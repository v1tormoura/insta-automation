'use strict';

/**
 * O que um erro da API oficial diz sobre a CONTA.
 *
 * Erro transitório (limite de chamadas, rede) não pode mudar a saúde: marcar
 * a conta como quebrada por causa de um soluço tiraria ela das rodadas. E um
 * erro desconhecido devolve null — nunca um status inventado.
 */

const { classificarErro } = require('../src/services/contas');

const erro = (mensagem, extras = {}) => Object.assign(new Error(mensagem), extras);

describe('erro transitório não muda a saúde', () => {
  test.each([
    ['limite de chamadas (4)',     erro('Application request limit reached', { code: 4 })],
    ['limite do usuário (17)',     erro('User request limit reached', { code: 17 })],
    ['limite da página (32)',      erro('Page request limit reached', { code: 32 })],
    ['limite de chamadas (613)',   erro('Calls to this api have exceeded the rate limit.', { code: 613 })],
    ['timeout de rede',            erro('connect ETIMEDOUT 1.2.3.4:443')],
    ['rede caiu',                  erro('fetch failed')],
    ['falha de codificação',       erro('ffmpeg exited with code 1')],
    ['mensagem vazia',             erro('')],
    ['desconhecido',               erro('xyzzy', { code: 99999 })],
  ])('%s → null', (_nome, err) => {
    expect(classificarErro(err)).toBeNull();
  });
});

describe('o que é da conta muda a saúde', () => {
  test('token inválido (190) pede reconexão', () => {
    const r = classificarErro(erro('Error validating access token', { code: 190, type: 'OAuthException' }));
    expect(r.status).toBe('token_invalido');
    expect(r.mensagem).toMatch(/reconecte/);
  });

  test('subcódigos dizem o motivo: senha trocada, expirado, revogado', () => {
    expect(classificarErro(erro('x', { code: 190, subcode: 460 })).mensagem).toMatch(/Senha/);
    expect(classificarErro(erro('x', { code: 190, subcode: 463 })).mensagem).toMatch(/expirado/);
    expect(classificarErro(erro('x', { code: 190, subcode: 467 })).mensagem).toMatch(/revogada/);
  });

  test('conta desativada vira banida', () => {
    expect(classificarErro(erro('Your account has been disabled for violating our terms')).status).toBe('banida');
  });

  test('restrição de publicação (2207050) e checkpoint viram restrita', () => {
    expect(classificarErro(erro('The user is restricted', { code: 2207050 })).status).toBe('restrita');
    expect(classificarErro(erro('x', { subcode: 2207050 })).status).toBe('restrita');
    expect(classificarErro(erro('checkpoint_required')).status).toBe('restrita');
  });

  test('status devolvidos cabem na coluna', () => {
    const permitidos = ['ativa', 'restrita', 'token_invalido', 'banida', 'conta_pessoal'];
    for (const e of [erro('x', { code: 190 }), erro('account disabled'), erro('checkpoint')]) {
      expect(permitidos).toContain(classificarErro(e).status);
    }
  });
});
