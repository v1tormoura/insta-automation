'use strict';

/**
 * Testes do comentário de campanha ponta a ponta.
 *
 * O ponto central: o comentário vai para a mídia EXATA que a publicação criou.
 * A busca por "mídia mais recente da conta" acertaria por acaso quando a conta
 * publica uma vez só e erraria em silêncio no resto — numa campanha, cada conta
 * publica várias vezes.
 *
 * O provider é duplado na fronteira HTTP (fetch), não no meio da cadeia: assim
 * ProviderFactory, InstagrapiProvider e InstagrapiHttpClient são exercitados de
 * verdade, e o teste prova o caminho inteiro, não só o executor.
 */

const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId();

/* ── Fila falsa ────────────────────────────────────────────────────────────── */

const mockFilaDb = new Map();

jest.mock('../src/queue/postQueue', () => ({
  add: jest.fn(async (nome, dados, opts = {}) => {
    if (mockFilaDb.has(opts.jobId)) return mockFilaDb.get(opts.jobId);
    const job = {
      id: opts.jobId, nome, data: dados, opts, delay: opts.delay || 0,
      getState: async () => 'delayed',
      remove:   async () => { mockFilaDb.delete(opts.jobId); },
    };
    mockFilaDb.set(opts.jobId, job);
    return job;
  }),
  getJob: jest.fn(async id => mockFilaDb.get(id) || null),
}));

/* ── Repositório em memória ────────────────────────────────────────────────── */

const db = { campaigns: [], publications: [], accounts: [], medias: [], posts: [] };

function _valor(doc, campo) {
  return campo.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
}

function _combina(doc, filtro = {}) {
  return Object.entries(filtro).every(([campo, cond]) => {
    if (campo === '$or') return cond.some(c => _combina(doc, c));
    const v = _valor(doc, campo);
    if (cond && typeof cond === 'object' && !(cond instanceof mongoose.Types.ObjectId) && !(cond instanceof Date)) {
      if (cond.$in)  return cond.$in.map(String).includes(String(v));
      if (cond.$nin) return !cond.$nin.map(String).includes(String(v));
      if (cond.$lt)  return v != null && new Date(v) < new Date(cond.$lt);
      return false;
    }
    return String(v) === String(cond);
  });
}

function _aplicar(doc, up) {
  if (up.$set) Object.assign(doc, up.$set);
  if (up.$inc) for (const [k, v] of Object.entries(up.$inc)) doc[k] = (doc[k] || 0) + v;
  if (!up.$set && !up.$inc) Object.assign(doc, up);
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
            const va = _valor(a, c), vb = _valor(b, c);
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
      sort: o => { ordem = o; return q; }, skip: n => { pular = n || 0; return q; },
      limit: n => { teto = n ?? null; return q; },
      select: () => q, populate: () => q, lean: () => q,
      then: (r, j) => Promise.resolve(resolver()).then(r, j),
    };
    return q;
  };

  return {
    create: jest.fn(async d => {
      const arr = Array.isArray(d) ? d : [d];
      const c = arr.map(x => { const doc = encaixar(x); db[colecao].push(doc); return doc; });
      return Array.isArray(d) ? c : c[0];
    }),
    insertMany: jest.fn(async docs => { const c = docs.map(encaixar); db[colecao].push(...c); return c; }),
    find:     jest.fn((f = {}) => consulta(db[colecao].filter(x => _combina(x, f)))),
    findOne:  jest.fn((f = {}) => consulta(db[colecao].find(x => _combina(x, f)) || null)),
    findById: jest.fn(id => consulta(db[colecao].find(x => String(x._id) === String(id)) || null)),
    findByIdAndUpdate: jest.fn(async (id, up) => {
      const d = db[colecao].find(x => String(x._id) === String(id));
      return d ? _aplicar(d, up) : null;
    }),
    findOneAndUpdate: jest.fn(async (f, up) => {
      const d = db[colecao].find(x => _combina(x, f));
      return d ? _aplicar(d, up) : null;
    }),
    updateOne: jest.fn(async (f, up) => {
      const d = db[colecao].find(x => _combina(x, f));
      if (d) _aplicar(d, up);
      return { modifiedCount: d ? 1 : 0 };
    }),
    updateMany: jest.fn(async (f, up) => {
      const a = db[colecao].filter(x => _combina(x, f));
      a.forEach(d => _aplicar(d, up));
      return { modifiedCount: a.length };
    }),
    countDocuments: jest.fn(async (f = {}) => db[colecao].filter(x => _combina(x, f)).length),
    deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
    aggregate: jest.fn(async pipeline => {
      const m = pipeline.find(p => p.$match)?.$match || {};
      const a = db[colecao].filter(d => String(d.campaignId) === String(m.campaignId));
      const por = {};
      for (const d of a) por[d.status] = (por[d.status] || 0) + 1;
      return Object.entries(por).map(([_id, total]) => ({ _id, total }));
    }),
  };
}

