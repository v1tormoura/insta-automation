'use strict';

/**
 * Testes do motor de execução da campanha (fase 8).
 *
 * A fila é um duplo em memória que reproduz o que importa do BullMQ para esta
 * fase: jobId determinístico com recusa de duplicata, delay, estado e remoção.
 * Testar contra o Redis real tornaria a suíte lenta e dependente de infra; o
 * que precisa ser provado aqui é a NOSSA lógica de idempotência, não a do BullMQ.
 */

const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId();

/* ── Fila falsa ────────────────────────────────────────────────────────────── */

const filaDb = new Map();   // jobId → { nome, dados, delay, estado }

const mockPostQueue = {
  add: jest.fn(async (nome, dados, opts = {}) => {
    const id = opts.jobId;
    // Comportamento central do BullMQ: jobId repetido NÃO cria segundo job.
    if (filaDb.has(id)) return filaDb.get(id);
    const job = {
      id, nome, data: dados, opts, delay: opts.delay || 0, estado: 'delayed',
      getState: async () => job.estado,
      remove:   async () => { filaDb.delete(id); },
    };
    filaDb.set(id, job);
    return job;
  }),
  getJob: jest.fn(async id => filaDb.get(id) || null),
};

jest.mock('../src/queue/postQueue', () => mockPostQueue);

/* ── Repositório em memória ────────────────────────────────────────────────── */

const db = { campaigns: [], publications: [], accounts: [], medias: [], posts: [] };

function _valorEmCampo(doc, campo) {
  return campo.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
}

function _combina(doc, filtro = {}) {
  return Object.entries(filtro).every(([campo, cond]) => {
    if (campo === '$or') return cond.some(c => _combina(doc, c));
    const valor = _valorEmCampo(doc, campo);
    if (cond && typeof cond === 'object' && !(cond instanceof mongoose.Types.ObjectId) && !(cond instanceof Date)) {
      if (cond.$in)  return cond.$in.map(String).includes(String(valor));
      if (cond.$nin) return !cond.$nin.map(String).includes(String(valor));
      if (cond.$lt)  return valor != null && new Date(valor) < new Date(cond.$lt);
      return false;
    }
    return String(valor) === String(cond);
  });
}

function _aplicar(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
  if (!update.$set && !update.$inc) Object.assign(doc, update);
  doc.updatedAt = new Date();
  return doc;
}

function mockModel(colecao, padroes = {}) {
  const encaixar = d => {
    const doc = { _id: oid(), createdAt: new Date(), updatedAt: new Date(), ...padroes, ...d };
    doc.save = jest.fn(async () => doc);
    doc.toObject = () => ({ ...doc });
    return doc;
  };

  const consulta = itens => {
    let ordem = null, pular = 0, teto = null;
    const resolver = () => {
      if (!Array.isArray(itens)) return itens;
      let s = itens.slice();
      if (ordem) {
        const campos = Object.entries(ordem);
        s.sort((a, b) => {
          for (const [c, dir] of campos) {
            const va = _valorEmCampo(a, c), vb = _valorEmCampo(b, c);
            const cmp = va > vb ? 1 : va < vb ? -1 : 0;
            if (cmp) return dir < 0 ? -cmp : cmp;
          }
          return 0;
        });
      }
      if (pular) s = s.slice(pular);
      if (teto !== null) s = s.slice(0, teto);
      return s;
    };
    const q = {
      sort: o => { ordem = o; return q; },
      skip: n => { pular = n || 0; return q; },
      limit: n => { teto = n ?? null; return q; },
      select: () => q, populate: () => q, lean: () => q,
      then: (r, j) => Promise.resolve(resolver()).then(r, j),
    };
    return q;
  };

  return {
    create: jest.fn(async d => {
      const arr = Array.isArray(d) ? d : [d];
      const criados = arr.map(x => { const doc = encaixar(x); db[colecao].push(doc); return doc; });
      return Array.isArray(d) ? criados : criados[0];
    }),
    insertMany: jest.fn(async docs => {
      const criados = docs.map(encaixar);
      db[colecao].push(...criados);
      return criados;
    }),
    find:     jest.fn((f = {}) => consulta(db[colecao].filter(x => _combina(x, f)))),
    findOne:  jest.fn((f = {}) => consulta(db[colecao].find(x => _combina(x, f)) || null)),
    // Encadeável como a Query real: o executor faz findById(...).lean() em
    // Account e Media, e devolver objeto puro quebraria só nesses caminhos.
    findById: jest.fn(id => consulta(db[colecao].find(x => String(x._id) === String(id)) || null)),
    findByIdAndUpdate: jest.fn(async (id, up) => {
      const doc = db[colecao].find(x => String(x._id) === String(id));
      return doc ? _aplicar(doc, up) : null;
    }),
    findOneAndUpdate: jest.fn(async (f, up) => {
      const doc = db[colecao].find(x => _combina(x, f));
      return doc ? _aplicar(doc, up) : null;
    }),
    updateOne: jest.fn(async (f, up) => {
      const doc = db[colecao].find(x => _combina(x, f));
      if (doc) _aplicar(doc, up);
      return { modifiedCount: doc ? 1 : 0 };
    }),
    updateMany: jest.fn(async (f, up) => {
      const alvos = db[colecao].filter(x => _combina(x, f));
      alvos.forEach(d => _aplicar(d, up));
      return { modifiedCount: alvos.length };
    }),
    countDocuments: jest.fn(async (f = {}) => db[colecao].filter(x => _combina(x, f)).length),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
    aggregate: jest.fn(async pipeline => {
      const match = pipeline.find(p => p.$match)?.$match || {};
      const alvos = db[colecao].filter(d => String(d.campaignId) === String(match.campaignId));
      const por = {};
      for (const d of alvos) por[d.status] = (por[d.status] || 0) + 1;
      return Object.entries(por).map(([_id, total]) => ({ _id, total }));
    }),
  };
}

