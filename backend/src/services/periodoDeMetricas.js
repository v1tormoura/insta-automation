'use strict';

/**
 * O período das métricas dos perfis.
 *
 * ── Por que não reusei o de `getGlobalMetrics`
 *
 * Aquele aceita `7d/30d/90d/1a` e tem cache de resposta compartilhado com
 * outras telas. Esta tela precisa de `hoje`, `ontem` e `total`, e de faixa
 * livre por data. Alargar o outro mexeria numa consulta que três páginas já
 * usam, com um cache que passaria a ter chaves de dois formatos.
 *
 * ── Duas grandezas com fusos diferentes
 *
 * As métricas de conteúdo saem de `Insight.postedAt`, que é um INSTANTE — a
 * consulta quer `Date`. Os seguidores saem de `SeguidoresDoDia.dia`, que é uma
 * ETIQUETA de calendário local `YYYY-MM-DD` — a consulta quer texto.
 *
 * Misturar os dois é o erro fácil: `new Date('2026-09-08')` é meia-noite em
 * UTC, que em Brasília é 21h do dia 7. Um filtro de "hoje" montado assim
 * incluiria três horas de ontem e perderia as três últimas de hoje. Por isso
 * este módulo devolve as DUAS formas, cada uma correta no seu domínio.
 */

const PERIODOS = ['hoje', 'ontem', '7d', '30d', 'total'];
const PADRAO = 'hoje';

/** A etiqueta `YYYY-MM-DD` de uma data, no fuso do processo. */
function etiqueta(d) {
  return new Date(d).toLocaleDateString('en-CA');
}

/** Meia-noite LOCAL de uma etiqueta — o começo daquele dia de verdade. */
function inicioDoDia(diaOuData) {
  const dia = typeof diaOuData === 'string' ? diaOuData : etiqueta(diaOuData);
  /* `new Date('2026-09-08T00:00:00')` sem `Z` é interpretado no fuso local,
     que é justamente o que se quer. Com `Z` viria UTC. */
  return new Date(`${dia}T00:00:00`);
}

/** O instante seguinte ao fim de uma etiqueta — para usar com `$lt`. */
function fimDoDia(diaOuData) {
  const d = inicioDoDia(diaOuData);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Resolve o período pedido.
 *
 * `de`/`ate` (etiquetas `YYYY-MM-DD`) vencem o atalho quando os dois vêm e
 * são válidos: é o filtro explícito da tela, e ignorá-lo em favor do atalho
 * faria o botão "Filtrar" não filtrar.
 *
 * @param {{periodo?: string, de?: string, ate?: string}} q
 * @param {Date} [agora]
 * @returns {{
 *   periodo: string, rotulo: string,
 *   diaDe: string|null, diaAte: string|null,
 *   desde: Date|null, ate: Date|null,
 * }}
 *   `null` nos quatro campos de limite significa "tudo" — sem filtro de data.
 */
function resolver(q = {}, agora = new Date()) {
  const eEtiqueta = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !Number.isNaN(inicioDoDia(v).getTime());

  /* Faixa explícita. Invertida é corrigida em vez de recusada: quem escolhe as
     datas ao contrário quer o intervalo entre elas, não um erro. */
  if (eEtiqueta(q.de) && eEtiqueta(q.ate)) {
    const [a, b] = q.de <= q.ate ? [q.de, q.ate] : [q.ate, q.de];
    return {
      periodo: 'faixa',
      rotulo: a === b ? formatarDia(a) : `${formatarDia(a)} — ${formatarDia(b)}`,
      diaDe: a, diaAte: b,
      desde: inicioDoDia(a), ate: fimDoDia(b),
    };
  }

  const periodo = PERIODOS.includes(q.periodo) ? q.periodo : PADRAO;
  const hoje = etiqueta(agora);

  if (periodo === 'total') {
    return { periodo, rotulo: 'Desde o início', diaDe: null, diaAte: null, desde: null, ate: null };
  }

  if (periodo === 'hoje') {
    return {
      periodo, rotulo: 'Hoje',
      diaDe: hoje, diaAte: hoje,
      desde: inicioDoDia(hoje), ate: fimDoDia(hoje),
    };
  }

  if (periodo === 'ontem') {
    const d = inicioDoDia(hoje);
    d.setDate(d.getDate() - 1);
    const ontem = etiqueta(d);
    return {
      periodo, rotulo: 'Ontem',
      diaDe: ontem, diaAte: ontem,
      desde: inicioDoDia(ontem), ate: fimDoDia(ontem),
    };
  }

  /* 7d e 30d incluem hoje: "últimos 7 dias" que termina ontem esconde o dia
     em curso, que é justamente o que se está olhando. */
  const dias = periodo === '7d' ? 7 : 30;
  const inicio = inicioDoDia(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return {
    periodo, rotulo: `Últimos ${dias} dias`,
    diaDe: etiqueta(inicio), diaAte: hoje,
    desde: inicio, ate: fimDoDia(hoje),
  };
}

/** `2026-09-08` → `08/09`. Para o rótulo da faixa. */
function formatarDia(dia) {
  const [, m, d] = String(dia).split('-');
  return `${d}/${m}`;
}

/**
 * O filtro de data para uma consulta de `Insight`, pelo campo `postedAt`.
 *
 * Objeto vazio quando o período é "tudo" — e vazio é o certo, não
 * `{ postedAt: {} }`, que o Mongo trata como "nenhum documento casa".
 */
function filtroDeInstante(p, campo = 'postedAt') {
  if (!p?.desde || !p?.ate) return {};
  return { [campo]: { $gte: p.desde, $lt: p.ate } };
}

module.exports = {
  resolver, filtroDeInstante, etiqueta, inicioDoDia, fimDoDia,
  PERIODOS, PADRAO,
};
