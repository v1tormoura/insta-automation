'use strict';

/**
 * O espaçamento entre logins por senha.
 *
 * ── O que este módulo NÃO faz
 *
 * Não remove o limite do Instagram. O `accounts/login/` tem contador por IP,
 * mantido no servidor deles — nada aqui o zera, e não existe engenharia deste
 * lado que zere. As únicas duas coisas que mudam o resultado são trocar de IP
 * (proxy) ou gastar menos tentativas. Este módulo é a segunda.
 *
 * ── O que ele faz
 *
 * O limite é uma TAXA: algumas tentativas por janela de tempo, por IP.
 * Conectar quatro contas em sequência gasta quatro tentativas em dois minutos e
 * estoura. As mesmas quatro, espaçadas, passam.
 *
 * Então o portão nega a passagem ANTES de gastar a tentativa, e diz em quanto
 * tempo ela abre. Quem chama transforma isso em espera automática em vez de
 * erro — a diferença entre "deu erro, tente de novo" e "conectando em 2min".
 *
 * ── Por que o estado sobrevive ao restart
 *
 * Em memória, um `docker compose restart` zeraria a contagem e o próximo clique
 * gastaria a tentativa que o Instagram ainda está contando. O contador dele não
 * reinicia junto com o nosso container.
 *
 * ── Por que o intervalo tem jitter
 *
 * Quatro logins exatamente 150 segundos separados é um padrão tão legível
 * quanto quatro seguidos. A faixa é 2 a 4 minutos.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '../../uploads/.portao-de-login.json');

/* Faixa entre uma tentativa e a seguinte.

   Não é um número que eu possa derivar do Instagram — o limite dele não é
   documentado. É conservador o bastante para quatro contas seguidas passarem, e
   curto o bastante para conectar dez não virar uma tarde. */
const ESPERA_MIN_MS = 120_000;   // 2 min
const ESPERA_MAX_MS = 240_000;   // 4 min

/* Quando o Instagram diz explicitamente para esperar, o valor dele manda —
   ele sabe o próprio contador e a gente não. Este é só o piso para quando ele
   não informa quanto. */
const ESPERA_APOS_LIMITE_MS = 300_000;   // 5 min

let _estado = null;

function carregar() {
  if (_estado) return _estado;
  try {
    _estado = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    /* Primeira execução, ou arquivo corrompido. Começar limpo é o
       comportamento certo: um estado ilegível não pode travar a conexão. */
    _estado = { ultimaTentativa: 0, bloqueadoAte: 0, proximaLiberacao: 0 };
  }
  return _estado;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(_estado));
  } catch (err) {
    /* Disco cheio ou permissão. O portão continua funcionando em memória —
       perder a persistência é pior que nada, mas muito melhor que recusar
       logins porque não deu para gravar um arquivo de controle. */
    console.log(`⚠️ [PortaoDeLogin] não deu para gravar o estado: ${err.message}`);
  }
}

/** Espera sorteada até a próxima tentativa. */
function esperaSorteada(aleatorio = Math.random) {
  return ESPERA_MIN_MS + Math.floor(aleatorio() * (ESPERA_MAX_MS - ESPERA_MIN_MS));
}

/**
 * Pode tentar um login por senha agora?
 *
 * @returns {{pode: boolean, esperaMs: number, motivo: string}}
 */
function conferir(agora = Date.now()) {
  const e = carregar();

  /* Bloqueio confirmado pelo Instagram vem primeiro: enquanto ele dura,
     insistir piora — a mensagem da própria tela diz isso. */
  if (e.bloqueadoAte > agora) {
    return {
      pode: false,
      esperaMs: e.bloqueadoAte - agora,
      motivo: 'o Instagram pediu espera neste IP',
    };
  }

  if (e.proximaLiberacao > agora) {
    return {
      pode: false,
      esperaMs: e.proximaLiberacao - agora,
      motivo: 'espaçando as tentativas para não estourar o limite do IP',
    };
  }

  return { pode: true, esperaMs: 0, motivo: '' };
}

/**
 * Registra que uma tentativa foi gasta, e fecha o portão pela próxima janela.
 *
 * Chamado ANTES do login, não depois: uma tentativa que falhou por senha
 * errada conta para o Instagram do mesmo jeito que uma que deu certo.
 */
function registrarTentativa(agora = Date.now(), aleatorio = Math.random) {
  const e = carregar();
  e.ultimaTentativa = agora;
  e.proximaLiberacao = agora + esperaSorteada(aleatorio);
  gravar();
  return e.proximaLiberacao;
}

/**
 * O Instagram confirmou o limite. Guarda até quando.
 *
 * @param {number} [segundos] — o que ele informou, quando informa
 */
function registrarLimite(segundos, agora = Date.now()) {
  const e = carregar();
  const ms = Number.isFinite(segundos) && segundos > 0
    ? segundos * 1000
    : ESPERA_APOS_LIMITE_MS;
  e.bloqueadoAte = Math.max(e.bloqueadoAte, agora + ms);
  gravar();
  return e.bloqueadoAte;
}

/**
 * Um login deu certo — o portão pode abrir mais cedo.
 *
 * Sucesso é sinal de que o IP não está limitado: manter a espera cheia depois
 * dele cobraria por um problema que não existe. Mas não abre de imediato:
 * quatro logins bem-sucedidos em trinta segundos é o padrão que o
 * espaçamento existe para evitar.
 */
function registrarSucesso(agora = Date.now()) {
  const e = carregar();
  e.bloqueadoAte = 0;
  e.proximaLiberacao = Math.min(e.proximaLiberacao, agora + ESPERA_MIN_MS / 2);
  gravar();
  return e.proximaLiberacao;
}

/** Zera tudo — só para teste, e para um comando de manutenção. */
function limpar() {
  _estado = { ultimaTentativa: 0, bloqueadoAte: 0, proximaLiberacao: 0 };
  try { fs.unlinkSync(ARQUIVO); } catch { /* já não existe */ }
}

module.exports = {
  conferir, registrarTentativa, registrarLimite, registrarSucesso, limpar,
  esperaSorteada,
  ESPERA_MIN_MS, ESPERA_MAX_MS, ESPERA_APOS_LIMITE_MS, ARQUIVO,
};