jest.mock('../src/models/Campaign',            () => mockModel('campaigns', { status: 'draft' }));
jest.mock('../src/models/CampaignPublication', () => mockModel('publications', { status: 'pending', attempts: 0, commentStatus: 'none' }));
jest.mock('../src/models/Account',             () => mockModel('accounts'));
jest.mock('../src/models/Media',               () => mockModel('medias'));
jest.mock('../src/models/Post',                () => mockModel('posts'));

const Campaign            = require('../src/models/Campaign');
const CampaignPublication = require('../src/models/CampaignPublication');
const executor  = require('../src/services/campaignExecutor');
const filaCamp  = require('../src/services/campaignQueue');
const recovery  = require('../src/jobs/campaignRecovery');

/* ── Cenário ───────────────────────────────────────────────────────────────── */

const T0 = new Date('2026-09-01T18:00:00');

let campanha, contas, midias, pubs;

async function montarCenario({ nContas = 4, nMidias = 4, commentMode = 'disabled', delayMinutes = 2 } = {}) {
  db.campaigns = []; db.publications = []; db.accounts = []; db.medias = []; db.posts = [];
  filaDb.clear();
  jest.clearAllMocks();

  contas = [];
  for (let i = 0; i < nContas; i++) {
    contas.push((await require('../src/models/Account').create({
      username: `conta0${i + 1}`, name: `Conta ${i + 1}`,
      provider: 'official', accessToken: 'TOKEN', igUserId: `IG${i}`,
      healthStatus: 'ativa', postsToday: 0, dailyPostLimit: 20,
    })));
  }

  midias = [];
  for (let i = 0; i < nMidias; i++) {
    midias.push((await require('../src/models/Media').create({
      filename: `video0${i + 1}.mp4`, originalName: `Video ${i + 1}`,
      url: `/uploads/video0${i + 1}.mp4`, type: 'video',
    })));
  }

  campanha = await Campaign.create({
    name: 'Campanha 8', status: 'scheduled',
    commentMode, comments: { delayMinutes },
    settings: { postType: 'reel', processMode: 'limpeza_leve' },
  });

  pubs = [];
  let ordem = 1;
  for (const c of contas) {
    for (const m of midias) {
      pubs.push(await CampaignPublication.create({
        campaignId: campanha._id, accountId: c._id, contentId: m._id,
        order: ordem, scheduledAt: new Date(T0.getTime() + ordem * 10 * 60_000),
        resolvedCaption: `Legenda de ${c.username} em ${m.originalName}`,
        resolvedComment: commentMode === 'disabled' ? '' : `Comentário de ${c.username}`,
        status: 'pending',
      }));
      ordem++;
    }
  }
  return { campanha, contas, midias, pubs };
}

