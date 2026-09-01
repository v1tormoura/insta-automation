'use strict';

/**
 * Aquecimento pela API mobile.
 *
 * ── O que estava acontecendo
 *
 * O log da conta dizia, ciclo após ciclo: "Ciclo concluído — 0 curtidas, 0
 * comentários, 0 follows". O painel mostrava o aquecimento ATIVO. Nada estava
 * quebrado de forma visível, e nada estava acontecendo.
 *
 * A causa eram dois caminhos mortos. As ações de descoberta iam pela biblioteca
 * antiga do Node, que exige uma sessão que quase nenhuma conta tem, e caíam num
 * `catch` que escrevia "requer sessão privada". As outras duas iam pela API
 * oficial, onde o único alvo possível são os comentários dos posts da própria
 * conta — a conta curtindo respostas no próprio feed.
 *
 * ── O que estes testes protegem
 *
 * Menos "chamou o método certo" e mais as decisões que separam aquecimento de
 * rajada: a ordem das ações, os tetos que a pessoa configurou valendo de fato,
 * e parar quando o Instagram pede para esperar em vez de insistir.
 */

const { ciclo, temSessaoMobile, _perfisUnicos, _pedeParaEsperar } =
  require('../src/services/aquecimentoMobile');

const MIDIA = (n, user) => ({
  media_id: `m${n}`, media_pk: `${n}`, code: `c${n}`,
  media_type: 2, user_id: `u${user ?? n}`, username: `perfil${user ?? n}`,
  like_count: 10,
});

/** Provider de mentira que anota a ordem em que foi chamado. */
function providerFake(sobrepor = {}) {
  const chamadas = [];
  const p = {
    chamadas,
    warmupDescobrir: jest.fn(async () => {
      chamadas.push('descobrir');
      return { itens: [MIDIA(1), MIDIA(2), MIDIA(3), MIDIA(4), MIDIA(5)] };
    }),
    warmupVisto: jest.fn(async (a, ids) => {
      chamadas.push('visto');
      return { vistas: ids.length };
    }),
    warmupCurtir: jest.fn(async () => { chamadas.push('curtir'); return { ok: true }; }),
    warmupStories: jest.fn(async () => { chamadas.push('stories'); return { vistos: 2 }; }),
    warmupSeguir:  jest.fn(async () => { chamadas.push('seguir'); return { ok: true }; }),
    ...sobrepor,
  };
  return p;
}

const conta = (extra = {}) => ({ _id: 'c1', username: 'loja', instagrapiSession: 'blob', ...extra });

/** Roda sem esperar de verdade — os intervalos reais são de dezenas de segundos. */
const rodar = (account, opcoes) => ciclo(account, { dormir: async () => {}, ...opcoes });

describe('quem tem por onde aquecer', () => {
  test('o que decide é a sessão, não o provider', () => {
    /* O fluxo novo é justamente este: conta conectada pela API oficial que
       depois entra no mobile. Olhar `provider` a deixaria de fora do caminho
       que funciona, e ela voltaria a ter ciclos vazios. */
    expect(temSessaoMobile({ provider: 'official', instagrapiSession: 'x' })).toBe(true);
    expect(temSessaoMobile({ provider: 'instagrapi' })).toBe(false);
    expect(temSessaoMobile({ provider: 'official' })).toBe(false);
  });
});

describe('a ordem das ações', () => {
  test('vê antes de curtir', async () => {
    /* Ninguém curte um post que não viu. Uma conta que só emite curtidas, sem
       nenhuma visualização antes, tem um padrão que nenhum uso humano produz —
       e é esse padrão que o aquecimento existe para não ter. */
    const prov = providerFake();
    await rodar(conta(), {
      provider: prov, acoes: ['like_posts'], limites: { maxLikes: 2 },
    });

    expect(prov.chamadas.indexOf('visto')).toBeLessThan(prov.chamadas.indexOf('curtir'));
  });

  test('seguir vem por último', async () => {
    /* É a única ação pública e difícil de desfazer. Interrompido no meio, o que
       fica para trás são visualizações e curtidas, não uma lista de seguidos. */
    const prov = providerFake();
    await rodar(conta(), {
      provider: prov,
      acoes: ['like_posts', 'follow', 'view_stories'],
      limites: { maxLikes: 2, maxFollows: 1, maxStories: 1 },
    });

    expect(prov.chamadas.lastIndexOf('seguir'))
      .toBeGreaterThan(prov.chamadas.lastIndexOf('curtir'));
    expect(prov.chamadas.lastIndexOf('seguir'))
      .toBeGreaterThan(prov.chamadas.lastIndexOf('stories'));
  });

  test('marca como visto mesmo sem nenhuma curtida pedida', async () => {
    /* Barata, invisível para terceiros e sem custo de reputação. É a única
       ação que faz sentido sozinha numa conta recém-criada. */
    const prov = providerFake();
    const r = await rodar(conta(), { provider: prov, acoes: ['view_stories'], limites: { maxStories: 1 } });

    expect(prov.warmupVisto).toHaveBeenCalled();
    expect(prov.warmupCurtir).not.toHaveBeenCalled();
    expect(r.views).toBe(5);
  });
});

