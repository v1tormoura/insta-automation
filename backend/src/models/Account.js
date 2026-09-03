const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    username: String,

    name: {
      type: String,
      default: '',
    },

    /* Caminho local versionado: /uploads/avatars/<user>.jpg?v=<ts>.
       A versão é o que faz o React repintar quando a foto troca — o arquivo
       tem nome fixo, então sem ela o `src` não muda e a tela fica na antiga. */
    avatar: {
      type: String,
      default: '',
    },

    /* O caminho da URL do CDN de onde o avatar atual veio.
       As URLs do Instagram são assinadas e mudam a cada leitura, então
       comparar URLs inteiras diria "mudou" sempre e o sync rebaixaria a foto
       de 5 em 5 minutos. O caminho é estável por imagem — é a assinatura. */
    avatarOrigem: {
      type: String,
      default: '',
    },

    followers: {
      type: Number,
      default: 0,
    },

    following: {
      type: Number,
      default: 0,
    },

    postsCount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      default: 'ativa',
    },

    bio: {
      type: String,
      default: '',
    },

    externalLink: {
      type: String,
      default: '',
    },

    proxy: {
      type: String,
      default: '',
    },
    
    proxyStatus: {
      type: String,
      default: 'nao_testado',
    },

    // IP de saída detectado no último teste do proxy desta conta —
    // exibido no card para confirmar por onde a conta está saindo.
    proxyIp: {
      type: String,
      default: '',
    },

    proxyLastCheck: {
      type: Date,
      default: null,
    },

    // Última edição de perfil aplicada. Serve de trava: alterações de perfil em
    // sequência são um dos padrões que o Instagram mais penaliza.
    lastProfileEditAt: {
      type: Date,
      default: null,
    },

    lastSync: {
      type: Date,
      default: null,
    },

    lastHealthCheck: {
      type: Date,
      default: null,
    },

    // 🔥 CONTROLE DE POSTAGEM

    dailyPostLimit: {
      type: Number,
      default: 999999,
    },

    postsToday: {
      type: Number,
      default: 0,
    },

    lastPostDate: {
      type: Date,
      default: null,
    },

    lastPostAt: {
      type: Date,
      default: null,
    },

    // 🔥 SAÚDE DA CONTA

    healthStatus: {
      type: String,
      enum: ['ativa', 'restrita', 'erro_login', 'sessao_expirada', 'banida', 'token_invalido', 'conta_pessoal'],
      default: 'ativa',
    },

    lastError: {
      type: String,
      default: '',
    },
    isBusy: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      default: '',
    },

    // Email ou telefone usado para login (quando username não funciona na API privada)
    loginEmail: {
      type: String,
      default: '',
    },
    busySince: {
      type: Date,
      default: null,
    },

    busyReason: {
      type: String,
      default: '',
    },

    // ─── Private Instagram API (instagram-private-api) ───────────────────
    // igSession — serialized session state (login once, reuse for all posts)
    // Cleared automatically on session errors; re-login happens transparently.

    igSession: {
      type: String,
      default: '',
    },

    // sessionid bruto extraído do browser via 🍪 — não é apagado pelo keepAlive
    rawWebSessionid: {
      type: String,
      default: '',
    },

    // ─── Meta Graph API ───────────────────────────────────────────────────
    // igUserId      — numeric Instagram User ID (e.g. "17841400000000001")
    // accessToken   — long-lived user access token (valid ~60 days)
    // tokenExpiresAt — when the token expires (for refresh reminders)

    igUserId: {
      type: String,
      default: '',
    },

    accessToken: {
      type: String,
      default: '',
    },

    /* ── Graph API via Facebook Login ────────────────────────────────────
       O OAuth do Instagram (`instagram_business_*`) publica story, mas NÃO
       aceita figurinha de link: a Graph responde erro 9007. Link em story
       exige token vindo do Facebook Login, ligado a uma Página, com a conta
       do Instagram no modo comercial.
       
       São dois tokens porque são dois fluxos de autorização diferentes, e a
       conta pode ter um sem o outro. Guardar num campo só faria o segundo
       login apagar o primeiro. */
    fbAccessToken: {
      type: String,
      default: '',
      select: false,
    },
    fbPageId:   { type: String, default: '' },
    fbPageName: { type: String, default: '' },

    /* O id do Instagram COMO O FACEBOOK o enumera. Parece redundante com
       `igUserId` e não é: aquele veio do Instagram Login, este vem do
       `instagram_business_account` da Página. Assumir que são o mesmo número e
       errar publicaria o story no lugar errado — ou em lugar nenhum, com um
       erro que não diz que a causa foi um id de outro espaço. */
    fbIgUserId: { type: String, default: '' },
    fbTokenExpiresAt: { type: Date, default: null },

    tokenExpiresAt: {
      type: Date,
      default: null,
    },


    // profileId do Multilogin para auto-sync de cookies sem ação manual
    multiloginProfileId: {
      type: String,
      default: '',
    },

    // Última vez que o keepalive da sessão foi executado
    lastSessionKeepAlive: {
      type: Date,
      default: null,
    },

    // Estado serializado do ig client durante challenge pendente (persiste reinicializações)
    challengeState: {
      type: String,
      default: '',
    },

    // Segredo TOTP do Google Authenticator (gerado no setup do 2FA)
    // Formato: base32 string, ex: "JBSWY3DPEHPK3PXP"
    // Usado para gerar códigos 2FA automaticamente sem interação manual
    totpSecret: {
      type: String,
      default: '',
    },

    // ─── Provider selector ────────────────────────────────────────────────────
    // Selects the Instagram API implementation for this account.
    // All existing accounts default to 'official' — zero migration needed.

    provider: {
      type: String,
      enum: ['official', 'instagrapi'],
      default: 'official',
    },

    // ─── Instagrapi session ───────────────────────────────────────────────────
    // Encrypted JSON blob equivalent to instagrapi's settings.json.
    // Never sent to the frontend — accountController.getAccounts strips it.
    // Uses the same AES-256-GCM getter/setter pattern as accessToken.

    instagrapiSession: {
      type: String,
      default: '',
    },

    // sessionStatus tracks the instagrapi session state machine.
    // Not a duplicate of healthStatus: healthStatus reflects overall account
    // health across both providers; sessionStatus is instagrapi-specific.

    sessionStatus: {
      type: String,
      enum: [
        'UNKNOWN', 'VALID', 'EXPIRING', 'INVALID', 'RECOVERING',
        'AUTH_REQUIRED', 'CHALLENGE_REQUIRED', 'FAILED', 'DISABLED',
        // Extended states:
        'RATE_LIMITED',   // Instagram rate-limited this account/IP
        'REAUTH_REQUIRED', // Re-login required (more specific than AUTH_REQUIRED)
        'NETWORK_ERROR',   // Transient infrastructure failure
      ],
      default: 'UNKNOWN',
    },

    // ─── Instagrapi timestamps ────────────────────────────────────────────────

    lastValidatedAt:         { type: Date,   default: null },
    lastSuccessfulRequestAt: { type: Date,   default: null },
    lastSessionErrorAt:      { type: Date,   default: null },
    lastLoginAt:             { type: Date,   default: null },
    lastRateLimitAt:         { type: Date,   default: null },

    // ─── Instagrapi counters ──────────────────────────────────────────────────

    loginAttempts:       { type: Number, default: 0 },
    reloginAttempts:     { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },
    rateLimitCount:      { type: Number, default: 0 },
    // Incremented on each new login to invalidate stale in-memory sessions.
    sessionVersion:      { type: Number, default: 0 },

    accountType: {
      type: String,
      default: '',
    },

    // ─── Aquecimento ──────────────────────────────────────────────────────
    warmupActive: { type: Boolean, default: false },
    warmupIntensity: { type: String, default: 'leve' },
    warmupActions: { type: [String], default: [] },
    warmupInterval: { type: Number, default: 30 },
    warmupMaxLikes: { type: Number, default: 6 },
    warmupMaxComments: { type: Number, default: 2 },
    warmupMaxFollows: { type: Number, default: 4 },
    warmupComments: { type: [String], default: [] },

    /* De onde sai o conteúdo do aquecimento mobile.

       'reels'   — o que o aplicativo mostraria a esta conta. Padrão porque
                   funciona sem configuração e sem a conta seguir ninguém.
       'hashtag' — dentro de um assunto. Uma conta de moda curtindo moda
                   constrói um sinal; curtindo o que calhar, não constrói nada.
       'feed'    — só serve a quem já segue gente. Em conta nova devolve vazio,
                   e por isso não é o padrão. */
    warmupFonte:    { type: String, enum: ['reels', 'hashtag', 'feed'], default: 'reels' },
    warmupHashtags: { type: [String], default: [] },
    warmupMaxStories: { type: Number, default: 3 },

    /* Estes dois o job já gravava — e o mongoose descartava, porque não
       estavam declarados aqui. Em modo estrito (o padrão), um campo fora do
       schema some do `findByIdAndUpdate` sem erro nenhum: o job "salvava" a
       duração máxima, a leitura seguinte não a encontrava, e o encerramento
       automático nunca acontecia. */
    warmupMaxDuration: { type: Number, default: 0 },
    warmupStartedAt:   { type: Date,   default: null },

    // ─── Divulgação automática (Promo) ───────────────────────────────────
    promoEnabled:        { type: Boolean, default: false },
    promoLink:           { type: String,  default: '' },
    autoComment:         { type: Boolean, default: true  },
    autoCommentTemplate: { type: String,  default: '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}' },
    autoStory:           { type: Boolean, default: false },
    autoBio:             { type: Boolean, default: false },
    lastPromoAt:         { type: Date,    default: null  },
  },
  {
    timestamps: true,
  }
);