/** Publicador falso: registra as chamadas e permite programar falhas. */
function publicadorFalso({ falharEm = [], semMediaId = false } = {}) {
  const chamadas = [];
  const fn = jest.fn(async (account, post) => {
    chamadas.push({ username: account.username, caption: post.caption, media: post.media });
    const regra = falharEm.find(f => f.username === account.username && (!f.media || f.media === post.media));
    if (regra) throw Object.assign(new Error(regra.mensagem || 'falhou'), { code: regra.code });
    // O publicador real devolve o id da mídia criada — é ele que amarra o
    // comentário a esta publicação. `semMediaId` simula a via que não o expõe
    // (Private API), onde comentar tem de falhar em vez de adivinhar o alvo.
    return semMediaId
      ? { ok: true }
      : { ok: true, mediaId: `media_${account.username}_${post.media}` };
  });
  fn.chamadas = chamadas;
  return fn;
}

const pubPorId = id => db.publications.find(p => String(p._id) === String(id));

/**
 * Jobs vivos das publicações em determinado estado.
 *
 * Contar filaDb inteira levaria a engano: o duplo mantém o job depois de
 * concluído, como o BullMQ real faz com removeOnComplete por contagem. O que
 * importa não é o tamanho da fila, e sim se cada publicação em aberto tem
 * exatamente um job — e se as encerradas não têm nenhum.
 */
const jobsVivosEm = (...estados) => db.publications
  .filter(p => estados.includes(p.status))
  .filter(p => filaDb.has(filaCamp.idPublicacao(p._id)))
  .length;

beforeEach(async () => { await montarCenario(); });

/* ── 1–3, 25 — agendamento e idempotência ──────────────────────────────────── */

describe('agendamento', () => {
  test('cria um job por CampaignPublication — 4×4 = 16 jobs', async () => {
    const r = await executor.agendarCampanha(campanha._id, { agora: T0 });
    expect(r.agendadas).toBe(16);
    expect(filaDb.size).toBe(16);
  });

  test('cada job carrega o id da própria publicação', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    const ids = [...filaDb.values()].map(j => j.data.campaignPublicationId).sort();
    expect(ids).toEqual(pubs.map(p => String(p._id)).sort());
  });

  test('agendar duas vezes NÃO duplica — 16 jobs, nunca 32', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    const r2 = await executor.agendarCampanha(campanha._id, { agora: T0 });

    expect(filaDb.size).toBe(16);
    expect(r2.agendadas).toBe(0);
    expect(r2.jaExistiam).toBe(16);
  });

  test('dois starts simultâneos também produzem 16 jobs', async () => {
    await Promise.all([
      executor.agendarCampanha(campanha._id, { agora: T0 }),
      executor.agendarCampanha(campanha._id, { agora: T0 }),
    ]);
    expect(filaDb.size).toBe(16);
  });

  test('scheduledAt vira delay em milissegundos', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    const primeira = pubs[0];
    const job = filaDb.get(filaCamp.idPublicacao(primeira._id));
    expect(job.delay).toBe(new Date(primeira.scheduledAt).getTime() - T0.getTime());
  });

  test('horário já passado vira delay 0, nunca negativo', () => {
    expect(filaCamp.calcularDelay(new Date(T0.getTime() - 60_000), T0)).toBe(0);
  });

  test('agendar marca as publicações como scheduled com o jobId', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    for (const p of db.publications) {
      expect(p.status).toBe('scheduled');
      expect(p.bullMqJobId).toBe(filaCamp.idPublicacao(p._id));
    }
  });

  test('campanha grande é paginada em lotes, sem carregar tudo de uma vez', async () => {
    await montarCenario({ nContas: 10, nMidias: 12 });   // 120 publicações
    const r = await executor.agendarCampanha(campanha._id, { agora: T0, lote: 25 });
    expect(r.agendadas).toBe(120);
    expect(filaDb.size).toBe(120);
  });

  test('campanha pausada recusa agendar', async () => {
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });
    await expect(executor.agendarCampanha(campanha._id, { agora: T0 }))
      .rejects.toMatchObject({ code: 'INVALID_CAMPAIGN_STATE' });
  });
});

