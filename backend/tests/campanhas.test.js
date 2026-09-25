'use strict';

/**
 * Campanhas, de ponta a ponta contra o banco de teste.
 *
 * A publicação e o comentário no Instagram chegam por injeção
 * (`publicarNaConta` / `comentarNaConta`), como o worker faz — aqui são
 * dublês que registram o que receberam. Todo o resto é o código real: plano,
 * materialização dos textos, fila no Postgres, contadores e recuperação.
 *
 * O que estes testes protegem:
 *   campanha pela metade        → ou nasce com todas as publicações, ou não nasce
 *   dois cliques em "Publicar"  → a fila tem um trabalho por publicação, nunca dois
 *   comentário na mídia errada  → vai no id que a PRÓPRIA publicação devolveu
 *   falha que contamina         → uma publicação falhando não derruba as outras
 *   pausa de ritmo virando erro → teto diário/cota adia, não falha
 *   restart no meio             → o que se perdeu da fila volta uma vez só, e o
 *                                 que talvez já tenha saído não é republicado
 *   token na resposta           → a API das campanhas nunca devolve a conta crua
 */

const banco = require('./helpers/banco');
const { sql } = banco;
const svc = require('../src/services/campaignService');
const executor = require('../src/services/campaignExecutor');
const recuperacao = require('../src/jobs/campaignRecovery');
const ctrl = require('../src/controllers/campaignController');

let CONTAS, MIDIAS;

async function semear({ contas = 2, midias = 2 } = {}) {
  await banco.limpar();
  CONTAS = [];
  for (let i = 1; i <= contas; i++) {
    CONTAS.push(await banco.criarConta({ username: `conta0${i}`, name: `Conta ${i}`, accessToken: 'segredo-do-token', igUserId: `ig${i}` }));
  }
  MIDIAS = [];
  for (let i = 1; i <= midias; i++) {
    const [m] = await sql`
      insert into media (filename, original_name, url, type)
      values (${`video0${i}.mp4`}, ${`Video ${i}`}, ${`/uploads/video0${i}.mp4`}, 'video') returning *`;
    MIDIAS.push(m);
  }
}

const dados = (extra = {}) => ({
  name: 'Campanha teste',
  accountIds: CONTAS.map(c => c.id),
  contentIds: MIDIAS.map(m => m.id),
  strategy: { mode: 'sequential', seed: 'fixa' },
  schedule: { intervalMinMinutes: 10, intervalMaxMinutes: 10 },
  captionMode: 'global',
  captions: { global: 'Olá de {username}' },
  commentMode: 'disabled',
  comments: {},
  settings: { postType: 'reel', respectDailyLimit: false },
  ...extra,
});

const comComentario = (extra = {}) => dados({
  commentMode: 'global',
  comments: { global: 'Comentário de {username}', delayMinutes: 2, delayMaxMinutes: 2 },
  ...extra,
});

const publicacoes = id => sql`select * from campaign_publications where campaign_id = ${id} order by "order"`;
const trabalhos = nome => sql`select * from queue_jobs where name = ${nome}`;
const umaPublicacao = async id => (await sql`select * from campaign_publications where id = ${id}`)[0];

/** Dublê da publicação: devolve um media id por chamada e guarda o que recebeu. */
function publicador(falharEm = () => null) {
  const chamadas = [];
  let n = 0;
  const fn = async (conta, post) => {
    chamadas.push({ conta, post });
    const erro = falharEm(conta, post);
    if (erro) throw erro;
    return { mediaId: `midia-${++n}` };
  };
  fn.chamadas = chamadas;
  return fn;
}

function comentador(falhar = null) {
  const chamadas = [];
  const fn = async (conta, alvo) => {
    chamadas.push({ conta, ...alvo });
    if (falhar) throw falhar;
    return { commentId: `coment-${chamadas.length}` };
  };
  fn.chamadas = chamadas;
  return fn;
}

/** Executa como a fila faz: o trabalho sai da tabela e o handler roda. */
async function rodar(pubId, publicarNaConta) {
  await sql`delete from queue_jobs where key = ${`campaign-publication:${pubId}`}`;
  return executor.processarPublicacao(pubId, { publicarNaConta });
}

/** Chama um handler do controller e devolve `{ status, corpo }`. */
async function chamar(handler, { params = {}, query = {}, body = {}, headers = {} } = {}) {
  const res = {
    statusCode: 200, corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.corpo = o; return this; },
  };
  await handler({ params, query, body, get: h => headers[h] }, res);
  return { status: res.statusCode, corpo: res.corpo };
}

/** Cria, agenda e devolve a campanha com as publicações. */
async function campanhaAgendada(extra = {}) {
  const c = await svc.criarCampanha(dados(extra));
  await executor.agendarCampanha(c.id);
  return { campanha: c, pubs: await publicacoes(c.id) };
}

beforeEach(() => semear());

/* ── Criação ─────────────────────────────────────────────────────────────── */