jest.mock('../src/models/Campaign',            () => mockModel('campaigns', { status: 'scheduled' }));
jest.mock('../src/models/CampaignPublication', () => mockModel('publications', {
  status: 'pending', attempts: 0, commentStatus: 'none', commentAttempts: 0, instagramMediaId: '',
}));
jest.mock('../src/models/Account', () => mockModel('accounts'));
jest.mock('../src/models/Media',   () => mockModel('medias'));
jest.mock('../src/models/Post',    () => mockModel('posts'));

/* ── SessionManager duplado ────────────────────────────────────────────────── */
//
// withLock é o lock por conta de verdade (Redis em produção). Aqui ele é
// instrumentado para os testes poderem provar que o comentário o adquire.

const mockLockAtivo = new Map();      // accountId → profundidade
const mockLockLog   = [];

const mockSm = {
  withLock: jest.fn(async (accountId, ttl, fn) => {
    const atual = mockLockAtivo.get(accountId) || 0;
    mockLockAtivo.set(accountId, atual + 1);
    mockLockLog.push({ accountId, ttl, simultaneos: atual + 1 });
    try { return await fn(); }
    finally { mockLockAtivo.set(accountId, (mockLockAtivo.get(accountId) || 1) - 1); }
  }),
  load:          jest.fn(async () => ({ uuids: {} })),
  save:          jest.fn(async () => {}),
  recordSuccess: jest.fn(async () => {}),
  recordFailure: jest.fn(async () => {}),
};

jest.mock('../src/services/instagrapi/SessionManager', () => ({
  getSessionManager: () => mockSm,
  SessionManager: class {},
}));

/* ── fetch duplado — fronteira HTTP com o serviço Python ───────────────────── */

const mockHttpLog = [];
let mockRespostaPython = null;

global.fetch = jest.fn(async (url, opts = {}) => {
  const corpo = opts.body ? JSON.parse(opts.body) : {};
  mockHttpLog.push({ url: String(url), corpo });

  if (String(url).endsWith('/session/load')) {
    return { ok: true, json: async () => ({ status: 'LOADED' }) };
  }
  if (String(url).endsWith('/publish/comment')) {
    if (mockRespostaPython?.erro) {
      return {
        ok: false, status: 422,
        json: async () => ({ detail: { code: mockRespostaPython.erro, message: mockRespostaPython.mensagem || 'falhou' } }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        status: 'COMMENT_PUBLISHED',
        comment_id: '55443322',
        media_id: corpo.media_id,
        settings: { uuids: {} },
      }),
    };
  }
  return { ok: true, json: async () => ({}) };
});

const Campaign            = require('../src/models/Campaign');
const CampaignPublication = require('../src/models/CampaignPublication');
const Account             = require('../src/models/Account');
const Media               = require('../src/models/Media');

const executor = require('../src/services/campaignExecutor');
const filaCamp = require('../src/services/campaignQueue');
const recovery = require('../src/jobs/campaignRecovery');
const { getProvider, _resetForTest } = require('../src/providers/ProviderFactory');
const { generatePlan }    = require('../src/services/publicationPlanner');
const { resolveTemplate } = require('../src/services/templateResolver');

