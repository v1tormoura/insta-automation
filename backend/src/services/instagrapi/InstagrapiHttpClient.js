'use strict';

const { resolveProxyFor } = require('../globalProxy');

const UPLOADS_DIR      = process.env.UPLOADS_DIR || '/app/uploads';
const DEFAULT_BASE     = process.env.INSTAGRAPI_SERVICE_URL || 'http://instagrapi-svc:8000';
const TIMEOUT_FAST     = 15_000;   // ms — for session operations (status, ping, evict)
const TIMEOUT_LOGIN    = 90_000;   // ms — Instagram login can take 20-90 s under load
const TIMEOUT_MEDIA    = 180_000;  // ms — up to 3 min for video uploads
// Publish lock TTL: longer than the media upload timeout so the lock never
// expires while a valid upload is in progress.
const LOCK_TTL_PUBLISH = 210_000;  // ms — 3.5 min
// Comentar é uma requisição só, não um upload — não precisa do TTL do publish.
// Um TTL curto também libera a conta mais cedo se o processo morrer no meio.
const TIMEOUT_COMMENT  = 30_000;   // ms

// Insights de story: uma conta com muitos stories ativos pode precisar de uma
// requisicao por story quando o feed nao traz a audiencia, entao o teto e maior
// que o do comentario. O lock fica acima do timeout, para nunca expirar antes.
const TIMEOUT_STORY_INSIGHTS  = 60_000;   // ms
const LOCK_TTL_STORY_INSIGHTS = 90_000;   // ms

/* Maior que o de story: em conta profissional o serviço faz uma chamada de
   insights POR publicação, e doze publicações são doze idas ao Instagram. Um
   limite curto aqui abortaria no meio e a conta ficaria sem métrica nenhuma —
   pior que demorar. */
const TIMEOUT_MEDIA_INSIGHTS  = 120_000;  // ms
const LOCK_TTL_MEDIA_INSIGHTS = 150_000;  // ms
const LOCK_TTL_COMMENT = 45_000;   // ms — acima do timeout, para o lock nunca
                                   // expirar com a requisição ainda em voo

/* Aquecimento: cada chamada é UMA ação no Instagram, não um upload. O que pode
   demorar é a descoberta, que traz uma lista; curtir e seguir são uma
   requisição só. O lock fica curto de propósito — o intervalo entre ações do
   ciclo é medido em dezenas de segundos, e segurar a conta travada durante essa
   espera impediria a publicação de uma campanha que caísse no meio. */
const TIMEOUT_WARMUP_DESCOBRIR = 60_000;
const TIMEOUT_WARMUP_ACAO      = 30_000;
const LOCK_TTL_WARMUP          = 90_000;

/**
 * HTTP client for the Docker-internal Python instagrapi service.
 *
 * Responsibilities:
 *  - Calls the Python FastAPI service for all Instagram operations.
 *  - Coordinates session load/save with SessionManager (MongoDB persistence).
 *  - Maps media relative paths to absolute container paths (/app/uploads/…).
 *
 * SECURITY:
 *  - Passwords are never stored — they are passed through in-memory only.
 *  - Session blobs are always encrypted by SessionManager before MongoDB storage.
 *  - The Python service is only reachable from the internal Docker network.
 */
class InstagrapiHttpClient {
  /**
   * @param {string|null}  baseUrl        — override service URL (null = use env var)
   * @param {import('./SessionManager').SessionManager} sessionManager
   */
  constructor(baseUrl, sessionManager) {
    this._base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this._sm   = sessionManager;
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async _post(endpoint, body, timeoutMs = TIMEOUT_FAST) {
    const url = this._base + endpoint;
    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw _serviceUnavailable(e.message);
    }
    return _parseResponse(res, endpoint);
  }

