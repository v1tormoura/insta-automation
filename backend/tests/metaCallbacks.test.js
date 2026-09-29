'use strict';

/** Desautorização e exclusão de dados: só com signed_request válido. */

const crypto = require('crypto');
const { _abrir } = require('../src/routes/metaCallbacksRoutes');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function assinar(payload, segredo) {
  const p = b64u(JSON.stringify(payload));
  return `${b64u(crypto.createHmac('sha256', segredo).update(p).digest())}.${p}`;
}

test('abre o pedido assinado por um dos apps', () => {
  const sr = assinar({ user_id: '1784', algorithm: 'HMAC-SHA256' }, 'segredo-2');
  expect(_abrir(sr, ['segredo-1', 'segredo-2'])).toMatchObject({ user_id: '1784' });
});

test('recusa assinatura errada ou pedido malformado', () => {
  expect(_abrir(assinar({ user_id: '1' }, 'outro'), ['segredo'])).toBeNull();
  expect(_abrir('lixo', ['segredo'])).toBeNull();
  expect(_abrir('', ['segredo'])).toBeNull();
});