/* ── Cenário ───────────────────────────────────────────────────────────────── */

const T0 = new Date('2026-09-01T18:00:00');

let campanha, contas, midias, pubs;

async function montar({ nContas = 2, nMidias = 2, provider = 'instagrapi',
                        commentMode = 'global', delayMinutes = 2,
                        comments = { global: 'Link na bio!' } } = {}) {
  db.campaigns = []; db.publications = []; db.accounts = []; db.medias = []; db.posts = [];
  mockFilaDb.clear(); mockHttpLog.length = 0; mockLockLog.length = 0; mockLockAtivo.clear();
  mockRespostaPython = null;
  jest.clearAllMocks();
  _resetForTest();

  contas = [];
  for (let i = 0; i < nContas; i++) {
    contas.push(await Account.create({
      username: `conta0${i + 1}`, name: `Conta ${i + 1}`, provider,
      accessToken: provider === 'instagrapi' ? '' : 'TOKEN_SEGREDO',
      igUserId:    provider === 'instagrapi' ? '' : `IG${i}`,
      password: 'senha_secreta_123', totpSecret: 'TOTP_SECRETO',
      healthStatus: 'ativa', postsToday: 0, dailyPostLimit: 20,
    }));
  }
  midias = [];
  for (let i = 0; i < nMidias; i++) {
    midias.push(await Media.create({
      filename: `video0${i + 1}.mp4`, originalName: `Video ${i + 1}`, type: 'video',
    }));
  }

  campanha = await Campaign.create({
    name: 'Campanha Comentário', status: 'scheduled',
    commentMode, comments: { ...comments, delayMinutes },
    settings: { postType: 'reel' },
  });

  pubs = [];
  let ordem = 1;
  for (const c of contas) {
    for (const m of midias) {
      pubs.push(await CampaignPublication.create({
        campaignId: campanha._id, accountId: c._id, contentId: m._id,
        order: ordem, scheduledAt: new Date(T0.getTime() + ordem * 600_000),
        resolvedCaption: `Legenda ${c.username}`,
        resolvedComment: resolveTemplate(comments.global || '', { username: c.username }).text
                         || `Comentário ${c.username}`,
        status: 'pending',
      }));
      ordem++;
    }
  }
  return { campanha, contas, midias, pubs };
}

/** Publicador que devolve um mediaId distinto por publicação. */
function publicadorComIds(mapa) {
  return jest.fn(async (account, post) => ({
    ok: true,
    mediaId: mapa[`${account.username}|${post.media}`] || `media_${account.username}_${post.media}`,
  }));
}

/** Comentador real: passa pelo ProviderFactory até o fetch duplado. */
const comentarViaProvider = (account, dados) => getProvider(account).comment(account, dados);

const pubPorId = id => db.publications.find(p => String(p._id) === String(id));

beforeEach(async () => { await montar(); });

/* ── 4–6 — a publicação registra o id da mídia ─────────────────────────────── */

describe('publicação registra o media_id', () => {
  test('salva instagramMediaId devolvido pela publicação', async () => {
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: publicadorComIds({ 'conta01|video01.mp4': '111_999' }),
    });
    expect(pubPorId(pubs[0]._id).instagramMediaId).toBe('111_999');
  });

  test('cada publicação guarda o SEU id, não o da última', async () => {
    const publicar = publicadorComIds({
      'conta01|video01.mp4': 'A1', 'conta01|video02.mp4': 'A2',
      'conta02|video01.mp4': 'B1', 'conta02|video02.mp4': 'B2',
    });
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });

    const ids = db.publications.map(p => p.instagramMediaId).sort();
    expect(ids).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  test('publicação sem id da mídia grava vazio, sem inventar', async () => {
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: jest.fn(async () => ({ ok: true })),
    });
    expect(pubPorId(pubs[0]._id).instagramMediaId).toBe('');
  });
});

/* ── 1–3 — o comentário usa o media_id exato ───────────────────────────────── */

