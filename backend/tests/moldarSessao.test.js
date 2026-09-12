'use strict';

/**
 * `moldarSessao` — espelho, no Node, do que o Python faz para isolar por conta.
 *
 * Usado só para o painel MEDIR e MOSTRAR o IP que as contas realmente usam
 * (por sessão), em vez do gateway cru de datacenter que assustava à toa. O
 * molde de produção continua no Python, fonte única; este é para o teste do
 * card. O formato precisa bater exatamente com o do Python, senão o IP de
 * amostra não representaria o que a conta recebe.
 */

const { moldarSessao } = require('../src/services/globalProxy');

const URL = 'http://user__cr.br:senha@host.axtron.io:11000';

test('o sufixo entra no usuário, antes da senha (formato do Python)', () => {
  expect(moldarSessao(URL, '__sessid.{sessao}', 'abc123'))
    .toBe('http://user__cr.br__sessid.abc123:senha@host.axtron.io:11000');
});

test('sessões diferentes geram URLs diferentes', () => {
  const a = moldarSessao(URL, '__sessid.{sessao}', 'aaa');
  const b = moldarSessao(URL, '__sessid.{sessao}', 'bbb');
  expect(a).not.toBe(b);
});

test('idempotente: aplicar duas vezes não duplica o sufixo', () => {
  const uma = moldarSessao(URL, '__sessid.{sessao}', 'x');
  expect(moldarSessao(uma, '__sessid.{sessao}', 'x')).toBe(uma);
});

test('molde vazio devolve a URL intacta', () => {
  expect(moldarSessao(URL, '', 'x')).toBe(URL);
  expect(moldarSessao(URL, null, 'x')).toBe(URL);
});

test('proxy sem credencial não é moldado — não há usuário onde pôr o sufixo', () => {
  const semCred = 'http://host.axtron.io:11000';
  expect(moldarSessao(semCred, '__sessid.{sessao}', 'x')).toBe(semCred);
});

test('preserva host, porta e senha — só o usuário muda', () => {
  const r = moldarSessao(URL, '-session-{sessao}', 'z9');
  expect(r).toContain(':senha@host.axtron.io:11000');
  expect(r).toContain('user__cr.br-session-z9:');
});
