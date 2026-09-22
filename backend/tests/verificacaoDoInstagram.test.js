'use strict';

/**
 * A verificação do Instagram vista pela API.
 *
 * O que estes testes protegem: o erro 190 com "log in to www.instagram.com
 * and follow the instructions given" é conta em VERIFICAÇÃO, não token
 * inválido — vira `restrita` com a instrução do que fazer, nunca "reconecte".
 * Mensagens de token vencido e de banimento seguem sendo o que eram.
 */

const v = require('../src/services/verificacaoDoInstagram');
const s = require('../src/services/saudeDaConta');

describe('ehVerificacaoPendente', () => {
  test('a frase real do erro 190 da verificação é reconhecida', () => {
    expect(v.ehVerificacaoPendente('Error validating access token: You cannot access the app till you log in to www.instagram.com and follow the instructions given.')).toBe(true);
    expect(v.ehVerificacaoPendente('Refresh do token falhou: Error validating access token: You cannot access the app till you log in to www.instagram.com and follow the instructions given. (code 190)')).toBe(true);
    expect(v.ehVerificacaoPendente('checkpoint_required')).toBe(true);
    expect(v.ehVerificacaoPendente('challenge_required: verify your identity')).toBe(true);
  });

  test('token vencido, banimento e vazio NÃO são verificação', () => {
    expect(v.ehVerificacaoPendente('Error validating access token: Session has expired on Monday')).toBe(false);
    expect(v.ehVerificacaoPendente('Your account has been disabled for violating our terms')).toBe(false);
    expect(v.ehVerificacaoPendente('Invalid OAuth access token - Cannot parse access token')).toBe(false);
    expect(v.ehVerificacaoPendente('')).toBe(false);
    expect(v.ehVerificacaoPendente(null)).toBe(false);
  });
});

describe('saudeDeVerificacao', () => {
  test('vira restrita, com a instrução em português e a promessa de voltar sozinha', () => {
    const u = v.saudeDeVerificacao();
    expect(u.healthStatus).toBe('restrita');
    expect(u.lastError).toMatch(/instagram\.com/);
    expect(u.lastError).toMatch(/volta a valer sozinho/);
    expect(u.lastError).not.toMatch(/reconecte/i);
  });

  test('o aviso "conta parou" usa a instrução inteira, sem repetir o estado na frente', () => {
    const m = s.motivo('restrita', v.MENSAGEM_DE_VERIFICACAO);
    expect(m.startsWith('Instagram pediu verificação')).toBe(true);
    expect(m).not.toMatch(/^o Instagram pediu verificação ou restringiu/);
  });
});

describe('recuperação', () => {
  test('restrita → ativa é recuperação; ativa → ativa e ativa → restrita não', () => {
    expect(s.recuperou('restrita', 'ativa')).toBe(true);
    expect(s.recuperou('token_invalido', 'ativa')).toBe(true);
    expect(s.recuperou('ativa', 'ativa')).toBe(false);
    expect(s.recuperou('ativa', 'restrita')).toBe(false);
    expect(s.recuperou(undefined, 'ativa')).toBe(false);
  });

  test('avisarTransicao chama o notificador de VOLTA na recuperação, e só ele', async () => {
    const caiu = [], voltou = [];
    const conta = { _id: 'c1', username: 'eliane' };
    await s.avisarTransicao({ conta, de: 'restrita', para: 'ativa', notificar: async p => caiu.push(p), notificarVolta: async p => voltou.push(p) });
    await s.avisarTransicao({ conta, de: 'ativa', para: 'ativa', notificar: async p => caiu.push(p), notificarVolta: async p => voltou.push(p) });
    expect(caiu).toHaveLength(0);
    expect(voltou).toHaveLength(1);
    expect(voltou[0].motivo).toBe('saiu de verificação/restrição e voltou a publicar normalmente');
  });
});