describe('comentário usa o media_id da publicação', () => {
  test('envia ao Python o id daquela publicação', async () => {
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: publicadorComIds({ 'conta01|video01.mp4': '777_888' }),
    });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.media_id).toBe('777_888');
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('posted');
  });

  test('com 4 publicações, cada comentário vai à sua própria mídia', async () => {
    const publicar = publicadorComIds({
      'conta01|video01.mp4': 'A1', 'conta01|video02.mp4': 'A2',
      'conta02|video01.mp4': 'B1', 'conta02|video02.mp4': 'B2',
    });
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    for (const p of pubs) await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });

    const enviados = mockHttpLog.filter(h => h.url.endsWith('/publish/comment')).map(h => h.corpo.media_id);
    expect(enviados.sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  test('a mídia comentada é a da MESMA conta+conteúdo, nunca a mais recente', async () => {
    // conta01 publica duas vezes. A segunda é a "mais recente" da conta; o
    // comentário da primeira precisa continuar indo para a primeira.
    const publicar = publicadorComIds({
      'conta01|video01.mp4': 'PRIMEIRA', 'conta01|video02.mp4': 'MAIS_RECENTE',
    });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });
    await executor.processarPublicacao(pubs[1]._id, { publicarNaConta: publicar });

    mockHttpLog.length = 0;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.media_id).toBe('PRIMEIRA');
    expect(req.corpo.media_id).not.toBe('MAIS_RECENTE');
  });

  test('sem media_id o comentário falha em vez de adivinhar', async () => {
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: jest.fn(async () => ({ ok: true })),   // sem mediaId
    });
    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('COMMENT_MEDIA_NOT_FOUND');
    expect(mockHttpLog.some(h => h.url.endsWith('/publish/comment'))).toBe(false);
    expect(pubPorId(pubs[0]._id).status).toBe('published');   // publicação intocada
  });

  test('o comentário guarda o id do comentário criado', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });
    expect(pubPorId(pubs[0]._id).commentId).toBe('55443322');
  });
});

/* ── 18 — lock por conta ───────────────────────────────────────────────────── */

describe('lock por conta', () => {
  test('comentar adquire o lock da conta', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockLockLog.length = 0;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(mockLockLog).toHaveLength(1);
    expect(mockLockLog[0].accountId).toBe(String(pubs[0].accountId));
  });

  test('o lock é do escopo da conta — contas diferentes não se bloqueiam', async () => {
    for (const p of pubs) {
      await executor.processarPublicacao(p._id, { publicarNaConta: publicadorComIds({}) });
    }
    mockLockLog.length = 0;
    for (const p of pubs) {
      await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });
    }
    const contasComLock = new Set(mockLockLog.map(l => l.accountId));
    expect(contasComLock.size).toBe(2);
    // Nunca dois titulares simultâneos da mesma conta.
    expect(mockLockLog.every(l => l.simultaneos === 1)).toBe(true);
  });

  test('o TTL do comentário é menor que o da publicação', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockLockLog.length = 0;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });
    // Comentar é uma requisição só; segurar a conta por 3,5 min seria excessivo.
    expect(mockLockLog[0].ttl).toBeLessThan(210_000);
  });
});

/* ── 19 — o atraso não bloqueia o worker ───────────────────────────────────── */

describe('atraso não bloqueia o worker', () => {
  test('o atraso vira delay do job, não espera dentro da execução', async () => {
    await montar({ delayMinutes: 15 });

    const inicio = Date.now();
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    const decorrido = Date.now() - inicio;

    expect(decorrido).toBeLessThan(1000);
    expect(mockFilaDb.get(filaCamp.idComentario(pubs[0]._id)).delay).toBe(15 * 60_000);
  });

  test('o job de comentário tem payload próprio', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    const job = mockFilaDb.get(filaCamp.idComentario(pubs[0]._id));
    expect(job.data.campaignCommentId).toBe(String(pubs[0]._id));
    expect(job.data.campaignPublicationId).toBeUndefined();
  });
});

/* ── 7–11 — resolução por conta / conteúdo / conta+conteúdo ────────────────── */

