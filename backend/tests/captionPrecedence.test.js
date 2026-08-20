'use strict';

const { resolveCaption, resolveComment, resolveTemplate } = require('../src/services/templateResolver');

describe('Precedencia e Resolucao de Legendas e Comentarios', () => {
  const accountA = { _id: 'acc_A', username: 'loja_oficial', name: 'Loja Oficial SP' };
  const accountB = { _id: 'acc_B', username: 'loja_rj', name: 'Loja RJ' };
  const content1 = { _id: 'cnt_1', name: 'Video 01', filename: 'video1.mp4' };
  const content2 = { _id: 'cnt_2', name: 'Foto 02', filename: 'foto2.jpg' };
  const campaign = { name: 'Campanha Black Friday' };

  test('Cenario 1: Legenda global para 1 conta e 1 conteudo', () => {
    const captions = { global: 'Confira nossas ofertas! 🔥' };
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions });
    expect(res.text).toBe('Confira nossas ofertas! 🔥');
  });

  test('Cenario 2: Legenda global para 3 contas e 2 conteudos com variaveis', () => {
    const captions = { global: 'Ola {name} (@{username}) na {campaign} vendo {content}!' };
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions });
    expect(res.text).toBe('Ola Loja Oficial SP (@loja_oficial) na Campanha Black Friday vendo Video 01!');
  });

  test('Cenario 3: Legenda por conta sobrescreve legenda global', () => {
    const captions = {
      global: 'Legenda global padrao',
      byAccount: {
        acc_A: 'Legenda exclusiva da Loja SP: {username}',
      },
    };
    const resA = resolveCaption({ campaign, account: accountA, content: content1, captions });
    const resB = resolveCaption({ campaign, account: accountB, content: content1, captions });

    expect(resA.text).toBe('Legenda exclusiva da Loja SP: loja_oficial');
    expect(resB.text).toBe('Legenda global padrao');
  });

  test('Cenario 4: Legenda por conteudo sobrescreve legenda por conta e global', () => {
    const captions = {
      global: 'Legenda global padrao',
      byAccount: {
        acc_A: 'Legenda da conta A',
      },
      byContent: {
        cnt_2: 'Legenda exclusiva da Foto 02: {content}',
      },
    };
    const res1 = resolveCaption({ campaign, account: accountA, content: content1, captions });
    const res2 = resolveCaption({ campaign, account: accountA, content: content2, captions });

    expect(res1.text).toBe('Legenda da conta A');
    expect(res2.text).toBe('Legenda exclusiva da Foto 02: Foto 02');
  });

  test('Cenario 5: Legenda especifica conta + conteudo tem a maior prioridade', () => {
    const captions = {
      global: 'Legenda global',
      byAccount: { acc_A: 'Legenda conta A' },
      byContent: { cnt_1: 'Legenda conteudo 1' },
      byAccountContent: {
        'acc_A__cnt_1': 'Legenda Hiper Especifica para {username} + {content} ✨',
      },
    };
    const resA1 = resolveCaption({ campaign, account: accountA, content: content1, captions });
    const resA2 = resolveCaption({ campaign, account: accountA, content: content2, captions });
    const resB1 = resolveCaption({ campaign, account: accountB, content: content1, captions });

    expect(resA1.text).toBe('Legenda Hiper Especifica para loja_oficial + Video 01 ✨');
    expect(resA2.text).toBe('Legenda conta A');
    expect(resB1.text).toBe('Legenda conteudo 1');
  });

  test('Cenario 6: Sem legenda / vazia devolve texto vazio sem erros', () => {
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions: {} });
    expect(res.text).toBe('');
    expect(res.unresolved).toEqual([]);
  });

  test('Cenario 7: Emojis complexos e caracteres especiais preservados', () => {
    const captions = { global: '🚀 Promocao especial 🇧🇷 | Link na bio 👆🔥 #desconto' };
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions });
    expect(res.text).toBe('🚀 Promocao especial 🇧🇷 | Link na bio 👆🔥 #desconto');
  });

  test('Cenario 8: Quebras de linha e tabs preservados', () => {
    const captions = { global: 'Linha 1\n\nLinha 2 com paragrafo\n\tLinha 3 com tab' };
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions });
    expect(res.text).toBe('Linha 1\n\nLinha 2 com paragrafo\n\tLinha 3 com tab');
  });

  test('Cenario 9: Variaveis desconhecidas sao mantidas sem quebrar', () => {
    const captions = { global: 'Ola {username}, seu codigo e {cupom_desconhecido}!' };
    const res = resolveCaption({ campaign, account: accountA, content: content1, captions });
    expect(res.text).toBe('Ola loja_oficial, seu codigo e {cupom_desconhecido}!');
    expect(res.unresolved).toEqual(['cupom_desconhecido']);
  });

  test('Cenario 10: Comentarios seguem a mesma regra de precedencia', () => {
    const comments = {
      global: 'Comentario geral 💬',
      byAccount: { acc_B: 'Comentario especial da loja RJ: @{username}' },
    };
    const resA = resolveComment({ campaign, account: accountA, content: content1, comments });
    const resB = resolveComment({ campaign, account: accountB, content: content1, comments });

    expect(resA.text).toBe('Comentario geral 💬');
    expect(resB.text).toBe('Comentario especial da loja RJ: @loja_rj');
  });

  test('Cenario 11: Resiliencia contra parametros nulos ou indefinidos', () => {
    expect(() => resolveCaption()).not.toThrow();
    expect(resolveCaption().text).toBe('');
    expect(resolveComment({ captions: null }).text).toBe('');
  });
});