/* ── 4–10, 24 — execução de uma publicação ─────────────────────────────────── */

describe('execução individual', () => {
  test('publica e marca published com publishedAt e postId', async () => {
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.ok).toBe(true);
    const p = pubPorId(pubs[0]._id);
    expect(p.status).toBe('published');
    expect(p.publishedAt).toBeInstanceOf(Date);
    expect(p.postId).toBeTruthy();
  });

  test('usa a legenda materializada daquela publicação', async () => {
    const publicar = publicadorFalso();
    await executor.processarPublicacao(pubs[5]._id, { publicarNaConta: publicar });
    expect(publicar.chamadas[0].caption).toBe(pubs[5].resolvedCaption);
  });

  test('resolve as marcações do template na hora de publicar', async () => {
    // O plano guarda o template bruto; quem publica precisa enviar o texto com
    // as variáveis já substituídas — nunca "{username}" literal.
    await CampaignPublication.updateOne(
      { _id: pubs[0]._id },
      { $set: { captionTemplate: 'Novidade de @{username}!', resolvedCaption: '' } },
    );

    const publicar = publicadorFalso();
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    const conta = contas.find(c => String(c._id) === String(pubs[0].accountId));
    expect(publicar.chamadas[0].caption).toBe(`Novidade de @${conta.username}!`);
    expect(publicar.chamadas[0].caption).not.toContain('{username}');
  });

  test('nunca publica com legenda vazia quando existe template', async () => {
    // Regressão: a criação gravava só o template e a execução lia apenas
    // resolvedCaption — toda campanha saía com legenda em branco.
    await CampaignPublication.updateOne(
      { _id: pubs[0]._id },
      { $set: { captionTemplate: 'Texto configurado', resolvedCaption: '' } },
    );

    const publicar = publicadorFalso();
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(publicar.chamadas[0].caption).toBe('Texto configurado');
    // E o que saiu fica registrado na publicação.
    expect(pubPorId(pubs[0]._id).resolvedCaption).toBe('Texto configurado');
  });

  test('publica na conta e com a mídia corretas', async () => {
    const publicar = publicadorFalso();
    await executor.processarPublicacao(pubs[6]._id, { publicarNaConta: publicar });

    const conta = contas.find(c => String(c._id) === String(pubs[6].accountId));
    const midia = midias.find(m => String(m._id) === String(pubs[6].contentId));
    expect(publicar.chamadas[0].username).toBe(conta.username);
    expect(publicar.chamadas[0].media).toBe(midia.filename);
  });

  test('cria um Post vinculado, preservando o histórico existente', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].status).toBe('concluido');
    expect(String(db.posts[0].accounts[0])).toBe(String(pubs[0].accountId));
  });

  test('incrementa attempts a cada execução', async () => {
    const publicar = publicadorFalso({ falharEm: [{ username: 'conta01' }] });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });
    expect(pubPorId(pubs[0]._id).attempts).toBe(1);

    await executor.reprocessarPublicacao(pubs[0]._id, { agora: T0 });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });
    expect(pubPorId(pubs[0]._id).attempts).toBe(2);
  });

  test('falha marca failed com mensagem e código', async () => {
    const publicar = publicadorFalso({
      falharEm: [{ username: 'conta01', code: 'RATE_LIMITED', mensagem: 'Please wait' }],
    });
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.ok).toBe(false);
    const p = pubPorId(pubs[0]._id);
    expect(p.status).toBe('failed');
    expect(p.errorCode).toBe('RATE_LIMITED');
    expect(p.error).toContain('Please wait');
  });

  test('publicação já publicada não executa de novo', async () => {
    const publicar = publicadorFalso();
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('ALREADY_PUBLISHED');
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  test('job duplicado não publica duas vezes — a reivindicação é atômica', async () => {
    const publicar = publicadorFalso();
    await Promise.all([
      executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar }),
      executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar }),
    ]);
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  test('publicação cancelada não executa', async () => {
    await CampaignPublication.updateOne({ _id: pubs[0]._id }, { $set: { status: 'cancelled' } });
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.skipped).toBe(true);
    expect(publicar).not.toHaveBeenCalled();
  });
});