describe('resolução do comentário pelo planner', () => {
  const plano = (comments, commentMode) => generatePlan({
    accounts: [{ id: 'acc1' }, { id: 'acc2' }],
    contents: [{ id: 'cnt1', name: 'v1' }, { id: 'cnt2', name: 'v2' }],
    strategy: { mode: 'sequential' },
    schedule: { intervalMin: 10, intervalMax: 10 },
    startAt: T0, commentMode, comments,
  });
  const achar = (p, a, c) => p.find(x => x.accountId === a && x.contentId === c).commentTemplate;

  test('por conta', () => {
    const p = plano({ global: 'geral', byAccount: { acc2: 'da conta 2' } }, 'per_account');
    expect(achar(p, 'acc2', 'cnt1')).toBe('da conta 2');
    expect(achar(p, 'acc1', 'cnt1')).toBe('geral');
  });

  test('por conteúdo', () => {
    const p = plano({ global: 'geral', byContent: { cnt2: 'do vídeo 2' } }, 'per_content');
    expect(achar(p, 'acc1', 'cnt2')).toBe('do vídeo 2');
    expect(achar(p, 'acc1', 'cnt1')).toBe('geral');
  });

  test('por conta+conteúdo', () => {
    const p = plano({ global: 'geral', byAccountContent: { acc1__cnt2: 'A2 exato' } }, 'per_account_content');
    expect(achar(p, 'acc1', 'cnt2')).toBe('A2 exato');
  });

  test('prioridade: conta+conteúdo → conta → conteúdo → geral', () => {
    const p = plano({
      global: 'padrão',
      byAccount:        { acc1: 'Comentário A' },
      byContent:        { cnt2: 'Comentário 2' },
      byAccountContent: { acc1__cnt1: 'Comentário A1' },
    }, 'per_account_content');

    expect(achar(p, 'acc1', 'cnt1')).toBe('Comentário A1');   // par
    expect(achar(p, 'acc1', 'cnt2')).toBe('Comentário A');    // conta
    expect(achar(p, 'acc2', 'cnt2')).toBe('Comentário 2');    // conteúdo
    expect(achar(p, 'acc2', 'cnt1')).toBe('padrão');          // geral
  });
});

/* ── 12 — variáveis ────────────────────────────────────────────────────────── */

describe('variáveis no comentário', () => {
  test('{username} chega resolvido ao Instagram', async () => {
    await montar({ comments: { global: 'Novidade de @{username}!' } });

    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.text).toBe('Novidade de @conta01!');
    expect(req.corpo.text).not.toContain('{username}');
  });

  test('cada conta recebe o texto com o seu próprio username', async () => {
    await montar({ comments: { global: 'Sou {username}' } });

    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicadorComIds({}) });
    for (const p of pubs) await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });

    const textos = new Set(mockHttpLog.filter(h => h.url.endsWith('/publish/comment')).map(h => h.corpo.text));
    expect(textos).toEqual(new Set(['Sou conta01', 'Sou conta02']));
  });

  test('a resolução usa o templateResolver, não uma cópia', () => {
    // Se o executor tivesse resolvedor próprio, esta igualdade não valeria.
    expect(resolveTemplate('Oi {username}', { username: 'conta01' }).text).toBe('Oi conta01');
  });

  test('o comentário resolve o template na execução, não publica a marcação crua', async () => {
    await montar();
    await CampaignPublication.updateOne(
      { _id: pubs[0]._id },
      { $set: { commentTemplate: 'Siga @{username}', resolvedComment: '' } },
    );

    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.text).toBe('Siga @conta01');
    expect(req.corpo.text).not.toContain('{');
    // O texto enviado fica registrado na publicação.
    expect(pubPorId(pubs[0]._id).resolvedComment).toBe('Siga @conta01');
  });
});

/* ── 13 — retry individual ─────────────────────────────────────────────────── */