describe('criação', () => {
  test('materializa uma publicação por conta × conteúdo, com o texto já resolvido', async () => {
    const c = await svc.criarCampanha(dados());
    const pubs = await publicacoes(c.id);
    expect(pubs).toHaveLength(4);
    expect(c.totalPublications).toBe(4);
    expect(new Set(pubs.map(p => `${p.accountId}|${p.contentId}`)).size).toBe(4);
    for (const p of pubs) {
      const conta = CONTAS.find(x => x.id === p.accountId);
      expect(p.captionTemplate).toBe('Olá de {username}');
      expect(p.resolvedCaption).toBe(`Olá de ${conta.username}`);
      expect(p.status).toBe('scheduled');
    }
  });

  test('horários seguem o intervalo configurado', async () => {
    const c = await svc.criarCampanha(dados());
    const pubs = await publicacoes(c.id);
    for (let i = 1; i < pubs.length; i++) {
      expect(pubs[i].scheduledAt - pubs[i - 1].scheduledAt).toBe(10 * 60_000);
    }
  });

  test('comentário respeita a precedência conta+conteúdo → conta → conteúdo → geral', async () => {
    const [a, b] = CONTAS;
    const [m1, m2] = MIDIAS;
    const c = await svc.criarCampanha(comComentario({
      commentMode: 'per_account_content',
      comments: {
        global: 'geral',
        byAccount: { [b.id]: 'da conta b' },
        byContent: { [m2.id]: 'do conteúdo 2' },
        byAccountContent: { [`${a.id}__${m1.id}`]: 'a com 1' },
      },
    }));
    const texto = (conta, midia) => {
      return publicacoes(c.id).then(ps => ps.find(p => p.accountId === conta.id && p.contentId === midia.id).resolvedComment);
    };
    expect(await texto(a, m1)).toBe('a com 1');
    expect(await texto(b, m1)).toBe('da conta b');
    expect(await texto(b, m2)).toBe('da conta b');
    expect(await texto(a, m2)).toBe('do conteúdo 2');
  });

  test.each([
    ['NO_ACCOUNTS', () => dados({ accountIds: [] })],
    ['NO_CONTENTS', () => dados({ contentIds: [] })],
    ['INVALID_ID', () => dados({ accountIds: ['nao-e-uuid'] })],
    ['ACCOUNT_NOT_FOUND', () => dados({ accountIds: ['00000000-0000-4000-8000-000000000000'] })],
    ['CONTENT_NOT_FOUND', () => dados({ contentIds: ['00000000-0000-4000-8000-000000000000'] })],
    ['NAME_REQUIRED', () => dados({ name: '  ' })],
    ['INVALID_STRATEGY', () => dados({ strategy: { mode: 'inventada' } })],
    ['INVALID_COMMENT_MODE', () => dados({ commentMode: 'inventado' })],
    ['INVALID_INTERVAL', () => dados({ schedule: { intervalMinMinutes: 10, intervalMaxMinutes: 5 } })],
    ['INVALID_WINDOW', () => dados({ schedule: { windowStart: '18:00', windowEnd: '09:00' } })],
    ['INVALID_WEEKDAYS', () => dados({ schedule: { weekdays: [1, 9] } })],
    ['INVALID_START_AT', () => dados({ schedule: { startAt: 'amanhã' } })],
  ])('%s: recusada, e nada fica gravado', async (codigo, entrada) => {
    await expect(svc.criarCampanha(entrada())).rejects.toMatchObject({ code: codigo });
    expect(await sql`select id from campaigns`).toHaveLength(0);
    expect(await sql`select id from campaign_publications`).toHaveLength(0);
  });

  test('conta banida é recusada na criação', async () => {
    await sql`update accounts set health_status = 'banida' where id = ${CONTAS[0].id}`;
    await expect(svc.criarCampanha(dados())).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ELIGIBLE' });
  });

  test('plano vazio (todas no teto diário) não cria campanha', async () => {
    await sql`update accounts set daily_post_limit = 1, posts_today = 1`;
    await expect(svc.criarCampanha(dados({ settings: { postType: 'reel' } }))).rejects.toMatchObject({ code: 'EMPTY_PLAN' });
  });

  test('só as capas de conteúdos e contas que ficaram na campanha são gravadas', async () => {
    const [capa] = await sql`insert into media (filename, type) values ('capa.jpg', 'image') returning id`;
    const fora = '00000000-0000-4000-8000-00000000abcd';
    const c = await svc.criarCampanha(dados({
      covers: {
        byContent: { [MIDIAS[0].id]: capa.id, [fora]: capa.id },
        byAccount: { [CONTAS[1].id]: capa.id, [fora]: capa.id },
      },
    }));
    expect(c.covers).toEqual({ byContent: { [MIDIAS[0].id]: capa.id }, byAccount: { [CONTAS[1].id]: capa.id } });
  });
});

/* ── Capas ───────────────────────────────────────────────────────────────── */

