'use strict';

/**
 * Integração ponta a ponta da campanha (fase 10).
 *
 * A diferença em relação aos outros arquivos: aqui NADA é montado à mão. A
 * campanha nasce de `POST /campaigns` e segue pelo caminho real —
 *
 *   controller → campaignService → publicationPlanner → templateResolver
 *   → CampaignPublication → campaignQueue → executor → ProviderFactory
 *   → InstagrapiProvider → InstagrapiHttpClient → fetch
 *
 * — e as verificações acontecem nas pontas. Foi exatamente uma falha de
 * integração que passou por 442 testes unitários verdes: a criação gravava só
 * `captionTemplate`, a execução lia `resolvedCaption`, e cada metade estava
 * "correta" isolada enquanto o conjunto publicava legenda vazia.
 *
 * Só três coisas são duplicadas, todas fronteiras de processo:
 *   - os models (repositório em memória, sem MongoDB);
 *   - postQueue (fila em memória com a semântica de jobId do BullMQ);
 *   - fetch (fronteira HTTP com o serviço Python).
 */

const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId();

/* ── Fila em memória ──────────────────────────────────────────────────────── */

const mockFila = new Map();

jest.mock('../src/queue/postQueue', () => ({
  add: jest.fn(async (nome, dados, opts = {}) => {
    // Semântica central do BullMQ: jobId repetido devolve o existente.
    if (mockFila.has(opts.jobId)) return mockFila.get(opts.jobId);
    const job = {
      id: opts.jobId, nome, data: dados, opts, delay: opts.delay || 0,
      getState: async () => 'delayed',
      remove:   async () => { mockFila.delete(opts.jobId); },
    };
    mockFila.set(opts.jobId, job);
    return job;
  }),
  getJob: jest.fn(async id => mockFila.get(id) || null),
}));

/* ── Repositório em memória ───────────────────────────────────────────────── */

const db = { campaigns: [], publications: [], accounts: [], medias: [], posts: [], settings: [] };

const valorEm = (doc, campo) => campo.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);

function combina(doc, filtro = {}) {
  return Object.entries(filtro).every(([campo, cond]) => {
    if (campo === '$or') return cond.some(c => combina(doc, c));
    const v = valorEm(doc, campo);
    if (cond && typeof cond === 'object'
        && !(cond instanceof mongoose.Types.ObjectId) && !(cond instanceof Date)) {
      if (cond.$in)    return cond.$in.map(String).includes(String(v));
      if (cond.$nin)   return !cond.$nin.map(String).includes(String(v));
      if (cond.$lt)    return v != null && new Date(v) < new Date(cond.$lt);
      if (cond.$regex) return new RegExp(cond.$regex, cond.$options || '').test(String(v));
      return false;
    }
    return String(v) === String(cond);
  });
}

function aplicar(doc, up = {}) {
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
            const va = valorEm(a, c), vb = valorEm(b, c);
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
      select: () => q, lean: () => q,
      // populate: devolve CÓPIAS com o caminho preenchido, nunca muta o documento
      // guardado. O Mongoose real também não substitui o campo no documento de
      // origem — e mutar aqui trocaria `accountId` por um objeto, quebrando todo
      // `Account.findById(pub.accountId)` que rodasse depois.
      populate: (campo) => {
        const alvo = { accountId: 'accounts', contentId: 'medias', postId: 'posts' }[campo];
        if (!alvo) return q;
        const atuais = resolver();
        const preencher = doc => {
          if (!doc) return doc;
          const id = doc[campo];
          if (!id || (typeof id === 'object' && id._id)) return doc;
          const achado = db[alvo].find(x => String(x._id) === String(id));
          if (!achado) return doc;
          const copia = { ...doc, [campo]: achado };
          // toObject precisa refletir a CÓPIA. Herdar o do original devolveria o
          // documento sem populate, e o serializer voltaria a emitir ids crus.
          copia.toObject = () => ({ ...copia });
          return copia;
        };
        itens = Array.isArray(atuais) ? atuais.map(preencher) : preencher(atuais);
        return q;
      },
      then: (r, j) => Promise.resolve(resolver()).then(r, j),
    };
    return q;
  };

  return {
    create: jest.fn(async d => {
      const arr = Array.isArray(d) ? d : [d];
      const criados = arr.map(x => {
        if (colecao === 'settings' && db.settings.some(s => s.key === x.key)) {
          const e = new Error('duplicate key'); e.code = 11000; throw e;
        }
        const doc = encaixar(x);
        db[colecao].push(doc);
        return doc;
      });
      return Array.isArray(d) ? criados : criados[0];
    }),
    insertMany: jest.fn(async docs => {
      const criados = docs.map(encaixar);
      db[colecao].push(...criados);
      return criados;
    }),
    find:     jest.fn((f = {}) => consulta(db[colecao].filter(x => combina(x, f)))),
    findOne:  jest.fn((f = {}) => consulta(db[colecao].find(x => combina(x, f)) || null)),
    findById: jest.fn(id => consulta(db[colecao].find(x => String(x._id) === String(id)) || null)),
    findByIdAndUpdate: jest.fn(async (id, up) => {
      const d = db[colecao].find(x => String(x._id) === String(id));
      return d ? aplicar(d, up) : null;
    }),
    findOneAndUpdate: jest.fn(async (f, up) => {
      const d = db[colecao].find(x => combina(x, f));
      return d ? aplicar(d, up) : null;
    }),
    updateOne: jest.fn(async (f, up) => {
      const d = db[colecao].find(x => combina(x, f));
      if (d) aplicar(d, up);
      return { modifiedCount: d ? 1 : 0 };
    }),
    updateMany: jest.fn(async (f, up) => {
      const a = db[colecao].filter(x => combina(x, f));
      a.forEach(d => aplicar(d, up));
      return { modifiedCount: a.length };
    }),
    countDocuments: jest.fn(async (f = {}) => db[colecao].filter(x => combina(x, f)).length),
    deleteMany: jest.fn(async (f = {}) => {
      const antes = db[colecao].length;
      db[colecao] = db[colecao].filter(x => !combina(x, f));
      return { deletedCount: antes - db[colecao].length };
    }),
    deleteOne: jest.fn(async (f = {}) => {
      const i = db[colecao].findIndex(x => combina(x, f));
      if (i >= 0) db[colecao].splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
    aggregate: jest.fn(async pipeline => {
      const match = pipeline.find(p => p.$match)?.$match || {};
      const group = pipeline.find(p => p.$group)?.$group || {};
      const campo = String(group._id || '$status').replace(/^\$/, '');
      const alvos = db[colecao].filter(d => String(d.campaignId) === String(match.campaignId));
      const contagem = {};
      for (const d of alvos) {
        const chave = d[campo] ?? null;
        contagem[chave] = (contagem[chave] || 0) + 1;
      }
      return Object.entries(contagem).map(([_id, total]) => ({
        _id: _id === 'null' || _id === 'undefined' ? null : _id, total,
      }));
    }),
  };
}

jest.mock('../src/models/Campaign',            () => mockModel('campaigns', { status: 'draft' }));
jest.mock('../src/models/CampaignPublication', () => mockModel('publications', {
  status: 'pending', attempts: 0, commentStatus: 'none', commentAttempts: 0, instagramMediaId: '',
}));
jest.mock('../src/models/Account', () => mockModel('accounts'));
jest.mock('../src/models/Media',   () => mockModel('medias'));
jest.mock('../src/models/Post',    () => mockModel('posts'));
jest.mock('../src/models/Setting', () => mockModel('settings'));

/* ── SessionManager: withLock instrumentado ───────────────────────────────── */

const mockLockLog   = [];
const mockLockAtivo = new Map();
const mockLockFila  = new Map();   // accountId -> promessa da vez anterior

const mockSm = {
  // Lock que SERIALIZA de fato, encadeando as chamadas por conta — é assim que
  // o SessionLock (Redis) se comporta em produção. Um duplo que só contasse
  // deixaria o teste de concorrência passar sem provar nada.
  withLock: jest.fn((accountId, ttl, fn) => {
    const anterior = mockLockFila.get(accountId) || Promise.resolve();
    const minhaVez = anterior.then(async () => {
      const simultaneos = (mockLockAtivo.get(accountId) || 0) + 1;
      mockLockAtivo.set(accountId, simultaneos);
      mockLockLog.push({ accountId, ttl, simultaneos, conflito: simultaneos > 1 });
      try { return await fn(); }
      finally { mockLockAtivo.set(accountId, simultaneos - 1); }
    });
    // A fila segue mesmo se esta rodada falhar, senão um erro travaria a conta.
    mockLockFila.set(accountId, minhaVez.catch(() => {}));
    return minhaVez;
  }),
  load: jest.fn(async () => ({ uuids: {} })),
  save: jest.fn(async () => {}),
  recordSuccess: jest.fn(async () => {}),
  recordFailure: jest.fn(async () => {}),
};

jest.mock('../src/services/instagrapi/SessionManager', () => ({
  getSessionManager: () => mockSm,
  SessionManager: class {},
}));

/* ── fetch: fronteira HTTP com o Python ───────────────────────────────────── */

const mockHttp = [];
let mockErroComentario = null;

global.fetch = jest.fn(async (url, opts = {}) => {
  const corpo = opts.body ? JSON.parse(opts.body) : {};
  mockHttp.push({ url: String(url), corpo });

  if (String(url).endsWith('/publish/comment')) {
    if (mockErroComentario) {
      return {
        ok: false, status: 422,
        json: async () => ({ detail: { code: mockErroComentario, message: 'falhou' } }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        status: 'COMMENT_PUBLISHED', comment_id: 'c-1',
        media_id: corpo.media_id, settings: { uuids: {} },
      }),
    };
  }
  return { ok: true, json: async () => ({ status: 'LOADED' }) };
});

/* ── Módulos reais ────────────────────────────────────────────────────────── */

const ctrl     = require('../src/controllers/campaignController');
const executor = require('../src/services/campaignExecutor');
const filaCamp = require('../src/services/campaignQueue');
const recovery = require('../src/jobs/campaignRecovery');
const { getProvider, _resetForTest } = require('../src/providers/ProviderFactory');

const Account = require('../src/models/Account');
const Media   = require('../src/models/Media');
const CampaignPublication = require('../src/models/CampaignPublication');
const Campaign = require('../src/models/Campaign');

/* ── Helpers de requisição ────────────────────────────────────────────────── */

function fakeRes() {
  return {
    statusCode: 200, corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.corpo = o; return this; },
  };
}