/* ── 12 — isolamento entre publicações ─────────────────────────────────────── */

describe('isolamento de erro', () => {
  test('a falha de uma publicação não impede as outras 15', async () => {
    const alvo = pubs[4];
    const conta = contas.find(c => String(c._id) === String(alvo.accountId));
    const midia = midias.find(m => String(m._id) === String(alvo.contentId));

    const publicar = publicadorFalso({
      falharEm: [{ username: conta.username, media: midia.filename, code: 'RATE_LIMITED' }],
    });

    for (const p of pubs) {
      await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    }

    const publicadas = db.publications.filter(p => p.status === 'published');
    const falhadas   = db.publications.filter(p => p.status === 'failed');

    expect(publicadas).toHaveLength(15);
    expect(falhadas).toHaveLength(1);
    expect(String(falhadas[0]._id)).toBe(String(alvo._id));
  });

  test('a publicação que falhou pode ser reprocessada sem recriar as outras', async () => {
    const alvo = pubs[4];
    await CampaignPublication.updateOne({ _id: alvo._id }, { $set: { status: 'failed', errorCode: 'RATE_LIMITED' } });

    const antes = db.publications.length;
    await executor.reprocessarPublicacao(alvo._id, { agora: T0 });

    expect(db.publications).toHaveLength(antes);          // nenhuma linha nova
    expect(pubPorId(alvo._id).status).toBe('scheduled');
    expect(filaDb.size).toBe(1);                          // só o job dela
  });

  test('reprocessar preserva attempts e limpa o erro anterior', async () => {
    await CampaignPublication.updateOne(
      { _id: pubs[0]._id },
      { $set: { status: 'failed', attempts: 2, error: 'antigo', errorCode: 'RATE_LIMITED' } },
    );
    await executor.reprocessarPublicacao(pubs[0]._id, { agora: T0 });

    const p = pubPorId(pubs[0]._id);
    expect(p.attempts).toBe(2);
    expect(p.error).toBe('');
    expect(p.errorCode).toBe('');
  });

  test('reprocessar recusa publicação já publicada', async () => {
    await CampaignPublication.updateOne({ _id: pubs[0]._id }, { $set: { status: 'published' } });
    await expect(executor.reprocessarPublicacao(pubs[0]._id, { agora: T0 }))
      .rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' });
  });
});

/* ── 28–32 — classificação de erro ─────────────────────────────────────────── */

describe('classificação de erro', () => {
  const casos = [
    ['SESSION_EXPIRED',      { code: 'SESSION_EXPIRED' },                 'SESSION_EXPIRED'],
    ['rate limit',           { code: 'RATE_LIMITED' },                    'RATE_LIMITED'],
    ['provider fora do ar',  { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' },  'PROVIDER_UNAVAILABLE'],
    ['desafio',              { code: 'CHALLENGE_REQUIRED' },              'ACCOUNT_CHALLENGE'],
    ['rede',                 { message: 'connect ETIMEDOUT proxy' },      'NETWORK_ERROR'],
    ['limite diário',        { message: 'Limite diário atingido: 20/20' },'DAILY_LIMIT'],
    ['conta ocupada',        { message: 'conta em uso — tempo de espera esgotado (5min)' }, 'ACCOUNT_BUSY'],
    ['genérico',             { message: 'qualquer outra coisa' },         'PUBLISH_ERROR'],
  ];

  test.each(casos)('%s → %s', (_nome, forma, esperado) => {
    const err = Object.assign(new Error(forma.message || 'erro'), forma.code ? { code: forma.code } : {});
    expect(executor.classificarErro(err)).toBe(esperado);
  });

  test('conteúdo inexistente falha sem chamar o publicador', async () => {
    db.medias = [];
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.errorCode).toBe('CONTENT_NOT_FOUND');
    expect(publicar).not.toHaveBeenCalled();
  });

  test('conta inexistente falha sem chamar o publicador', async () => {
    db.accounts = [];
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.errorCode).toBe('ACCOUNT_UNAVAILABLE');
    expect(publicar).not.toHaveBeenCalled();
  });

  test('conta banida não publica', async () => {
    db.accounts[0].healthStatus = 'banida';
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.errorCode).toBe('ACCOUNT_UNAVAILABLE');
    expect(publicar).not.toHaveBeenCalled();
  });
});