describe('_arquivoDaCapa', () => {
  let capaConteudo, capaPerfil;
  beforeEach(async () => {
    [capaConteudo] = await sql`insert into media (filename, type) values ('capa-conteudo.jpg', 'image') returning id`;
    [capaPerfil] = await sql`insert into media (filename, type) values ('capa-perfil.jpg', 'image') returning id`;
  });

  test('a capa do perfil vale acima da do conteúdo', async () => {
    const campanha = { covers: { byContent: { c1: capaConteudo.id }, byAccount: { a1: capaPerfil.id } } };
    expect(await executor._arquivoDaCapa(campanha, 'c1', 'a1')).toBe('capa-perfil.jpg');
    expect(await executor._arquivoDaCapa(campanha, 'c1', 'a2')).toBe('capa-conteudo.jpg');
  });

  test('sem capa, ou capa apagada da biblioteca, vira "sem capa" em vez de erro', async () => {
    expect(await executor._arquivoDaCapa({ covers: {} }, 'c1', 'a1')).toBe('');
    expect(await executor._arquivoDaCapa({}, 'c1', 'a1')).toBe('');
    const apagada = { covers: { byContent: { c1: '00000000-0000-4000-8000-000000000000' } } };
    expect(await executor._arquivoDaCapa(apagada, 'c1', 'a1')).toBe('');
  });
});

/* ── Agendamento ─────────────────────────────────────────────────────────── */

describe('agendamento', () => {
  test('um trabalho por publicação, e agendar de novo não duplica', async () => {
    const c = await svc.criarCampanha(dados({ schedule: { startAt: new Date(Date.now() + 3_600_000), intervalMinMinutes: 10, intervalMaxMinutes: 10 } }));
    const r1 = await executor.agendarCampanha(c.id);
    const r2 = await executor.agendarCampanha(c.id);
    expect(r1.agendadas).toBe(4);
    expect(r2).toMatchObject({ agendadas: 0, jaExistiam: 4 });
    const fila = await trabalhos('campanha_publicacao');
    expect(fila).toHaveLength(4);
    const pubs = await publicacoes(c.id);
    expect(fila.map(j => j.key).sort()).toEqual(pubs.map(p => `campaign-publication:${p.id}`).sort());
    expect(pubs.every(p => p.queueJobId === `campaign-publication:${p.id}`)).toBe(true);
  });

  test('o horário planejado vira o horário do trabalho', async () => {
    const inicio = new Date(Date.now() + 3_600_000);
    const c = await svc.criarCampanha(dados({ schedule: { startAt: inicio, intervalMinMinutes: 10, intervalMaxMinutes: 10 } }));
    await executor.agendarCampanha(c.id);
    const [primeira] = await publicacoes(c.id);
    const [job] = await sql`select run_at from queue_jobs where key = ${`campaign-publication:${primeira.id}`}`;
    expect(Math.abs(job.runAt - inicio)).toBeLessThan(2000);
  });

  test('publicações atrasadas são espaçadas em vez de saírem de uma vez', async () => {
    const c = await svc.criarCampanha(dados({ schedule: { startAt: new Date(Date.now() - 86_400_000), intervalMinMinutes: 1, intervalMaxMinutes: 1 } }));
    await executor.agendarCampanha(c.id);
    const horarios = (await trabalhos('campanha_publicacao')).map(j => j.runAt.getTime()).sort((a, b) => a - b);
    // 4 atrasadas: 0–4, 5–9, 10–14 e 15–19 min a partir de agora.
    expect(horarios[horarios.length - 1] - horarios[0]).toBeGreaterThanOrEqual(11 * 60_000 - 1000);
  });

  test('campanha pausada ou cancelada não agenda', async () => {
    const c = await svc.criarCampanha(dados());
    await sql`update campaigns set status = 'paused' where id = ${c.id}`;
    await expect(executor.agendarCampanha(c.id)).rejects.toMatchObject({ code: 'INVALID_CAMPAIGN_STATE' });
  });
});

/* ── Execução ────────────────────────────────────────────────────────────── */