async function chamar(handler, opcoes = {}) {
  const res = fakeRes();
  await handler({ params: {}, query: {}, body: {}, get: () => undefined, ...opcoes }, res);
  return res;
}

/* ── Cenário ──────────────────────────────────────────────────────────────── */

let CONTAS, MIDIAS;

async function semear({ contas = 3, midias = 3, provider = 'instagrapi', limiteDiario = 20 } = {}) {
  db.campaigns = []; db.publications = []; db.accounts = []; db.medias = [];
  db.posts = []; db.settings = [];
  mockFila.clear(); mockHttp.length = 0;
  mockLockLog.length = 0; mockLockAtivo.clear(); mockLockFila.clear();
  mockErroComentario = null;
  jest.clearAllMocks();
  _resetForTest();

  CONTAS = [];
  for (let i = 0; i < contas; i++) {
    CONTAS.push(await Account.create({
      username: `conta0${i + 1}`, name: `Conta ${i + 1}`, provider,
      accessToken: provider === 'instagrapi' ? '' : 'TOKEN_SEGREDO',
      igUserId:    provider === 'instagrapi' ? '' : `IG${i}`,
      password: 'senha_secreta', totpSecret: 'TOTP_SECRETO',
      proxy: 'http://user:pass@proxy:8080',
      healthStatus: 'ativa', postsToday: 0, dailyPostLimit: limiteDiario,
    }));
  }
  MIDIAS = [];
  for (let i = 0; i < midias; i++) {
    MIDIAS.push(await Media.create({
      filename: `video0${i + 1}.mp4`, originalName: `Video ${i + 1}`,
      url: `/uploads/video0${i + 1}.mp4`, type: 'video',
    }));
  }
}

/** Payload do wizard — o mesmo formato que o frontend envia. */
const payload = (over = {}) => ({
  name: 'Campanha E2E',
  accountIds: CONTAS.map(c => String(c._id)),
  contentIds: MIDIAS.map(m => String(m._id)),
  strategy: { mode: 'interleaved_random', seed: 'teste-123' },
  schedule: { intervalMinMinutes: 15, intervalMaxMinutes: 30 },
  settings: { postType: 'reel', respectDailyLimit: false },
  ...over,
});

/** Cria a campanha pelo endpoint real e devolve o id. */
async function criarCampanha(over = {}) {
  const res = await chamar(ctrl.create, { body: payload(over) });
  if (res.statusCode !== 201) {
    throw new Error(`criação falhou (${res.statusCode}): ${JSON.stringify(res.corpo)}`);
  }
  return res.corpo.campaign._id;
}

/**
 * Publicador que substitui `publishOneAccount` do worker.
 *
 * Registra o que RECEBEU — é o ponto onde se prova que a legenda chegou ao
 * método de publicação, não apenas ao banco.
 */
function publicador({ falharEm = [], idPorPar = {} } = {}) {
  const enviados = [];
  const fn = jest.fn(async (account, post) => {
    enviados.push({
      username: account.username,
      media:    post.media,
      caption:  post.caption,
      postType: post.postType,
    });
    const chave = `${account.username}|${post.media}`;
    const regra = falharEm.find(f => f.chave === chave || (f.username === account.username && !f.chave));
    if (regra) throw Object.assign(new Error(regra.mensagem || 'falha simulada'), { code: regra.code });
    return { ok: true, mediaId: idPorPar[chave] || `media_${chave.replace(/[|.]/g, '_')}` };
  });
  fn.enviados = enviados;
  return fn;
}

/** Executa todas as publicações agendadas, na ordem do plano. */
async function executarTudo(publicar) {
  const ordenadas = [...db.publications].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const p of ordenadas) {
    await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
  }
}

const comentarViaProvider = (account, dados) => getProvider(account).comment(account, dados);
const pubDe = (contaIdx, midiaIdx) => db.publications.find(
  p => String(p.accountId) === String(CONTAS[contaIdx]._id)
    && String(p.contentId) === String(MIDIAS[midiaIdx]._id)
);