describe('os tetos configurados valem', () => {
  test('curte no máximo o que foi pedido, mesmo com mais conteúdo disponível', async () => {
    const prov = providerFake();
    const r = await rodar(conta(), { provider: prov, acoes: ['like_posts'], limites: { maxLikes: 2 } });

    expect(prov.warmupCurtir).toHaveBeenCalledTimes(2);
    expect(r.likes).toBe(2);
  });

  test('teto zero significa zero, não o padrão', async () => {
    /* "Não quero follows" é uma escolha legítima e conservadora. Um `|| padrão`
       transformaria o zero no padrão e faria o sistema seguir perfis para quem
       pediu explicitamente que não seguisse. */
    const prov = providerFake();
    const r = await rodar(conta(), {
      provider: prov, acoes: ['like_posts', 'follow'],
      limites: { maxLikes: 1, maxFollows: 0 },
    });

    expect(prov.warmupSeguir).not.toHaveBeenCalled();
    expect(r.follows).toBe(0);
  });

  test('não segue o mesmo perfil duas vezes no ciclo', async () => {
    /* O Explorar traz várias mídias do mesmo perfil com frequência. Sem a
       deduplicação, o teto de 3 follows viraria 3 tentativas no mesmo alvo — e
       a segunda e a terceira são ruído que o Instagram enxerga. */
    const prov = providerFake({
      warmupDescobrir: jest.fn(async () => ({
        itens: [MIDIA(1, 'A'), MIDIA(2, 'A'), MIDIA(3, 'A'), MIDIA(4, 'B')],
      })),
    });
    await rodar(conta(), { provider: prov, acoes: ['follow'], limites: { maxFollows: 3 } });

    const alvos = prov.warmupSeguir.mock.calls.map(c => c[1]);
    expect(new Set(alvos).size).toBe(alvos.length);
    expect(alvos.length).toBe(2);   // só existem dois perfis distintos
  });
});

describe('quando o Instagram pede para esperar', () => {
  test('para as curtidas em vez de insistir', async () => {
    /* Insistir depois de "Please wait a few minutes" é o caminho mais curto
       para o bloqueio que o aquecimento existe para evitar. */
    let n = 0;
    const prov = providerFake({
      warmupCurtir: jest.fn(async () => {
        n++;
        if (n === 2) throw Object.assign(new Error('Please wait a few minutes before you try again'), {});
        return { ok: true };
      }),
    });

    const linhas = [];
    const r = await rodar(conta(), {
      provider: prov, acoes: ['like_posts'], limites: { maxLikes: 5 },
      registrar: async (acao, detalhe) => { linhas.push(`${acao}: ${detalhe}`); },
    });

    expect(prov.warmupCurtir).toHaveBeenCalledTimes(2);   // parou na falha
    expect(r.likes).toBe(1);
    expect(linhas.join(' | ')).toMatch(/pediu para esperar/i);
  });

  test('reconhece o pedido pelo código também, não só pelo texto', async () => {
    expect(_pedeParaEsperar({ code: 'RATE_LIMITED', message: 'x' })).toBe(true);
    expect(_pedeParaEsperar({ message: 'Please wait a few minutes' })).toBe(true);
    expect(_pedeParaEsperar({ message: 'media not found' })).toBe(false);
  });
});

