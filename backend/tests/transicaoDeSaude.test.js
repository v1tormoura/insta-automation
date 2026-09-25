'use strict';

/**
 * Aviso quando a saúde da conta piora — a regra de transição.
 *
 * O que estes testes protegem: só a TRANSIÇÃO avisa (ativa → restrita sim;
 * restrita → restrita não; piorar entre estados ruins sim; recuperar não), o
 * motivo sai legível com o detalhe do Instagram. O repositório de contas só
 * chama isto ao gravar — a regra mora aqui, testável sem banco.
 */

const s = require('../src/services/saudeDaConta');

describe('o que é ruim', () => {
  test('restrita, banida, token inválido', () => {
    for (const e of ['restrita', 'banida', 'token_invalido']) expect(s.ehRuim(e)).toBe(true);
  });
  test('ativa e conta_pessoal não são; lixo não é', () => {
    expect(s.ehRuim('ativa')).toBe(false);
    expect(s.ehRuim('conta_pessoal')).toBe(false);
    expect(s.ehRuim(null)).toBe(false);
    expect(s.ehRuim('toString')).toBe(false);   // hasOwnProperty, não `in`
  });
});

describe('a transição', () => {
  test('ativa → restrita avisa; restrita → restrita não', () => {
    expect(s.mudouParaRuim('ativa', 'restrita')).toBe(true);
    expect(s.mudouParaRuim('restrita', 'restrita')).toBe(false);
  });
  test('piorar entre ruins avisa (restrita → banida é notícia)', () => {
    expect(s.mudouParaRuim('restrita', 'banida')).toBe(true);
  });
  test('recuperar não avisa por aqui', () => {
    expect(s.mudouParaRuim('banida', 'ativa')).toBe(false);
  });
  test('estado anterior desconhecido ainda avisa — melhor um aviso a mais que uma verificação perdida', () => {
    expect(s.mudouParaRuim(undefined, 'restrita')).toBe(true);
  });
});

describe('o motivo', () => {
  test('estado + detalhe do Instagram', () => {
    expect(s.motivo('restrita', 'challenge_required')).toBe('o Instagram pediu verificação ou restringiu a atividade (challenge_required)');
  });
  test('sem detalhe, só o estado; detalhe igual ao estado não duplica', () => {
    expect(s.motivo('banida', '')).toBe('conta suspensa ou desativada pelo Instagram');
    expect(s.motivo('banida', 'conta suspensa ou desativada pelo Instagram')).toBe('conta suspensa ou desativada pelo Instagram');
  });
  test('detalhe curto entra entre parênteses; detalhe longo (já uma frase) vale sozinho, cortado', () => {
    expect(s.motivo('token_invalido', 'x\n\n  y')).toBe('o token da API ficou inválido — reconecte a conta (x y)');
    const m = s.motivo('token_invalido', 'x\n\n  y ' + 'z'.repeat(500));
    expect(m.length).toBeLessThanOrEqual(220);
    expect(m.startsWith('x y zzz')).toBe(true);
  });
});

describe('avisarTransicao', () => {
  test('chama o notificador só na transição, com o motivo montado', async () => {
    const chamadas = [];
    const notificar = async p => { chamadas.push(p); return { id: 'n1' }; };
    const voltas = [];
    const notificarVolta = async p => { voltas.push(p); return { id: 'n2' }; };
    const conta = { id: 'c1', username: 'eliane' };

    expect(await s.avisarTransicao({ conta, de: 'ativa', para: 'restrita', lastError: 'checkpoint_required', notificar })).toEqual({ id: 'n1' });
    expect(await s.avisarTransicao({ conta, de: 'restrita', para: 'restrita', lastError: 'checkpoint_required', notificar })).toBeNull();
    expect(await s.avisarTransicao({ conta, de: 'restrita', para: 'ativa', notificar, notificarVolta })).toEqual({ id: 'n2' });
    expect(await s.avisarTransicao({ conta: null, de: 'ativa', para: 'banida', notificar })).toBeNull();

    expect(voltas).toHaveLength(1);
    expect(voltas[0].motivo).toMatch(/voltou a publicar/);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].conta).toBe(conta);
    expect(chamadas[0].motivo).toBe('o Instagram pediu verificação ou restringiu a atividade (checkpoint_required)');
  });
});
