'use strict';

/**
 * Legenda aleatória da biblioteca, por publicação.
 *
 * ── O problema
 *
 * O Postar mandava UMA legenda para o envio inteiro: 40 reels, 40 vezes o
 * mesmo texto, em série, na mesma conta. O botão "Aleatória" da tela só
 * preenchia a caixa uma vez; a variação por conta (`{a|b}`) troca pedaços,
 * mas a legenda base seguia idêntica de um post para o outro.
 *
 * ── Como funciona
 *
 * Ligado no envio, cada Post da rodada recebe uma legenda sorteada da
 * biblioteca — só as ativas, e opcionalmente só de uma categoria. O sorteio é
 * feito para a RODADA inteira de uma vez: dentro dela não repete enquanto
 * houver legenda suficiente, e evita as últimas sorteadas nas rodadas
 * anteriores (o job guarda um histórico curto, `ultimas`). Biblioteca vazia
 * cai na legenda escrita na caixa — nunca deixa de publicar por falta de
 * texto.
 *
 * O texto sorteado segue o mesmo caminho da legenda comum: `{a|b}` por conta,
 * variáveis, comentário fixado. O sufixo ("Link na bio") vem AQUI, em vez de
 * colado na caixa pela tela, porque a caixa deixou de ser a legenda.
 *
 * `sortear` é puro (recebe o gerador) para os testes provarem a rotação sem
 * banco; `sortearParaRodada` é a casca que fala com o Mongo.
 */

const TAMANHO_DO_HISTORICO = 20;
const SUFIXO_MAXIMO = 300;
const CATEGORIA_MAXIMA = 60;

/** Normaliza a configuração vinda do banco ou da tela. */
function normalizar(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ativa: false, categoria: '', sufixo: '', ultimas: [] };
  return {
    ativa:     cfg.ativa === true || cfg.ativa === 'true',
    categoria: String(cfg.categoria || '').trim().slice(0, CATEGORIA_MAXIMA),
    /* O sufixo NÃO passa por trim: "\n\n🔗 Link na bio" começa com as quebras
       de linha de propósito — são elas que o separam da legenda. */
    sufixo:    typeof cfg.sufixo === 'string' ? cfg.sufixo.slice(0, SUFIXO_MAXIMO) : '',
    ultimas:   Array.isArray(cfg.ultimas) ? cfg.ultimas.map(String) : [],
  };
}

/**
 * Lê o campo do corpo da requisição (JSON em string, por vir de FormData, ou
 * objeto). Devolve `null` quando desligado ou estragado — o job fica sem o
 * campo e nada muda para quem não pediu.
 */
function lerDoCorpo(raw) {
  if (raw == null || raw === '' || raw === 'false') return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  const cfg = normalizar(obj);
  if (!cfg.ativa) return null;
  return { ativa: true, categoria: cfg.categoria, sufixo: cfg.sufixo };
}

/** Cola o sufixo ao texto sorteado. Sufixo em branco não muda nada. */
function montar(texto, sufixo) {
  const base = String(texto == null ? '' : texto);
  if (!sufixo || !String(sufixo).trim()) return base;
  return base + sufixo;
}

function _embaralhar(lista, aleatorio) {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Escolhe `quantidade` legendas de `docs`.
 *
 * Primeiro as que NÃO estão em `evitar` (embaralhadas); se faltarem, completa
 * com as de `evitar`, da mais antiga para a mais recente — a que foi usada há
 * mais tempo volta primeiro. Com menos legendas do que publicações, a fila
 * cicla: biblioteca de 1 legenda e 5 mídias dá 5 vezes a mesma, que é o
 * único resultado possível.
 *
 * @param {Array<{id:any}>} docs
 * @param {number} quantidade
 * @param {{ evitar?: string[], aleatorio?: () => number }} [opcoes]
 * @returns {Array} subconjunto de `docs`, com `quantidade` itens (ou vazio)
 */
function sortear(docs, quantidade, { evitar = [], aleatorio = Math.random } = {}) {
  const n = Math.max(0, Math.floor(Number(quantidade) || 0));
  if (!Array.isArray(docs) || !docs.length || !n) return [];

  const porId = new Map(docs.map(d => [String(d.id), d]));
  const evitados = evitar.map(String).filter(id => porId.has(id));
  const marcados = new Set(evitados);

  const frescos = _embaralhar(docs.filter(d => !marcados.has(String(d.id))), aleatorio);
  /* Da mais antiga para a mais recente, sem duplicar quem aparece duas vezes
     no histórico (fica a posição mais recente, que é a que conta). */
  const vistos = new Set();
  const usados = [];
  for (let i = evitados.length - 1; i >= 0; i--) {
    if (vistos.has(evitados[i])) continue;
    vistos.add(evitados[i]);
    usados.unshift(porId.get(evitados[i]));
  }

  const fila = frescos.concat(usados);
  const escolhidas = [];
  for (let i = 0; i < n; i++) escolhidas.push(fila[i % fila.length]);
  return escolhidas;
}

/**
 * Sorteia as legendas de uma rodada e grava o histórico no job.
 *
 * @returns {Promise<null | { vazia: true, legendas: [] } | { vazia: false, legendas: Array<{id, titulo, texto}> }>}
 *   `null` quando o job não pediu legenda aleatória.
 */
async function sortearParaRodada(job, quantidade, { aleatorio } = {}) {
  const cfg = normalizar(job && job.legendaAleatoria);
  if (!cfg.ativa) return null;

  const { sql } = require('../db');
  const docs = await sql`
    select id, title, text from legends
    where is_active and usuario_id = ${job.usuarioId}
      ${cfg.categoria ? sql`and category = ${cfg.categoria}` : sql``}`;
  if (!docs.length) return { vazia: true, legendas: [] };

  const escolhidas = sortear(docs, quantidade, { evitar: cfg.ultimas, aleatorio });
  const historico = cfg.ultimas.concat(escolhidas.map(d => String(d.id))).slice(-TAMANHO_DO_HISTORICO);
  await sql`
    update jobs set legenda_aleatoria = jsonb_set(legenda_aleatoria, '{ultimas}', ${sql.json(historico)})
    where id = ${job.id}`;

  return {
    vazia: false,
    legendas: escolhidas.map(d => ({ id: String(d.id), titulo: d.title || '', texto: montar(d.text, cfg.sufixo) })),
  };
}

module.exports = {
  normalizar, lerDoCorpo, montar, sortear, sortearParaRodada,
  TAMANHO_DO_HISTORICO, SUFIXO_MAXIMO, CATEGORIA_MAXIMA,
};