accountSchema.index({ isBusy: 1, busySince: 1 });
accountSchema.index({ healthStatus: 1 });
accountSchema.index({ provider: 1 });

// ─── Token encryption (transparent) ──────────────────────────────────────────
// Getter decrypts on read; setter encrypts on write.
// Plaintext tokens pass through unchanged (backward compatible).
// Without ENCRYPTION_KEY: no-op — tokens stored as plaintext.

const { encrypt: _encryptToken, decrypt: _decryptToken } = require('../services/tokenEncryption');

/* Uma LISTA, e não um bloco por campo.
   
   Eram dois campos com o mesmo tratamento repetido em quatro lugares — getter,
   setter e duas metades do hook de update. Acrescentar um terceiro token
   significava lembrar dos quatro, e o custo de esquecer um deles não é um bug
   comum: é token gravado em texto puro no banco, em silêncio, descoberto só
   por alguém que abra a coleção.
   
   Com a lista, o campo novo entra em um lugar. */
/* `password` entra aqui. Ela já era guardada — vários fluxos dependem dela
   (login-private, init-mobile-session, importação em lote) — só que em texto
   puro no banco. Cifrar não é mudança de comportamento: o getter devolve em
   claro e o setter cifra ao gravar, então quem lê e escreve nem percebe.

   A migração é sozinha e sem script: `decrypt` deixa passar valor que não está
   cifrado, então as senhas antigas continuam funcionando e cada regravação
   converte a sua. */
const CAMPOS_CIFRADOS = ['accessToken', 'instagrapiSession', 'fbAccessToken', 'password'];

for (const campo of CAMPOS_CIFRADOS) {
  accountSchema.path(campo)
    .get(function (v) { try { return _decryptToken(v); } catch { return v; } })
    .set(function (v) { try { return _encryptToken(v); } catch { return v; } });
}

// findByIdAndUpdate / updateOne ignoram os setters do schema → cifra aqui.
accountSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function () {
  const u = this.getUpdate();
  if (!u) return;
  for (const campo of CAMPOS_CIFRADOS) {
    const cru = u?.[campo] ?? u?.$set?.[campo];
    if (!cru || typeof cru !== 'string') continue;
    try {
      const cifrado = _encryptToken(cru);
      if (u[campo] !== undefined)       u[campo]       = cifrado;
      if (u.$set?.[campo] !== undefined) u.$set[campo] = cifrado;
    } catch { /* mantém como está em caso de erro */ }
  }
});

// Ensure getters run on toObject / toJSON calls used by controllers
accountSchema.set('toObject', { getters: true });
accountSchema.set('toJSON',   { getters: true });

module.exports = mongoose.model('Account', accountSchema);