describe('quando não vem conteúdo', () => {
  test('explica o que fazer em vez de mandar reconectar', async () => {
    /* Zero itens costuma ser conta nova com a fonte em `feed`: ela não segue
       ninguém, então o feed está vazio. O conserto é trocar a fonte. Um erro
       genérico faria a pessoa reconectar uma conta que está perfeitamente boa. */
    const prov = providerFake({ warmupDescobrir: jest.fn(async () => ({ itens: [] })) });
    const linhas = [];

    const r = await rodar(conta({ warmupFonte: 'feed' }), {
      provider: prov, acoes: ['like_posts'], limites: { maxLikes: 3 },
      registrar: async (a, d) => linhas.push(d),
    });

    expect(r.likes).toBe(0);
    expect(prov.warmupCurtir).not.toHaveBeenCalled();
    expect(linhas.join(' ')).toMatch(/troque a fonte/i);
  });

  test('falha ao descobrir encerra o ciclo sem tentar agir às cegas', async () => {
    const prov = providerFake({
      warmupDescobrir: jest.fn(async () => { throw new Error('serviço fora'); }),
    });
    const r = await rodar(conta(), { provider: prov, acoes: ['like_posts'], limites: { maxLikes: 3 } });

    expect(prov.warmupCurtir).not.toHaveBeenCalled();
    expect(prov.warmupVisto).not.toHaveBeenCalled();
    expect(r.errors[0]).toMatch(/serviço fora/);
  });
});

describe('a fonte do conteúdo', () => {
  test('hashtag sem lista cai em reels em vez de pedir vazio', async () => {
    /* `hashtag` com o campo em branco pediria ao Instagram a hashtag "" — um
       erro que voltaria como falha do aquecimento, quando o que houve foi
       configuração incompleta. */
    const prov = providerFake();
    await rodar(conta({ warmupFonte: 'hashtag', warmupHashtags: [] }), {
      provider: prov, acoes: ['like_posts'], limites: { maxLikes: 1 },
    });

    expect(prov.warmupDescobrir.mock.calls[0][1].fonte).toBe('reels');
  });

  test('com hashtags configuradas, sorteia uma delas', async () => {
    const prov = providerFake();
    await rodar(conta({ warmupFonte: 'hashtag', warmupHashtags: ['#moda', 'estilo'] }), {
      provider: prov, acoes: ['like_posts'], limites: { maxLikes: 1 },
    });

    const { fonte, hashtag } = prov.warmupDescobrir.mock.calls[0][1];
    expect(fonte).toBe('hashtag');
    expect(['moda', 'estilo']).toContain(hashtag);   // o "#" é removido
  });
});

describe('o registro no log', () => {
  test('cada ação vira uma linha com o perfil alvo', async () => {
    const prov = providerFake();
    const linhas = [];
    await rodar(conta(), {
      provider: prov, acoes: ['like_posts', 'follow'],
      limites: { maxLikes: 1, maxFollows: 1 },
      registrar: async (acao, detalhe, extras) => linhas.push({ acao, detalhe, extras }),
    });

    const curtida = linhas.find(l => l.acao === 'like');
    const follow  = linhas.find(l => l.acao === 'follow');
    expect(curtida.detalhe).toMatch(/^Curtiu publicação de @perfil/);
    expect(curtida.extras.targetUser).toMatch(/^perfil/);
    expect(follow.detalhe).toMatch(/^Seguiu @perfil/);
  });

  test('perfil sem story no ar não vira linha', async () => {
    /* É o caso mais comum. Registrar "viu 0 stories" encheria o histórico de
       linhas que não contam nada e esconderia as que contam. */
    const prov = providerFake({ warmupStories: jest.fn(async () => ({ vistos: 0 })) });
    const linhas = [];
    await rodar(conta(), {
      provider: prov, acoes: ['view_stories'], limites: { maxStories: 2 },
      registrar: async (acao) => linhas.push(acao),
    });

    expect(prov.warmupStories).toHaveBeenCalledTimes(2);
    expect(linhas.filter(a => a === 'story_view')).toHaveLength(0);
  });
});

describe('perfis únicos', () => {
  test('descarta repetidos e itens sem dono', () => {
    const r = _perfisUnicos([
      { user_id: 'a', username: 'ana' },
      { user_id: 'a', username: 'ana' },
      { user_id: '',  username: 'sem' },
      { user_id: 'b', username: 'bia' },
    ]);
    expect(r.map(p => p.user_id).sort()).toEqual(['a', 'b']);
  });
});