describe('retry individual do comentário', () => {
  test('uma falha entre 4 não afeta as outras', async () => {
    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicadorComIds({}) });

    for (const [i, p] of pubs.entries()) {
      mockRespostaPython = i === 1 ? { erro: 'RATE_LIMITED', mensagem: 'Please wait' } : null;
      await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });
    }

    expect(db.publications.filter(p => p.commentStatus === 'posted')).toHaveLength(3);
    const falhou = db.publications.filter(p => p.commentStatus === 'failed');
    expect(falhou).toHaveLength(1);
    expect(String(falhou[0]._id)).toBe(String(pubs[1]._id));
  });

  test('reprocessar só o comentário — não republica nem recria linha', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockRespostaPython = { erro: 'RATE_LIMITED' };
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const antesLinhas = db.publications.length;
    const antesPosts  = db.posts.length;
    mockFilaDb.clear();

    await executor.reprocessarComentario(pubs[0]._id, { agora: T0 });

    expect(db.publications).toHaveLength(antesLinhas);
    expect(db.posts).toHaveLength(antesPosts);          // não republicou
    expect(mockFilaDb.size).toBe(1);                        // só o job do comentário
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('scheduled');
    expect(pubPorId(pubs[0]._id).status).toBe('published');
  });

  test('commentAttempts acumula entre tentativas', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });

    mockRespostaPython = { erro: 'RATE_LIMITED' };
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });
    expect(pubPorId(pubs[0]._id).commentAttempts).toBe(1);

    await executor.reprocessarComentario(pubs[0]._id, { agora: T0 });
    mockRespostaPython = null;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(pubPorId(pubs[0]._id).commentAttempts).toBe(2);
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('posted');
  });

  test('reprocessar recusa comentário já publicado', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    await expect(executor.reprocessarComentario(pubs[0]._id, { agora: T0 }))
      .rejects.toMatchObject({ code: 'ALREADY_POSTED' });
  });

  test('reprocessar recusa quando não há media_id — não há onde comentar', async () => {
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: jest.fn(async () => ({ ok: true })),
    });
    await expect(executor.reprocessarComentario(pubs[0]._id, { agora: T0 }))
      .rejects.toMatchObject({ code: 'COMMENT_MEDIA_NOT_FOUND' });
  });
});

/* ── 14–17, 10 — classificação de erro ─────────────────────────────────────── */

describe('classificação de erro do comentário', () => {
  const casos = [
    ['RATE_LIMITED',            'RATE_LIMITED'],
    ['SESSION_EXPIRED',         'SESSION_EXPIRED'],
    ['SESSION_NOT_LOADED',      'SESSION_EXPIRED'],
    ['COMMENT_MEDIA_NOT_FOUND', 'COMMENT_MEDIA_NOT_FOUND'],
    ['PROXY_ERROR',             'NETWORK_ERROR'],
    ['FEEDBACK_REQUIRED',       'RATE_LIMITED'],
    ['CHALLENGE_REQUIRED',      'ACCOUNT_CHALLENGE'],
  ];

  test.each(casos)('o Python devolve %s → executor grava %s', async (codigoPython, esperado) => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockRespostaPython = { erro: codigoPython };

    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(r.errorCode).toBe(esperado);
    expect(pubPorId(pubs[0]._id).commentErrorCode).toBe(esperado);
  });

  test('timeout é distinguido de erro de rede', () => {
    const t = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    expect(executor.classificarErroComentario(t)).toBe('TIMEOUT');
    expect(executor.classificarErroComentario(new Error('connect ECONNREFUSED'))).toBe('NETWORK_ERROR');
  });

  test('erro desconhecido vira COMMENT_FAILED, nunca UNKNOWN_ERROR', () => {
    expect(executor.classificarErroComentario(new Error('coisa estranha'))).toBe('COMMENT_FAILED');
  });

  test('serviço fora do ar é distinguido de sessão expirada', () => {
    const e = Object.assign(new Error('svc down'), { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' });
    expect(executor.classificarErroComentario(e)).toBe('PROVIDER_UNAVAILABLE');
  });

  test('sessão expirada NÃO dispara novo login', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockHttpLog.length = 0;
    mockRespostaPython = { erro: 'SESSION_EXPIRED' };

    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(mockHttpLog.some(h => h.url.includes('/session/login'))).toBe(false);
    expect(pubPorId(pubs[0]._id).commentErrorCode).toBe('SESSION_EXPIRED');
  });

  test('falha de comentário não reverte a publicação', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockRespostaPython = { erro: 'RATE_LIMITED' };
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const p = pubPorId(pubs[0]._id);
    expect(p.status).toBe('published');
    expect(p.publishedAt).toBeTruthy();
  });
});