describe('execução da publicação', () => {
  test('publica, grava o media id e o post, e fecha a campanha no fim', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    const publicar = publicador();
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });

    const depois = await publicacoes(campanha.id);
    expect(depois.every(p => p.status === 'published')).toBe(true);
    expect(depois.map(p => p.instagramMediaId).sort()).toEqual(['midia-1', 'midia-2', 'midia-3', 'midia-4']);
    const posts = await sql`select * from posts`;
    expect(posts).toHaveLength(4);
    expect(posts.every(p => p.status === 'concluido' && p.postType === 'reel')).toBe(true);
    expect(depois.every(p => posts.some(x => x.id === p.postId))).toBe(true);

    const [c] = await sql`select * from campaigns where id = ${campanha.id}`;
    expect(c).toMatchObject({ status: 'completed', publishedPublications: 4, pendingPublications: 0 });
  });

  test('a legenda que sai é a da conta que publica', async () => {
    const { pubs } = await campanhaAgendada();
    const publicar = publicador();
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });
    for (const { conta, post } of publicar.chamadas) expect(post.caption).toBe(`Olá de ${conta.username}`);
  });

  test('imagem não vira reel', async () => {
    await sql`update media set filename = replace(filename, '.mp4', '.jpg'), type = 'image'`;
    const { pubs } = await campanhaAgendada();
    const publicar = publicador();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    expect(publicar.chamadas[0].post).toMatchObject({ postType: 'post', mediaType: 'image', cover: '' });
  });

  test('duas execuções simultâneas publicam uma vez só', async () => {
    const { pubs } = await campanhaAgendada();
    const publicar = publicador();
    const r = await Promise.all([
      executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar }),
      executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar }),
    ]);
    expect(publicar.chamadas).toHaveLength(1);
    expect(r.filter(x => x.ok)).toHaveLength(1);
    expect((await umaPublicacao(pubs[0].id)).attempts).toBe(1);
  });

  test('publicação já publicada não sai de novo', async () => {
    const { pubs } = await campanhaAgendada();
    const publicar = publicador();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    const r = await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    expect(r).toMatchObject({ skipped: true, reason: 'ALREADY_PUBLISHED' });
    expect(publicar.chamadas).toHaveLength(1);
  });

  test('uma falha não contamina as outras, e a campanha fecha como parcial', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    const alvo = pubs[1];
    const publicar = publicador((conta, post) => (
      conta.id === alvo.accountId && post.media === MIDIAS.find(m => m.id === alvo.contentId).filename
        ? Object.assign(new Error('Too many calls'), { code: 4 }) : null));
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });

    const depois = await publicacoes(campanha.id);
    expect(depois.filter(p => p.status === 'published')).toHaveLength(3);
    expect(await umaPublicacao(alvo.id)).toMatchObject({ status: 'failed', errorCode: 'RATE_LIMITED' });
    expect((await sql`select status from campaigns where id = ${campanha.id}`)[0].status).toBe('partial');
  });

  test('tudo falhando fecha a campanha como falha', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    const publicar = publicador(() => new Error('erro qualquer'));
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });
    expect((await sql`select status from campaigns where id = ${campanha.id}`)[0].status).toBe('failed');
  });

  test('pausa de ritmo adia para o horário devolvido, sem falhar', async () => {
    const { pubs } = await campanhaAgendada();
    const ate = new Date(Date.now() + 2 * 3_600_000);
    const publicar = publicador(() => Object.assign(new Error('Teto diário atingido'), { code: 'RHYTHM_WAIT', retryAt: ate }));
    const r = await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    expect(r.deferred).toBe(true);

    const pub = await umaPublicacao(pubs[0].id);
    expect(pub).toMatchObject({ status: 'scheduled', errorCode: 'RHYTHM_WAIT' });
    const [job] = await sql`select run_at from queue_jobs where key = ${`campaign-publication:${pub.id}`}`;
    expect(Math.abs(job.runAt - ate)).toBeLessThan(2000);
  });

  test('conta banida ou apagada falha com o código certo, sem chamar a publicação', async () => {
    const { pubs } = await campanhaAgendada();
    await sql`update accounts set health_status = 'banida' where id = ${pubs[0].accountId}`;
    const publicar = publicador();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'failed', errorCode: 'ACCOUNT_UNAVAILABLE' });

    const outra = pubs.find(p => p.accountId !== pubs[0].accountId);
    await sql`delete from accounts where id = ${outra.accountId}`;
    await executor.processarPublicacao(outra.id, { publicarNaConta: publicar });
    expect(await umaPublicacao(outra.id)).toMatchObject({ status: 'failed', errorCode: 'ACCOUNT_UNAVAILABLE' });
    expect(publicar.chamadas).toHaveLength(0);
  });

  test('conteúdo apagado falha como CONTENT_NOT_FOUND', async () => {
    const { pubs } = await campanhaAgendada();
    await sql`delete from media where id = ${pubs[0].contentId}`;
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicador() });
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'failed', errorCode: 'CONTENT_NOT_FOUND' });
  });

  test('campanha pausada devolve a publicação para pendente sem gastar tentativa', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    await sql`update campaigns set status = 'paused' where id = ${campanha.id}`;
    const r = await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicador() });
    expect(r.reason).toBe('CAMPAIGN_PAUSED');
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

/* ── Comentário ──────────────────────────────────────────────────────────── */

