'use strict';

/**
 * O ritmo das varreduras periódicas.
 *
 * ── O que foi medido
 *
 * Três jobs — `accountFastSync`, `accountAutoSync` e `healthCheck` — rodavam a
 * cada 5 minutos, e nenhum dos três filtrava por "sincronizada há pouco":
 * cada ciclo pegava TODAS as contas. São 288 ciclos por dia, vezes três jobs,
 * vezes cada conta — e todas no mesmo instante, saindo do mesmo endereço.
 *
 * ── Por que isso importa
 *
 * Nenhum celular consulta o próprio perfil a cada 5 minutos, a noite inteira,
 * todos os dias. Isso não é "parecer robô": é um padrão que uma pessoa com um
 * telefone não consegue produzir. E como todas as contas faziam a varredura
 * ao mesmo tempo, na mesma cadência, o padrão ficava idêntico entre elas — o
 * que é a outra metade do problema: correlação, o sinal de que várias contas
 * são a mesma mão.
 *
 * Proxy não conserta nada disso. Ele só faz o mesmo padrão impossível chegar
 * de um endereço mais bonito.
 *
 * ── As três medidas, e por que uma resolve duas
 *
 *   1. ESPAÇAR — 30 min em vez de 5. O painel não fica pior: o número de
 *      seguidores não muda a cada cinco minutos.
 *
 *   2. SILÊNCIO NOTURNO — nada entre 1h e 7h. Corta um quarto do dia de
 *      sinal, e custa zero.
 *
 *   3. DESALINHAR — em vez de todas as contas de uma vez a cada 30 min, cada
 *      tique processa uma FATIA das contas com sincronização mais antiga.
 *      Com tique de 5 min e intervalo de 30, são seis fatias: cada conta
 *      continua sendo vista uma vez a cada meia hora, mas só um sexto delas
 *      sai a cada momento.
 *
 * A fatia resolve (1) e (3) de uma vez, e é por isso que preferi ela a um
 * deslocamento calculado por conta: deslocamento exige guardar o desvio de
 * cada uma e continua disparando o lote inteiro quando o servidor reinicia.
 * A fatia se reequilibra sozinha, porque a ordem é sempre "a mais antiga
 * primeiro".
 *
 * ── O que este módulo NÃO governa
 *
 * Publicação. Postar, story, loop e campanha são ações que a pessoa agendou:
 * elas acontecem na hora marcada, inclusive de madrugada se foi isso que ela
 * pediu. O silêncio aqui vale só para a varredura de monitoramento, que é
 * iniciativa do sistema e não do usuário.
 */

/** Tique dos jobs. Continua curto — quem decide o ritmo é a fatia. */
const TIQUE_MS = 5 * 60 * 1000;

const PADRAO = Object.freeze({
  intervaloMin: 30,
  silencioInicio: 1,   // 1h da manhã, hora local do servidor
  silencioFim: 7,      // volta às 7h
});

/**
 * Número inteiro dentro de limites, vindo do ambiente.
 *
 * ── O teste de tipo ANTES do `Number()`
 *
 * `Number('')` é **0**, não `NaN` — e `Number.isFinite(0)` é verdadeiro. Sem a
 * conferência de string vazia, `SYNC_SILENCIO_FIM=` (declarada e vazia, que é
 * um jeito comum de "desligar" algo num `.env`) virava fim = 0. Com o início
 * em 1, a janela passava a ser "das 1h às 0h" — o ramo que cruza a
 * meia-noite — e o silêncio engolia o dia inteiro. A varredura simplesmente
 * parava, sem erro, sem log, sem nada.
 *
 * É a terceira vez que este projeto tropeça no mesmo lugar: `Number(null)`,
 * `Number([])` e `Number('')` são todos 0, e todos passam por `isFinite`. A
 * defesa é conferir o TIPO antes de converter, não o resultado depois.
 */
function doAmbiente(nome, padrao, min, max) {
  const cru = process.env[nome];
  if (typeof cru !== 'string' || cru.trim() === '') return padrao;
  const v = Number(cru);
  if (!Number.isFinite(v)) return padrao;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

/** Intervalo efetivo entre duas passagens pela MESMA conta. */
function intervaloMs() {
  return doAmbiente('SYNC_INTERVALO_MIN', PADRAO.intervaloMin, 5, 360) * 60 * 1000;
}

/**
 * Está no silêncio noturno?
 *
 * A janela pode cruzar a meia-noite (ex.: 23h → 6h), e é por isso que a
 * comparação tem dois ramos: `inicio < fim` é uma janela normal, `inicio > fim`
 * é uma que passa da virada. Um `>=` e `<` simples cobriria só o primeiro caso
 * e o silêncio noturno de verdade — o que atravessa a madrugada — nunca
 * valeria.
 *
 * Igual desliga o silêncio: quem configura 3 e 3 está dizendo "sem janela".
 */
function emSilencio(agora = new Date()) {
  const inicio = doAmbiente('SYNC_SILENCIO_INICIO', PADRAO.silencioInicio, 0, 23);
  const fim    = doAmbiente('SYNC_SILENCIO_FIM', PADRAO.silencioFim, 0, 23);
  if (inicio === fim) return false;

  const h = new Date(agora).getHours();
  return inicio < fim
    ? (h >= inicio && h < fim)
    : (h >= inicio || h < fim);
}

/**
 * A fatia de contas que deve ser processada NESTE tique.
 *
 * @param {Array} contas  ordenadas da sincronização mais ANTIGA para a mais nova
 * @param {{tiqueMs?: number, intervaloMs?: number}} [opts]
 * @returns {Array} a fatia — vazia durante o silêncio noturno
 *
 * A ordenação é responsabilidade de quem chama, e é o que faz isto funcionar:
 * pegando sempre as mais antigas, nenhuma conta fica para trás, mesmo que a
 * lista mude de tamanho entre dois tiques.
 */
function fatiaDaVez(contas, { tiqueMs = TIQUE_MS, intervalo = intervaloMs(), agora = new Date() } = {}) {
  const lista = Array.isArray(contas) ? contas : [];
  if (!lista.length) return [];
  if (emSilencio(agora)) return [];

  /* Quantos tiques cabem num intervalo. Mínimo 1: com tique maior que o
     intervalo, cada tique processa tudo — que é o comportamento correto, e
     não uma divisão por zero. */
  const tiques = Math.max(1, Math.round(intervalo / Math.max(1, tiqueMs)));

  /* `ceil` e não `floor`: com 5 contas em 6 tiques, `floor` daria zero e
     NENHUMA conta seria sincronizada nunca. */
  const porTique = Math.max(1, Math.ceil(lista.length / tiques));
  return lista.slice(0, porTique);
}

/** Para o log: descreve o ritmo em uma linha, sem obrigar a ler o código. */
function descrever() {
  const min = intervaloMs() / 60000;
  const i = doAmbiente('SYNC_SILENCIO_INICIO', PADRAO.silencioInicio, 0, 23);
  const f = doAmbiente('SYNC_SILENCIO_FIM', PADRAO.silencioFim, 0, 23);
  const silencio = i === f ? 'sem silêncio noturno' : `silêncio ${i}h–${f}h`;
  return `cada conta a cada ~${min} min, em fatias de ${TIQUE_MS / 60000} min · ${silencio}`;
}

module.exports = { TIQUE_MS, PADRAO, intervaloMs, emSilencio, fatiaDaVez, descrever };