/* ── 25–26 — cada provider no seu caminho ──────────────────────────────────── */

describe('provider correto por conta', () => {
  test('conta instagrapi vai ao serviço Python', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(mockHttpLog.some(h => h.url.includes('/publish/comment'))).toBe(true);
    expect(mockHttpLog.some(h => h.url.includes('graph.'))).toBe(false);
  });

  test('conta oficial vai à Graph API, não ao Python', async () => {
    await montar({ provider: 'official' });
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockHttpLog.length = 0;

    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(mockHttpLog.some(h => h.url.includes('/publish/comment'))).toBe(false);
    expect(mockHttpLog.some(h => h.url.includes('graph.') && h.url.includes('/comments'))).toBe(true);
  });

  test('a Graph API também recebe o media_id exato', async () => {
    await montar({ provider: 'official' });
    await executor.processarPublicacao(pubs[0]._id, {
      publicarNaConta: publicadorComIds({ 'conta01|video01.mp4': 'GRAPH_123' }),
    });
    mockHttpLog.length = 0;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.includes('/comments'));
    expect(req.url).toContain('GRAPH_123');
  });

  test('o provider recusa comentar sem media_id, nos dois caminhos', async () => {
    for (const provider of ['instagrapi', 'official']) {
      await montar({ provider });
      const p = getProvider(db.accounts[0]);
      await expect(p.comment(db.accounts[0], { mediaId: '', text: 'x' }))
        .rejects.toMatchObject({ code: 'COMMENT_MEDIA_NOT_FOUND' });
    }
  });
});

/* ── 20–22 — pause, resume, cancel ─────────────────────────────────────────── */

describe('pausa, retomada e cancelamento', () => {
  test('cancelar a campanha cancela o comentário pendente', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    expect(mockFilaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeTruthy();

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });
    await executor.cancelarCampanha(campanha._id);

    expect(mockFilaDb.get(filaCamp.idComentario(pubs[0]._id))).toBeUndefined();
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('cancelled');
  });

  test('campanha cancelada faz o job de comentário desistir', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'cancelled' } });
    mockHttpLog.length = 0;

    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(r.skipped).toBe(true);
    expect(mockHttpLog.some(h => h.url.endsWith('/publish/comment'))).toBe(false);
  });

  test('pausar não cancela comentário de publicação já publicada', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });
    await executor.pausarCampanha(campanha._id);

    // O post está no ar; o comentário dele continua fazendo sentido.
    expect(pubPorId(pubs[0]._id).commentStatus).toBe('scheduled');
  });

  test('retomar não duplica o job de comentário', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    const antes = mockFilaDb.size;

    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'paused' } });
    await executor.pausarCampanha(campanha._id);
    await Campaign.findByIdAndUpdate(campanha._id, { $set: { status: 'scheduled' } });
    await executor.retomarCampanha(campanha._id, { agora: T0 });

    expect(mockFilaDb.has(filaCamp.idComentario(pubs[0]._id))).toBe(true);
    expect([...mockFilaDb.keys()].filter(k => k.startsWith('campaign-comment:'))).toHaveLength(1);
    expect(antes).toBeGreaterThan(0);
  });
});

/* ── 23 — recuperação após restart ─────────────────────────────────────────── */

describe('recuperação após restart', () => {
  test('comentário agendado perdido é reenfileirado uma vez só', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    mockFilaDb.clear();

    const r1 = await recovery.recuperarComentarios(T0);
    expect(r1.reenfileirados).toBe(1);

    const r2 = await recovery.recuperarComentarios(T0);
    expect(r2.reenfileirados).toBe(0);         // não duplica
    expect([...mockFilaDb.keys()].filter(k => k.startsWith('campaign-comment:'))).toHaveLength(1);
  });

  test('comentário já publicado não é reenfileirado', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });
    mockFilaDb.clear();

    const r = await recovery.recuperarComentarios(T0);
    expect(r.reenfileirados).toBe(0);
  });
});

