'use strict';

/**
 * A fila de postagens.
 *
 * ── Dois elos que faltavam, não recursos novos
 *
 * A tela não podia responder "de que envio é esta linha?" nem "quantas views
 * deu?" — e em nenhum dos dois casos o problema era interface:
 *
 *   o Post não guardava o job          → a informação existia no Job e nunca
 *                                        descia para cá
 *   o Post não guardava o `igMediaId`  → a publicação SEMPRE devolveu esse id
 *                                        (a campanha já o usava para comentar)
 *                                        e `Insight` já guardava `videoViews`
 *                                        por mídia. Os dois lados existiam sem
 *                                        nada no meio.
 *
 * Construir os filtros antes desses elos daria seletores que não filtram nada.
 *
 * ── O que quebra calado aqui
 *
 *   filtro cru no Mongo      → 'bagunça' viraria `status: 'bagunça'` e a fila
 *                              devolveria zero linhas, parecendo vazia
 *   id inválido no filtro    → CastError no meio da consulta: a fila responde
 *                              500 por causa de um parâmetro de URL
 *   views por linha          → dez linhas na tela viravam dez consultas
 *   0 no lugar de "não sei"  → publicação que não saiu ainda mostraria "0
 *                              views", que afirma algo falso
 *   limpar demais            → `parcial` é publicação que saiu em ALGUMAS
 *                              contas; apagá-la perde o registro do que foi
 *                              publicado
 */

const {
  montarConsulta, montarPaginacao, viewsPorMidia, montarLinha,
  STATUS, FORMATOS, LIMPAVEIS, LIMITE_PADRAO, LIMITE_MAX,
} = require('../src/services/filaDePostagens');

const OID = '68bd4a800000000000000001';

describe('os filtros viram consulta', () => {
  test('sem filtro, consulta vazia — a fila inteira', () => {
    expect(montarConsulta({})).toEqual({});
    expect(montarConsulta()).toEqual({});
  });

  test('status e formato conhecidos entram', () => {
    expect(montarConsulta({ status: 'erro' })).toEqual({ status: 'erro' });
    expect(montarConsulta({ formato: 'reel' })).toEqual({ postType: 'reel' });
  });

  test('filtro inventado é ignorado, não vai cru para o Mongo', () => {
    /* Mandando o valor cru, a fila devolveria zero linhas e pareceria vazia —
       o sintoma seria "o filtro sumiu com tudo". */
    expect(montarConsulta({ status: 'bagunça' })).toEqual({});
    expect(montarConsulta({ status: 'todos' })).toEqual({});
    expect(montarConsulta({ formato: 'tiktok' })).toEqual({});
    expect(montarConsulta({ status: { $ne: null } })).toEqual({});
  });

  test('o envio entra só se for um ObjectId de verdade', () => {
    /* Um id inventado faz o Mongoose LANÇAR CastError no meio da consulta, e a
       fila responderia 500 por causa de um parâmetro de URL. */
    expect(montarConsulta({ job: OID })).toEqual({ jobId: OID });
    expect(montarConsulta({ job: 'todos' })).toEqual({});
    expect(montarConsulta({ job: 'admin' })).toEqual({});
    expect(montarConsulta({ job: '../../etc' })).toEqual({});
    expect(montarConsulta({ job: { $gt: '' } })).toEqual({});
  });

  test('os três filtros combinam', () => {
    expect(montarConsulta({ status: 'concluido', formato: 'reel', job: OID }))
      .toEqual({ status: 'concluido', postType: 'reel', jobId: OID });
  });

  test('a lista de status bate com o que o sistema grava', () => {
    /* Descobertos lendo quem os grava: o schema declara `status` como String
       sem enum, então a lista real está espalhada pelo worker e pelos
       controllers. Se um status novo aparecer e não entrar aqui, o filtro
       passa a esconder linhas. */
    for (const s of ['pendente', 'processando', 'concluido', 'parcial', 'erro', 'cancelado']) {
      expect(STATUS).toContain(s);
    }
    expect(FORMATOS).toEqual(['reel', 'post', 'story']);
  });
});

describe('a paginação', () => {
  test('o padrão é a primeira página com dez', () => {
    expect(montarPaginacao({})).toEqual({ pagina: 1, porPagina: LIMITE_PADRAO, pular: 0 });
  });

  test('página e limite são respeitados', () => {
    expect(montarPaginacao({ page: 3, limit: 25 })).toEqual({ pagina: 3, porPagina: 25, pular: 50 });
  });

  test('valores absurdos não viram consulta absurda', () => {
    /* `limit=999999` numa coleção grande derruba a memória do processo. */
    expect(montarPaginacao({ limit: 999999 }).porPagina).toBe(LIMITE_MAX);
    expect(montarPaginacao({ page: 0 }).pagina).toBe(1);
    expect(montarPaginacao({ page: -5 }).pagina).toBe(1);
    expect(montarPaginacao({ limit: 0 }).porPagina).toBe(LIMITE_PADRAO);
    expect(montarPaginacao({ limit: -3 }).porPagina).toBe(LIMITE_PADRAO);
  });

  test('texto e lixo caem no padrão', () => {
    /* `Number('')` e `Number(null)` são 0, e 0 aqui daria `skip: NaN` ou uma
       página zero. Mesmo defeito que já apareceu na opacidade da marca. */
    for (const v of ['', '   ', 'abc', null, undefined, {}, []]) {
      expect(montarPaginacao({ page: v, limit: v })).toEqual({ pagina: 1, porPagina: LIMITE_PADRAO, pular: 0 });
    }
  });

  test('página fracionária é truncada', () => {
    expect(montarPaginacao({ page: 2.7 }).pagina).toBe(2);
  });
});