/* ── 13–15 — pausa, retomada, cancelamento ─────────────────────────────────── */

describe('pausa, retomada e cancelamento', () => {
  test('pausar remove os jobs futuros da fila', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    expect(filaDb.size).toBe(16);

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });
    const r = await executor.pausarCampanha(campanha._id);

    expect(r.removidos).toBe(16);
    expect(filaDb.size).toBe(0);
    expect(db.publications.every(p => p.status === 'pending')).toBe(true);
  });

  test('campanha pausada bloqueia a execução de um job sobrevivente', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });

    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('CAMPAIGN_PAUSED');
    expect(publicar).not.toHaveBeenCalled();
    expect(pubPorId(pubs[0]._id).attempts).toBe(0);     // pausa não gasta tentativa
  });

  test('retomar reenfileira só o que ficou pendente, sem duplicar', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });
    await executor.pausarCampanha(campanha._id);
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'scheduled' } });

    const r = await executor.retomarCampanha(campanha._id, { agora: T0 });

    expect(r.agendadas).toBe(15);              // a publicada não volta
    expect(jobsVivosEm('scheduled')).toBe(15); // uma por pendente, sem duplicar
    expect(pubPorId(pubs[0]._id).status).toBe('published');
  });

  test('cancelar remove jobs e marca as publicações não executadas', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });
    const r = await executor.cancelarCampanha(campanha._id);

    expect(r.canceladas).toBe(15);
    expect(jobsVivosEm('cancelled')).toBe(0);                 // nenhuma volta a rodar
    expect(pubPorId(pubs[0]._id).status).toBe('published');   // publicada intocada
  });

  test('campanha cancelada faz o job sobrevivente desistir', async () => {
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });
    const publicar = publicadorFalso();
    const r = await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });

    expect(r.reason).toBe('CAMPAIGN_CANCELLED');
    expect(publicar).not.toHaveBeenCalled();
    expect(pubPorId(pubs[0]._id).status).toBe('cancelled');
  });
});

/* ── 19–22 — comentário como job independente ──────────────────────────────── */

describe('comentário', () => {
  test('publicar agenda o comentário e NÃO bloqueia o worker', async () => {
    await montarCenario({ commentMode: 'global', delayMinutes: 7 });

    const inicio = Date.now();
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    const decorrido = Date.now() - inicio;

    // Se o atraso fosse aplicado com sleep dentro do worker, isto levaria 7 min.
    expect(decorrido).toBeLessThan(1000);

    const job = filaDb.get(filaCamp.idComentario(pubs[0]._id));
    expect(job).toBeTruthy();
    expect(job.delay).toBe(7 * 60_000);
  });

  test('o comentário é um job separado, com payload próprio', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });

    const job = filaDb.get(filaCamp.idComentario(pubs[0]._id));
    expect(job.data.campaignCommentId).toBe(String(pubs[0]._id));
    expect(job.data.campaignPublicationId).toBeUndefined();
  });

  test('comentário desativado não gera job', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    expect(filaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeUndefined();
  });

  test('não duplica o job de comentário', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    const antes = filaDb.size;

    await executor.agendarComentarioDe(pubPorId(pubs[0]._id), campanha);
    expect(filaDb.size).toBe(antes);
  });

  test('comentar marca posted e não repete', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });

    const comentar = jest.fn(async () => {});
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentar });
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('posted');

    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentar });
    expect(r.skipped).toBe(true);
    expect(comentar).toHaveBeenCalledTimes(1);
  });

  test('falha ao comentar não reverte a publicação', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });

    const comentar = jest.fn(async () => { throw new Error('sem permissão'); });
    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentar });

    expect(r.ok).toBe(false);
    const p = pubPorId(pubs[0]._id);
    expect(p.status).toBe('published');        // continua publicada
    expect(p.commentStatus).toBe('failed');
  });

  test('cancelar a campanha cancela comentários ainda não publicados', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    expect(filaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeTruthy();

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });
    await executor.cancelarCampanha(campanha._id);

    expect(filaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeUndefined();
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('cancelled');
  });

  test('via sem media_id falha o comentário em vez de escolher outra mídia', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: publicadorFalso({ semMediaId: true }),
    });

    const comentar = jest.fn(async () => {});
    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentar });

    expect(r.errorCode).toBe('COMMENT_MEDIA_NOT_FOUND');
    expect(comentar).not.toHaveBeenCalled();
    expect(pubPorId(pubs[0]._id).status).toBe('published');   // publicação preservada
  });

  test('comentário só roda em publicação que saiu', async () => {
    await montarCenario({ commentMode: 'global' });
    const comentar = jest.fn(async () => {});
    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentar });

    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('NOT_PUBLISHED');
    expect(comentar).not.toHaveBeenCalled();
  });
});