describe('comentário', () => {
  async function publicadas() {
    const c = await svc.criarCampanha(comComentario());
    await executor.agendarCampanha(c.id);
    const publicar = publicador();
    for (const p of await publicacoes(c.id)) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });
    return { campanha: c, pubs: await publicacoes(c.id) };
  }

  test('publicar agenda o comentário como trabalho à parte, com o atraso configurado', async () => {
    const { pubs } = await publicadas();
    const fila = await trabalhos('campanha_comentario');
    expect(fila).toHaveLength(4);
    for (const j of fila) {
      expect(j.runAt.getTime() - Date.now()).toBeGreaterThan(60_000);
      expect(j.runAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60_000 + 1000);
    }
    expect(pubs.every(p => p.commentStatus === 'scheduled')).toBe(true);
  });

  test('cada comentário vai à mídia da própria publicação, com o texto da própria conta', async () => {
    const { pubs } = await publicadas();
    const comentar = comentador();
    for (const p of pubs) await executor.processarComentario(p.id, { comentarNaConta: comentar });

    for (const p of pubs) {
      const chamada = comentar.chamadas.find(ch => ch.mediaId === p.instagramMediaId);
      expect(chamada).toBeDefined();
      expect(chamada.conta.id).toBe(p.accountId);
      expect(chamada.text).toBe(`Comentário de ${chamada.conta.username}`);
    }
    const depois = await sql`select * from campaign_publications`;
    expect(depois.every(p => p.commentStatus === 'posted' && p.commentId.startsWith('coment-'))).toBe(true);
  });

  test('comentário já publicado não sai de novo', async () => {
    const { pubs } = await publicadas();
    const comentar = comentador();
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentar });
    const r = await executor.processarComentario(pubs[0].id, { comentarNaConta: comentar });
    expect(r.reason).toBe('ALREADY_POSTED');
    expect(comentar.chamadas).toHaveLength(1);
  });

  test('sem o id da mídia, falha em vez de adivinhar onde comentar', async () => {
    const { pubs } = await publicadas();
    await sql`update campaign_publications set instagram_media_id = '' where id = ${pubs[0].id}`;
    const comentar = comentador();
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentar });
    expect(comentar.chamadas).toHaveLength(0);
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ commentStatus: 'failed', commentErrorCode: 'COMMENT_MEDIA_NOT_FOUND' });
    await expect(executor.reprocessarComentario(pubs[0].id)).rejects.toMatchObject({ code: 'COMMENT_MEDIA_NOT_FOUND' });
  });

  test('falha no comentário não desfaz a publicação, e o retry comenta sem republicar', async () => {
    const { pubs } = await publicadas();
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentador(new Error('timeout de rede')) });
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'published', commentStatus: 'failed', commentErrorCode: 'TIMEOUT', commentAttempts: 1 });

    await executor.reprocessarComentario(pubs[0].id);
    expect(await sql`select id from queue_jobs where key = ${`campaign-comment:${pubs[0].id}`}`).toHaveLength(1);
    const comentar = comentador();
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentar });
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'published', commentStatus: 'posted', commentAttempts: 2 });
    expect(await sql`select id from posts`).toHaveLength(4);
  });

  test('reprocessar recusa comentário já publicado e publicação que não saiu', async () => {
    const { pubs } = await publicadas();
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentador() });
    await expect(executor.reprocessarComentario(pubs[0].id)).rejects.toMatchObject({ code: 'ALREADY_POSTED' });
    await sql`update campaign_publications set status = 'failed' where id = ${pubs[1].id}`;
    await expect(executor.reprocessarComentario(pubs[1].id)).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  test('campanha sem comentário não agenda nada', async () => {
    const { pubs } = await campanhaAgendada();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicador() });
    expect(await trabalhos('campanha_comentario')).toHaveLength(0);
    expect((await umaPublicacao(pubs[0].id)).commentStatus).toBe('none');
  });
});

/* ── Controller: pausa, retomada, cancelamento, retry ────────────────────── */