describe('as views vêm em uma consulta, não uma por linha', () => {
  /** Um `Insight` de mentira que registra como foi consultado. */
  function insightCom(rows) {
    const chamadas = [];
    return {
      chamadas,
      find(q) { chamadas.push(q); return { select: () => ({ lean: async () => rows }) }; },
    };
  }

  test('uma consulta para o lote inteiro', () => {
    /* Dez linhas na tela viravam dez idas ao banco. */
    const I = insightCom([]);
    const posts = Array.from({ length: 10 }, (_, i) => ({ igMediaId: `m${i}` }));
    return viewsPorMidia(posts, I).then(() => {
      expect(I.chamadas).toHaveLength(1);
      expect(I.chamadas[0].igMediaId.$in).toHaveLength(10);
    });
  });

  test('ids repetidos são consultados uma vez', () => {
    const I = insightCom([]);
    return viewsPorMidia([{ igMediaId: 'm1' }, { igMediaId: 'm1' }, { igMediaId: 'm2' }], I).then(() => {
      expect(I.chamadas[0].igMediaId.$in.sort()).toEqual(['m1', 'm2']);
    });
  });

  test('sem id nenhum, não consulta', async () => {
    const I = insightCom([]);
    expect([...(await viewsPorMidia([{ igMediaId: '' }, {}, null], I))]).toEqual([]);
    expect(I.chamadas).toHaveLength(0);
  });

  test('devolve as reproduções do reel', async () => {
    const I = insightCom([{ igMediaId: 'm1', videoViews: 1240, reach: 900 }]);
    const mapa = await viewsPorMidia([{ igMediaId: 'm1' }], I);
    expect(mapa.get('m1')).toBe(1240);
  });

  test('sem reproduções, cai no alcance', async () => {
    /* Reel recém-publicado costuma ter alcance antes de contabilizar
       reprodução. Mostrar 0 ao lado de um post que já circulou é pior que
       mostrar o número que existe. */
    const I = insightCom([{ igMediaId: 'm1', videoViews: 0, reach: 310 }]);
    expect((await viewsPorMidia([{ igMediaId: 'm1' }], I)).get('m1')).toBe(310);
  });

  test('falha do banco não derruba a fila', async () => {
    /* Métrica é enfeite da linha; a linha é o que importa. */
    const I = { find() { throw new Error('sem conexão'); } };
    expect([...(await viewsPorMidia([{ igMediaId: 'm1' }], I))]).toEqual([]);
  });
});

describe('a linha, como a tela precisa', () => {
  const post = {
    _id: OID,
    scheduledAt: new Date('2026-09-07T22:10:00Z'),
    createdAt: new Date('2026-09-07T20:00:00Z'),
    jobName: 'Teste',
    jobId: '68bd4a800000000000000009',
    postType: 'reel',
    status: 'concluido',
    error: '',
    igMediaId: 'm1',
    accounts: [{ _id: 'a1', username: 'josefabonatto_83', avatar: '/uploads/avatars/x.jpg' }],
  };

  test('traz o nome do envio', () => {
    /* A pergunta que a fila não respondia: trinta linhas iguais, sem como
       agrupar por "aquele lote que eu disparei ontem". */
    expect(montarLinha(post, new Map()).envio).toBe('Teste');
  });

  test('mostra o horário previsto, não o de criação', () => {
    /* `scheduledAt` responde "quando isto vai (ou foi) ao ar"; `createdAt`
       responde "quando entrou na fila", que não é a pergunta. */
    expect(montarLinha(post, new Map()).quando).toEqual(post.scheduledAt);
  });

  test('sem horário previsto, cai na criação', () => {
    const semAgenda = { ...post, scheduledAt: null };
    expect(montarLinha(semAgenda, new Map()).quando).toEqual(post.createdAt);
  });

  test('views é null quando não se sabe, nunca 0', () => {
    /* 0 afirmaria que o post não teve nenhuma view. "Não sei" e "zero" são
       respostas diferentes, e a tela mostra um traço para a primeira. */
    expect(montarLinha(post, new Map()).views).toBeNull();
    expect(montarLinha({ ...post, igMediaId: '' }, new Map([['m1', 50]])).views).toBeNull();
  });

  test('views vem quando se sabe', () => {
    expect(montarLinha(post, new Map([['m1', 1240]])).views).toBe(1240);
  });

  test('zero de verdade é zero, não traço', () => {
    /* Publicação com métrica sincronizada e nenhuma view É zero — a distinção
       toda é entre "medido" e "não medido". */
    expect(montarLinha(post, new Map([['m1', 0]])).views).toBe(0);
  });

  test('o motivo do erro vai na linha', () => {
    /* Antes ele existia no documento e não aparecia em lugar nenhum: a linha
       dizia "erro" e o porquê ficava no banco. */
    const comErro = { ...post, status: 'erro', error: 'Tentativa 1: Falha, tentando novamente' };
    expect(montarLinha(comErro, new Map()).erro).toContain('Tentativa 1');
  });

  test('todas as contas da publicação aparecem', () => {
    /* Mostrar só a primeira mentiria sobre onde a publicação saiu. */
    const duas = { ...post, accounts: [post.accounts[0], { _id: 'a2', username: 'outra' }] };
    expect(montarLinha(duas, new Map()).contas.map(c => c.username)).toEqual(['josefabonatto_83', 'outra']);
  });

  test('conta apagada não vira linha quebrada', () => {
    /* `accounts` guarda ObjectIds; sem populate ou com a conta apagada, o item
       vem como id cru ou null. Ler `.username` disso dava undefined na tela. */
    expect(montarLinha({ ...post, accounts: ['64b0000000000000000000aa', null] }, new Map()).contas).toEqual([]);
    expect(montarLinha({ ...post, accounts: undefined }, new Map()).contas).toEqual([]);
  });
});

