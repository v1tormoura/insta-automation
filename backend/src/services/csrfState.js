'use strict';

/**
 * Assinatura do `state` do OAuth (proteção contra CSRF).
 *
 * Formato: {state}~{nonce}~{hmac}. O retorno do Instagram só é aceito se o
 * HMAC bater — sem isso, qualquer um poderia forjar um retorno e prender uma
 * conta dele ao nosso painel.
 *
 * A chave é OAUTH_STATE_SECRET ou, na falta, ENCRYPTION_KEY (obrigatória).
 */

const crypto = require('crypto');

const SEPARADOR = '~';

function chave() {
  const bruta = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
  if (!bruta) throw new Error('OAUTH_STATE_SECRET/ENCRYPTION_KEY não configurada — o OAuth não pode ser assinado');
  return crypto.createHash('sha256').update(bruta).digest();
}

function hmac(payload) {
  return crypto.createHmac('sha256', chave()).update(payload).digest('hex').slice(0, 32);
}

function signState(state) {
  const payload = `${state}${SEPARADOR}${crypto.randomBytes(8).toString('hex')}`;
  return `${payload}${SEPARADOR}${hmac(payload)}`;
}

/** @returns {{valid: boolean, state: string}} */
function verifyAndStripState(assinado) {
  const partes = String(assinado || '').split(SEPARADOR);
  if (partes.length < 3) return { valid: false, state: '' };

  const recebido = Buffer.from(partes.pop(), 'hex');
  const payload = partes.join(SEPARADOR);
  const esperado = Buffer.from(hmac(payload), 'hex');
  const valido = recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  if (!valido) return { valid: false, state: '' };

  partes.pop(); // o nonce
  return { valid: true, state: partes.join(SEPARADOR) };
}

module.exports = { signState, verifyAndStripState };