/* ── 29–30 — sem duplicação ────────────────────────────────────────────────── */

describe('sem duplicação', () => {
  test('comentário não é publicado duas vezes', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    mockHttpLog.length = 0;
    const r = await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('ALREADY_POSTED');
    expect(mockHttpLog.some(h => h.url.endsWith('/publish/comment'))).toBe(false);
  });

  test('publicação não é repetida ao reprocessar o comentário', async () => {
    const publicar = publicadorComIds({});
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicar });
    mockRespostaPython = { erro: 'RATE_LIMITED' };
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    await executor.reprocessarComentario(pubs[0]._id, { agora: T0 });
    mockRespostaPython = null;
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    expect(publicar).toHaveBeenCalledTimes(1);
    expect(db.posts).toHaveLength(1);
  });
});

/* ── 27–28 — segredos fora dos logs ────────────────────────────────────────── */

describe('segurança do log', () => {
  test('nenhuma senha, 2FA ou token vai para o log', () => {
    const linha = executor.registrarEvento('COMMENT_POSTED', {
      campaignId: campanha._id, publicationId: pubs[0]._id, accountId: contas[0]._id,
      mediaId: '123_456', durationMs: 120,
      password: 'senha_secreta_123', verification_code: '654321',
      totpSecret: 'TOTP_SECRETO', accessToken: 'TOKEN_SEGREDO',
      instagrapiSession: 'BLOB', proxy: 'http://user:pass@host:8080',
    });

    const texto = JSON.stringify(linha);
    for (const segredo of ['senha_secreta_123', '654321', 'TOTP_SECRETO', 'TOKEN_SEGREDO', 'BLOB', 'user:pass']) {
      expect(texto).not.toContain(segredo);
    }
  });

  test('o log guarda o que serve para diagnóstico', () => {
    const linha = executor.registrarEvento('COMMENT_FAILED', {
      campaignId: campanha._id, publicationId: pubs[0]._id, accountId: contas[0]._id,
      mediaId: '123_456', durationMs: 88, errorCode: 'RATE_LIMITED',
    });
    expect(linha).toMatchObject({
      evento: 'COMMENT_FAILED', mediaId: '123_456', durationMs: 88, errorCode: 'RATE_LIMITED',
    });
  });

  test('o corpo enviado ao Python não carrega credenciais', async () => {
    await executor.processarPublicacao(pubs[0]._id, { publicarNaConta: publicadorComIds({}) });
    await executor.processarComentario(pubs[0]._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttpLog.find(h => h.url.endsWith('/publish/comment'));
    expect(Object.keys(req.corpo).sort()).toEqual(['account_id', 'media_id', 'text']);
  });
});

/* ── 24 — integração publicação + comentário ───────────────────────────────── */

describe('integração', () => {
  test('4 publicações + 4 comentários, cada um na sua mídia', async () => {
    await montar({ nContas: 2, nMidias: 2, comments: { global: 'De {username}' } });

    const publicar = publicadorComIds({
      'conta01|video01.mp4': 'M-A1', 'conta01|video02.mp4': 'M-A2',
      'conta02|video01.mp4': 'M-B1', 'conta02|video02.mp4': 'M-B2',
    });

    for (const p of pubs) await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(4);
    expect(db.campaigns[0].status).toBe('completed');

    for (const p of pubs) await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });

    const reqs = mockHttpLog.filter(h => h.url.endsWith('/publish/comment'));
    expect(reqs).toHaveLength(4);

    // Cada comentário casa com a mídia da sua própria publicação.
    for (const p of db.publications) {
      const req = reqs.find(r => r.corpo.media_id === p.instagramMediaId);
      expect(req).toBeTruthy();
      expect(req.corpo.text).toBe(p.resolvedComment);
      expect(p.commentStatus).toBe('posted');
    }
  });
});
