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

const OID = '00000000-68bd-4a80-0000-000000000001';

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
  /** Uma busca de mentira que registra com quais ids foi chamada. */
  function buscaCom(rows) {
    const chamadas = [];
    const buscar = async ids => { chamadas.push(ids); return rows; };
    return { chamadas, buscar };
  }

  test('uma consulta para o lote inteiro', async () => {
    /* Dez linhas na tela viravam dez idas ao banco. */
    const b = buscaCom([]);
    await viewsPorMidia(Array.from({ length: 10 }, (_, i) => ({ igMediaId: `m${i}` })), b.buscar);
    expect(b.chamadas).toHaveLength(1);
    expect(b.chamadas[0]).toHaveLength(10);
  });

  test('ids repetidos são consultados uma vez', async () => {
    const b = buscaCom([]);
    await viewsPorMidia([{ igMediaId: 'm1' }, { igMediaId: 'm1' }, { igMediaId: 'm2' }], b.buscar);
    expect(b.chamadas[0].sort()).toEqual(['m1', 'm2']);
  });

  test('sem id nenhum, não consulta', async () => {
    const b = buscaCom([]);
    expect([...(await viewsPorMidia([{ igMediaId: '' }, {}, null], b.buscar))]).toEqual([]);
    expect(b.chamadas).toHaveLength(0);
  });

  test('devolve as reproduções do reel', async () => {
    const b = buscaCom([{ igMediaId: 'm1', videoViews: 1240, reach: 900 }]);
    expect((await viewsPorMidia([{ igMediaId: 'm1' }], b.buscar)).get('m1')).toBe(1240);
  });

  test('sem reproduções, cai no alcance', async () => {
    /* Reel recém-publicado costuma ter alcance antes de contabilizar
       reprodução. Mostrar 0 ao lado de um post que já circulou é pior que
       mostrar o número que existe. */
    const b = buscaCom([{ igMediaId: 'm1', videoViews: 0, reach: 310 }]);
    expect((await viewsPorMidia([{ igMediaId: 'm1' }], b.buscar)).get('m1')).toBe(310);
  });

  test('falha do banco não derruba a fila', async () => {
    /* Métrica é enfeite da linha; a linha é o que importa. */
    const quebrada = async () => { throw new Error('sem conexão'); };
    expect([...(await viewsPorMidia([{ igMediaId: 'm1' }], quebrada))]).toEqual([]);
  });

  test('a busca padrão lê a tabela de insights', async () => {
    const banco = require('./helpers/banco');
    await banco.limpar();
    const conta = await banco.criarConta();
    await banco.sql`insert into insights ${banco.sql({ accountId: conta.id, igMediaId: 'm9', videoViews: 77 })}`;
    expect((await viewsPorMidia([{ igMediaId: 'm9' }])).get('m9')).toBe(77);
  });
});

describe('a linha, como a tela precisa', () => {
  const post = {
    id: OID,
    scheduledAt: new Date('2026-09-07T22:10:00Z'),
    createdAt: new Date('2026-09-07T20:00:00Z'),
    jobName: 'Teste',
    jobId: '00000000-68bd-4a80-0000-000000000009',
    postType: 'reel',
    status: 'concluido',
    error: '',
    igMediaId: 'm1',
    accounts: [{ id: 'a1', username: 'josefabonatto_83', avatar: '/uploads/avatars/x.jpg' }],
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
    const duas = { ...post, accounts: [post.accounts[0], { id: 'a2', username: 'outra' }] };
    expect(montarLinha(duas, new Map()).contas.map(c => c.username)).toEqual(['josefabonatto_83', 'outra']);
  });

  test('conta apagada não vira linha quebrada', () => {
    /* `accounts` guarda ObjectIds; sem populate ou com a conta apagada, o item
       vem como id cru ou null. Ler `.username` disso dava undefined na tela. */
    expect(montarLinha({ ...post, accounts: ['00000000-64b0-0000-0000-0000000000aa', null] }, new Map()).contas).toEqual([]);
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
  const banco = require('./helpers/banco');

  test('o post guarda o envio e o id da mídia', async () => {
    await banco.limpar();
    const job = await banco.criarJob({ name: 'Envio X' });
    const post = await banco.criarPost({ jobId: job.id, jobName: 'Envio X', igMediaId: '179' });
    const [linha] = await banco.sql`select job_id, job_name, ig_media_id from posts where id = ${post.id}`;
    expect(linha).toEqual({ jobId: job.id, jobName: 'Envio X', igMediaId: '179' });
  });

  test('o worker grava o envio e o id da mídia', () => {
    /* Coluna que ninguém preenche é o defeito mais barato daqui: a fila
       abriria com o envio vazio em toda linha. */
    const w = ler('../src/worker.js');
    expect(w).toMatch(/jobId: job\.id, jobRound: rodada, jobName: job\.name/);
    expect(w).toContain('update posts set ig_media_id = ${mediaId}');
  });

  test('o id da mídia é anexado atomicamente, sem sobrescrever o de outra conta', () => {
    /* O mesmo post sai em várias contas em paralelo: o registro de cada uma é
       acrescentado com `||` no próprio UPDATE, nunca lido-e-regravado. */
    const w = ler('../src/worker.js');
    expect(w).toMatch(/midias_publicadas = midias_publicadas \|\|/);
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

/* ── Rodada longa não é rodada travada ──────────────────────────────────────
   Uma rodada de 10 contas com intervalo humanizado leva de 20 a 50 min. A
   recuperação só reagenda envio SEM rodada nenhuma na fila — a que está
   rodando conta como presente. */
describe('a recuperação não duplica uma rodada em andamento', () => {
  const banco = require('./helpers/banco');

  test('envio com rodada rodando não ganha outra', async () => {
    await banco.limpar();
    const job = await banco.criarJob({ status: 'running' });
    await banco.sql`insert into queue_jobs (name, data, status) values ('job_round', ${banco.sql.json({ jobId: job.id })}, 'running')`;
    await require('../src/worker').recuperar();
    const rodadas = await banco.sql`select status from queue_jobs where name = 'job_round'`;
    expect(rodadas.map(r => r.status)).toEqual(['running']);
  });

  test('envio ativo sem rodada nenhuma volta para a fila', async () => {
    await banco.limpar();
    const job = await banco.criarJob({ status: 'waiting_interval' });
    await require('../src/worker').recuperar();
    const rodadas = await banco.sql`select data from queue_jobs where name = 'job_round'`;
    expect(rodadas.map(r => r.data.jobId)).toEqual([job.id]);
  });
});
