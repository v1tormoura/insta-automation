'use strict';

/**
 * Quanto e quando uma conta pode publicar.
 *
 * ── Estado atual: teto e janela DESLIGADOS
 *
 * Por decisão de quem opera o sistema (18/09/2026): publicar a qualquer hora e
 * em qualquer quantidade. Sem nada no ambiente, este módulo libera tudo — é
 * `podePublicar` devolvendo `pode: true` sempre, a menos que a CONTA tenha um
 * teto próprio configurado, que continua sendo obedecido.
 *
 * Para religar, sem tocar no código nem subir imagem nova:
 *
 *     TETO_DIARIO_PADRAO=6-10     # publicações por dia, sorteadas na faixa
 *     JANELA_PUBLICACAO=7-23      # horário em que a conta publica
 *
 * ── Por que o mecanismo continua aqui em vez de ser apagado
 *
 * O que ele fazia não era invenção. `dailyPostLimit` tinha padrão 999999 — na
 * prática, sem teto. Com o loop a cada 40 minutos, cada conta publicava cerca
 * de 36 reels por dia, 24 horas por dia. Trinta e seis publicações distribuídas
 * uniformemente pelas 24 horas é o padrão mais característico de automação que
 * existe: não depende de analisar conteúdo, arquivo, IP ou dispositivo — basta
 * contar publicações por hora, e nenhuma humanização de pixel compensa isso.
 *
 * Apagar o código significaria reescrevê-lo do zero no dia em que as contas
 * pararem de entregar e a hipótese voltar à mesa. Duas linhas no `.env` é o
 * preço de manter essa porta aberta.
 *
 * ── O jitter, para quando estiver ligado
 *
 * Cinco contas parando exatamente na oitava publicação, todo dia, é outro
 * padrão. Ligado, o teto é sorteado por conta e por dia dentro da faixa: hoje
 * uma para em 6, outra em 9, e amanhã trocam. A janela ganha um deslocamento de
 * até 45 minutos vindo do id da conta — a que acorda mais cedo acorda mais cedo
 * todo dia, como uma pessoa com rotina, em vez de um enxame às 07:00 em ponto.
 */
const crypto = require('crypto');

/* ── Os padrões, lidos do ambiente ────────────────────────────────────────
   Ausentes (o caso normal hoje) = teto e janela desligados. Ver o cabeçalho. */

/** Lê "6-10" do ambiente. Qualquer outra coisa vira `null` — ou seja, desligado. */
function _faixaDoAmbiente(bruto) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(String(bruto ?? ''));
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return { min, max };
}

/* `null` = sem teto. Não é 0: zero seria um teto de zero publicações, que
   barraria tudo — o oposto exato do que "desligado" quer dizer. */
const TETO_PADRAO = _faixaDoAmbiente(process.env.TETO_DIARIO_PADRAO);
const TETO_MIN = TETO_PADRAO ? TETO_PADRAO.min : 0;
const TETO_MAX = TETO_PADRAO ? TETO_PADRAO.max : 0;

/* Sem janela configurada, 0–24: `dentroDaJanela` já trata o dia inteiro como
   "regra desligada", então não há caso especial a escrever aqui. */
const JANELA = _faixaDoAmbiente(process.env.JANELA_PUBLICACAO) || { min: 0, max: 24 };
const JANELA_INICIO = JANELA.min;
const JANELA_FIM = JANELA.max;

/* O valor que significa "nunca foi configurado". O schema nasceu com ele, e
   toda conta existente o tem gravado — então não dá para distinguir "sem teto"
   de "não mexeram nisso" olhando só o número. */
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

  /* Teto configurado à mão vale como está — sem jitter, e mesmo com o padrão
     desligado. Quem digitou 3 na tela de Contas quer 3, e o desligamento geral
     é sobre o que o sistema IMPÕE por conta própria, não sobre o que o dono
     pediu explicitamente. */
  if (Number.isFinite(configurado) && configurado > 0 && configurado !== SEM_TETO) {
    return configurado;
  }

  /* Sem faixa padrão no ambiente: sem teto. */
  if (!TETO_PADRAO) return SEM_TETO;

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
