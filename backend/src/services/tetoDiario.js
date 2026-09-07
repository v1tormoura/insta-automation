'use strict';

/**
 * Quantas publicações por conta em 24 horas.
 *
 * ── Onde este número mora, e por que não num lugar novo
 *
 * Ele já existe: `Account.dailyPostLimit`. Dois lugares o respeitam e são
 * testados — o `publicationPlanner`, que nem gera publicação além do teto, e o
 * `checkDailyLimit` na execução, que barra na hora de publicar. Guardar um
 * segundo número no job criaria duas verdades sobre o mesmo assunto, e a
 * pergunta "quantas esta conta pode hoje" passaria a ter duas respostas.
 *
 * Então a tela de envio escreve no campo que já é obedecido. O efeito colateral
 * é real e precisa estar escrito na tela: mexer aqui muda a configuração DAS
 * CONTAS, não só deste envio.
 *
 * ── O aviso que acompanha
 *
 * `ritmoDaConta.js` sorteia o teto de cada conta entre 6 e 10 por dia, e isso
 * não foi um número escolhido no vazio: antes dele o padrão era 999999, o loop
 * rodava a cada 40 minutos e cada conta publicava cerca de 36 reels por dia,
 * 24 horas por dia. Foi a causa mais provável de as contas pararem de entregar.
 *
 * Aceitar 24, 40 ou 48 é decisão de quem opera, e este módulo aceita. O que ele
 * não faz é aceitar calado: `acimaDoSeguro` existe para a tela poder dizer o
 * que está sendo trocado.
 */

const Account = require('../models/Account');

/* O teto que `ritmoDaConta` considera seguro. Repetido aqui e não importado
   porque são decisões diferentes: lá é o que o sistema faz por padrão, aqui é a
   linha a partir da qual a tela avisa. Um teste compara os dois números. */
const SEGURO_MAX = 10;

/* Acima de 48 não é mais uma escolha de ritmo — é uma publicação a cada 30
   minutos sem parar, dia e noite. O teto existe para o campo não aceitar um
   número que só pode ter sido digitado por engano. */
const MAXIMO = 48;

/**
 * O valor pedido, como inteiro utilizável — ou `null` quando não foi pedido.
 *
 * `null` e não um padrão: quem não mandou o campo não quer mexer no teto das
 * contas, e escrever um padrão ali apagaria a configuração de quem já ajustou.
 *
 * `Number(null)`, `Number([])` e `Number('')` são todos 0 e passariam por
 * `isFinite` — daí a conferência de tipo antes. É o mesmo defeito que já
 * transformou opacidade vazia em 5%.
 */
function normalizarTeto(valor) {
  if (typeof valor !== 'number' && !(typeof valor === 'string' && valor.trim() !== '')) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const inteiro = Math.round(n);
  if (inteiro < 1) return null;
  return Math.min(MAXIMO, inteiro);
}

/** Este teto passa do que o sistema considera seguro? */
function acimaDoSeguro(teto) {
  const n = normalizarTeto(teto);
  return n !== null && n > SEGURO_MAX;
}

/**
 * Grava o teto nas contas escolhidas.
 *
 * Nunca lança: uma falha aqui não pode impedir a publicação. O teto antigo
 * continua valendo, e é um teto — perder o ajuste custa ritmo, não
 * funcionamento.
 *
 * @returns {Promise<number>} quantas contas foram atualizadas
 */
async function aplicarNasContas(accountIds, teto) {
  const n = normalizarTeto(teto);
  if (n === null) return 0;
  const ids = (Array.isArray(accountIds) ? accountIds : []).filter(Boolean);
  if (!ids.length) return 0;

  try {
    const r = await Account.updateMany({ _id: { $in: ids } }, { $set: { dailyPostLimit: n } });
    const quantas = r?.modifiedCount ?? r?.nModified ?? 0;
    console.log(`📊 [TetoDiario] ${quantas} conta(s) → ${n} publicações/24h`);
    return quantas;
  } catch (err) {
    console.log(`⚠️ [TetoDiario] não deu para gravar o teto: ${err.message} — o teto anterior continua`);
    return 0;
  }
}

module.exports = { normalizarTeto, acimaDoSeguro, aplicarNasContas, SEGURO_MAX, MAXIMO };
