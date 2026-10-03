'use strict';

/**
 * Alcance por envio — o que está subindo e o que não está.
 *
 * ── O que isto responde
 *
 * "Por que esse vídeo pegou 2.000 e aquele 20?" A resposta já estava no banco,
 * espalhada: `Insight` tem alcance e views por mídia, `Post` sabe de qual envio
 * (job) cada mídia saiu. Cada envio do Postar é, na prática, um TIPO de vídeo
 * — um lote de material parecido — então agrupar por envio é agrupar por tipo
 * sem ninguém precisar etiquetar nada.
 *
 * ── O elo
 *
 * `Post.igMediaId` (a última mídia publicada) e `Post.midiasPublicadas[]`
 * (uma por conta — o Post é um só para N contas, e um campo só guardava a
 * última). O `Insight` tem o mesmo id. Mídia que não casa com Post nenhum
 * (publicada fora do SaaS, ou antes de o id ser gravado) entra no grupo
 * "fora de um envio" — aparece, em vez de sumir da conta.
 *
 * Só função pura aqui; quem tem o banco na mão é o controller.
 */

const SEM_ENVIO = 'sem-envio';

/* O "chão" de uma conta: a mediana do alcance dos últimos N reels. É o que o
   aquecimento constrói — o tamanho do público-teste que o Instagram dá a cada
   reel novo. Medido em 19–20/09/2026: conta fria testa em ~110, conta
   aquecida em ~3.000; o mesmo vídeo alcançou 194 mil numa e 105 na outra.
   Acima de PISO_PRONTA a conta está pronta para receber o conteúdo que
   importa; abaixo, ainda está aquecendo. Mediana e não média: um pico de
   194 mil não pode fazer uma conta de chão 300 parecer pronta. */
const JANELA_DO_CHAO = 10;
const PISO_PRONTA = 1000;

function mediana(nums) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Mapa igMediaId → { jobId, jobName } a partir dos Posts.
 * `midiasPublicadas` ganha de `igMediaId` porque é por conta.
 */
function indiceDeEnvios(posts) {
  const m = new Map();
  for (const p of posts || []) {
    const envio = { jobId: p.jobId ? String(p.jobId) : SEM_ENVIO, jobName: p.jobName || '', rotulo: p.jobRotulo || '', duracaoMs: p.duracaoMs || null };
    if (p.igMediaId) m.set(String(p.igMediaId), envio);
    for (const mp of p.midiasPublicadas || []) {
      if (mp?.igMediaId) m.set(String(mp.igMediaId), envio);
    }
  }
  return m;
}

/**
 * Agrupa os insights por envio e por conta.
 *
 * @returns {{ envios: object[], contas: object[], reels: object[] }}
 *   envios: ordenados por alcance médio (desc) — é o que diz "qual tipo sobe"
 *   contas: ordenadas por alcance total
 *   reels:  todos, ordenados por alcance (desc), com o envio já colado
 */
