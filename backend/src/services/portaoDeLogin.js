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

/* ── Por que a espera CRESCE a cada limite seguido ──────────────────────────
   O 429 quase nunca vem com "espere N segundos": vem só o código. Fixar 5 min
   para todos os casos criava um laço — espera 5, tenta, 429 de novo, espera 5,
   para sempre — e cada tentativa dentro do laço reforça o bloqueio no lado do
   Instagram sem o nosso timer nunca crescer. Foi o que fez a conexão parar de
   funcionar "de repente" depois de muitas tentativas num dia.

   Agora cada limite seguido multiplica a espera: 5 → 15 → 45 → teto de 60 min.
   Um sucesso, ou um período longo sem novo limite, zera o contador — o dia
   seguinte não paga pelo bloqueio do anterior. */
const BACKOFF_FATOR = 3;
const ESPERA_LIMITE_TETO_MS = 60 * 60_000;   // 60 min
/* Sem novo limite por este tempo, a sequência é considerada encerrada. Igual
   ao teto: se o IP ficou uma hora sem apanhar, o contador não deve mais punir. */
const JANELA_SEQUENCIA_MS = 60 * 60_000;

let _estado = null;

function carregar() {
  if (_estado) return _estado;
  try {
    _estado = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    /* Primeira execução, ou arquivo corrompido. Começar limpo é o
       comportamento certo: um estado ilegível não pode travar a conexão. */
    _estado = { ultimaTentativa: 0, bloqueadoAte: 0, proximaLiberacao: 0, limitesSeguidos: 0, ultimoLimiteEm: 0 };
  }
  /* Campos novos num arquivo gravado por uma versão antiga: preenche sem
     apagar o resto. Sem isto, `limitesSeguidos` viria `undefined` e o
     `+ 1` abaixo faria `NaN`. */
  if (typeof _estado.limitesSeguidos !== 'number') _estado.limitesSeguidos = 0;
  if (typeof _estado.ultimoLimiteEm !== 'number') _estado.ultimoLimiteEm = 0;
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

  /* A sequência continua ou recomeça? Se o último limite foi há mais de uma
     janela, o IP ficou tempo suficiente sem apanhar e a contagem reinicia —
     senão um bloqueio isolado hoje herdaria o histórico de ontem. */
  const seguido = e.ultimoLimiteEm > 0 && (agora - e.ultimoLimiteEm) < JANELA_SEQUENCIA_MS;
  e.limitesSeguidos = seguido ? e.limitesSeguidos + 1 : 1;
  e.ultimoLimiteEm = agora;

  /* Quando o Instagram informa os segundos, o valor DELE manda — ele conhece
     o próprio contador. O 429 real, porém, quase nunca traz esse número: vem
     só o código. É nesse caso, o que trava o usuário, que a espera cresce com
     a sequência: 5, 15, 45, teto de 60 min. */
  const informado = Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : 0;
  const degrau = Math.min(
    ESPERA_APOS_LIMITE_MS * Math.pow(BACKOFF_FATOR, e.limitesSeguidos - 1),
    ESPERA_LIMITE_TETO_MS,
  );
  const ms = informado || degrau;

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
  /* A sequência de limites acabou: um login passou, então o IP não está mais
     bloqueado. Sem zerar aqui, o próximo 429 (horas depois) começaria já no
     terceiro degrau. */
  e.limitesSeguidos = 0;
  e.ultimoLimiteEm = 0;
  e.proximaLiberacao = Math.min(e.proximaLiberacao, agora + ESPERA_MIN_MS / 2);
  gravar();
  return e.proximaLiberacao;
}

/** Zera tudo — só para teste, e para um comando de manutenção. */
function limpar() {
  _estado = { ultimaTentativa: 0, bloqueadoAte: 0, proximaLiberacao: 0, limitesSeguidos: 0, ultimoLimiteEm: 0 };
  try { fs.unlinkSync(ARQUIVO); } catch { /* já não existe */ }
}

module.exports = {
  conferir, registrarTentativa, registrarLimite, registrarSucesso, limpar,
  esperaSorteada,
  ESPERA_MIN_MS, ESPERA_MAX_MS, ESPERA_APOS_LIMITE_MS, ARQUIVO,
};
