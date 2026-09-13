'use strict';

/**
 * O espaçamento entre logins por senha — POR CONTA, chaveado pelo USERNAME.
 *
 * ── Por que por conta, e não global
 *
 * A primeira versão era global: um 429 fechava o portão para TODAS as contas.
 * Isso fazia sentido quando todas saíam pelo mesmo IP — o limite do Instagram
 * é por IP, e punir uma punia o endereço que as outras também usavam.
 *
 * Deixou de fazer sentido quando cada conta passou a ter o SEU IP (o molde
 * `__sessid.` no proxy). Agora a `contaB`, com IP próprio e limpo, era barrada
 * porque a `contaA` — outro IP — levou 429. O usuário via "aguarde 5 min" numa
 * conta que nunca tinha tentado nada. O freio tem de seguir a unidade de
 * isolamento, e essa unidade virou a conta.
 *
 * ── Por que a chave é o USERNAME, não o `_id`
 *
 * Conta nova que falha o login é apagada como órfã e recriada com `_id` novo no
 * próximo clique. Se a chave fosse o `_id`, cada recriação zeraria o freio e o
 * clique gastaria de novo a tentativa que o Instagram conta — e o Instagram
 * conta POR @, não por registro nosso. O @ é estável entre recriações e é a
 * unidade que ele de fato limita. Por isso `chave` aqui é o username.
 *
 * ── O que este módulo NÃO faz
 *
 * Não remove o limite do Instagram. O contador é dele, por IP/por conta, no
 * servidor dele — nada aqui zera. As duas coisas que mudam o resultado são
 * gastar menos tentativas (isto) e cada conta sair por um IP próprio (o molde).
 *
 * ── A espera cresce a cada limite seguido
 *
 * O 429 quase nunca vem com "espere N segundos": vem só o código. Fixar 5 min
 * criava um laço — espera 5, tenta, 429 de novo, espera 5, para sempre — e cada
 * tentativa dentro do laço reforça o bloqueio. Agora cada limite seguido DA
 * MESMA CONTA multiplica a espera dela: 5 → 15 → 45 → teto de 60 min. Um
 * sucesso, ou uma janela longa sem novo limite, zera a contagem daquela conta.
 *
 * ── Por que o estado sobrevive ao restart
 *
 * Em memória, um `docker compose restart` zeraria a contagem e o próximo clique
 * gastaria a tentativa que o Instagram ainda está contando. Persistido em disco.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '../../uploads/.portao-de-login.json');

const ESPERA_MIN_MS = 120_000;   // 2 min — espaçamento normal entre tentativas
const ESPERA_MAX_MS = 240_000;   // 4 min
const ESPERA_APOS_LIMITE_MS = 300_000;   // 5 min — piso do 1º limite sem tempo informado
const BACKOFF_FATOR = 3;                 // 5 → 15 → 45 …
const ESPERA_LIMITE_TETO_MS = 60 * 60_000;   // teto de 60 min
const JANELA_SEQUENCIA_MS   = 60 * 60_000;   // sem novo limite por isso, a sequência reinicia

let _estado = null;

function _novaConta() {
  return { ultimaTentativa: 0, bloqueadoAte: 0, proximaLiberacao: 0, limitesSeguidos: 0, ultimoLimiteEm: 0 };
}

function carregar() {
  if (_estado) return _estado;
  try {
    const lido = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    /* Formato antigo (estado global plano, sem `.contas`) é DESCARTADO de
       propósito: além de incompatível, o bloqueio global que ele guardava é
       justamente o que punia contas inocentes. Começar limpo aqui conserta
       isso no primeiro carregamento. */
    _estado = (lido && typeof lido.contas === 'object') ? lido : { contas: {} };
  } catch {
    _estado = { contas: {} };
  }
  return _estado;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(_estado));
  } catch (err) {
    console.log(`⚠️ [PortaoDeLogin] não deu para gravar o estado: ${err.message}`);
  }
}