  async _get(endpoint, timeoutMs = TIMEOUT_FAST) {
    const url = this._base + endpoint;
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw _serviceUnavailable(e.message);
    }
    return _parseResponse(res, endpoint);
  }

  // ── Session management ───────────────────────────────────────────────────

  /**
   * Ensures the Python service has this account's session in its in-memory pool.
   * If the pool entry is missing (e.g. after a Python restart), loads from MongoDB
   * and sends the decrypted settings to the Python service.
   * Structured event: SESSION_RESTORED is logged by SessionManager.load().
   */
  async ensureSession(account) {
    const accountId = String(account._id);
    const { loaded } = await this._get(
      `/session/status?account_id=${encodeURIComponent(accountId)}`
    );
    if (loaded) return;

    const settings = await this._sm.load(accountId);
    if (!settings) {
      const e = new Error('Conta sem sessão instagrapi — faça login pelo painel');
      e.code  = 'NO_INSTAGRAPI_SESSION';
      throw e;
    }
    await this._post('/session/load', {
      account_id: accountId,
      settings,
      // Proxy da conta, ou o proxy global quando a conta não tem um próprio.
      proxy: (await resolveProxyFor(account)) || null,
    });
  }

  /**
   * Performs a fresh login with username + password.
   * The password travels in-memory only — it is NEVER persisted.
   * Returns { status: 'AUTHENTICATED', settings } on success.
   * Returns { status: 'TWO_FACTOR_REQUIRED' } when Instagram requires 2FA
   * (caller must handle this case and call verify2fa() after getting the code).
   * Saves the resulting session to MongoDB via SessionManager.
   *
   * @param {Object}  account          — Mongoose Account document
   * @param {string}  username
   * @param {string}  password         — never stored
   * @param {string}  [verificationCode=''] — TOTP or SMS/email 2FA code (optional on first try)
   */
  /**
   * Diagnóstico de saída de rede — não faz login e não recebe senha.
   *
   * Serve para separar duas causas que produzem a MESMA mensagem na tela:
   * senha errada e IP recusado pelo Instagram. Ver o comentário do endpoint
   * /session/diagnostico no serviço Python para como interpretar a resposta.
   */
  async diagnosticar(account) {
    return this._post('/session/diagnostico', {
      account_id: String(account._id),
      proxy:      (await resolveProxyFor(account)) || null,
    }, 30000);
  }

  async login(account, username, password, verificationCode = '') {
    const accountId = String(account._id);

    // A origem viaja junto porque o serviço Python não tem como deduzi-la —
    // ele recebe só a URL. Sem isso o log dizia "conta" para qualquer proxy
    // que chegasse, inclusive o global, e quem lesse procuraria o problema no
    // lugar errado.
    const { resolverComOrigem } = require('../globalProxy');
    const rota = await resolverComOrigem(account);

    const result = await this._post('/session/login', {
      account_id:         accountId,
      username,
      password,
      verification_code:  verificationCode || '',
      proxy:              rota.url || null,
      proxy_origem:       rota.origem,
    }, TIMEOUT_LOGIN);

    // TWO_FACTOR_REQUIRED is returned as a 2xx (202) — not an error
    if (result.status === 'TWO_FACTOR_REQUIRED') {
      return result;
    }

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Authenticates using an existing Instagram session ID (from browser cookie).
   * Does NOT call accounts/login/ — bypasses IP-level rate limits entirely.
   *
   * The sessionid is never persisted in Node.js — it is forwarded to Python and
   * discarded immediately after the request. Only the resulting instagrapi
   * settings blob (encrypted by SessionManager) is stored in MongoDB.
   *
   * @param {Object} account   — Mongoose Account document
   * @param {string} sessionid — value of the 'sessionid' cookie from instagram.com
   */
  async loginBySessionid(account, sessionid) {
    const accountId = String(account._id);
    const result = await this._post('/session/login-by-sessionid', {
      account_id: accountId,
      sessionid,
      proxy: (await resolveProxyFor(account)) || null,
    }, TIMEOUT_LOGIN);

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Reconhece o checkpoint "aprove no app" após a aprovação manual do usuário.
   * Não autentica por si — depois disto o login deve ser repetido com a senha.
   *
   * NOT_APPROVED_YET indica que o Instagram ainda não registrou a aprovação.
   */
  async challengeApproved(account) {
    return this._post('/session/challenge-approved', {
      account_id: String(account._id),
    }, TIMEOUT_LOGIN);
  }

  /**
   * Conclui um desafio de verificação (checkpoint por e-mail/SMS) com o código
   * que o Instagram enviou. Deve ser chamado após login() devolver
   * { status: 'CHALLENGE_REQUIRED' }.
   *
   * Código errado vem como CHALLENGE_CODE_REJECTED — o desafio segue aberto e o
   * usuário pode tentar outro código sem refazer o login.
   *
   * @param {Object} account
   * @param {string} code — código de verificação recebido
   */
  async challengeCode(account, code) {
    const accountId = String(account._id);
    const result = await this._post('/session/challenge-code', {
      account_id: accountId,
      code,
    }, TIMEOUT_LOGIN);

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Completes a pending 2FA challenge using the code sent to the user's device.
   * Must be called after login() returned { status: 'TWO_FACTOR_REQUIRED' }.
   * Saves the resulting session to MongoDB via SessionManager.
   *
   * @param {Object} account           — Mongoose Account document
   * @param {string} verificationCode  — SMS/email/TOTP code
   */
  async verify2fa(account, verificationCode) {
    const accountId = String(account._id);
    const result = await this._post('/session/verify-2fa', {
      account_id:        accountId,
      verification_code: verificationCode,
    }, TIMEOUT_LOGIN);

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Lightweight session check — calls Python /session/ping which calls account_info().
   * Used by the health check to verify the session is still active with Instagram.
   * Never attempts a new login.
   *
   * @param {Object} account — Mongoose Account document
   * @returns {Promise<{valid, username, full_name, pk}>}
   */
  async pingSession(account) {
    const accountId = String(account._id);
    const result = await this._get(`/session/ping?account_id=${encodeURIComponent(accountId)}`);
    // Persiste o estado devolvido: o Instagram rotaciona cookies e tokens durante
    // as requisições, e descartar isso faz o blob salvo envelhecer até deixar de
    // ser aceito — a sessão morria por desatualização, não por invalidação.
    if (result?.settings) {
      await this._sm.save(accountId, result.settings).catch(() => {});
    }
    return result;
  }

  /**
   * Fetches a safe subset of public profile info for the account's username.
   * Called immediately after a successful login to populate avatar, display name, etc.
   * Non-blocking from the caller's perspective — errors should be caught and logged,
   * not allowed to break the login flow.
   *
   * @param {Object} account   — Mongoose Account document
   * @param {string} username
   * @returns {Promise<{pk, full_name, profile_pic_url, follower_count, following_count, media_count}>}
   */
  async getUserInfo(account, username) {
    const accountId = String(account._id);
    const result = await this._get(
      `/session/userinfo?account_id=${encodeURIComponent(accountId)}&username=${encodeURIComponent(username)}`
    );
    // Mesmo motivo do pingSession: mantém o blob do banco em dia com o que o
    // Instagram acabou de emitir.
    if (result?.settings) {
      await this._sm.save(accountId, result.settings).catch(() => {});
    }
    return result;
  }

  /**
   * Evicts the account's client from the Python service pool.
   * Called after invalidation so stale sessions are not reused.
   * Best-effort — failure is silently ignored.
   */
  async evictSession(accountId) {
    await this._post('/session/evict', { account_id: String(accountId) }).catch(() => {});
  }

  // ── Publication ──────────────────────────────────────────────────────────

  /**
   * Publishes a Reel via the Python instagrapi service.
   * Acquires a per-account Redis lock to prevent concurrent publications.
   * Persists the updated session blob returned by Python to MongoDB.
   */
  async publishReel(account, postData) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const result = await this._post('/publish/reel', {
        account_id: accountId,
        media_path: _toContainerPath(postData.media),
        caption:    postData.caption || '',
        cover_path: _toContainerPath(postData.cover) || null,
      }, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Comenta em uma mídia específica, identificada pelo id que a publicação
   * devolveu.
   *
   * Usa o mesmo lock por conta do publish: comentário e publicação da mesma
   * conta nunca rodam ao mesmo tempo. O TTL é o curto — comentar é uma
   * requisição só, não um upload.
   *
   * O atraso configurado pelo usuário NÃO é esperado aqui: quem o representa é
   * o `delay` do job no BullMQ, então o worker não fica preso.
   *
   * @param {Object} account
   * @param {{mediaId: string, text: string}} dados
   * @returns {Promise<{status: string, comment_id: string, media_id: string}>}
   */
  async comment(account, { mediaId, text }) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_COMMENT, async () => {
      await this.ensureSession(account);
      const result = await this._post('/publish/comment', {
        account_id: accountId,
        media_id:   String(mediaId || ''),
        text:       String(text || ''),
      }, TIMEOUT_COMMENT);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Publica um story (foto ou vídeo) com link sticker opcional.
   *
   * O link exige elegibilidade da conta no Instagram (em geral 10 mil seguidores
   * ou verificação); sem isso o Instagram recusa e o erro é propagado.
   *
   * Posição do sticker (opcional) em coordenadas normalizadas 0..1, onde x/y são
   * o CENTRO do sticker. Ausentes → sticker centralizado (padrão da biblioteca).
   *
   * @param {Object} account
   * @param {{media: string, caption?: string, linkUrl?: string,
   *          linkX?: number, linkY?: number, linkWidth?: number,
   *          linkHeight?: number, linkRotation?: number}} storyData
   */
  async publishStory(account, storyData) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const body = {
        account_id: accountId,
        media_path: _toContainerPath(storyData.media),
        caption:    storyData.caption || '',
        link_url:   storyData.linkUrl || null,
        link_text:  storyData.linkText || null,
        // burned = a pílula já está nos pixels e aqui vai só a área de toque.
        link_sticker_mode: storyData.linkStickerMode || 'burned',
      };
      const posicao = {
        link_x:        storyData.linkX,
        link_y:        storyData.linkY,
        link_width:    storyData.linkWidth,
        link_height:   storyData.linkHeight,
        link_rotation: storyData.linkRotation,
      };
      for (const [chave, valor] of Object.entries(posicao)) {
        if (valor !== undefined && valor !== null && !Number.isNaN(Number(valor))) {
          body[chave] = Number(valor);
        }
      }
      const result = await this._post('/publish/story', body, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Audiência dos stories ativos da conta (janela de 24h do Instagram).
   *
   * Leitura, não publicação: usa o lock curto do comentário, não o de upload.
   * Segurar o lock de publicação por 3,5 min para ler uma métrica atrasaria as
   * publicações da conta sem motivo.
   *
   * @param {Object} account
   * @returns {Promise<{stories: Array, total: number, viewers: number}>}
   */
  async storyInsights(account) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_STORY_INSIGHTS, async () => {
      await this.ensureSession(account);
      const result = await this._post(
        '/insights/stories',
        { account_id: accountId },
        TIMEOUT_STORY_INSIGHTS,
      );
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Métricas das publicações recentes.
   *
   * O par deste método é o `storyInsights`, e a diferença entre os dois é a
   * razão de existir: métrica de POST vinha só da Graph API, que exige token
   * da Meta. Numa base só instagrapi aquele caminho encontrava zero contas e
   * não fazia nada — a opção "visualizações de post" ficava ligada no painel
   * sem ter como funcionar.
   *
   * O tempo limite é maior que o de story porque o serviço pode fazer uma
   * chamada de insights POR publicação quando a conta é profissional.
   */
  async mediaInsights(account, quantidade = 12) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_MEDIA_INSIGHTS, async () => {
      await this.ensureSession(account);
      const result = await this._post(
        '/insights/media',
        { account_id: accountId, quantidade },
        TIMEOUT_MEDIA_INSIGHTS,
      );
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Edita nome, bio e link da bio (external_url) pela sessão instagrapi.
   * Campos ausentes não são alterados — account_edit sobrescreve o que recebe.
   *
   * @param {Object} account
   * @param {{biography?: string, externalUrl?: string, fullName?: string}} fields
   */
  async editProfile(account, fields) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const body = { account_id: accountId };
      if (fields.biography   !== undefined) body.biography    = fields.biography;
      if (fields.externalUrl !== undefined) body.external_url = fields.externalUrl;
      if (fields.fullName    !== undefined) body.full_name    = fields.fullName;
      // 1=masculino, 2=feminino, 3=personalizado
      if (fields.gender      !== undefined) body.gender       = Number(fields.gender);

      const result = await this._post('/profile/edit', body, TIMEOUT_LOGIN);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /** Troca a foto de perfil pela sessão instagrapi. */
  async changeProfilePicture(account, imagePath) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const result = await this._post('/profile/picture', {
        account_id:  accountId,
        image_path:  _toContainerPath(imagePath),
      }, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Publishes a photo post via the Python instagrapi service.
   * Acquires a per-account Redis lock to prevent concurrent publications.
   * Persists the updated session blob returned by Python to MongoDB.
   */
  async publishPost(account, postData) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const result = await this._post('/publish/post', {
        account_id: accountId,
        media_path: _toContainerPath(postData.media),
        caption:    postData.caption || '',
      }, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /* ── Aquecimento ────────────────────────────────────────────────────────
     Primitivas. O ritmo, os limites e o registro no log ficam no job do Node,
     que já os tem: repetir a decisão aqui criaria duas versões dela. */

  /**
   * Mídias para o ciclo agir sobre elas.
   * @param {Object} account
   * @param {{fonte?: 'reels'|'hashtag'|'feed', hashtag?: string, amount?: number}} [opcoes]
   * @returns {Promise<{itens: Array<{media_id,media_pk,code,media_type,user_id,username,like_count}>, fonte: string}>}
   */
  async warmupDescobrir(account, { fonte = 'reels', hashtag = '', amount = 10 } = {}) {
    return this._acaoDeAquecimento(account, '/warmup/descobrir', {
      fonte, hashtag: hashtag || null, amount,
    }, TIMEOUT_WARMUP_DESCOBRIR);
  }

  /** Curte uma mídia devolvida por `warmupDescobrir`. */
  async warmupCurtir(account, mediaId) {
    return this._acaoDeAquecimento(account, '/warmup/curtir', { media_id: String(mediaId || '') });
  }

  /**
   * Marca mídias como vistas.
   *
   * Barata e invisível para terceiros — ninguém é notificado de que você viu um
   * post. É a ação mais segura do aquecimento, e a única que faz sentido
   * executar sozinha numa conta recém-criada.
   */
  async warmupVisto(account, mediaIds) {
    return this._acaoDeAquecimento(account, '/warmup/visto', {
      media_ids: (Array.isArray(mediaIds) ? mediaIds : [mediaIds]).map(String).filter(Boolean),
    });
  }

  /** Segue um perfil. A ação mais vigiada — o teto por ciclo é do job. */
  async warmupSeguir(account, userId) {
    return this._acaoDeAquecimento(account, '/warmup/seguir', { user_id: String(userId || '') });
  }

  /** Vê os stories de um perfil e os marca como vistos. */
  async warmupStories(account, userId, amount = 5) {
    return this._acaoDeAquecimento(account, '/warmup/stories', {
      user_id: String(userId || ''), amount,
    });
  }

  async _acaoDeAquecimento(account, endpoint, corpo, timeoutMs = TIMEOUT_WARMUP_ACAO) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_WARMUP, async () => {
      await this.ensureSession(account);
      const result = await this._post(endpoint, { account_id: accountId, ...corpo }, timeoutMs);
      /* A sessão volta atualizada a cada ação e precisa ser gravada. Sem isto,
         a conta acumula estado no serviço e o perde no primeiro reinício — e o
         sintoma seria a sessão "expirar" sozinha depois de um deploy. */
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }
}

// ── Module-private helpers ────────────────────────────────────────────────────

function _toContainerPath(rel) {
  if (!rel) return null;
  if (rel.startsWith('/')) return rel; // already absolute
  return `${UPLOADS_DIR}/${rel}`;
}

function _serviceUnavailable(msg) {
  const e = new Error(`InstagrapiService inacessível: ${msg}`);
  e.code  = 'INSTAGRAPI_SERVICE_UNAVAILABLE';
  return e;
}

async function _parseResponse(res, endpoint) {
  let body;
  try {
    body = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(`InstagrapiService: resposta inválida de ${endpoint} (${res.status}): ${text}`);
  }
  if (!res.ok) {
    const detail  = body?.detail ?? body;
    const code    = typeof detail === 'object' ? detail.code  : null;
    const message = typeof detail === 'object' ? detail.message : String(detail);
    const e       = new Error(`InstagrapiService ${endpoint}: ${message}`);
    e.code        = code || `INSTAGRAPI_HTTP_${res.status}`;
    e.httpStatus  = res.status;
    // Detalhe cru do Python, separado do texto do Error — usado só quando o
    // código não tem mensagem curada, para não exibir um palpite errado.
    e.detail      = typeof message === 'string' ? message : '';
    throw e;
  }
  return body;
}

module.exports = { InstagrapiHttpClient };