describe('controle da campanha', () => {
  test('pausar tira da fila; retomar reenfileira sem duplicar', async () => {
    const { campanha } = await campanhaAgendada();
    const pausa = await chamar(ctrl.pause, { params: { id: campanha.id } });
    expect(pausa.status).toBe(200);
    expect(pausa.corpo.dequeued).toBe(4);
    expect(await trabalhos('campanha_publicacao')).toHaveLength(0);
    expect((await publicacoes(campanha.id)).every(p => p.status === 'pending')).toBe(true);

    const retomada = await chamar(ctrl.resume, { params: { id: campanha.id } });
    expect(retomada.corpo.requeued).toBe(4);
    await chamar(ctrl.start, { params: { id: campanha.id } });
    expect(await trabalhos('campanha_publicacao')).toHaveLength(4);
  });

  test('retomar só vale para campanha pausada', async () => {
    const { campanha } = await campanhaAgendada();
    const r = await chamar(ctrl.resume, { params: { id: campanha.id } });
    expect(r.status).toBe(409);
    expect(r.corpo.code).toBe('INVALID_CAMPAIGN_STATE');
  });

  test('cancelar cancela o que falta e o comentário pendente; o publicado fica', async () => {
    const c = await svc.criarCampanha(comComentario());
    await executor.agendarCampanha(c.id);
    const [primeira] = await publicacoes(c.id);
    await rodar(primeira.id, publicador());

    const r = await chamar(ctrl.cancel, { params: { id: c.id } });
    expect(r.corpo.cancelled).toBe(3);
    const depois = await publicacoes(c.id);
    expect(depois.find(p => p.id === primeira.id)).toMatchObject({ status: 'published', commentStatus: 'cancelled' });
    expect(depois.filter(p => p.status === 'cancelled')).toHaveLength(3);
    expect(await sql`select id from queue_jobs`).toHaveLength(0);
  });

  test('campanha cancelada faz o trabalho que sobrou desistir', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    await sql`update campaigns set status = 'cancelled' where id = ${campanha.id}`;
    const publicar = publicador();
    const r = await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicar });
    expect(r.reason).toBe('CAMPAIGN_CANCELLED');
    expect(publicar.chamadas).toHaveLength(0);
  });

  test('retry-failed devolve as falhas para a fila, na mesma linha', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicador(() => new Error('falhou')) });
    expect((await sql`select status from campaigns where id = ${campanha.id}`)[0].status).toBe('failed');

    const r = await chamar(ctrl.retryFailed, { params: { id: campanha.id } });
    expect(r.corpo.retried).toBe(4);
    expect(r.corpo.campaign.status).toBe('scheduled');
    expect(await publicacoes(campanha.id)).toHaveLength(4);
    expect((await publicacoes(campanha.id)).every(p => p.status === 'scheduled')).toBe(true);
    expect(await trabalhos('campanha_publicacao')).toHaveLength(4);

    const publicar = publicador();
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicar });
    expect((await publicacoes(campanha.id)).every(p => p.status === 'published' && p.attempts === 2)).toBe(true);
  });

  test('retry recusa publicação que já saiu ou que está rodando', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicador() });
    const r = await chamar(ctrl.retryPublication, { params: { id: campanha.id, publicationId: pubs[0].id } });
    expect(r.status).toBe(409);
    await expect(executor.reprocessarPublicacao(pubs[0].id)).rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' });
    await sql`update campaign_publications set status = 'processing' where id = ${pubs[1].id}`;
    await expect(executor.reprocessarPublicacao(pubs[1].id)).rejects.toMatchObject({ code: 'PUBLICATION_RUNNING' });
  });

  test('cancelar uma publicação não mexe nas outras', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    const r = await chamar(ctrl.cancelPublication, { params: { id: campanha.id, publicationId: pubs[0].id } });
    expect(r.corpo.publication.status).toBe('cancelled');
    expect(await trabalhos('campanha_publicacao')).toHaveLength(3);
    expect((await publicacoes(campanha.id)).filter(p => p.status === 'scheduled')).toHaveLength(3);
  });

  test('publicação de outra campanha é 404', async () => {
    const { campanha } = await campanhaAgendada();
    const outra = await svc.criarCampanha(dados({ name: 'Outra' }));
    const [dela] = await publicacoes(outra.id);
    const r = await chamar(ctrl.getPublication, { params: { id: campanha.id, publicationId: dela.id } });
    expect(r.status).toBe(404);
  });
});

/* ── Controller: criação, prévia, leitura ────────────────────────────────── */