/** Sub-estado de uma conta, criado sob demanda. `null`/vazio cai num balde comum. */
function _conta(chave) {
  const e = carregar();
  const k = String(chave || '__sem_conta__');
  if (!e.contas[k]) e.contas[k] = _novaConta();
  const c = e.contas[k];
  if (typeof c.limitesSeguidos !== 'number') c.limitesSeguidos = 0;
  if (typeof c.ultimoLimiteEm !== 'number') c.ultimoLimiteEm = 0;
  return c;
}

function esperaSorteada(aleatorio = Math.random) {
  return ESPERA_MIN_MS + Math.floor(aleatorio() * (ESPERA_MAX_MS - ESPERA_MIN_MS));
}

/**
 * Esta conta pode tentar um login por senha agora?
 * @param {string} chave — o username da conta (a unidade que o Instagram limita)
 * @returns {{pode: boolean, esperaMs: number, motivo: string}}
 */
function conferir(chave, agora = Date.now()) {
  const c = _conta(chave);

  if (c.bloqueadoAte > agora) {
    return { pode: false, esperaMs: c.bloqueadoAte - agora, motivo: 'o Instagram pediu espera nesta conta' };
  }
  if (c.proximaLiberacao > agora) {
    return { pode: false, esperaMs: c.proximaLiberacao - agora, motivo: 'espaçando as tentativas desta conta' };
  }
  return { pode: true, esperaMs: 0, motivo: '' };
}

/** Registra uma tentativa gasta desta conta, e espaça a próxima. */
function registrarTentativa(chave, agora = Date.now(), aleatorio = Math.random) {
  const c = _conta(chave);
  c.ultimaTentativa = agora;
  c.proximaLiberacao = agora + esperaSorteada(aleatorio);
  gravar();
  return c.proximaLiberacao;
}

/**
 * O Instagram confirmou o limite DESTA conta. Guarda até quando, com backoff.
 * @param {number} [segundos] — o que ele informou, quando informa
 */
function registrarLimite(chave, segundos, agora = Date.now()) {
  const c = _conta(chave);

  const seguido = c.ultimoLimiteEm > 0 && (agora - c.ultimoLimiteEm) < JANELA_SEQUENCIA_MS;
  c.limitesSeguidos = seguido ? c.limitesSeguidos + 1 : 1;
  c.ultimoLimiteEm = agora;

  const informado = Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : 0;
  const degrau = Math.min(
    ESPERA_APOS_LIMITE_MS * Math.pow(BACKOFF_FATOR, c.limitesSeguidos - 1),
    ESPERA_LIMITE_TETO_MS,
  );
  const ms = informado || degrau;

  c.bloqueadoAte = Math.max(c.bloqueadoAte, agora + ms);
  gravar();
  return c.bloqueadoAte;
}

/** Um login desta conta deu certo — abre mais cedo e zera a escalada dela. */
function registrarSucesso(chave, agora = Date.now()) {
  const c = _conta(chave);
  c.bloqueadoAte = 0;
  c.limitesSeguidos = 0;
  c.ultimoLimiteEm = 0;
  c.proximaLiberacao = Math.min(c.proximaLiberacao, agora + ESPERA_MIN_MS / 2);
  gravar();
  return c.proximaLiberacao;
}

/** Zera o freio: de uma conta (com a chave) ou de todas (sem chave). */
function limpar(chave) {
  const e = carregar();
  if (chave) {
    delete e.contas[String(chave)];
  } else {
    _estado = { contas: {} };
    try { fs.unlinkSync(ARQUIVO); return; } catch { /* já não existe */ }
  }
  gravar();
}

module.exports = {
  conferir, registrarTentativa, registrarLimite, registrarSucesso, limpar,
  esperaSorteada,
  ESPERA_MIN_MS, ESPERA_MAX_MS, ESPERA_APOS_LIMITE_MS, ESPERA_LIMITE_TETO_MS, ARQUIVO,
};
