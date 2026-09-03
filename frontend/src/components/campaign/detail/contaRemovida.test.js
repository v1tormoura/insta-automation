import { describe, test, expect } from 'vitest';
import { agruparPorConta, resumoContas } from './views';
import { nomeConta, contaSumiu } from './shared';

/**
 * Conta excluída depois da campanha montada.
 *
 * O `populate` do backend não acha o documento e devolve `null` em
 * `account`. Antes, `agruparPorConta` descartava a publicação (`if (!id)
 * continue`) — e a tela passava a se contradizer:
 *
 *   - a configuração dizia "1 conta"   (lê `campanha.accountIds`, que ainda
 *                                       tem o id)
 *   - as métricas diziam "0 contas"    (leem este agrupamento)
 *   - a matriz vinha vazia             (mesmo descarte)
 *   - a linha do tempo mostrava "—"    (nome ausente)
 *
 * Quatro sintomas de uma causa que nada na tela nomeava.
 */

const pub = (i, extra = {}) => ({
  _id: `p${i}`, order: i, status: 'published',
  content: { _id: `c${i}`, filename: `v${i}.mp4` },
  scheduledAt: new Date(2026, 7, 31, 20 + i).toISOString(),
  ...extra,
});

describe('publicação órfã não some do painel', () => {
  test('conta nula vira um grupo próprio em vez de sumir', () => {
    const grupos = agruparPorConta([pub(1, { account: null }), pub(2, { account: null })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].total).toBe(2);
  });

  test('o grupo se identifica como removido', () => {
    const [g] = agruparPorConta([pub(1, { account: null })]);
    expect(g.removida).toBe(true);
  });

  test('conta existente não é marcada como removida', () => {
    const conta = { _id: 'a1', username: 'goligi1257' };
    const [g] = agruparPorConta([pub(1, { account: conta })]);
    expect(g.removida).toBe(false);
    expect(g.conta.username).toBe('goligi1257');
  });

  test('órfãs e existentes convivem sem se misturar', () => {
    const grupos = agruparPorConta([
      pub(1, { account: { _id: 'a1', username: 'um' } }),
      pub(2, { account: null }),
      pub(3, { account: { _id: 'a1', username: 'um' } }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find(g => g.removida).total).toBe(1);
    expect(grupos.find(g => !g.removida).total).toBe(2);
  });

  test('o resumo deixa de contradizer a configuração', () => {
    /* O defeito exato do print: 12 publicações de uma conta excluída
       resultavam em `total: 0`, ao lado de uma configuração dizendo 1. */
    const pubs = Array.from({ length: 12 }, (_, i) => pub(i, { account: null }));
    expect(resumoContas(pubs).total).toBe(1);
  });

  test('todas publicadas contam como concluída', () => {
    const pubs = [pub(1, { account: null }), pub(2, { account: null })];
    expect(resumoContas(pubs).concluidas).toBe(1);
  });

  test('publicação sem conta E sem conteúdo ainda conta', () => {
    // Órfã dos dois lados continua sendo uma publicação que aconteceu.
    const grupos = agruparPorConta([{ _id: 'x', order: 1, status: 'failed', account: null, content: null }]);
    expect(grupos).toHaveLength(1);
  });
});

describe('o nome diz o que houve', () => {
  test('conta ausente é nomeada, não virada num travessão', () => {
    expect(nomeConta(null)).toBe('Conta removida');
    expect(nomeConta(undefined)).toBe('Conta removida');
    expect(nomeConta({})).toBe('Conta removida');
  });

  test('conta existente continua com arroba', () => {
    expect(nomeConta({ username: 'goligi1257' })).toBe('@goligi1257');
  });

  test('contaSumiu separa os dois casos', () => {
    expect(contaSumiu(null)).toBe(true);
    expect(contaSumiu({ _id: 'a' })).toBe(true);        // populado mas sem username
    expect(contaSumiu({ username: 'x' })).toBe(false);
  });
});
