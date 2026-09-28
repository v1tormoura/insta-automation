'use strict';

/**
 * Publicação no Instagram pela API oficial — o mesmo fluxo do Publicador
 * (publicador-saas: integrations/meta/publishing.ts + publishExecutor.ts),
 * portado em 28/09/2026.
 *
 *   1. POST /{ig-user-id}/media           cria o container
 *        reel  → media_type=REELS, video_url, caption, cover_url | thumb_offset, share_to_feed
 *        foto  → image_url, caption
 *        story → media_type=STORIES, image_url | video_url
 *   2. GET  /{container}?fields=status_code,status   até FINISHED
 *        vídeo: consulta a cada 8s no 1º minuto, 20s até 5 min, 45s depois
 *        foto:  a cada 3s
 *        limite de 45 min; EXPIRED descarta o container e cria outro
 *   3. POST /{ig-user-id}/media_publish creation_id={container}
 *        "ainda não pronto" → volta a consultar o status
 *        resposta perdida   → confere se o container virou PUBLISHED antes de
 *                             tentar de novo: publicar duas vezes é o pior erro
 *   4. GET  /{media-id}?fields=permalink
 *
 * A Meta BAIXA a mídia da URL pública do arquivo — o arquivo vai como foi
 * enviado. Nada de upload direto, nada de conversão aqui.
 *
 * Erros: tentativas até 5, com espera dobrando a partir de 1 min (teto de
 * 30 min) — só para o que é passageiro (rede, 5xx, limite de chamadas,
 * container expirado ou lento). Erro da conta ou da mídia falha na hora.
 */

const { get, post, GraphError } = require('./instagramAPI');

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const MAX_TENTATIVAS = 5;
const LIMITE_DO_CONTAINER = 45 * MINUTO;

/* Os tempos passam por aqui para os testes poderem encurtá-los. */
const tempo = {
  esperar: ms => new Promise(r => setTimeout(r, ms)),
  agora: () => Date.now(),
};

/** Erro que outra tentativa pode resolver (o Publicador chama de RetryableJobError). */
class ErroPassageiro extends Error {
  constructor(code, message, esperaMs = MINUTO) {
    super(message);
    this.name = 'ErroPassageiro';
    this.code = code;
    this.esperaMs = esperaMs;
  }
}

function exigirConexao(conta) {
  if (!conta?.igUserId || !conta?.accessToken) {
    throw Object.assign(
      new Error(`@${conta?.username || '?'} não está conectada pela API oficial — reconecte em Contas`),
      { code: 'SEM_TOKEN' });
  }
}

/* ── Chamadas da Content Publishing API (publishing.ts) ─────────────────── */

async function criarContainer(conta, entrada) {
  let campos;
  if (entrada.tipo === 'IMAGE') {
    campos = { image_url: entrada.midia.url, caption: entrada.legenda || undefined };
  } else if (entrada.tipo === 'REEL') {
    campos = {
      media_type: 'REELS',
      video_url: entrada.midia.url,
      caption: entrada.legenda || undefined,
      cover_url: entrada.capaUrl || undefined,
      thumb_offset: entrada.capaUrl ? undefined : entrada.thumbOffsetMs ?? undefined,
      share_to_feed: entrada.noFeed === false ? 'false' : 'true',
    };
  } else {
    campos = {
      media_type: 'STORIES',
      ...(entrada.midia.kind === 'image' ? { image_url: entrada.midia.url } : { video_url: entrada.midia.url }),
    };
  }
  const d = await post(`/${conta.igUserId}/media`, campos, conta.accessToken);
  if (!d?.id) throw new ErroPassageiro('SEM_CONTAINER', 'A Meta não devolveu o id do container');
  return String(d.id);
}

async function statusDoContainer(conta, id) {
  const d = await get(`/${id}`, { fields: 'status_code,status' }, conta.accessToken);
  return { statusCode: d.status_code, status: d.status || null };
}

async function publicarContainer(conta, id) {
  const d = await post(`/${conta.igUserId}/media_publish`, { creation_id: id }, conta.accessToken);
  if (!d?.id) throw new ErroPassageiro('SEM_MIDIA', 'A Meta não devolveu o id da publicação');
  return String(d.id);
}

async function linkDaMidia(conta, mediaId) {
  try {
    return (await get(`/${mediaId}`, { fields: 'permalink' }, conta.accessToken)).permalink || null;
  } catch {
    return null; // opcional; stories às vezes não têm
  }
}

/** Resposta do media_publish perdida: acha a mídia pela data e pela legenda. */
async function acharPublicada(conta, entrada, desde) {
  try {
    const d = await get(`/${conta.igUserId}/media`, { fields: 'id,caption,timestamp', limit: 10 }, conta.accessToken);
    const achada = (d.data || []).find(m => m.timestamp && new Date(m.timestamp).getTime() >= desde - MINUTO
      && (entrada.tipo === 'STORY' || (m.caption || '') === (entrada.legenda || '')));
    return achada?.id || null;
  } catch {
    return null;
  }
}

/* ── Classificação de erro (errors.ts + decideFailure) ──────────────────── */

/** "Ainda processando" na hora do media_publish (9007 / 2207027). */
function naoPronto(err) {
  return Number(err?.code) === 9007 || Number(err?.subcode) === 2207027
    || /not ready|isn't ready|não está pronta/i.test(String(err?.message || ''));
}