function agrupar(insights, posts, { topReelsPorEnvio = 3 } = {}) {
  const idx = indiceDeEnvios(posts);

  const reels = (insights || []).map(i => {
    const envio = idx.get(String(i.igMediaId)) || { jobId: SEM_ENVIO, jobName: '', rotulo: '', duracaoMs: null };
    const views = _num(i.videoViews);
    const likes = _num(i.likeCount);
    const saves = _num(i.savedCount);
    return {
      igMediaId: i.igMediaId,
      username: i.username || '',
      accountId: i.accountId ? String(i.accountId) : '',
      postedAt: i.postedAt || null,
      caption: String(i.caption || '').slice(0, 90),
      thumbnailUrl: i.thumbnailUrl || '',
      permalink: i.permalink || '',
      reach: _num(i.reach),
      views,
      likes,
      comments: _num(i.commentsCount),
      shares: _num(i.shareCount),
      saves,
      /* (likes + saves) / views — a mesma taxa que a tela de Performance já
         mostra por conta, para os dois números serem comparáveis. */
      taxa: views ? Number((((likes + saves) / views) * 100).toFixed(1)) : null,
      /* Segundos assistidos em média. É a retenção: o que decide se o
         Instagram continua distribuindo depois do público-teste. */
      assistidoS: i.avgWatchTimeMs != null ? Number((Number(i.avgWatchTimeMs) / 1000).toFixed(1)) : null,
      /* Retenção em %: tempo médio assistido ÷ duração do vídeo. Passa de
         100% quando o vídeo é revisto (loop) — e isso é ótimo sinal. */
      retencao: i.avgWatchTimeMs != null && envio.duracaoMs
        ? Math.round((Number(i.avgWatchTimeMs) / envio.duracaoMs) * 100) : null,
      jobId: envio.jobId,
      jobName: envio.jobName,
      rotulo: envio.rotulo,
    };
  }).sort((a, b) => b.reach - a.reach);

  const porEnvio = new Map();
  const porConta = new Map();
  for (const r of reels) {
    const e = porEnvio.get(r.jobId) || {
      jobId: r.jobId, jobName: r.jobName, rotulo: r.rotulo, reels: 0, reach: 0, views: 0, likes: 0, saves: 0, shares: 0,
      reachMax: 0, contas: new Set(), primeiro: null, ultimo: null, top: [],
      _tempoPonderado: 0, _viewsComTempo: 0,
    };
    e.reels++; e.reach += r.reach; e.views += r.views; e.likes += r.likes; e.saves += r.saves; e.shares += r.shares;
    e.reachMax = Math.max(e.reachMax, r.reach);
    if (r.username) e.contas.add(r.username);
    if (r.postedAt) {
      const t = new Date(r.postedAt);
      if (!e.primeiro || t < e.primeiro) e.primeiro = t;
      if (!e.ultimo || t > e.ultimo) e.ultimo = t;
    }
    if (e.top.length < topReelsPorEnvio) e.top.push(r); // reels já vem ordenado por alcance
    /* Média ponderada por views: um reel com 5.000 views pesa mais que um com 6. */
    if (r.assistidoS != null && r.views > 0) { e._tempoPonderado += r.assistidoS * r.views; e._viewsComTempo += r.views; }
    porEnvio.set(r.jobId, e);

    const c = porConta.get(r.username) || { username: r.username, accountId: r.accountId, reels: 0, reach: 0, views: 0, likes: 0, saves: 0, reachMax: 0 };
    c.reels++; c.reach += r.reach; c.views += r.views; c.likes += r.likes; c.saves += r.saves;
    c.reachMax = Math.max(c.reachMax, r.reach);
    porConta.set(r.username, c);
  }

  const envios = [...porEnvio.values()].map(({ _tempoPonderado, _viewsComTempo, ...e }) => ({
    ...e,
    assistidoS: _viewsComTempo ? Number((_tempoPonderado / _viewsComTempo).toFixed(1)) : null,
    contas: [...e.contas],
    reachMedio: e.reels ? Math.round(e.reach / e.reels) : 0,
    viewsMedio: e.reels ? Math.round(e.views / e.reels) : 0,
    taxa: e.views ? Number((((e.likes + e.saves) / e.views) * 100).toFixed(1)) : null,
  })).sort((a, b) => b.reachMedio - a.reachMedio);

  /* Os últimos N reels de cada conta, do mais antigo ao mais novo — a série
     do chão e o desenho da tela saem daqui. */
  const ultimosPorConta = new Map();
  for (const r of [...reels].filter(r => r.postedAt).sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))) {
    const l = ultimosPorConta.get(r.username) || [];
    l.push(r.reach);
    ultimosPorConta.set(r.username, l.slice(-JANELA_DO_CHAO));
  }

  const contas = [...porConta.values()].map(c => {
    const ultimos = ultimosPorConta.get(c.username) || [];
    const piso = mediana(ultimos);
    return {
      ...c,
      reachMedio: c.reels ? Math.round(c.reach / c.reels) : 0,
      taxa: c.views ? Number((((c.likes + c.saves) / c.views) * 100).toFixed(1)) : null,
      ultimos,
      piso,
      pico: c.reachMax,
      prontaParaTrocar: ultimos.length >= 5 && piso >= PISO_PRONTA,
    };
  }).sort((a, b) => b.reach - a.reach);

  return { envios, contas, reels, etiquetas: porEtiqueta(reels) };
}

/**
 * O comparativo: os reels agrupados pela etiqueta do envio ("Original",
 * "Repost"...). Médias por reel, para grupos de tamanhos diferentes serem
 * comparáveis; retenção ponderada por views. Sem etiqueta = "Sem etiqueta".
 */
function porEtiqueta(reels) {
  const g = new Map();
  for (const r of reels) {
    const nome = r.rotulo || '';
    const e = g.get(nome) || { rotulo: nome, reels: 0, reach: 0, views: 0, likes: 0, saves: 0, shares: 0, comments: 0,
      _t: 0, _tv: 0, _r: 0, _rv: 0, alcances: [], envios: new Set(), contas: new Set() };
    e.reels++; e.reach += r.reach; e.views += r.views; e.likes += r.likes; e.saves += r.saves; e.shares += r.shares; e.comments += r.comments;
    e.alcances.push(r.reach);
    if (r.jobId !== SEM_ENVIO) e.envios.add(r.jobId);
    if (r.username) e.contas.add(r.username);
    if (r.assistidoS != null && r.views > 0) { e._t += r.assistidoS * r.views; e._tv += r.views; }
    if (r.retencao != null && r.views > 0) { e._r += r.retencao * r.views; e._rv += r.views; }
    g.set(nome, e);
  }
  const por1k = (n, v) => (v ? Number(((n / v) * 1000).toFixed(1)) : null);
  return [...g.values()].map(e => ({
    rotulo: e.rotulo,
    reels: e.reels,
    envios: e.envios.size,
    contas: e.contas.size,
    reachMedio: Math.round(e.reach / e.reels),
    reachMediano: mediana(e.alcances),
    viewsMedio: Math.round(e.views / e.reels),
    assistidoS: e._tv ? Number((e._t / e._tv).toFixed(1)) : null,
    retencao: e._rv ? Math.round(e._r / e._rv) : null,
    sharesPor1k: por1k(e.shares, e.views),
    savesPor1k: por1k(e.saves, e.views),
    taxa: e.views ? Number((((e.likes + e.saves) / e.views) * 100).toFixed(1)) : null,
  })).sort((a, b) => b.reachMediano - a.reachMediano);
}

module.exports = { agrupar, porEtiqueta, indiceDeEnvios, mediana, SEM_ENVIO, JANELA_DO_CHAO, PISO_PRONTA };
