'use strict';

/**
 * A cota de publicação da API do Instagram.
 *
 * ── O que é
 *
 * O Meta limita quantas publicações uma conta faz pela Content Publishing API
 * numa janela deslizante de 24 horas. `GET /{ig-user-id}/content_publishing_limit`
 * devolve `quota_usage` e `config.quota_total`. Medido em 20/09/2026: a config
 * dizia 100 e o Meta recusou em 50 — "Vous avez atteint le nombre maximal de
 * publications pouvant être publiées par l'API Content Publishing". O 100 é
 * campo legado; a regra vigente é 50. Por isso o limite aqui é 50, e não o
 * `quota_total` da resposta.
 *
 * ── Por que este módulo existe
 *
 * Sem ele, o job bateu nessa parede 55 vezes seguidas, a cada 10 minutos, por
 * 13 horas: cada tentativa virava um Post com erro em francês e consumia uma
 * rodada. A cota não é "ritmo humano" que se possa desligar — é o Meta
 * recusando. Então ela entra no mesmo lugar em que a janela e o teto entravam
 * (`podePublicar`), como mais um motivo de "não agora": a rodada é adiada até
 * a janela liberar, sem criar Post, sem gastar rodada, sem erro.
 *
 * ── Quando libera
 *
 * A janela é deslizante: um lugar abre quando a publicação mais antiga entre as
 * últimas 50 completa 24h. O Meta não devolve esse horário; estimamos pelas
 * nossas próprias gravações (`Post.midiasPublicadas`). Sem registro suficiente
 * (o campo é recente), tenta de novo em 1 hora — e a tela diz isso.
 */

const LIMITE = parseInt(process.env.IG_COTA_API_24H, 10) || 50;
const CACHE_MS = 60_000;
const JANELA_MS = 24 * 60 * 60 * 1000;
const SEM_REGISTRO_MS = 60 * 60 * 1000;

const _cache = new Map(); // igUserId → { em, dados }

/** A mensagem do Meta, em qualquer idioma que o app estiver. */
function ehErroDeCota(err) {
  const m = String(err?.message || err || '');
  return /nombre maximal de publications|content publishing|número máximo de publica|número máximo de posts|maximum number of (posts|publications)|content_publish_rate_limit|publishing limit|too many publishes/i.test(m);
}

/**
 * Uso atual da cota. `null` quando não deu para consultar — e aí NÃO bloqueia:
 * o erro real, se vier, é tratado depois. Bloquear por falha de consulta
 * pararia a fila inteira por um soluço de rede.
 */
async function consultar(account, { agora = Date.now(), limiteImpl = null } = {}) {
  if (!account?.accessToken || !account?.igUserId) return null;
  const chave = String(account.igUserId);
  const c = _cache.get(chave);
  if (c && agora - c.em < CACHE_MS) return c.dados;
  try {
    const d = await (limiteImpl || require('./instagramAPI').limiteDePublicacao)(account);
    const usage = Number(d.quota_usage) || 0;
    const dados = { usage, total: Number(d.config?.quota_total) || null, limite: LIMITE, cheia: usage >= LIMITE };
    _cache.set(chave, { em: agora, dados });
    return dados;
  } catch {
    return null;
  }
}

/**
 * Depois de um erro de cota REAL: a cota está cheia, não importa o que a
 * consulta disse. Grava no cache para as próximas rodadas não tentarem.
 */
function marcarCheia(account, { agora = Date.now() } = {}) {
  if (!account?.igUserId) return;
  _cache.set(String(account.igUserId), { em: agora, dados: { usage: LIMITE, total: null, limite: LIMITE, cheia: true } });
}

/**
 * Quando a janela libera um lugar, estimado pelas nossas gravações.
 *
 * @param {Date[]} momentos  instantes das publicações da conta nas últimas 24h
 */
function liberacaoEstimada(momentos, agora = new Date()) {
  const ts = (momentos || []).map(m => new Date(m).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const piso = agora.getTime() + SEM_REGISTRO_MS; // nunca no passado: registro incompleto dava "libera 12:11" as 14:11
  let estimada;
  if (ts.length >= LIMITE) estimada = ts[ts.length - LIMITE] + JANELA_MS; // a mais antiga das últimas LIMITE sai da janela
  else if (ts.length)      estimada = ts[0] + JANELA_MS;                  // registro incompleto: quando a mais antiga que conhecemos sai
  else                     estimada = piso;                               // sem registro: tenta em 1h
  return new Date(Math.max(estimada, piso));
}

async function proximaLiberacao(account, agora = new Date()) {
  const { sql } = require('../db');
  const desde = new Date(agora.getTime() - JANELA_MS);
  const linhas = await sql`
    select (m->>'em')::timestamptz as em
    from posts, jsonb_array_elements(midias_publicadas) m
    where m->>'accountId' = ${String(account.id)} and (m->>'em')::timestamptz >= ${desde}`;
  return liberacaoEstimada(linhas.map(l => l.em), agora);
}

function motivo(cota, ate) {
  const hora = ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `cota da API do Instagram cheia (${cota.usage}/${cota.limite} em 24h) — libera ${hora}`;
}

module.exports = { consultar, marcarCheia, ehErroDeCota, proximaLiberacao, liberacaoEstimada, motivo, LIMITE, CACHE_MS, _cache };
