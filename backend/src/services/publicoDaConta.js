'use strict';

/**
 * Quem viu os reels — gênero, país, idade — por conta.
 *
 * ── De onde vem
 *
 * `reached_audience_demographics` na Graph API: a demografia das contas que o
 * conteúdo ALCANÇOU no período (não dos seguidores — para quem publica para
 * fora, é o número que interessa). Existe também `engaged_audience_demographics`
 * (quem interagiu) e `follower_demographics` (quem segue); esta tela pede as
 * três e mostra o que voltar.
 *
 * ── O que o Instagram NÃO devolve, e por quê
 *
 * Conta pequena recebe `data: []` — sem erro, sem mensagem. Medido com o token
 * real: uma conta com 9 seguidores devolve vazio em todos os recortes, todos os
 * períodos, enquanto `reach` no mesmo token responde normalmente. É a regra do
 * Meta de não expor demografia de audiência pequena (no app aparece como
 * "insights indisponíveis — mínimo de 100 seguidores"). Não é o token, não é o
 * app, não é a chamada. Por isso a tela diz o motivo com o número, em vez de
 * ficar em branco: a seção acende sozinha quando a conta passar da linha.
 *
 * ── Cache
 *
 * Demografia muda devagar e a Graph tem limite por hora. Uma hora em memória
 * por conta é o suficiente para a tela poder ser recarregada à vontade.
 */

const MINIMO_SEGUIDORES = 100;
const CACHE_MS = 60 * 60 * 1000;
const PERIODOS = Object.freeze(['this_week', 'last_14_days', 'last_30_days', 'last_90_days', 'this_month', 'prev_month']);

const _cache = new Map(); // `${igUserId}:${timeframe}` → { em, dados }

function graphBase(token) {
  return String(token || '').startsWith('IG') ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
}

async function _get(igUserId, token, params) {
  const url = new URL(`${graphBase(token)}/${igUserId}/insights`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  const d = await r.json();
  if (d.error) throw new Error(`[Graph] ${d.error.message} (${d.error.code})`);
  return d;
}

/**
 * Lê um `total_value.breakdowns[0].results[]` em `[{ chave, valor }]`.
 * Função pura, exportada para o teste cobrir o formato da Graph sem rede.
 */
function interpretar(resposta) {
  const d = resposta?.data?.[0];
  const b = d?.total_value?.breakdowns?.[0];
  if (!b || !Array.isArray(b.results)) return [];
  return b.results
    .map(r => ({ chave: (r.dimension_values || []).join(' / '), valor: Number(r.value) || 0 }))
    .filter(x => x.chave)
    .sort((a, b) => b.valor - a.valor);
}

/** Percentuais sobre o total, mantendo a ordem. */
function comPercentual(lista) {
  const total = lista.reduce((s, x) => s + x.valor, 0);
  return lista.map(x => ({ ...x, pct: total ? Number(((x.valor / total) * 100).toFixed(1)) : 0 }));
}

/** Gênero vem como F / M / U na Graph. */
const GENERO = { F: 'Mulheres', M: 'Homens', U: 'Não informado' };
function rotularGenero(lista) {
  return lista.map(x => ({ ...x, rotulo: GENERO[x.chave] || x.chave }));
}

/**
 * O público de uma conta.
 *
 * @returns {{ username, followers, disponivel, motivo, timeframe, alcancados: {genero, paises, idades} | null, engajados: {...}|null }}
 */
async function buscarPublico(account, timeframe = 'last_30_days') {
  const tf = PERIODOS.includes(timeframe) ? timeframe : 'last_30_days';
  const base = { username: account.username, followers: Number(account.followers) || 0, timeframe: tf };

  if (!account.accessToken || !account.igUserId) {
    return { ...base, disponivel: false, motivo: 'sem_token', alcancados: null, engajados: null };
  }

  const chave = `${account.igUserId}:${tf}`;
  const c = _cache.get(chave);
  if (c && Date.now() - c.em < CACHE_MS) return { ...base, ...c.dados };

  const token = account.accessToken; // getter do modelo já descriptografa
  const pede = (metric, breakdown) => _get(account.igUserId, token, {
    metric, period: 'lifetime', timeframe: tf, breakdown, metric_type: 'total_value',
  }).then(interpretar).catch(() => []);

  const [gA, pA, iA, gE, pE] = await Promise.all([
    pede('reached_audience_demographics', 'gender'),
    pede('reached_audience_demographics', 'country'),
    pede('reached_audience_demographics', 'age'),
    pede('engaged_audience_demographics', 'gender'),
    pede('engaged_audience_demographics', 'country'),
  ]);

  const temAlcancados = gA.length || pA.length || iA.length;
  const dados = temAlcancados
    ? {
        disponivel: true,
        motivo: 'ok',
        alcancados: { genero: rotularGenero(comPercentual(gA)), paises: comPercentual(pA).slice(0, 10), idades: comPercentual(iA) },
        engajados: (gE.length || pE.length)
          ? { genero: rotularGenero(comPercentual(gE)), paises: comPercentual(pE).slice(0, 10) }
          : null,
      }
    : {
        disponivel: false,
        /* Vazio sem erro = o Meta reteve. O número de seguidores é o que a
           pessoa consegue mudar; por isso vai junto. */
        motivo: base.followers < MINIMO_SEGUIDORES ? 'poucos_seguidores' : 'sem_dados_no_periodo',
        alcancados: null,
        engajados: null,
      };

  _cache.set(chave, { em: Date.now(), dados });
  return { ...base, ...dados };
}

/**
 * Soma o público de várias contas (só as que têm dados) em um recorte único.
 * Soma de valores absolutos, depois percentual — não média de percentuais,
 * que daria peso igual a uma conta de 100 e a uma de 10.000 alcançados.
 */
function agregar(lista) {
  const soma = (campo, sub) => {
    const m = new Map();
    for (const c of lista) {
      const arr = c?.[campo]?.[sub] || [];
      for (const x of arr) m.set(x.chave, (m.get(x.chave) || 0) + x.valor);
    }
    return comPercentual([...m.entries()].map(([chave, valor]) => ({ chave, valor })).sort((a, b) => b.valor - a.valor));
  };
  const comDados = lista.filter(c => c.disponivel);
  if (!comDados.length) return null;
  return {
    contas: comDados.length,
    genero: rotularGenero(soma('alcancados', 'genero')),
    paises: soma('alcancados', 'paises').slice(0, 10),
    idades: soma('alcancados', 'idades'),
  };
}

module.exports = { buscarPublico, agregar, interpretar, comPercentual, rotularGenero, MINIMO_SEGUIDORES, PERIODOS, _cache };