describe('API', () => {
  test('criar responde 201; erro de validação vira 4xx com código', async () => {
    const ok = await chamar(ctrl.create, { body: dados() });
    expect(ok.status).toBe(201);
    expect(ok.corpo.campaign.id).toBeDefined();

    const ruim = await chamar(ctrl.create, { body: dados({ accountIds: [] }) });
    expect(ruim.status).toBe(400);
    expect(ruim.corpo.code).toBe('NO_ACCOUNTS');
    const semConta = await chamar(ctrl.create, { body: dados({ accountIds: ['00000000-0000-4000-8000-000000000000'] }) });
    expect(semConta.status).toBe(404);
  });

  test('Idempotency-Key: o reenvio devolve a mesma campanha em vez de criar outra', async () => {
    const headers = { 'Idempotency-Key': 'chave-1' };
    const a = await chamar(ctrl.create, { body: dados(), headers });
    const b = await chamar(ctrl.create, { body: dados(), headers });
    expect(b.status).toBe(200);
    expect(b.corpo).toMatchObject({ idempotent: true, campaign: { id: a.corpo.campaign.id } });
    expect(await sql`select id from campaigns`).toHaveLength(1);
  });

  test('Idempotency-Key de uma criação que falhou fica livre para tentar de novo', async () => {
    const headers = { 'Idempotency-Key': 'chave-2' };
    expect((await chamar(ctrl.create, { body: dados({ name: '' }), headers })).status).toBe(400);
    expect((await chamar(ctrl.create, { body: dados(), headers })).status).toBe(201);
  });

  test('prévia resolve os textos e não grava nada', async () => {
    const r = await chamar(ctrl.preview, { body: comComentario() });
    expect(r.status).toBe(200);
    expect(r.corpo.summary).toMatchObject({ accounts: 2, contents: 2, publications: 4, invalid: 0 });
    for (const p of r.corpo.publications) {
      expect(p.resolvedCaption).toBe(`Olá de ${p.account.username}`);
      expect(p.resolvedComment).toBe(`Comentário de ${p.account.username}`);
      expect(p.commentDelayMinutes).toBe(2);
    }
    expect(await sql`select id from campaigns`).toHaveLength(0);
    expect(await sql`select id from queue_jobs`).toHaveLength(0);
  });

  test('a prévia com a mesma semente é exatamente o que será criado', async () => {
    const entrada = dados({ strategy: { mode: 'interleaved_random', seed: 'igual' }, schedule: { startAt: '2030-01-01T12:00:00Z', intervalMinMinutes: 5, intervalMaxMinutes: 30 } });
    const previa = (await chamar(ctrl.preview, { body: entrada })).corpo.publications;
    const c = await svc.criarCampanha(entrada);
    const criadas = await publicacoes(c.id);
    expect(criadas.map(p => [p.accountId, p.contentId, p.scheduledAt.toISOString()]))
      .toEqual(previa.map(p => [p.account.id, p.content.id, new Date(p.scheduledAt).toISOString()]));
  });

  test('a prévia aponta texto longo demais e marcação inexistente na publicação exata', async () => {
    const r = await chamar(ctrl.preview, { body: dados({ captions: { global: `${'x'.repeat(2300)} {inexistente}` } }) });
    const [p] = r.corpo.publications;
    expect(p.problemas.map(x => x.tipo)).toEqual(expect.arrayContaining(['CAPTION_TOO_LONG', 'UNRESOLVED_VARIABLE']));
    expect(r.corpo.summary.invalid).toBe(4);
  });

  test('a prévia mostra a capa só em vídeo, com a do perfil acima da do conteúdo', async () => {
    const [capaC] = await sql`insert into media (filename, url, type) values ('cc.jpg', '/uploads/cc.jpg', 'image') returning id`;
    const [capaP] = await sql`insert into media (filename, url, type) values ('cp.jpg', '/uploads/cp.jpg', 'image') returning id`;
    const r = await chamar(ctrl.preview, { body: dados({ covers: {
      byContent: { [MIDIAS[0].id]: capaC.id },
      byAccount: { [CONTAS[0].id]: capaP.id },
    } }) });
    const de = (conta, midia) => r.corpo.publications.find(p => p.account.id === conta.id && p.content.id === midia.id).cover;
    expect(de(CONTAS[0], MIDIAS[0])).toMatchObject({ id: capaP.id, porPerfil: true });
    expect(de(CONTAS[1], MIDIAS[0])).toMatchObject({ id: capaC.id, porPerfil: false });
    expect(de(CONTAS[1], MIDIAS[1])).toBeNull();
  });

  test('variáveis: exatamente a lista do templateResolver', () => {
    const res = { json(o) { this.corpo = o; } };
    ctrl.variables({}, res);
    expect(res.corpo.variables).toEqual(require('../src/services/templateResolver').listarVariaveis());
  });

  test('lista, detalhe e publicações com contadores, sem o token da conta', async () => {
    const { campanha, pubs } = await campanhaAgendada();
    await executor.processarPublicacao(pubs[0].id, { publicarNaConta: publicador() });

    const lista = await chamar(ctrl.list, { query: {} });
    expect(lista.corpo.campaigns[0]).toMatchObject({ id: campanha.id, publicadas: 1, pendentes: 3 });

    const detalhe = await chamar(ctrl.get, { params: { id: campanha.id } });
    expect(detalhe.corpo.statistics).toMatchObject({ total: 4, published: 1, scheduled: 3 });
    expect(detalhe.corpo.progress).toMatchObject({ done: 1, total: 4, percentage: 25 });

    const pubsResp = await chamar(ctrl.listPublications, { params: { id: campanha.id }, query: {} });
    expect(pubsResp.corpo.publications).toHaveLength(4);
    expect(pubsResp.corpo.publications[0].account.username).toMatch(/^conta0/);

    const tudo = JSON.stringify([lista.corpo, detalhe.corpo, pubsResp.corpo]);
    expect(tudo).not.toContain('segredo-do-token');
    expect(tudo).not.toContain('accessToken');
    expect(tudo).not.toContain('instagramMediaId');
  });

  test('busca por nome escapa curinga', async () => {
    await svc.criarCampanha(dados({ name: 'Promo 100%' }));
    await svc.criarCampanha(dados({ name: 'Outra' }));
    const r = await chamar(ctrl.list, { query: { search: '100%' } });
    expect(r.corpo.campaigns.map(c => c.name)).toEqual(['Promo 100%']);
    expect((await chamar(ctrl.list, { query: { search: '%' } })).corpo.campaigns).toHaveLength(1);
  });

  test('apagar leva publicações e eventos junto, e tira da fila', async () => {
    const { campanha } = await campanhaAgendada();
    const r = await chamar(ctrl.remove, { params: { id: campanha.id } });
    expect(r.corpo.success).toBe(true);
    expect(await sql`select id from campaign_publications`).toHaveLength(0);
    expect(await sql`select id from queue_jobs`).toHaveLength(0);
  });

  test('editar muda só nome e descrição', async () => {
    const { campanha } = await campanhaAgendada();
    const r = await chamar(ctrl.update, { params: { id: campanha.id }, body: { name: ' Novo ', description: 'd', status: 'completed' } });
    expect(r.corpo.campaign).toMatchObject({ name: 'Novo', description: 'd', status: 'scheduled' });
  });
});