/* ── 16–17 — contadores e finalização ──────────────────────────────────────── */

describe('contadores e finalização', () => {
  test('contadores são contados, não incrementados', async () => {
    const publicar = publicadorFalso({ falharEm: [{ username: 'conta01' }] });
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });

    const c = await executor.recalcularContadores(campanha._id);
    expect(c.total).toBe(16);
    expect(c.published).toBe(12);
    expect(c.failed).toBe(4);

    const camp = db.campaigns[0];
    expect(camp.totalPublications).toBe(16);
    expect(camp.publishedPublications).toBe(12);
    expect(camp.failedPublications).toBe(4);
  });

  test('contadores continuam corretos com a campanha interrompida no meio', async () => {
    const publicar = publicadorFalso();
    for (const p of pubs.slice(0, 5)) {
      await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    }
    const c = await executor.recalcularContadores(campanha._id);
    expect(c.published + c.pending + c.scheduled).toBe(16);
    expect(c.published).toBe(5);
  });

  test('tudo publicado → campanha completed', async () => {
    const publicar = publicadorFalso();
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    expect(db.campaigns[0].status).toBe('completed');
  });

  test('parte falhou → campanha partial', async () => {
    const publicar = publicadorFalso({ falharEm: [{ username: 'conta02' }] });
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    expect(db.campaigns[0].status).toBe('partial');
  });

  test('nada publicou → campanha failed', async () => {
    const publicar = publicadorFalso({
      falharEm: contas.map(c => ({ username: c.username })),
    });
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    expect(db.campaigns[0].status).toBe('failed');
  });

  test('não finaliza enquanto houver publicação em aberto', async () => {
    const publicar = publicadorFalso();
    for (const p of pubs.slice(0, 10)) {
      await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    }
    expect(db.campaigns[0].status).toBe('scheduled');
    expect(db.campaigns[0].completedAt).toBeFalsy();
  });
});

/* ── 26 — recuperação após restart ─────────────────────────────────────────── */

describe('recuperação após restart', () => {
  test('reenfileira apenas as publicações que perderam o job', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    expect(filaDb.size).toBe(16);

    // Redis reiniciou sem persistência: 6 jobs sobreviveram, 10 sumiram.
    const perdidos = pubs.slice(0, 10);
    for (const p of perdidos) filaDb.delete(filaCamp.idPublicacao(p._id));
    expect(filaDb.size).toBe(6);

    const r = await recovery.recuperarAgendadas(T0);

    expect(r.reenfileiradas).toBe(10);
    expect(filaDb.size).toBe(16);
  });

  test('recuperação não duplica os jobs que já existem', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    const r = await recovery.recuperarAgendadas(T0);

    expect(r.reenfileiradas).toBe(0);
    expect(filaDb.size).toBe(16);
  });

  test('não reenfileira publicação já publicada', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    filaDb.clear();

    await recovery.recuperarAgendadas(T0);

    expect(filaDb.get(filaCamp.idPublicacao(pubs[0]._id))).toBeUndefined();
    expect(filaDb.size).toBe(15);
  });

  test('publicação presa em processing vira falha, não republica', async () => {
    const velho = new Date(T0.getTime() - 60 * 60_000);
    await CampaignPublication.updateOne(
      { _id: pubs[0]._id },
      { $set: { status: 'processing' } },
    );
    pubPorId(pubs[0]._id).updatedAt = velho;

    const n = await recovery.recuperarProcessando(T0);

    expect(n).toBe(1);
    const p = pubPorId(pubs[0]._id);
    expect(p.status).toBe('failed');
    expect(p.errorCode).toBe('WORKER_RESTARTED');
    expect(filaDb.size).toBe(0);      // nada foi reenfileirado automaticamente
  });

  test('processing recente é deixada em paz — ainda pode estar publicando', async () => {
    await CampaignPublication.updateOne({ _id: pubs[0]._id }, { $set: { status: 'processing' } });
    pubPorId(pubs[0]._id).updatedAt = new Date(T0.getTime() - 60_000);

    const n = await recovery.recuperarProcessando(T0);

    expect(n).toBe(0);
    expect(pubPorId(pubs[0]._id).status).toBe('processing');
  });

  test('comentários agendados perdidos são reenfileirados', async () => {
    await montarCenario({ commentMode: 'global' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorFalso() });
    filaDb.clear();

    const r = await recovery.recuperarComentarios(T0);

    expect(r.reenfileirados).toBe(1);
    expect(filaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeTruthy();
  });

  test('campanha inativa não é recuperada', async () => {
    await executor.agendarCampanha(campanha._id, { agora: T0 });
    filaDb.clear();
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });

    const r = await recovery.recuperarAgendadas(T0);
    expect(r.reenfileiradas).toBe(0);
  });
});