describe('limpar a fila', () => {
  test('só o que não pode mais acontecer', () => {
    expect(LIMPAVEIS.sort()).toEqual(['cancelado', 'erro']);
  });

  test('parcial NÃO é limpável', () => {
    /* Parcial é publicação que saiu em algumas contas e falhou em outras.
       Apagá-la perderia o registro do que foi publicado. */
    expect(LIMPAVEIS).not.toContain('parcial');
  });

  test('nada que ainda pode publicar é limpável', () => {
    /* Limpar a fila não pode significar cancelar o que está em andamento. */
    expect(LIMPAVEIS).not.toContain('pendente');
    expect(LIMPAVEIS).not.toContain('processando');
    expect(LIMPAVEIS).not.toContain('concluido');
  });
});

describe('a ligação com o resto do sistema', () => {
  const fs = require('fs');
  const path = require('path');
  const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('o Post guarda o envio e o id da mídia', () => {
    /* Sem os campos no schema, o Mongoose descarta em silêncio o que o worker
       tenta gravar — foi assim que `processMode` sumia entre o clique e o
       banco no Loop. */
    const Post = require('../src/models/Post');
    for (const campo of ['jobId', 'jobName', 'igMediaId']) {
      expect(Post.schema.paths).toHaveProperty(campo);
    }
  });

  test('o worker grava os três', () => {
    /* Campo no schema que ninguém preenche é o defeito mais barato daqui: a
       fila abriria com a coluna de envio vazia em toda linha. */
    const w = ler('../src/queue/worker.js');
    expect(w).toContain('jobId:         jobDoc._id');
    expect(w).toContain("jobName:       jobDoc.name || ''");
    expect(w).toMatch(/\$set:\s*\{\s*igMediaId:\s*idDaMidia\s*\}/);
  });

  test('o id da mídia é gravado por updateOne, não por save()', () => {
    /* O mesmo Post é publicado em várias contas em paralelo. Dois `save()`
       concorrentes num documento carregado sobrescreveriam campos um do
       outro. */
    const w = ler('../src/queue/worker.js');
    const trecho = w.slice(w.indexOf('const idDaMidia'), w.indexOf('agendarComentarioFixado(account, post, idDaMidia)'));
    expect(trecho).toContain('Post.updateOne');
    /* Regex sobre a CHAMADA e não sobre o texto "post.save()": esse texto
       aparece no comentário que explica a escolha, e uma assertiva que não
       distingue prosa de código falha por causa da própria documentação. É a
       terceira vez que escrevo isso errado neste projeto. */
    expect(trecho).not.toMatch(/await\s+post\.save\(\)/);
  });

  test('a rota da fila vem antes de /:id', () => {
    /* Depois, o Express casaria 'fila' como um id e a rota nunca seria
       alcançada — o sintoma é a fila responder "post não encontrado". */
    const r = ler('../src/routes/postRoutes.js');
    expect(r.indexOf("router.get('/fila'")).toBeLessThan(r.indexOf("router.delete('/:id'"));
    expect(r).toContain("router.post('/fila/limpar', limparFila)");
  });

  test('a tela chama a fila e a limpeza', () => {
    const tela = ler('../../frontend/src/components/FilaDePostagens.jsx');
    expect(tela).toContain("api.get('/posts/fila'");
    expect(tela).toContain("api.post('/posts/fila/limpar')");
  });

  test('o painel está no dashboard', () => {
    /* Um componente perfeito que ninguém renderiza. */
    const dash = ler('../../frontend/src/pages/Dashboard.jsx');
    expect(dash).toContain("import FilaDePostagens from '../components/FilaDePostagens'");
    expect(dash).toContain('<FilaDePostagens />');
  });
});
