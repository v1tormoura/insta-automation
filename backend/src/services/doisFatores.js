'use strict';

/**
 * Login em dois fatores — o código de 6 dígitos do app autenticador (Google
 * Authenticator, Authy, 1Password…), padrão TOTP (RFC 6238): HMAC-SHA1 de um
 * segredo + o relógio dividido em passos de 30 s.
 *
 * Feito aqui, sem biblioteca: são vinte linhas de crypto do Node e é a parte
 * que decide quem entra — melhor ler inteira do que confiar num pacote.
 *
 * ── Decisões
 *
 *  • Aceita o passo anterior e o seguinte (±30 s): relógio de celular atrasa.
 *  • Cada passo vale UMA vez (`ultimoPasso`): um código visto por cima do
 *    ombro não serve de novo nos mesmos 30 s.
 *  • 8 códigos de reserva, de uso único, para quem perde o celular. Só o hash
 *    fica no banco; a pessoa vê os códigos uma vez, ao ligar.
 *  • O segredo vai cifrado quando ENCRYPTION_KEY existe (mesmo cofre dos
 *    tokens da Meta).
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const cofre = require('./tokenEncryption');

const PASSO_S = 30;
const DIGITOS = 6;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0, valor = 0, saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function deBase32(texto) {
  const limpo = String(texto).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of limpo) {
    valor = (valor << 5) | ALFABETO.indexOf(c); bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

const gerarSegredo = () => base32(crypto.randomBytes(20));
const passoDe = (ms = Date.now()) => Math.floor(ms / 1000 / PASSO_S);

function codigoNoPasso(segredo, passo) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', deBase32(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** DIGITOS;
  return String(n).padStart(DIGITOS, '0');
}

/**
 * O passo em que o código bate, ou null. Recusa passo já usado.
 * @returns {number|null}
 */
function conferir(segredo, codigo, { ultimoPasso = null, agora = Date.now() } = {}) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== DIGITOS || !segredo) return null;
  const atual = passoDe(agora);
  for (const p of [atual, atual - 1, atual + 1]) {
    if (ultimoPasso != null && p <= Number(ultimoPasso)) continue;
    const esperado = codigoNoPasso(segredo, p);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return p;
  }
  return null;
}

function otpauth(segredo, conta, emissor = 'Nexora') {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_S}`;
}

const qrDe = url => QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' });

// ── Códigos de reserva ─────────────────────────────────────────────────────
const hashReserva = c => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

function gerarReserva(n = 8) {
  const codigos = Array.from({ length: n }, () => {
    const s = crypto.randomBytes(5).toString('hex'); // 10 caracteres
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codigos, hashes: codigos.map(hashReserva) };
}

/** Os hashes que sobram depois de usar `codigo`, ou null se não é um deles. */
function usarReserva(hashes, codigo) {
  const h = hashReserva(codigo);
  const lista = hashes || [];
  return lista.includes(h) ? lista.filter(x => x !== h) : null;
}

const guardar = segredo => cofre.encrypt(segredo);
const abrir = guardado => cofre.decrypt(guardado);

module.exports = {
  gerarSegredo, conferir, codigoNoPasso, passoDe, otpauth, qrDe,
  gerarReserva, usarReserva, guardar, abrir, base32, deBase32, PASSO_S,
};