function passageiro(err) {
  if (err instanceof ErroPassageiro) return true;
  if (!(err instanceof GraphError)) return true;                 // rede, timeout
  const code = Number(err.code);
  if (err.status >= 500) return true;
  if ([1, 2, 4, 17, 32, 613, -1].includes(code)) return true;    // instabilidade e limite de chamadas
  if (err.subcode && [2207001, 2207003, 2207020, 2207032, 2207053].includes(Number(err.subcode))) return true;
  return false;
}

function ehErroDaConta(err) {
  return err?.code === 'SEM_TOKEN' || !!require('./contas').classificarErro(err);
}

/* ── A execução de UMA publicação numa conta ─────────────────────────────── */

function intervaloDeConsulta(entrada, idadeMs) {
  const video = entrada.midia.kind === 'video';
  if (!video) return 3 * SEGUNDO;
  return idadeMs < MINUTO ? 8 * SEGUNDO : idadeMs < 5 * MINUTO ? 20 * SEGUNDO : 45 * SEGUNDO;
}

async function uma(conta, entrada, estado) {
  if (!estado.containerId) {
    estado.containerId = await criarContainer(conta, entrada);
    estado.criadoEm = tempo.agora();
  }

  for (;;) {
    const idade = tempo.agora() - estado.criadoEm;
    const st = await statusDoContainer(conta, estado.containerId);
    if (st.statusCode === 'FINISHED') break;
    if (st.statusCode === 'PUBLISHED') {
      const id = await acharPublicada(conta, entrada, estado.inicio);
      return { mediaId: id, permalink: id ? await linkDaMidia(conta, id) : null };
    }
    if (st.statusCode === 'EXPIRED') {
      estado.containerId = null;
      throw new ErroPassageiro('CONTAINER_EXPIRADO', 'O container de mídia expirou; um novo será criado.');
    }
    if (st.statusCode === 'ERROR') {
      estado.containerId = null;
      const sub = Number(String(st.status || '').match(/(2207\d{3})/)?.[1]);
      throw new GraphError({ message: `A Meta não conseguiu processar a mídia: ${st.status || 'ERROR'}`, code: 9, error_subcode: Number.isFinite(sub) ? sub : undefined }, 400);
    }
    if (idade > LIMITE_DO_CONTAINER) {
      estado.containerId = null;
      throw new ErroPassageiro('PROCESSAMENTO_LENTO', 'O Instagram não terminou de processar a mídia a tempo.', 2 * MINUTO);
    }
    await tempo.esperar(intervaloDeConsulta(entrada, idade));
  }

  // Uma tentativa anterior pode ter chamado media_publish e perdido a resposta.
  if (estado.publishChamado) {
    const st = await statusDoContainer(conta, estado.containerId).catch(() => null);
    if (st?.statusCode === 'PUBLISHED') {
      const id = await acharPublicada(conta, entrada, estado.inicio);
      return { mediaId: id, permalink: id ? await linkDaMidia(conta, id) : null };
    }
  }
  estado.publishChamado = true;
  let mediaId;
  try {
    mediaId = await publicarContainer(conta, estado.containerId);
  } catch (err) {
    if (naoPronto(err)) {
      estado.publishChamado = false;
      await tempo.esperar(20 * SEGUNDO);
      return uma(conta, entrada, estado);
    }
    if (passageiro(err)) {
      const st = await statusDoContainer(conta, estado.containerId).catch(() => null);
      if (st?.statusCode === 'PUBLISHED') {
        const id = await acharPublicada(conta, entrada, estado.inicio);
        return { mediaId: id, permalink: id ? await linkDaMidia(conta, id) : null };
      }
    }
    throw err;
  }
  return { mediaId, permalink: await linkDaMidia(conta, mediaId) };
}

/**
 * Publica uma mídia numa conta.
 *
 * @param {object} conta — `igUserId`, `accessToken`, `username`
 * @param {{ tipo: 'REEL'|'IMAGE'|'STORY', midia: {kind: 'video'|'image', url: string},
 *           legenda?: string, capaUrl?: string, thumbOffsetMs?: number, noFeed?: boolean }} entrada
 * @returns {Promise<{mediaId: string|null, permalink: string|null}>}
 */
async function publicarNoInstagram(conta, entrada) {
  exigirConexao(conta);
  const estado = { containerId: null, criadoEm: 0, publishChamado: false, inicio: tempo.agora() };
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await uma(conta, entrada, estado);
      console.log(`✅ [Publicação] @${conta.username} — ${entrada.tipo} publicado (${r.mediaId || 'id não confirmado'})`);
      return r;
    } catch (err) {
      if (ehErroDaConta(err) || !passageiro(err) || tentativa >= MAX_TENTATIVAS) throw err;
      const base = err instanceof ErroPassageiro ? err.esperaMs : MINUTO;
      const espera = Math.min(30 * MINUTO, base * 2 ** (tentativa - 1));
      console.log(`↻ [Publicação] @${conta.username} — tentativa ${tentativa} falhou (${err.message}); nova em ${Math.round(espera / 1000)}s`);
      await tempo.esperar(espera);
    }
  }
}

module.exports = { publicarNoInstagram, ErroPassageiro, MAX_TENTATIVAS, _tempo: tempo };
