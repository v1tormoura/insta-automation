'use strict';

/**
 * Chaves do push sem ninguém gerar à mão.
 *
 *   sem chave no .env   → gera um par na primeira subida e guarda no banco
 *   subida seguinte     → reaproveita o MESMO par (trocar desinscreveria todos
 *                         os aparelhos, presos à chave pública antiga)
 *   privada no banco    → cifrada, nunca em claro
 */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const banco = require('./helpers/banco');
const settings = require('../src/repos/settings');

function modulo() {
  jest.resetModules();
  return require('../src/services/smartActivity/webPush');
}

beforeEach(() => banco.limpar());
afterAll(() => banco.sql.end());

test('sem .env, gera, guarda cifrado e fica disponível', async () => {
  const wp = modulo();
  expect(wp.disponivel()).toBe(false);
  expect(await wp.prepararChaves()).toBe('banco');
  expect(wp.disponivel()).toBe(true);

  const salvo = await settings.ler('vapid');
  expect(wp.chavePublica()).toBe(salvo.publica);
  expect(salvo.privada.startsWith('enc')).toBe(true);
});

test('a subida seguinte reaproveita o mesmo par', async () => {
  await modulo().prepararChaves();
  const primeira = modulo();
  await primeira.prepararChaves();
  const segunda = modulo();
  await segunda.prepararChaves();
  expect(segunda.chavePublica()).toBe(primeira.chavePublica());
});
