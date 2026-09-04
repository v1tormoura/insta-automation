'use strict';

/**
 * Quanto e quando uma conta pode publicar.
 *
 * ── O que este módulo corrige
 *
 * `dailyPostLimit` tinha padrão 999999 — na prática, sem teto. Com o loop a
 * cada 40 minutos, cada conta publicava cerca de 36 reels por dia, 24 horas por
 * dia, sem parar de madrugada.
 *
 * Uma conta real publica de um a três reels por dia e dorme. Trinta e seis
 * publicações distribuídas uniformemente pelas 24 horas é o padrão mais
 * característico de automação que existe: não depende de analisar conteúdo,
 * arquivo, IP ou dispositivo — basta contar publicações por hora.
 *
 * Nenhuma humanização de pixel compensa isso. É por isso que este módulo vem
 * depois de `midiaPorConta` na ordem de importância mas antes na de efeito.
 *
 * ── Por que o teto tem jitter
 *
 * Cinco contas parando exatamente na oitava publicação, todo dia, é outro
 * padrão. O teto é sorteado por conta e por dia dentro de uma faixa: hoje uma
 * conta para em 6, outra em 9, e amanhã trocam.
 *
 * ── Por que a janela é por conta
 *
 * Todas as contas acordando às 08:00 em ponto se comportam como um enxame. O
 * deslocamento vem do id da conta, então é estável — a conta que acorda mais
 * cedo acorda mais cedo todo dia, como uma pessoa com rotina.
 */

const crypto = require('crypto');

/* Faixas padrão.

   6 a 10 publicações por dia é acima do que uma pessoa comum faz e abaixo do
   que chama atenção em conta de conteúdo — que é o uso real aqui. Não é um
   número que eu possa provar: é um teto conservador onde antes não havia
   nenhum, e é configurável por conta.

   A janela 07:00–23:00 deixa 8 horas de silêncio. O silêncio é o sinal: uma
   conta que nunca dorme não se parece com ninguém. */
const TETO_MIN = 6;
const TETO_MAX = 10;
const JANELA_INICIO = 7;    // 07:00
const JANELA_FIM = 23;      // 23:00

/* O valor que significa "nunca foi configurado". O schema nasceu com ele, e
   toda conta existente o tem gravado — então não dá para distinguir "sem teto"
   de "não mexeram nisso" olhando só o número. Tratar 999999 como ausência é o
   que faz a correção valer para as contas que já existem, sem migração. */
const SEM_TETO = 999999;

/** Número estável em [0, 1) a partir de uma chave. */
function fracaoDe(chave) {
  const d = crypto.createHash('sha256').update(String(chave)).digest();
  return d.readUInt32BE(0) / 4294967296;
}

/**
 * Quantas publicações esta conta pode fazer hoje.
 *
 * @param {Object} account
 * @param {Date}   [hoje]  — injetável para o teste não depender do relógio
 */
function tetoDeHoje(account, hoje = new Date()) {
  const configurado = Number(account?.dailyPostLimit);

  /* Teto configurado à mão vale como está — sem jitter. Quem digitou 3 quer 3,
     e sortear entre 2 e 4 seria desobedecer em nome de uma heurística. */
  if (Number.isFinite(configurado) && configurado > 0 && configurado !== SEM_TETO) {
    return configurado;
  }

  const dia = `${hoje.getFullYear()}-${hoje.getMonth()}-${hoje.getDate()}`;
  const f = fracaoDe(`${account?._id || 'sem-id'}:${dia}`);
  return TETO_MIN + Math.floor(f * (TETO_MAX - TETO_MIN + 1));
}

/**
 * O deslocamento desta conta, em minutos, dentro da hora.
 *
 * Estável por conta: a conta que acorda às 07:12 acorda às 07:12 todo dia.
 */
function deslocamentoDe(account) {
  return Math.floor(fracaoDe(`janela:${account?._id || 'sem-id'}`) * 90) - 45;
}

/**
 * Está num horário em que uma pessoa publicaria?
 *
 * @param {Object} account
 * @param {Date}   [agora]
 * @param {Object} [janela] — `{ inicio, fim }` em horas, para sobrescrever
 */
function dentroDaJanela(account, agora = new Date(), janela = {}) {
  const inicio = Number.isFinite(janela.inicio) ? janela.inicio : JANELA_INICIO;
  const fim = Number.isFinite(janela.fim) ? janela.fim : JANELA_FIM;

  // Janela cobrindo o dia inteiro desliga a regra — é o caminho de quem quer
  // publicar 24h de propósito.
  if (inicio <= 0 && fim >= 24) return true;

  const minutos = agora.getHours() * 60 + agora.getMinutes() + deslocamentoDe(account);
  const de = inicio * 60;
  const ate = fim * 60;

  /* Janela que atravessa a meia-noite (22h às 6h) é o caso de quem publica de
     madrugada de propósito. Sem este ramo, `de > ate` recusaria sempre. */
  return de <= ate
    ? minutos >= de && minutos < ate
    : minutos >= de || minutos < ate;
}

/**
 * Quando a janela reabre, para o agendamento não ficar tentando de minuto em
 * minuto durante a madrugada inteira.
 */
function proximaAbertura(account, agora = new Date(), janela = {}) {
  const inicio = Number.isFinite(janela.inicio) ? janela.inicio : JANELA_INICIO;
  const d = new Date(agora);
  d.setHours(inicio, 0, 0, 0);
  d.setMinutes(d.getMinutes() - deslocamentoDe(account));
  if (d <= agora) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * A conta pode publicar agora?
 *
 * Devolve `{ pode, motivo, ate }` — o motivo é para o log dizer POR QUE parou,
 * em vez de a publicação sumir sem explicação.
 */
function podePublicar(account, agora = new Date(), janela = {}) {
  const teto = tetoDeHoje(account, agora);
  const feitas = Number(account?.postsToday) || 0;

  if (feitas >= teto) {
    return {
      pode: false,
      motivo: `teto diário atingido (${feitas}/${teto})`,
      ate: proximaAbertura(account, agora, janela),
    };
  }

  if (!dentroDaJanela(account, agora, janela)) {
    const ate = proximaAbertura(account, agora, janela);
    return {
      pode: false,
      motivo: `fora da janela de publicação — retoma ${ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      ate,
    };
  }

  return { pode: true, motivo: '', ate: null };
}

module.exports = {
  podePublicar, tetoDeHoje, dentroDaJanela, proximaAbertura, deslocamentoDe,
  TETO_MIN, TETO_MAX, JANELA_INICIO, JANELA_FIM, SEM_TETO,
};