/* ── 18 — log sem dado sensível ────────────────────────────────────────────── */

describe('log', () => {
  test('o evento carrega identificadores, tentativa e duração', () => {
    const linha = executor.registrarEvento('PUBLICATION_SUCCESS', {
      campaignId: campanha._id, publicationId: pubs[0]._id,
      accountId: contas[0]._id, contentId: midias[0]._id,
      attempt: 2, durationMs: 1234,
    });
    expect(linha).toMatchObject({ evento: 'PUBLICATION_SUCCESS', attempt: 2, durationMs: 1234 });
    expect(linha.at).toBeTruthy();
  });

  test('não vaza senha, token, sessão nem proxy', () => {
    const linha = executor.registrarEvento('PUBLICATION_FAILED', {
      campaignId: campanha._id, publicationId: pubs[0]._id,
      accountId: contas[0]._id,
      password: 'segredo', accessToken: 'TOKEN', instagrapiSession: 'BLOB',
      proxy: 'http://user:pass@host:8080',
    });
    const texto = JSON.stringify(linha);
    for (const proibido of ['segredo', 'TOKEN', 'BLOB', 'user:pass']) {
      expect(texto).not.toContain(proibido);
    }
  });
});

/* ── 24 — integração ponta a ponta ─────────────────────────────────────────── */

describe('integração 4 contas × 4 conteúdos', () => {
  test('16 publicações, 16 jobs, uma falha isolada e retry individual', async () => {
    expect(pubs).toHaveLength(16);
    for (const p of pubs) {
      expect(p.accountId).toBeTruthy();
      expect(p.contentId).toBeTruthy();
      expect(p.scheduledAt).toBeInstanceOf(Date);
      expect(p.resolvedCaption).toBeTruthy();
    }

    await executor.agendarCampanha(campanha._id, { agora: T0 });
    expect(filaDb.size).toBe(16);

    // A #5 falha; as outras 15 seguem.
    const alvo  = pubs[4];
    const conta = contas.find(c => String(c._id) === String(alvo.accountId));
    const midia = midias.find(m => String(m._id) === String(alvo.contentId));
    const publicar = publicadorFalso({
      falharEm: [{ username: conta.username, media: midia.filename, code: 'RATE_LIMITED' }],
    });

    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });

    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(15);
    expect(pubPorId(alvo._id).status).toBe('failed');
    expect(db.campaigns[0].status).toBe('partial');

    // Retry só da #5 — as 15 não são recriadas.
    filaDb.clear();
    await executor.reprocessarPublicacao(alvo._id, { agora: T0 });

    expect(filaDb.size).toBe(1);
    expect(db.publications).toHaveLength(16);

    const publicarOk = publicadorFalso();
    await executor.processarPublicacao(alvo._id, { publicarNaConta: publicarOk });

    expect(pubPorId(alvo._id).status).toBe('published');
    expect(pubPorId(alvo._id).attempts).toBe(2);
    expect(db.campaigns[0].status).toBe('partial');   // já finalizada, não regride
  });
});