beforeEach(async () => { await semear(); });

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 2 — a legenda chega ao provider                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 2 — legenda pelo fluxo real', () => {
  const CAPTIONS = {
    c1: 'Olá {username}, conteúdo exclusivo para você.',
    c2: 'Bem-vindo {username}, essa publicação pertence à conta 2.',
    c3: 'Conteúdo especial de hoje.',
  };

  const criar = () => criarCampanha({
    captionMode: 'per_account',
    captions: {
      byAccount: {
        [String(CONTAS[0]._id)]: CAPTIONS.c1,
        [String(CONTAS[1]._id)]: CAPTIONS.c2,
        [String(CONTAS[2]._id)]: CAPTIONS.c3,
      },
    },
  });

  test('a campanha nasce do endpoint e materializa 3×3 = 9 publicações', async () => {
    await criar();
    expect(db.publications).toHaveLength(9);
    expect(db.campaigns).toHaveLength(1);
  });

  test('o texto que CHEGA ao publicador tem as variáveis resolvidas', async () => {
    await criar();
    const publicar = publicador();
    await executarTudo(publicar);

    expect(publicar.enviados).toHaveLength(9);

    for (const env of publicar.enviados) {
      expect(env.caption).not.toContain('{');       // nenhuma marcação crua
      expect(env.caption.trim()).not.toBe('');      // nunca vazia
    }

    const daConta1 = publicar.enviados.filter(e => e.username === 'conta01');
    expect(daConta1).toHaveLength(3);
    for (const e of daConta1) {
      expect(e.caption).toBe('Olá conta01, conteúdo exclusivo para você.');
    }
  });

  test('cada conta recebe o SEU texto', async () => {
    await criar();
    const publicar = publicador();
    await executarTudo(publicar);

    const por = u => publicar.enviados.find(e => e.username === u).caption;
    expect(por('conta01')).toBe('Olá conta01, conteúdo exclusivo para você.');
    expect(por('conta02')).toBe('Bem-vindo conta02, essa publicação pertence à conta 2.');
    expect(por('conta03')).toBe('Conteúdo especial de hoje.');
  });

  test('o texto enviado é idêntico ao gravado na publicação', async () => {
    await criar();
    const publicar = publicador();
    await executarTudo(publicar);

    for (const p of db.publications) {
      const conta = CONTAS.find(c => String(c._id) === String(p.accountId));
      const midia = MIDIAS.find(m => String(m._id) === String(p.contentId));
      const env = publicar.enviados.find(e => e.username === conta.username && e.media === midia.filename);
      expect(env.caption).toBe(p.resolvedCaption);
    }
  });

  test('o Post criado carrega a mesma legenda', async () => {
    await criar();
    await executarTudo(publicador());

    expect(db.posts).toHaveLength(9);
    for (const post of db.posts) {
      expect(post.caption).not.toContain('{');
      expect(post.caption.trim()).not.toBe('');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 3 — prioridade das legendas                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 3 — prioridade byAccountContent > byAccount > byContent > global', () => {
  const criar = () => criarCampanha({
    captionMode: 'per_account_content',
    captions: {
      global:    'GLOBAL',
      byAccount: { [String(CONTAS[0]._id)]: 'CONTA' },
      byContent: { [String(MIDIAS[0]._id)]: 'CONTEUDO' },
      byAccountContent: { [`${CONTAS[0]._id}__${MIDIAS[0]._id}`]: 'ESPECIFICA' },
    },
  });

  test('as quatro combinações resolvem pelo nível certo, no fluxo real', async () => {
    await criar();
    const publicar = publicador();
    await executarTudo(publicar);

    const texto = (ci, mi) => {
      const conta = CONTAS[ci], midia = MIDIAS[mi];
      return publicar.enviados.find(e => e.username === conta.username && e.media === midia.filename).caption;
    };

    expect(texto(0, 0)).toBe('ESPECIFICA');   // conta01 + video01
    expect(texto(0, 1)).toBe('CONTA');        // conta01 + video02
    expect(texto(1, 0)).toBe('CONTEUDO');     // conta02 + video01
    expect(texto(1, 1)).toBe('GLOBAL');       // conta02 + video02
  });

  test('a mesma prioridade vale para o comentário', async () => {
    await semear();
    const id = await criarCampanha({
      commentMode: 'per_account_content',
      comments: {
        global:    'C-GLOBAL',
        byAccount: { [String(CONTAS[0]._id)]: 'C-CONTA' },
        byContent: { [String(MIDIAS[0]._id)]: 'C-CONTEUDO' },
        byAccountContent: { [`${CONTAS[0]._id}__${MIDIAS[0]._id}`]: 'C-ESPECIFICA' },
      },
    });
    expect(id).toBeTruthy();

    await executarTudo(publicador());
    for (const p of db.publications) {
      await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });
    }

    const textoDe = (ci, mi) => {
      const p = pubDe(ci, mi);
      return mockHttp.filter(h => h.url.endsWith('/publish/comment'))
        .find(h => h.corpo.media_id === p.instagramMediaId).corpo.text;
    };

    expect(textoDe(0, 0)).toBe('C-ESPECIFICA');
    expect(textoDe(0, 1)).toBe('C-CONTA');
    expect(textoDe(1, 0)).toBe('C-CONTEUDO');
    expect(textoDe(1, 1)).toBe('C-GLOBAL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 4 — variáveis                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 4 — variáveis', () => {
  test('{username} e {campaign} resolvem, e o template fica preservado', async () => {
    await criarCampanha({
      name: 'Campanha Agosto',
      captionMode: 'global',
      captions: { global: '{username} — {campaign}' },
    });

    const publicar = publicador();
    await executarTudo(publicar);

    for (const p of db.publications) {
      // O template continua bruto: é ele que a execução reresolve.
      expect(p.captionTemplate).toBe('{username} — {campaign}');
      expect(p.resolvedCaption).toMatch(/^conta0\d — Campanha Agosto$/);
    }
    for (const e of publicar.enviados) {
      expect(e.caption).toMatch(/^conta0\d — Campanha Agosto$/);
    }
  });

  test('variável inexistente é REPORTADA na prévia, não ignorada', async () => {
    const res = await chamar(ctrl.preview, {
      body: payload({ captions: { global: 'Compre {variavel_que_nao_existe} hoje' } }),
    });

    expect(res.statusCode).toBe(200);
    const p = res.corpo.publications[0];
    expect(p.problemas).toContainEqual({
      tipo: 'UNRESOLVED_VARIABLE', detalhe: 'variavel_que_nao_existe',
    });
    expect(res.corpo.summary.invalid).toBe(9);
  });

  test('variável inexistente é preservada como texto, não apagada', async () => {
    await criarCampanha({ captions: { global: 'Use {cupom_inexistente}' } });
    const publicar = publicador();
    await executarTudo(publicar);

    // Apagar em silêncio publicaria "Use " sem ninguém perceber.
    expect(publicar.enviados[0].caption).toBe('Use {cupom_inexistente}');
  });

  test('a prévia usa o MESMO texto que a execução produz', async () => {
    const corpo = payload({ captions: { global: 'Olá {username}' } });

    const previa = await chamar(ctrl.preview, { body: corpo });
    const res = await chamar(ctrl.create, { body: corpo });
    expect(res.statusCode).toBe(201);

    const publicar = publicador();
    await executarTudo(publicar);

    for (const item of previa.corpo.publications) {
      const enviado = publicar.enviados.find(e => e.username === item.account.username);
      expect(enviado.caption).toBe(item.resolvedCaption);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTES 5 e 6 — comentário e media_id                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTES 5 e 6 — comentário usa o media_id exato', () => {
  const criar = () => criarCampanha({
    commentMode: 'global',
    comments: { global: 'Link na bio, {username}', delayMinutes: 3 },
  });

  test('media_id de cada par é gravado separadamente', async () => {
    await criar();
    await executarTudo(publicador({
      idPorPar: {
        'conta01|video01.mp4': 'MEDIA_A',
        'conta01|video02.mp4': 'MEDIA_B',
        'conta02|video01.mp4': 'MEDIA_C',
      },
    }));

    expect(pubDe(0, 0).instagramMediaId).toBe('MEDIA_A');
    expect(pubDe(0, 1).instagramMediaId).toBe('MEDIA_B');
    expect(pubDe(1, 0).instagramMediaId).toBe('MEDIA_C');
  });

  test('o comentário de video01 usa MEDIA_A, nunca MEDIA_B', async () => {
    await criar();
    await executarTudo(publicador({
      idPorPar: { 'conta01|video01.mp4': 'MEDIA_A', 'conta01|video02.mp4': 'MEDIA_B' },
    }));

    mockHttp.length = 0;
    await executor.processarComentario(pubDe(0, 0)._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttp.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.media_id).toBe('MEDIA_A');
    expect(req.corpo.media_id).not.toBe('MEDIA_B');
  });

  test('outra conta com o MESMO conteúdo usa o seu próprio media_id', async () => {
    await criar();
    await executarTudo(publicador({
      idPorPar: { 'conta01|video01.mp4': 'MEDIA_A', 'conta02|video01.mp4': 'MEDIA_C' },
    }));

    mockHttp.length = 0;
    await executor.processarComentario(pubDe(1, 0)._id, { comentarNaConta: comentarViaProvider });

    const req = mockHttp.find(h => h.url.endsWith('/publish/comment'));
    expect(req.corpo.media_id).toBe('MEDIA_C');
    expect(req.corpo.media_id).not.toBe('MEDIA_A');
  });

  test('nenhum comentário busca a mídia — não há chamada de listagem', async () => {
    await criar();
    await executarTudo(publicador());
    for (const p of db.publications) {
      await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });
    }

    // Se alguém trocar media_comment por "última mídia", alguma destas aparece.
    const suspeitas = mockHttp.filter(h =>
      /user_medias|\/media\?|media\/recent|limit=\d/.test(h.url));
    expect(suspeitas).toEqual([]);
  });

  test('cada comentário casa com a mídia da sua própria publicação', async () => {
    await criar();
    await executarTudo(publicador());
    for (const p of db.publications) {
      await executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider });
    }

    const reqs = mockHttp.filter(h => h.url.endsWith('/publish/comment'));
    expect(reqs).toHaveLength(9);

    for (const p of db.publications) {
      const conta = CONTAS.find(c => String(c._id) === String(p.accountId));
      const req = reqs.find(r => r.corpo.media_id === p.instagramMediaId);
      expect(req).toBeTruthy();
      expect(req.corpo.text).toBe(`Link na bio, ${conta.username}`);
    }
  });

  test('o atraso vai para o job, não para uma espera na execução', async () => {
    await criar();
    const inicio = Date.now();
    await executor.processarPublicacao(db.publications[0]._id, { publicarNaConta: publicador() });
    expect(Date.now() - inicio).toBeLessThan(1000);

    // O atraso é sorteado na faixa [delayMinutes, delayMaxMinutes] — sem teto
    // configurado vale o padrão do model (6 min). Valor fixo faria o comentário
    // sair sempre no mesmo delta da publicação.
    const job = mockFila.get(filaCamp.idComentario(db.publications[0]._id));
    expect(job.delay).toBeGreaterThanOrEqual(3 * 60_000);
    expect(job.delay).toBeLessThanOrEqual(6 * 60_000);
  });

  test('teto igual ao piso volta ao atraso exato', async () => {
    await criarCampanha({
      commentMode: 'global',
      comments: { global: 'Link na bio, {username}', delayMinutes: 3, delayMaxMinutes: 3 },
    });
    await executor.processarPublicacao(db.publications[0]._id, { publicarNaConta: publicador() });

    const job = mockFila.get(filaCamp.idComentario(db.publications[0]._id));
    expect(job.delay).toBe(3 * 60_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 7 — interleaving                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 7 — interleaved_random', () => {
  const ordem = () => [...db.publications]
    .sort((a, b) => a.order - b.order)
    .map(p => {
      const c = CONTAS.find(x => String(x._id) === String(p.accountId));
      const m = MIDIAS.find(x => String(x._id) === String(p.contentId));
      return `${c.username}|${m.filename}`;
    });

  test('4×4 gera 16 pares, todos distintos', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha();

    const pares = ordem();
    expect(pares).toHaveLength(16);
    expect(new Set(pares).size).toBe(16);      // nenhuma duplicação
  });

  test('não agrupa por conta nem por conteúdo', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha();
    const pares = ordem();

    // "conta por conta" faria as 4 primeiras serem todas da conta01.
    const primeiras4 = pares.slice(0, 4).map(p => p.split('|')[0]);
    expect(new Set(primeiras4).size).toBeGreaterThan(1);

    // "conteúdo por conteúdo" faria as 4 primeiras serem todo video01.
    const conteudos4 = pares.slice(0, 4).map(p => p.split('|')[1]);
    expect(new Set(conteudos4).size).toBeGreaterThan(1);
  });

  test('nunca repete a mesma conta em sequência', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha();
    const contas = ordem().map(p => p.split('|')[0]);

    for (let i = 1; i < contas.length; i++) {
      expect(contas[i]).not.toBe(contas[i - 1]);
    }
  });

  test('a mesma seed produz exatamente o mesmo plano', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha({ strategy: { mode: 'interleaved_random', seed: 'teste-123' } });
    const primeira = ordem();

    await semear({ contas: 4, midias: 4 });
    await criarCampanha({ strategy: { mode: 'interleaved_random', seed: 'teste-123' } });
    const segunda = ordem();

    expect(segunda).toEqual(primeira);
  });

  test('seed diferente pode mudar a ordem', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha({ strategy: { mode: 'interleaved_random', seed: 'seed-A' } });
    const a = ordem();

    await semear({ contas: 4, midias: 4 });
    await criarCampanha({ strategy: { mode: 'interleaved_random', seed: 'seed-B' } });
    const b = ordem();

    expect(b).not.toEqual(a);
    expect(new Set(b)).toEqual(new Set(a));    // mesmos pares, ordem diferente
  });

  test('os intervalos entre publicações respeitam a faixa configurada', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha({ schedule: { intervalMinMinutes: 15, intervalMaxMinutes: 30 } });

    const horarios = [...db.publications]
      .sort((a, b) => a.order - b.order)
      .map(p => new Date(p.scheduledAt).getTime());

    for (let i = 1; i < horarios.length; i++) {
      const min = (horarios[i] - horarios[i - 1]) / 60_000;
      expect(min).toBeGreaterThanOrEqual(15);
      expect(min).toBeLessThanOrEqual(30);
    }
  });

  test('a janela de horário é respeitada em horário local', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha({
      schedule: {
        intervalMinMinutes: 15, intervalMaxMinutes: 30,
        windowStart: '18:00', windowEnd: '23:00',
      },
    });

    for (const p of db.publications) {
      const h = new Date(p.scheduledAt).getHours();
      expect(h).toBeGreaterThanOrEqual(18);
      expect(h).toBeLessThan(23);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 8 — BullMQ 1:1                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 8 — relação 1:1 com o BullMQ', () => {
  test('12 publicações → 12 jobs', async () => {
    await semear({ contas: 4, midias: 3 });
    const id = await criarCampanha();
    expect(db.publications).toHaveLength(12);

    await chamar(ctrl.start, { params: { id } });
    expect(mockFila.size).toBe(12);
  });

  test('dois cliques em iniciar continuam gerando 12 jobs, nunca 24', async () => {
    await semear({ contas: 4, midias: 3 });
    const id = await criarCampanha();

    await chamar(ctrl.start, { params: { id } });
    const segundo = await chamar(ctrl.start, { params: { id } });

    expect(mockFila.size).toBe(12);
    expect(db.publications).toHaveLength(12);
    expect(segundo.corpo.alreadyQueued ?? 0).toBeGreaterThan(0);
  });

  test('dois starts SIMULTÂNEOS também produzem 12 jobs', async () => {
    await semear({ contas: 4, midias: 3 });
    const id = await criarCampanha();

    await Promise.all([
      chamar(ctrl.start, { params: { id } }),
      chamar(ctrl.start, { params: { id } }),
    ]);

    expect(mockFila.size).toBe(12);
    expect(db.publications).toHaveLength(12);
  });

  test('cada job aponta para uma publicação distinta', async () => {
    await semear({ contas: 4, midias: 3 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });

    const ids = [...mockFila.values()].map(j => j.data.campaignPublicationId);
    expect(new Set(ids).size).toBe(12);
    expect(new Set(ids)).toEqual(new Set(db.publications.map(p => String(p._id))));
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 9 — retry individual                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 9 — retry individual', () => {
  test('16 publicações, a #5 falha, as outras 15 seguem', async () => {
    await semear({ contas: 4, midias: 4 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });

    const ordenadas = [...db.publications].sort((a, b) => a.order - b.order);
    const alvo = ordenadas[4];                                  // a #5
    const conta = CONTAS.find(c => String(c._id) === String(alvo.accountId));
    const midia = MIDIAS.find(m => String(m._id) === String(alvo.contentId));

    const publicar = publicador({
      falharEm: [{ chave: `${conta.username}|${midia.filename}`, code: 'RATE_LIMITED' }],
    });
    await executarTudo(publicar);

    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(15);
    expect(db.publications.filter(p => p.status === 'failed')).toHaveLength(1);
    expect(String(db.publications.find(p => p.status === 'failed')._id)).toBe(String(alvo._id));
    expect(alvo.attempts).toBe(1);

    // Retry só da #5.
    const publicarOk = publicador();
    await chamar(ctrl.retryPublication, { params: { id, publicationId: String(alvo._id) } });
    await executor.processarPublicacao(alvo._id, { publicarNaConta: publicarOk });

    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(16);
    expect(alvo.attempts).toBe(2);
    // As outras 15 não foram tocadas.
    expect(publicarOk.enviados).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTES 10 a 12 — pause, resume, cancel                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTES 10 a 12 — pause, resume, cancel', () => {
  async function campanhaEmAndamento({ contas = 4, midias = 5, publicar = 6 } = {}) {
    await semear({ contas, midias });
    const id = await criarCampanha({ commentMode: 'global', comments: { global: 'Comentário' } });
    await chamar(ctrl.start, { params: { id } });

    const ordenadas = [...db.publications].sort((a, b) => a.order - b.order);
    const pub = publicador();
    for (const p of ordenadas.slice(0, publicar)) {
      await executor.processarPublicacao(p._id, { publicarNaConta: pub });
    }
    return { id, pub };
  }

  test('pause remove os jobs futuros e preserva as concluídas', async () => {
    const { id } = await campanhaEmAndamento();
    expect(db.publications).toHaveLength(20);

    await chamar(ctrl.pause, { params: { id } });

    const publicadas = db.publications.filter(p => p.status === 'published');
    expect(publicadas).toHaveLength(6);

    // Nenhum job de publicação sobreviveu para as pendentes.
    const pendentes = db.publications.filter(p => ['pending', 'scheduled'].includes(p.status));
    expect(pendentes).toHaveLength(14);
    for (const p of pendentes) {
      expect(mockFila.has(filaCamp.idPublicacao(p._id))).toBe(false);
    }
  });

  test('durante o pause nenhuma publicação nova acontece', async () => {
    const { id } = await campanhaEmAndamento();
    await chamar(ctrl.pause, { params: { id } });

    const publicar = publicador();
    // Um job sobrevivente tentando rodar.
    for (const p of db.publications.filter(p => p.status !== 'published')) {
      await executor.processarPublicacao(p._id, { publicarNaConta: publicar });
    }

    expect(publicar).not.toHaveBeenCalled();
    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(6);
  });

  test('comentário de publicação pausada não é executado', async () => {
    const { id } = await campanhaEmAndamento();
    await chamar(ctrl.pause, { params: { id } });

    // As 6 publicadas mantêm o comentário agendado (o post está no ar);
    // as pendentes nunca chegaram a ter comentário.
    const comComentario = db.publications.filter(p => p.commentStatus === 'scheduled');
    expect(comComentario).toHaveLength(6);
    expect(comComentario.every(p => p.status === 'published')).toBe(true);
  });

  test('resume devolve só as pendentes e não recria as publicadas', async () => {
    const { id } = await campanhaEmAndamento();
    await chamar(ctrl.pause, { params: { id } });

    const antesLinhas = db.publications.length;
    const res = await chamar(ctrl.resume, { params: { id } });

    expect(db.publications).toHaveLength(antesLinhas);           // nada recriado
    expect(res.corpo.requeued).toBe(14);
    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(6);

    // Um job vivo por pendente, sem duplicar. Contar a fila inteira enganaria:
    // o duplo retém os jobs já concluídos, como o BullMQ com removeOnComplete.
    const pendentes = db.publications.filter(p => ['pending', 'scheduled'].includes(p.status));
    expect(pendentes).toHaveLength(14);
    expect(pendentes.every(p => mockFila.has(filaCamp.idPublicacao(p._id)))).toBe(true);
  });

  test('cancel encerra futuras e comentários, preservando as publicadas', async () => {
    const { id } = await campanhaEmAndamento();
    const res = await chamar(ctrl.cancel, { params: { id } });

    expect(res.corpo.cancelled).toBe(14);
    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(6);
    expect(db.publications.filter(p => p.status === 'cancelled')).toHaveLength(14);

    // Comentários agendados foram cancelados.
    expect(db.publications.filter(p => p.commentStatus === 'scheduled')).toHaveLength(0);
    expect(db.publications.filter(p => p.commentStatus === 'cancelled')).toHaveLength(6);

    // Nenhuma cancelada mantém job vivo — nem de publicação nem de comentário.
    const canceladas = db.publications.filter(p => p.status === 'cancelled');
    expect(canceladas.every(p => !mockFila.has(filaCamp.idPublicacao(p._id)))).toBe(true);
    expect(db.publications.every(p => !mockFila.has(filaCamp.idComentario(p._id)))).toBe(true);
  });

  test('depois do cancelamento nenhuma publicação nova ocorre', async () => {
    const { id } = await campanhaEmAndamento();
    await chamar(ctrl.cancel, { params: { id } });

    const publicar = publicador();
    await executarTudo(publicar);

    expect(publicar).not.toHaveBeenCalled();
    expect(db.campaigns[0].status).toBe('cancelled');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 13 — recovery                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 13 — recovery após restart', () => {
  test('jobs perdidos são recriados; os existentes não duplicam', async () => {
    await semear({ contas: 4, midias: 3 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });
    expect(mockFila.size).toBe(12);

    // Redis reiniciou sem persistência: 7 jobs sumiram.
    const perdidos = db.publications.slice(0, 7);
    for (const p of perdidos) mockFila.delete(filaCamp.idPublicacao(p._id));
    expect(mockFila.size).toBe(5);

    const r = await recovery.recuperarAgendadas(new Date());
    expect(r.reenfileiradas).toBe(7);
    expect(mockFila.size).toBe(12);

    // Rodar de novo não duplica.
    const r2 = await recovery.recuperarAgendadas(new Date());
    expect(r2.reenfileiradas).toBe(0);
    expect(mockFila.size).toBe(12);
  });

  test('publicação já publicada não volta para a fila', async () => {
    await semear({ contas: 2, midias: 2 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });

    await executor.processarPublicacao(db.publications[0]._id, { publicarNaConta: publicador() });
    mockFila.clear();

    await recovery.recuperarAgendadas(new Date());

    expect(mockFila.has(filaCamp.idPublicacao(db.publications[0]._id))).toBe(false);
    expect([...mockFila.keys()].filter(k => k.startsWith('campaign-publication:'))).toHaveLength(3);
  });

  test('processing antigo vira falha e NÃO é republicado automaticamente', async () => {
    await semear({ contas: 2, midias: 2 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });
    mockFila.clear();

    const presa = db.publications[0];
    await CampaignPublication.updateOne({ _id: presa._id }, { $set: { status: 'processing' } });
    presa.updatedAt = new Date(Date.now() - 60 * 60_000);       // 1h atrás

    const n = await recovery.recuperarProcessando(new Date());

    expect(n).toBe(1);
    expect(presa.status).toBe('failed');
    expect(presa.errorCode).toBe('WORKER_RESTARTED');
    // Republicar sem conferir criaria post duplicado no Instagram.
    expect(mockFila.has(filaCamp.idPublicacao(presa._id))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 16 — lock por conta                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 16 — lock por conta', () => {
  test('o comentário adquire o lock da conta e nunca há dois titulares', async () => {
    await semear({ contas: 2, midias: 2 });
    await criarCampanha({ commentMode: 'global', comments: { global: 'oi' } });
    await executarTudo(publicador());

    mockLockLog.length = 0;
    await Promise.all(db.publications.map(p =>
      executor.processarComentario(p._id, { comentarNaConta: comentarViaProvider })));

    expect(mockLockLog.length).toBeGreaterThan(0);
    expect(mockLockLog.some(l => l.conflito)).toBe(false);
    expect(mockLockLog.every(l => l.simultaneos === 1)).toBe(true);
  });

  test('a reivindicação atômica impede publicação dupla da mesma linha', async () => {
    await semear({ contas: 2, midias: 2 });
    await criarCampanha();

    const publicar = publicador();
    const alvo = db.publications[0]._id;
    await Promise.all([
      executor.processarPublicacao(alvo, { publicarNaConta: publicar }),
      executor.processarPublicacao(alvo, { publicarNaConta: publicar }),
      executor.processarPublicacao(alvo, { publicarNaConta: publicar }),
    ]);

    expect(publicar).toHaveBeenCalledTimes(1);
    expect(db.posts).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 17 — limite diário                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 17 — limite diário', () => {
  test('respectDailyLimit=true corta o plano no limite de cada conta', async () => {
    await semear({ contas: 2, midias: 5, limiteDiario: 3 });
    await criarCampanha({ settings: { postType: 'reel', respectDailyLimit: true } });

    // 2 contas × 3 = 6, não 2 × 5 = 10.
    expect(db.publications).toHaveLength(6);
    for (const conta of CONTAS) {
      const daConta = db.publications.filter(p => String(p.accountId) === String(conta._id));
      expect(daConta).toHaveLength(3);
    }
  });

  test('respectDailyLimit=false planeja todos os pares', async () => {
    await semear({ contas: 2, midias: 5, limiteDiario: 3 });
    await criarCampanha({ settings: { postType: 'reel', respectDailyLimit: false } });
    expect(db.publications).toHaveLength(10);
  });

  test('o limite considera o que a conta já publicou hoje', async () => {
    await semear({ contas: 2, midias: 5, limiteDiario: 3 });
    // conta01 já usou 2 das 3 de hoje.
    db.accounts[0].postsToday = 2;
    db.accounts[0].lastPostDate = new Date();

    await criarCampanha({ settings: { postType: 'reel', respectDailyLimit: true } });

    const daConta1 = db.publications.filter(p => String(p.accountId) === String(CONTAS[0]._id));
    expect(daConta1).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 18 — timezone                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 18 — timezone', () => {
  test('a suíte roda em America/Sao_Paulo', () => {
    expect(process.env.TZ).toBe('America/Sao_Paulo');
  });

  test('a janela 18:00–23:00 gera horários locais de Brasília', async () => {
    await semear({ contas: 3, midias: 3 });
    await criarCampanha({
      schedule: {
        intervalMinMinutes: 15, intervalMaxMinutes: 30,
        windowStart: '18:00', windowEnd: '23:00',
      },
    });

    for (const p of db.publications) {
      const d = new Date(p.scheduledAt);
      const hora = d.getHours();
      expect(hora).toBeGreaterThanOrEqual(18);
      expect(hora).toBeLessThan(23);

      // E o instante gravado é UTC — a leitura local é que aplica o fuso.
      const utc = d.getUTCHours();
      expect(utc).not.toBe(hora);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 19 — o que a Campaign Detail consome                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTE 19 — dados da Campaign Detail', () => {
  test('o detalhe entrega tudo que o painel precisa, sem vazar segredo', async () => {
    await semear({ contas: 3, midias: 3 });
    const id = await criarCampanha({
      captions: { global: 'Olá {username}' },
      commentMode: 'global', comments: { global: 'Comentário' },
    });
    await chamar(ctrl.start, { params: { id } });

    const res = await chamar(ctrl.get, { params: { id } });
    const c = res.corpo;

    expect(c.campaign.name).toBe('Campanha E2E');
    expect(c.campaign.status).toBe('scheduled');
    expect(c.statistics).toMatchObject({ total: 9, scheduled: 9 });
    expect(c.commentStatistics.total).toBe(9);
    expect(c.progress).toMatchObject({ done: 0, total: 9, percentage: 0 });
    expect(c.nextPublication).toBeTruthy();
    expect(c.nextPublication.resolvedCaption).toMatch(/^Olá conta0\d$/);

    const texto = JSON.stringify(c);
    for (const segredo of ['senha_secreta', 'TOTP_SECRETO', 'TOKEN_SEGREDO', 'user:pass']) {
      expect(texto).not.toContain(segredo);
    }
  });

  test('a listagem devolve conta e conteúdo populados — avatar e miniatura', async () => {
    await semear({ contas: 2, midias: 2 });
    const id = await criarCampanha();

    const res = await chamar(ctrl.listPublications, { params: { id }, query: { limit: '200' } });
    expect(res.corpo.publications).toHaveLength(4);

    for (const p of res.corpo.publications) {
      // O painel lê `account`/`content`, não `accountId`/`contentId`.
      expect(p.account.username).toMatch(/^conta0\d$/);
      expect(p.content.originalName).toMatch(/^Video \d$/);
      expect(p.account.password).toBeUndefined();
      expect(p.account.proxy).toBeUndefined();
      expect(p.account.hasProxy).toBe(true);
    }
  });

  test('a listagem sai ordenada por horário, como a timeline espera', async () => {
    await semear({ contas: 3, midias: 3 });
    const id = await criarCampanha();

    const res = await chamar(ctrl.listPublications, { params: { id }, query: { limit: '200' } });
    const t = res.corpo.publications.map(p => new Date(p.scheduledAt).getTime());
    expect(t).toEqual([...t].sort((a, b) => a - b));
  });

  test('retry de comentário está exposto e reenfileira só o comentário', async () => {
    await semear({ contas: 2, midias: 2 });
    const id = await criarCampanha({ commentMode: 'global', comments: { global: 'oi' } });
    await executarTudo(publicador());

    const alvo = db.publications[0];
    mockErroComentario = 'RATE_LIMITED';
    await executor.processarComentario(alvo._id, { comentarNaConta: comentarViaProvider });
    expect(alvo.commentStatus).toBe('failed');

    mockErroComentario = null;
    mockFila.clear();
    const res = await chamar(ctrl.retryComment, {
      params: { id, publicationId: String(alvo._id) },
    });

    expect(res.statusCode).toBe(200);
    expect(alvo.commentStatus).toBe('scheduled');
    expect(alvo.status).toBe('published');                     // publicação intocada
    expect([...mockFila.keys()]).toEqual([filaCamp.idComentario(alvo._id)]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTES 14 e 15 — Postar e Loop sem interferência                           */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('PARTES 14 e 15 — isolamento de Postar e Loop', () => {
  test('a campanha só enfileira jobs de campanha — nada de job_round/post', async () => {
    await semear({ contas: 3, midias: 3 });
    const id = await criarCampanha({ commentMode: 'global', comments: { global: 'oi' } });
    await chamar(ctrl.start, { params: { id } });
    await executarTudo(publicador());

    const nomes = new Set([...mockFila.values()].map(j => j.nome));
    expect(nomes).toEqual(new Set(['campaign_publication', 'campaign_comment']));
    // 'job_round' é do Postar/Loop; 'post' é o legado.
    expect(nomes.has('job_round')).toBe(false);
    expect(nomes.has('post')).toBe(false);
  });

  test('os jobs de campanha têm prefixo próprio, sem colidir com o Job Engine', async () => {
    await semear({ contas: 2, midias: 2 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });

    for (const chave of mockFila.keys()) {
      expect(chave).toMatch(/^campaign-(publication|comment):/);
    }
  });

  test('o controller de campanha não importa Job nem Post', () => {
    const fonte = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/controllers/campaignController.js'), 'utf8');
    expect(fonte).not.toMatch(/models\/Job/);
    expect(fonte).not.toMatch(/models\/Post/);
  });

  test('o executor não toca no model Job', () => {
    const fonte = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/services/campaignExecutor.js'), 'utf8');
    expect(fonte).not.toMatch(/models\/Job/);
  });

  test('o worker preserva os branches de Postar e Loop, na ordem', () => {
    const fonte = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/queue/worker.js'), 'utf8');

    // Os quatro branches continuam existindo.
    expect(fonte).toMatch(/job\.data\.campaignPublicationId/);
    expect(fonte).toMatch(/job\.data\.campaignCommentId/);
    expect(fonte).toMatch(/job\.data\.jobId/);
    expect(fonte).toMatch(/job\.data\.postId/);

    // E as funções de Postar/Loop seguem no arquivo.
    for (const fn of ['processJobRound', 'processLegacyPost', 'publishOneAccount',
                      'publishViaInstagrapi', 'publishWithRetry', 'recoverStuckJobs']) {
      expect(fonte).toMatch(new RegExp(`function ${fn}\\b`));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* FASE 11 — campanha controlada 2×2, preparada sem publicar                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const CFG_CONTROLADA = {
  name: 'Campanha Controlada',
  strategy: { mode: 'interleaved_random', seed: 'teste-final-campanha-001' },
  schedule: {
    intervalMinMinutes: 20, intervalMaxMinutes: 30,
    windowStart: '18:00', windowEnd: '23:00',
  },
  settings: { postType: 'reel', respectDailyLimit: true },
};

/** Legendas e comentários POR CONTA, sobre um nível global. */
function textosPorConta() {
  return {
    captionMode: 'per_account',
    captions: {
      global: 'Campanha teste — {username}',
      byAccount: {
        [String(CONTAS[0]._id)]: 'Conteúdo especial para {username} — conta 01',
        [String(CONTAS[1]._id)]: 'Conteúdo especial para {username} — conta 02',
      },
    },
    commentMode: 'per_account',
    comments: {
      global: 'Confira o conteúdo de {username}',
      byAccount: {
        [String(CONTAS[0]._id)]: 'Comentário da conta 01 — {username}',
        [String(CONTAS[1]._id)]: 'Comentário da conta 02 — {username}',
      },
      delayMinutes: 3,
    },
  };
}

describe('FASE 11 — campanha controlada 2×2', () => {
  beforeEach(async () => { await semear({ contas: 2, midias: 2 }); });

  test('a PRÉVIA mostra o plano sem criar campanha, publicação ou job', async () => {
    const corpo = payload({ ...CFG_CONTROLADA, ...textosPorConta() });
    const res = await chamar(ctrl.preview, { body: corpo });

    expect(res.statusCode).toBe(200);
    expect(res.corpo.publications).toHaveLength(4);

    // Prévia é só cálculo: nada foi persistido nem enfileirado.
    expect(db.campaigns).toHaveLength(0);
    expect(db.publications).toHaveLength(0);
    expect(mockFila.size).toBe(0);
    expect(db.posts).toHaveLength(0);
  });

  test('plano: 4 publicações, cada conta 2x, cada conteúdo 2x, sem par repetido', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    expect(id).toBeTruthy();

    const linhas = [...db.publications].sort((a, b) => a.order - b.order).map(p => {
      const c = CONTAS.find(x => String(x._id) === String(p.accountId));
      const m = MIDIAS.find(x => String(x._id) === String(p.contentId));
      return { conta: c.username, conteudo: m.originalName };
    });

    expect(linhas).toHaveLength(4);

    const porConta = {}, porConteudo = {};
    for (const l of linhas) {
      porConta[l.conta] = (porConta[l.conta] || 0) + 1;
      porConteudo[l.conteudo] = (porConteudo[l.conteudo] || 0) + 1;
    }
    expect(Object.values(porConta)).toEqual([2, 2]);
    expect(Object.values(porConteudo)).toEqual([2, 2]);

    const pares = linhas.map(l => `${l.conta}|${l.conteudo}`);
    expect(new Set(pares).size).toBe(4);
  });

  test('nenhuma conta aparece em publicações consecutivas', async () => {
    await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    const contas = [...db.publications].sort((a, b) => a.order - b.order)
      .map(p => CONTAS.find(x => String(x._id) === String(p.accountId)).username);

    for (let i = 1; i < contas.length; i++) {
      expect(contas[i]).not.toBe(contas[i - 1]);
    }
  });

  test('intervalos entre 20 e 30 minutos, tudo dentro da janela 18:00-23:00', async () => {
    await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    const t = [...db.publications].sort((a, b) => a.order - b.order)
      .map(p => new Date(p.scheduledAt));

    for (let i = 1; i < t.length; i++) {
      const min = (t[i] - t[i - 1]) / 60000;
      expect(min).toBeGreaterThanOrEqual(20);
      expect(min).toBeLessThanOrEqual(30);
    }
    for (const d of t) {
      expect(d.getHours()).toBeGreaterThanOrEqual(18);
      expect(d.getHours()).toBeLessThan(23);
    }
  });

  test('materialização: template bruto preservado e texto resolvido por conta', async () => {
    await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });

    for (const p of db.publications) {
      const conta = CONTAS.find(c => String(c._id) === String(p.accountId));
      const n = conta.username === 'conta01' ? '01' : '02';

      // Campos exigidos pela PARTE 5.
      expect(p.campaignId).toBeTruthy();
      expect(p.accountId).toBeTruthy();
      expect(p.contentId).toBeTruthy();
      expect(p.scheduledAt).toBeInstanceOf(Date);
      expect(p.order).toBeGreaterThan(0);

      // O template guarda a marcação; o resolvido guarda o texto final.
      expect(p.captionTemplate).toBe(`Conteúdo especial para {username} — conta ${n}`);
      expect(p.resolvedCaption).toBe(`Conteúdo especial para ${conta.username} — conta ${n}`);
      expect(p.commentTemplate).toBe(`Comentário da conta ${n} — {username}`);
      expect(p.resolvedComment).toBe(`Comentário da conta ${n} — ${conta.username}`);

      // A legenda global foi sobreposta pela da conta — prova da prioridade.
      expect(p.resolvedCaption).not.toContain('Campanha teste');
      expect(p.resolvedComment).not.toContain('Confira o conteúdo');
    }
  });

  test('start enfileira exatamente 4 jobs, com jobId determinístico', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    await chamar(ctrl.start, { params: { id } });

    expect(mockFila.size).toBe(4);
    for (const p of db.publications) {
      expect(mockFila.has(`campaign-publication:${p._id}`)).toBe(true);
      expect(p.bullMqJobId).toBe(`campaign-publication:${p._id}`);
    }
  });

  test('start duas vezes — sequencial e simultâneo — mantém 4 jobs', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });

    await chamar(ctrl.start, { params: { id } });
    await chamar(ctrl.start, { params: { id } });
    expect(mockFila.size).toBe(4);

    await Promise.all([
      chamar(ctrl.start, { params: { id } }),
      chamar(ctrl.start, { params: { id } }),
    ]);
    expect(mockFila.size).toBe(4);
    expect(db.publications).toHaveLength(4);
  });

  test('retry da #3: só ela reexecuta, attempts vai de 1 para 2', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    await chamar(ctrl.start, { params: { id } });

    const ordenadas = [...db.publications].sort((a, b) => a.order - b.order);
    const alvo  = ordenadas[2];                       // a #3
    const conta = CONTAS.find(c => String(c._id) === String(alvo.accountId));
    const midia = MIDIAS.find(m => String(m._id) === String(alvo.contentId));

    const publicar = publicador({
      falharEm: [{ chave: `${conta.username}|${midia.filename}`, code: 'RATE_LIMITED' }],
    });
    await executarTudo(publicar);

    expect(ordenadas[0].status).toBe('published');
    expect(ordenadas[1].status).toBe('published');
    expect(ordenadas[2].status).toBe('failed');
    expect(ordenadas[3].status).toBe('published');
    expect(alvo.attempts).toBe(1);

    const publicarOk = publicador();
    await chamar(ctrl.retryPublication, { params: { id, publicationId: String(alvo._id) } });
    await executor.processarPublicacao(alvo._id, { publicarNaConta: publicarOk });

    expect(alvo.status).toBe('published');
    expect(alvo.attempts).toBe(2);
    // Só a #3 foi tocada — as outras três não voltaram ao publicador.
    expect(publicarOk.enviados).toHaveLength(1);
    expect(publicarOk.enviados[0].username).toBe(conta.username);
    expect(db.publications.filter(p => p.status === 'published')).toHaveLength(4);
  });

  test('nenhum Post é criado antes de publicar', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    await chamar(ctrl.start, { params: { id } });

    expect(db.posts).toHaveLength(0);
    expect(mockHttp).toHaveLength(0);
    expect(db.publications.every(p => !p.publishedAt)).toBe(true);
    expect(db.publications.every(p => !p.instagramMediaId)).toBe(true);
  });

  test('PLANO FINAL — impressão para conferência', async () => {
    const id = await criarCampanha({ ...CFG_CONTROLADA, ...textosPorConta() });
    await chamar(ctrl.start, { params: { id } });

    const linhas = [...db.publications].sort((a, b) => a.order - b.order).map(p => {
      const c = CONTAS.find(x => String(x._id) === String(p.accountId));
      const m = MIDIAS.find(x => String(x._id) === String(p.contentId));
      const d = new Date(p.scheduledAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const dia = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
      return {
        n: p.order, quando: dia + ' ' + hh + ':' + mm, conta: '@' + c.username,
        conteudo: m.originalName, legenda: p.resolvedCaption, comentario: p.resolvedComment,
      };
    });

    const sep = '='.repeat(80);
    console.log(sep);
    console.log('PLANO CONTROLADO 2x2 - seed teste-final-campanha-001 (NADA PUBLICADO)');
    console.log(sep);
    for (const l of linhas) {
      console.log(`${String(l.n).padStart(2, '0')} | ${l.quando} | ${l.conta.padEnd(9)} | ${l.conteudo.padEnd(8)} | +3m`);
      console.log(`     legenda...: "${l.legenda}"`);
      console.log(`     comentario: "${l.comentario}"`);
    }
    console.log('-'.repeat(80));
    console.log(`Publicacoes: ${db.publications.length} | Jobs: ${mockFila.size} | Posts: ${db.posts.length} | HTTP ao Instagram: ${mockHttp.length}`);
    console.log(sep);

    expect(linhas).toHaveLength(4);
    expect(mockFila.size).toBe(4);
    expect(db.posts).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* FASE 11 — validações pontuais                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('FASE 11 — validações pontuais', () => {
  test('PARTE 11: 10 publicações, 7 perdem o job — 7 recriados, 3 preservados', async () => {
    await semear({ contas: 5, midias: 2 });
    const id = await criarCampanha();
    await chamar(ctrl.start, { params: { id } });
    expect(db.publications).toHaveLength(10);
    expect(mockFila.size).toBe(10);

    for (const p of db.publications.slice(0, 7)) {
      mockFila.delete(filaCamp.idPublicacao(p._id));
    }
    expect(mockFila.size).toBe(3);

    const r = await recovery.recuperarAgendadas(new Date());
    expect(r.reenfileiradas).toBe(7);
    expect(mockFila.size).toBe(10);
  });

  test('PARTE 14: 2 contas, limite 3, 10 conteúdos → no máximo 6 publicações', async () => {
    await semear({ contas: 2, midias: 10, limiteDiario: 3 });
    await criarCampanha({ settings: { postType: 'reel', respectDailyLimit: true } });

    expect(db.publications).toHaveLength(6);
    for (const conta of CONTAS) {
      const n = db.publications.filter(p => String(p.accountId) === String(conta._id)).length;
      expect(n).toBeLessThanOrEqual(3);
      expect(n).toBe(3);
    }
  });

  test('PARTE 18: o par campanha+conta+conteúdo nunca se repete', async () => {
    await semear({ contas: 4, midias: 4 });
    await criarCampanha();

    const chaves = db.publications.map(p => `${p.campaignId}|${p.accountId}|${p.contentId}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves).toHaveLength(16);
  });

  test('PARTE 18: o índice único do model cobre campanha+conta+conteúdo', () => {
    // O model real, não o duplo: é a definição do índice que está sendo lida.
    const CP = jest.requireActual('../src/models/CampaignPublication');
    const indices = CP.schema.indexes();

    const unico = indices.find(([campos, opcoes]) =>
      opcoes && opcoes.unique
      && campos.campaignId === 1 && campos.accountId === 1 && campos.contentId === 1);

    expect(unico).toBeTruthy();
  });

  test('PARTE 17: o planner é determinístico — mesma entrada, mesma saída', async () => {
    const config = {
      ...CFG_CONTROLADA,
      strategy: { mode: 'interleaved_random', seed: 'determinismo' },
    };

    const rodar = async () => {
      await semear({ contas: 3, midias: 3 });
      await criarCampanha(config);
      return [...db.publications].sort((a, b) => a.order - b.order).map(p => {
        const c = CONTAS.find(x => String(x._id) === String(p.accountId));
        const m = MIDIAS.find(x => String(x._id) === String(p.contentId));
        return `${c.username}|${m.filename}`;
      });
    };

    expect(await rodar()).toEqual(await rodar());
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* PARTE 12 — payload real do wizard                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * O wizard monta o corpo com `...form`, então ele manda TODOS os campos do
 * estado — inclusive os vazios e os que o backend não conhecia até ontem.
 * Testes anteriores enviavam só o essencial, e foi assim que a criação real
 * passou a falhar sem nenhum teste ficar vermelho.
 */
describe('PARTE 12 — o corpo que o wizard realmente envia', () => {
  const payloadWizard = (over = {}) => ({
    name: 'Campanha do painel',
    description: '',
    accountIds: CONTAS.map(c => String(c._id)),
    contentIds: MIDIAS.map(m => String(m._id)),
    captionMode: 'global',
    captions: { global: '', byAccount: {}, byContent: {}, byAccountContent: {} },
    commentMode: 'disabled',
    comments: { global: '', delayMinutes: 2, delayMaxMinutes: 6 },
    strategy: { mode: 'interleaved_random' },
    schedule: {
      startAt: undefined,
      intervalMinMinutes: 12,
      intervalMaxMinutes: 28,
      useFixedInterval: false,
      windowStart: '',
      windowEnd: '',
      weekdays: [],
    },
    settings: { respectDailyLimit: true, postType: 'reel' },
    covers: { byContent: {} },
    ...over,
  });

  test('a prévia aceita o corpo do wizard', async () => {
    const res = await chamar(ctrl.preview, { body: payloadWizard() });
    expect(res.statusCode).toBe(200);
    expect(res.corpo.publications.length).toBeGreaterThan(0);
  });

  test('a criação aceita o corpo do wizard', async () => {
    const res = await chamar(ctrl.create, { body: payloadWizard() });
    expect(res.statusCode).toBe(201);
  });

  test('legenda vazia não impede criar — o campo é opcional na tela', async () => {
    const res = await chamar(ctrl.create, { body: payloadWizard() });
    expect(res.statusCode).toBe(201);
  });

  test('sem seed na estratégia o serviço gera uma', async () => {
    const res = await chamar(ctrl.create, { body: payloadWizard() });
    expect(res.statusCode).toBe(201);
    expect(res.corpo.campaign.strategy.seed).toBeTruthy();
  });

  test('capa por conteúdo é aceita e gravada', async () => {
    const capaId = String(MIDIAS[0]._id);
    const res = await chamar(ctrl.create, {
      body: payloadWizard({ covers: { byContent: { [String(MIDIAS[1]._id)]: capaId } } }),
    });
    expect(res.statusCode).toBe(201);
  });

  test('a prévia aceita capa por conteúdo', async () => {
    const res = await chamar(ctrl.preview, {
      body: payloadWizard({ covers: { byContent: { [String(MIDIAS[1]._id)]: String(MIDIAS[0]._id) } } }),
    });
    expect(res.statusCode).toBe(200);
  });

  test('janela e dias vazios não viram filtro impossível', async () => {
    const res = await chamar(ctrl.create, {
      body: payloadWizard({
        schedule: {
          startAt: undefined, intervalMinMinutes: 12, intervalMaxMinutes: 28,
          useFixedInterval: false, windowStart: '', windowEnd: '', weekdays: [],
        },
      }),
    });
    expect(res.statusCode).toBe(201);
  });

  test('comentário desativado com texto vazio não quebra', async () => {
    const res = await chamar(ctrl.create, {
      body: payloadWizard({ commentMode: 'disabled', comments: { global: '', delayMinutes: 2, delayMaxMinutes: 6 } }),
    });
    expect(res.statusCode).toBe(201);
  });
});