/* ── Recuperação após restart ────────────────────────────────────────────── */

describe('recuperação', () => {
  test('publicação agendada que sumiu da fila volta, uma vez só', async () => {
    const { campanha } = await campanhaAgendada();
    await sql`delete from queue_jobs`;
    const r1 = await recuperacao.recuperarAgendadas();
    const r2 = await recuperacao.recuperarAgendadas();
    expect(r1.reenfileiradas).toBe(4);
    expect(r2.reenfileiradas).toBe(0);
    expect(await trabalhos('campanha_publicacao')).toHaveLength(4);
    expect((await publicacoes(campanha.id)).every(p => p.status === 'scheduled')).toBe(true);
  });

  test('campanha pausada não é reenfileirada pela recuperação', async () => {
    const { campanha } = await campanhaAgendada();
    await chamar(ctrl.pause, { params: { id: campanha.id } });
    await recuperacao.recuperarAgendadas();
    expect(await trabalhos('campanha_publicacao')).toHaveLength(0);
  });

  test('presa em processing vira falha, sem republicar — a menos que ainda esteja rodando', async () => {
    const { pubs } = await campanhaAgendada();
    const velho = new Date(Date.now() - 2 * 3_600_000);
    await sql`update campaign_publications set status = 'processing' where id = any(${[pubs[0].id, pubs[1].id]}::uuid[])`;
    // O trigger de updated_at só age em UPDATE; aqui o valor explícito vale.
    await sql`alter table campaign_publications disable trigger user`;
    await sql`update campaign_publications set updated_at = ${velho} where id = any(${[pubs[0].id, pubs[1].id]}::uuid[])`;
    await sql`alter table campaign_publications enable trigger user`;
    await sql`update queue_jobs set status = 'running' where key = ${`campaign-publication:${pubs[1].id}`}`;

    expect(await recuperacao.recuperarProcessando()).toBe(1);
    expect(await umaPublicacao(pubs[0].id)).toMatchObject({ status: 'failed', errorCode: 'WORKER_RESTARTED' });
    expect((await umaPublicacao(pubs[1].id)).status).toBe('processing');
  });

  test('comentário agendado perdido volta; o já publicado não', async () => {
    const c = await svc.criarCampanha(comComentario());
    await executor.agendarCampanha(c.id);
    const pubs = await publicacoes(c.id);
    for (const p of pubs) await executor.processarPublicacao(p.id, { publicarNaConta: publicador() });
    await executor.processarComentario(pubs[0].id, { comentarNaConta: comentador() });
    await sql`delete from queue_jobs`;

    const r = await recuperacao.recuperarComentarios();
    expect(r.reenfileirados).toBe(3);
    expect((await recuperacao.recuperarComentarios()).reenfileirados).toBe(0);
    expect(await sql`select id from queue_jobs where key = ${`campaign-comment:${pubs[0].id}`}`).toHaveLength(0);
  });
});

/* ── Classificação de erro ───────────────────────────────────────────────── */

describe('classificação de erro', () => {
  test.each([
    [{ code: 'SEM_TOKEN', message: '' }, 'SESSION_EXPIRED'],
    [{ code: 4, message: 'Application request limit reached' }, 'RATE_LIMITED'],
    [{ message: 'Teto diário atingido' }, 'DAILY_LIMIT'],
    [{ message: 'fetch failed' }, 'NETWORK_ERROR'],
    [{ message: 'algo estranho' }, 'PUBLISH_ERROR'],
  ])('publicação: %o → %s', (err, codigo) => {
    expect(executor.classificarErro(err)).toBe(codigo);
  });

  test.each([
    [{ message: 'The operation was aborted due to timeout' }, 'TIMEOUT'],
    [{ message: 'fetch failed' }, 'NETWORK_ERROR'],
    [{ message: 'Unsupported get request. Object does not exist' }, 'COMMENT_MEDIA_NOT_FOUND'],
    [{ message: 'algo estranho' }, 'COMMENT_FAILED'],
  ])('comentário: %o → %s', (err, codigo) => {
    expect(executor.classificarErroComentario(err)).toBe(codigo);
  });

  test('o atraso do comentário é sorteado dentro da faixa', () => {
    for (let i = 0; i < 50; i++) {
      const m = executor._atrasoDoComentario({ delayMinutes: 2, delayMaxMinutes: 6 });
      expect(m).toBeGreaterThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(6);
    }
    expect(executor._atrasoDoComentario({})).toBeGreaterThanOrEqual(2);
    expect(executor._atrasoDoComentario({ delayMinutes: 3, delayMaxMinutes: 3 })).toBe(3);
  });
});
