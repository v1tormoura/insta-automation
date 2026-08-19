'use strict';

/**
 * Testes da Campaign API (fase 4).
 *
 * Os models são mockados por um repositório em memória — mesmo padrão dos testes
 * já existentes no projeto, que não sobem MongoDB. Isso mantém a suíte rápida e
 * determinística, e ainda exercita controller + service + planner de verdade.
 */

const mongoose = require('mongoose');

const oid = () => new mongoose.Types.ObjectId();

/* ── Repositório em memória ────────────────────────────────────────────────── */

const db = { campaigns: [], publications: [], accounts: [], medias: [], settings: [] };

const clonar = o => JSON.parse(JSON.stringify(o, (k, v) => v));

function _combina(doc, filtro) {
  return Object.entries(filtro).every(([campo, cond]) => {
    const valor = doc[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof mongoose.Types.ObjectId)) {
      // Operadores suportados. Um operador desconhecido cairia na comparação
      // por string abaixo e daria "[object Object]" — nunca combinando, o que
      // faz a consulta devolver zero em silêncio em vez de falhar.
      let ok = true;
      let reconhecido = false;
      if (cond.$in    !== undefined) { reconhecido = true; ok = ok && cond.$in.map(String).includes(String(valor)); }
      if (cond.$nin   !== undefined) { reconhecido = true; ok = ok && !cond.$nin.map(String).includes(String(valor)); }
      if (cond.$ne    !== undefined) { reconhecido = true; ok = ok && String(valor) !== String(cond.$ne); }
      if (cond.$exists!== undefined) { reconhecido = true; ok = ok && (valor !== undefined) === !!cond.$exists; }
      if (cond.$regex !== undefined) { reconhecido = true; ok = ok && new RegExp(cond.$regex, cond.$options || '').test(String(valor)); }
      if (reconhecido) return ok;
    }
    return String(valor) === String(cond);
  });
}

/** Aplica $set/$inc como o Mongoose faria — o executor usa os dois. */
function _aplicarUpdate(doc, update = {}) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
  if (!update.$set && !update.$inc) Object.assign(doc, update);
  return doc;
}

/** Model falso com o subconjunto de API que o controller usa. */
function mockCriarModel(colecao, comSave = true) {
  const encaixar = doc => {
    if (!comSave) return doc;
    doc.save = jest.fn(async () => doc);
    doc.toObject = () => ({ ...doc });
    return doc;
  };

  // Consulta encadeável que APLICA sort/skip/limit de verdade — sem isso a
  // paginação do controller passaria despercebida nos testes.
  const consulta = resultado => {
    let itens = resultado;
    let ordem = null, pular = 0, teto = null;

    const resolver = () => {
      if (!Array.isArray(itens)) return itens;
      let saida = itens.slice();
      if (ordem) {
        const [campo, dir] = Object.entries(ordem)[0];
        saida.sort((a, b) => {
          const va = a[campo], vb = b[campo];
          const cmp = va > vb ? 1 : va < vb ? -1 : 0;
          return dir < 0 ? -cmp : cmp;
        });
      }
      if (pular) saida = saida.slice(pular);
      if (teto !== null) saida = saida.slice(0, teto);
      return saida;
    };

    const q = {
      sort: (o) => { ordem = o; return q; },
      skip: (n) => { pular = n || 0; return q; },
      limit: (n) => { teto = n ?? null; return q; },
      select: () => q, populate: () => q, lean: () => q,
      then: (res, rej) => Promise.resolve(resolver()).then(res, rej),
    };
    return q;
  };

  return {
    _dados: () => db[colecao],
    create: jest.fn(async (dados) => {
      const arr = Array.isArray(dados) ? dados : [dados];
      const criados = arr.map(d => {
        if (colecao === 'settings' && db.settings.some(s => s.key === d.key)) {
          const e = new Error('duplicate key'); e.code = 11000; throw e;
        }
        const doc = encaixar({ _id: oid(), ...d });
        db[colecao].push(doc);
        return doc;
      });
      return Array.isArray(dados) ? criados : criados[0];
    }),
    insertMany: jest.fn(async (docs) => {
      const criados = docs.map(d => encaixar({ _id: oid(), ...d }));
      db[colecao].push(...criados);
      return criados;
    }),
    find: jest.fn((filtro = {}) => consulta(db[colecao].filter(d => _combina(d, filtro)))),
    findOne: jest.fn((filtro = {}) => consulta(db[colecao].find(d => _combina(d, filtro)) || null)),
    findById: jest.fn(async (id) => db[colecao].find(d => String(d._id) === String(id)) || null),
    findOneAndUpdate: jest.fn(async (filtro, update) => {
      const doc = db[colecao].find(d => _combina(d, filtro));
      if (doc) _aplicarUpdate(doc, update);
      return doc || null;
    }),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      const doc = db[colecao].find(d => String(d._id) === String(id));
      if (doc) _aplicarUpdate(doc, update);
      return doc || null;
    }),
    updateOne: jest.fn(async (filtro, update) => {
      const doc = db[colecao].find(d => _combina(d, filtro));
      if (doc) _aplicarUpdate(doc, update);
      return { modifiedCount: doc ? 1 : 0 };
    }),
    countDocuments: jest.fn(async (filtro = {}) => db[colecao].filter(d => _combina(d, filtro)).length),
    updateMany: jest.fn(async (filtro, update) => {
      const alvos = db[colecao].filter(d => _combina(d, filtro));
      alvos.forEach(d => Object.assign(d, update.$set || {}));
      return { modifiedCount: alvos.length };
    }),
    deleteMany: jest.fn(async (filtro = {}) => {
      const antes = db[colecao].length;
      db[colecao] = db[colecao].filter(d => !_combina(d, filtro));
      return { deletedCount: antes - db[colecao].length };
    }),
    deleteOne: jest.fn(async (filtro = {}) => {
      const i = db[colecao].findIndex(d => _combina(d, filtro));
      if (i >= 0) db[colecao].splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
    // Lê o campo de agrupamento do PIPELINE em vez de assumir `status`: a
    // contagem de comentários agrupa por `commentStatus`, e um campo fixo aqui
    // devolveria os grupos de publicação e o teste passaria medindo a coisa errada.
    aggregate: jest.fn(async (pipeline) => {
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
        _id: _id === 'null' || _id === 'undefined' ? null : _id,
        total,
      }));
    }),
  };
}

// A partir da fase 8 o controller enfileira de verdade. Sem duplar a fila, o
// require puxaria BullMQ + ioredis e abriria conexao real com o Redis — a suite
// travaria esperando a conexao em vez de falhar.
const mockFila = new Map();
jest.mock('../src/queue/postQueue', () => ({
  add: jest.fn(async (nome, dados, opts = {}) => {
    if (mockFila.has(opts.jobId)) return mockFila.get(opts.jobId);
    const job = {
      id: opts.jobId, nome, data: dados, opts,
      getState: async () => 'delayed',
      remove:   async () => { mockFila.delete(opts.jobId); },
    };
    mockFila.set(opts.jobId, job);
    return job;
  }),
  getJob: jest.fn(async id => mockFila.get(id) || null),
}));

jest.mock('../src/models/Campaign',            () => mockCriarModel('campaigns'));
jest.mock('../src/models/CampaignPublication', () => mockCriarModel('publications'));
jest.mock('../src/models/Account',             () => mockCriarModel('accounts', false));
jest.mock('../src/models/Media',               () => mockCriarModel('medias', false));
jest.mock('../src/models/Setting',             () => mockCriarModel('settings', false));

const ctrl = require('../src/controllers/campaignController');

/* ── Helpers de requisição ─────────────────────────────────────────────────── */

function fakeRes() {
  const res = {
    statusCode: 200,
    corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.corpo = o; return this; },
  };
  return res;
}

const req = (over = {}) => ({
  params: {}, query: {}, body: {},
  get: () => undefined,
  ...over,
});

async function chamar(handler, opcoes) {
  const res = fakeRes();
  await handler(req(opcoes), res);
  return res;
}

/* ── Sementes ──────────────────────────────────────────────────────────────── */

let CONTAS, MIDIAS;

function semear({ contas = 4, midias = 4 } = {}) {
  db.campaigns = []; db.publications = []; db.accounts = []; db.medias = []; db.settings = [];
  mockFila.clear();

  CONTAS = Array.from({ length: contas }, (_, i) => ({
    _id: oid(), username: `conta0${i + 1}`, name: `Conta ${i + 1}`,
    provider: i % 2 ? 'instagrapi' : 'official',
    healthStatus: 'ativa', postsToday: 0, dailyPostLimit: 20,
    // Campos sensíveis propositalmente presentes: os testes verificam que NÃO vazam.
    password: 'segredo123', accessToken: 'TOKEN_SECRETO', totpSecret: 'TOTP',
    instagrapiSession: 'BLOB', proxy: 'http://user:pass@proxy:8080',
  }));
  MIDIAS = Array.from({ length: midias }, (_, i) => ({
    _id: oid(), filename: `video0${i + 1}.mp4`, originalName: `Video ${i + 1}`,
    url: `/uploads/video0${i + 1}.mp4`, type: 'video', folder: 'default',
  }));
  db.accounts.push(...CONTAS);
  db.medias.push(...MIDIAS);
}

const payload = (over = {}) => ({
  name: 'Campanha Reels Agosto',
  accountIds: CONTAS.map(c => String(c._id)),
  contentIds: MIDIAS.map(m => String(m._id)),
  strategy: { mode: 'interleaved_random', seed: 'teste-fixo' },
  schedule: { intervalMinMinutes: 12, intervalMaxMinutes: 28 },
  ...over,
});

const criar = (over = {}) => chamar(ctrl.create, { body: payload(over) });

beforeEach(() => { semear(); jest.clearAllMocks(); });

/* ── 1 a 10 — criação ──────────────────────────────────────────────────────── */

describe('POST /campaigns — criação', () => {
  test('cria campanha válida e materializa 4×4 = 16 publicações', async () => {
    const res = await criar();
    expect(res.statusCode).toBe(201);
    expect(res.corpo.campaign.name).toBe('Campanha Reels Agosto');
    expect(db.publications).toHaveLength(16);
  });

  test('campanha nasce em scheduled com contadores corretos', async () => {
    const res = await criar();
    expect(res.corpo.campaign.status).toBe('scheduled');
    expect(res.corpo.campaign.totalPublications).toBe(16);
    expect(res.corpo.campaign.pendingPublications).toBe(16);
    expect(res.corpo.campaign.publishedPublications).toBe(0);
    expect(res.corpo.campaign.failedPublications).toBe(0);
  });

  test('publicações nascem scheduled e sem job na fila', async () => {
    await criar();
    for (const p of db.publications) {
      expect(p.status).toBe('scheduled');
      expect(p.bullMqJobId || '').toBe('');   // fase 8 é quem enfileira
    }
  });

  test('nome é obrigatório', async () => {
    const res = await criar({ name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.corpo.code).toBe('NAME_REQUIRED');
  });

  test('conta inexistente devolve ACCOUNT_NOT_FOUND com os ids', async () => {
    const fantasma = String(oid());
    const res = await criar({ accountIds: [String(CONTAS[0]._id), fantasma] });
    expect(res.statusCode).toBe(404);
    expect(res.corpo.code).toBe('ACCOUNT_NOT_FOUND');
    expect(res.corpo.missingIds).toContain(fantasma);
  });

  test('conteúdo inexistente devolve CONTENT_NOT_FOUND', async () => {
    const fantasma = String(oid());
    const res = await criar({ contentIds: [String(MIDIAS[0]._id), fantasma] });
    expect(res.statusCode).toBe(404);
    expect(res.corpo.code).toBe('CONTENT_NOT_FOUND');
    expect(res.corpo.missingIds).toContain(fantasma);
  });

  test('conta banida não pode participar', async () => {
    db.accounts[1].healthStatus = 'banida';
    const res = await criar();
    expect(res.statusCode).toBe(409);
    expect(res.corpo.code).toBe('ACCOUNT_NOT_ELIGIBLE');
  });

  test('funciona com provider official e instagrapi juntos', async () => {
    const res = await criar();
    expect(res.statusCode).toBe(201);
    const providers = new Set(CONTAS.map(c => c.provider));
    expect(providers.size).toBe(2);          // a semente tem os dois
  });

  test('estratégia inválida é rejeitada', async () => {
    const res = await criar({ strategy: { mode: 'caotico' } });
    expect(res.statusCode).toBe(400);
    expect(res.corpo.code).toBe('INVALID_STRATEGY');
  });

  test('intervalo invertido é rejeitado', async () => {
    const res = await criar({ schedule: { intervalMinMinutes: 30, intervalMaxMinutes: 5 } });
    expect(res.corpo.code).toBe('INVALID_INTERVAL');
  });

  test('janela invertida é rejeitada', async () => {
    const res = await criar({ schedule: { windowStart: '22:00', windowEnd: '08:00' } });
    expect(res.corpo.code).toBe('INVALID_WINDOW');
  });

  test('weekdays fora de 0..6 é rejeitado', async () => {
    const res = await criar({ schedule: { weekdays: [1, 9] } });
    expect(res.corpo.code).toBe('INVALID_WEEKDAYS');
  });

  test('startAt inválido é rejeitado', async () => {
    const res = await criar({ schedule: { startAt: 'ontem' } });
    expect(res.corpo.code).toBe('INVALID_START_AT');
  });

  test('lista de contas vazia é rejeitada', async () => {
    const res = await criar({ accountIds: [] });
    expect(res.corpo.code).toBe('NO_ACCOUNTS');
  });

  test('nenhuma duplicação conta+conteúdo no plano', async () => {
    await criar();
    const chaves = db.publications.map(p => `${p.accountId}|${p.contentId}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  test('todas as contas no limite diário → EMPTY_PLAN, nada é criado', async () => {
    db.accounts.forEach(c => { c.postsToday = 20; });
    const res = await criar();
    expect(res.corpo.code).toBe('EMPTY_PLAN');
    expect(db.campaigns).toHaveLength(0);
    expect(db.publications).toHaveLength(0);
  });

  test('rollback: falha ao gravar o plano não deixa campanha órfã', async () => {
    const CampaignPublication = require('../src/models/CampaignPublication');
    CampaignPublication.insertMany.mockRejectedValueOnce(new Error('disco cheio'));

    const res = await criar();
    expect(res.statusCode).toBe(500);
    expect(res.corpo.code).toBe('PLAN_PERSIST_FAILED');
    expect(db.campaigns).toHaveLength(0);     // compensação removeu a campanha
    expect(db.publications).toHaveLength(0);
  });
});

/* ── Fase 6 — legendas por conta / conteúdo / combinação ───────────────────── */

describe('legendas materializadas no plano', () => {
  const legendaDe = (accountId, contentId) => {
    const p = db.publications.find(
      x => String(x.accountId) === String(accountId) && String(x.contentId) === String(contentId)
    );
    return p?.captionTemplate;
  };

  test('modo global aplica o mesmo texto a todas', async () => {
    await criar({ captionMode: 'global', captions: { global: 'Texto único' } });
    expect(db.publications.every(p => p.captionTemplate === 'Texto único')).toBe(true);
  });

  test('modo por conta: cada conta leva o seu, o resto cai na geral', async () => {
    const conta2 = String(CONTAS[1]._id);
    await criar({
      captionMode: 'per_account',
      captions: { global: 'GERAL', byAccount: { [conta2]: 'DA CONTA 2' } },
    });

    for (const p of db.publications) {
      const esperado = String(p.accountId) === conta2 ? 'DA CONTA 2' : 'GERAL';
      expect(p.captionTemplate).toBe(esperado);
    }
  });

  test('modo por conteúdo: cada mídia leva a sua', async () => {
    const midia3 = String(MIDIAS[2]._id);
    await criar({
      captionMode: 'per_content',
      captions: { global: 'GERAL', byContent: { [midia3]: 'DO VIDEO 3' } },
    });

    for (const p of db.publications) {
      const esperado = String(p.contentId) === midia3 ? 'DO VIDEO 3' : 'GERAL';
      expect(p.captionTemplate).toBe(esperado);
    }
  });

  test('conta+conteúdo tem prioridade sobre conta e sobre conteúdo', async () => {
    const c1 = String(CONTAS[0]._id);
    const m1 = String(MIDIAS[0]._id);
    const m2 = String(MIDIAS[1]._id);

    await criar({
      captionMode: 'per_account_content',
      captions: {
        global:           'GERAL',
        byAccount:        { [c1]: 'DA CONTA' },
        byContent:        { [m1]: 'DO CONTEUDO' },
        byAccountContent: { [`${c1}__${m1}`]: 'ESPECIFICA' },
      },
    });

    expect(legendaDe(c1, m1)).toBe('ESPECIFICA');   // combinação vence
    expect(legendaDe(c1, m2)).toBe('DA CONTA');     // conta vence conteúdo/geral
    expect(legendaDe(String(CONTAS[1]._id), m1)).toBe('DO CONTEUDO');
    expect(legendaDe(String(CONTAS[1]._id), m2)).toBe('GERAL');
  });

  test('o template fica BRUTO e o texto materializado é gravado ao lado', async () => {
    await criar({
      name: 'Campanha Reels Agosto',
      captionMode: 'global',
      captions: { global: 'Olá @{username} — {campaign}' },
    });

    const p = db.publications[0];

    // O template preserva as marcações: é ele que a execução reresolve, para o
    // texto acompanhar um username que tenha mudado depois do planejamento.
    expect(p.captionTemplate).toBe('Olá @{username} — {campaign}');

    // E o texto materializado já existe desde a criação. Sem ele o painel
    // mostraria "{username}" como legenda, e a execução — que usa este campo
    // como reserva — publicaria com legenda vazia.
    expect(p.resolvedCaption).toMatch(/^Olá @conta0\d — Campanha Reels Agosto$/);
    expect(p.resolvedCaption).not.toContain('{');
  });

  test('cada publicação materializa o texto com os SEUS dados', async () => {
    await criar({ captionMode: 'global', captions: { global: 'De {username}' } });

    for (const p of db.publications) {
      const conta = CONTAS.find(c => String(c._id) === String(p.accountId));
      expect(p.resolvedCaption).toBe(`De ${conta.username}`);
    }
  });

  test('comentário por conta também é materializado', async () => {
    const conta3 = String(CONTAS[2]._id);
    await criar({
      commentMode: 'per_account',
      comments: { global: 'padrão 👇', byAccount: { [conta3]: 'só da 3' } },
    });

    for (const p of db.publications) {
      const esperado = String(p.accountId) === conta3 ? 'só da 3' : 'padrão 👇';
      expect(p.commentTemplate).toBe(esperado);
    }
  });
});

/* ── 7 — timezone ──────────────────────────────────────────────────────────── */

describe('timezone', () => {
  test('processo roda em America/Sao_Paulo', () => {
    // Definido no docker-compose e em jest.setup para os testes.
    expect(process.env.TZ).toBe('America/Sao_Paulo');
  });

  test('janela é interpretada no fuso local, não em UTC', async () => {
    const res = await criar({
      schedule: {
        intervalMinMinutes: 30, intervalMaxMinutes: 30,
        windowStart: '18:00', windowEnd: '23:00',
        startAt: new Date('2026-09-01T10:00:00'),   // antes da janela
      },
    });
    expect(res.statusCode).toBe(201);
    const primeira = db.publications.sort((a, b) => a.order - b.order)[0];
    expect(new Date(primeira.scheduledAt).getHours()).toBe(18);
  });

  test('nenhuma publicação cai fora da janela', async () => {
    await criar({
      schedule: {
        intervalMinMinutes: 45, intervalMaxMinutes: 90,
        windowStart: '08:00', windowEnd: '23:00',
        startAt: new Date('2026-09-01T08:00:00'),
      },
    });
    for (const p of db.publications) {
      const h = new Date(p.scheduledAt).getHours();
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThanOrEqual(23);
    }
  });
});

/* ── 11 a 16 — listagem e detalhe ──────────────────────────────────────────── */

describe('GET /campaigns', () => {
  test('lista com paginação', async () => {
    await criar({ name: 'Alpha' });
    await criar({ name: 'Beta' });
    const res = await chamar(ctrl.list, { query: { page: 1, limit: 1 } });
    expect(res.corpo.campaigns).toHaveLength(1);
    expect(res.corpo.pagination).toMatchObject({ page: 1, limit: 1, total: 2, pages: 2 });
  });

  test('filtra por status', async () => {
    await criar();
    const res = await chamar(ctrl.list, { query: { status: 'scheduled' } });
    expect(res.corpo.campaigns.length).toBeGreaterThan(0);
    const vazio = await chamar(ctrl.list, { query: { status: 'completed' } });
    expect(vazio.corpo.campaigns).toHaveLength(0);
  });

  test('busca por nome', async () => {
    await criar({ name: 'Campanha Alpha' });
    await criar({ name: 'Outra Beta' });
    const res = await chamar(ctrl.list, { query: { search: 'alpha' } });
    expect(res.corpo.campaigns).toHaveLength(1);
  });

  test('busca com caractere especial não quebra a regex', async () => {
    await criar({ name: 'Promo (2026)' });
    const res = await chamar(ctrl.list, { query: { search: '(2026)' } });
    expect(res.corpo.campaigns).toHaveLength(1);
  });

  test('detalhe traz estatísticas e progresso', async () => {
    const criada = await criar();
    const id = criada.corpo.campaign._id;
    const res = await chamar(ctrl.get, { params: { id } });

    expect(res.corpo.statistics.total).toBe(16);
    expect(res.corpo.statistics.scheduled).toBe(16);
    expect(res.corpo.progress).toMatchObject({ done: 0, total: 16, percentage: 0 });
    expect(res.corpo.schedule).toBeDefined();
  });

  test('estatísticas vêm das publicações, não do contador desnormalizado', async () => {
    const criada = await criar();
    const id = criada.corpo.campaign._id;
    // Contador mente de propósito; a agregação precisa ignorá-lo.
    db.campaigns[0].totalPublications = 999;
    const res = await chamar(ctrl.get, { params: { id } });
    expect(res.corpo.statistics.total).toBe(16);
  });

  test('campanha inexistente devolve 404', async () => {
    const res = await chamar(ctrl.get, { params: { id: String(oid()) } });
    expect(res.statusCode).toBe(404);
    expect(res.corpo.code).toBe('CAMPAIGN_NOT_FOUND');
  });

  /* ── Fase 9: dados que o painel precisa ─────────────────────────────────── */

  test('detalhe traz contagem de comentários agrupada por commentStatus', async () => {
    const criada = await criar({ commentMode: 'global', comments: { global: 'Link na bio' } });
    const id = criada.corpo.campaign._id;

    // Estados variados, como numa campanha em andamento.
    db.publications[0].commentStatus = 'posted';
    db.publications[1].commentStatus = 'posted';
    db.publications[2].commentStatus = 'scheduled';
    db.publications[3].commentStatus = 'failed';

    const res = await chamar(ctrl.get, { params: { id } });

    expect(res.corpo.commentStatistics).toMatchObject({ posted: 2, scheduled: 1, failed: 1 });

    // `total` conta quem TEM comentário configurado (pelo template), não quem já
    // saiu do estado 'none'. Contar por commentStatus daria 0 numa campanha
    // recém-criada e o painel diria "não publica comentários" — para uma
    // campanha que publica.
    expect(res.corpo.commentStatistics.total).toBe(16);
    // Os 12 restantes ainda não foram agendados: o post não saiu.
    expect(res.corpo.commentStatistics.pending).toBe(12);
  });

  test('campanha recém-criada já mostra os comentários que vai publicar', async () => {
    // Regressão: antes o total vinha de commentStatus, que só sai de 'none'
    // depois de publicar — a tela anunciava "sem comentários" antes de começar.
    const criada = await criar({ commentMode: 'global', comments: { global: 'Link na bio' } });
    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });

    expect(res.corpo.commentStatistics.total).toBe(16);
    expect(res.corpo.commentStatistics.posted).toBe(0);
    expect(res.corpo.commentStatistics.pending).toBe(16);
  });

  test('campanha sem comentários devolve total 0', async () => {
    const criada = await criar();
    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });
    expect(res.corpo.commentStatistics.total).toBe(0);
  });

  test('contagem de comentários é independente do status da publicação', async () => {
    const criada = await criar({ commentMode: 'global', comments: { global: 'x' } });
    // Publicação concluída com comentário ainda pendente — estados separados.
    db.publications[0].status = 'published';
    db.publications[0].commentStatus = 'scheduled';

    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });

    expect(res.corpo.statistics.published).toBe(1);
    expect(res.corpo.commentStatistics.scheduled).toBe(1);
    expect(res.corpo.commentStatistics.posted).toBe(0);
  });

  test('detalhe aponta a próxima publicação pendente, pela ordem de horário', async () => {
    const criada = await criar();
    const id = criada.corpo.campaign._id;

    const porHorario = [...db.publications].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    // As três primeiras já saíram: a próxima tem de ser a quarta.
    porHorario.slice(0, 3).forEach(p => { p.status = 'published'; });

    const res = await chamar(ctrl.get, { params: { id } });

    expect(res.corpo.nextPublication).toBeTruthy();
    expect(String(res.corpo.nextPublication._id)).toBe(String(porHorario[3]._id));
    expect(res.corpo.nextPublication.status).toBe('scheduled');
  });

  test('próxima publicação vem com conta, conteúdo e legenda materializada', async () => {
    const criada = await criar({ captions: { global: 'Confira @{username}' } });
    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });

    const p = res.corpo.nextPublication;
    expect(p.account).toBeTruthy();
    expect(p.content).toBeTruthy();
    // Texto materializado: a marcação já foi resolvida pelo planner.
    expect(p.resolvedCaption).toMatch(/^Confira @conta0\d$/);
    // Nunca a senha nem a URL do proxy da conta.
    expect(JSON.stringify(p)).not.toContain('segredo123');
    expect(JSON.stringify(p)).not.toContain('user:pass');
  });

  test('sem pendentes, a próxima publicação é nula', async () => {
    const criada = await criar();
    db.publications.forEach(p => { p.status = 'published'; });

    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });
    expect(res.corpo.nextPublication).toBeNull();
  });

  test('publicação em processamento também conta como próxima', async () => {
    const criada = await criar();
    const porHorario = [...db.publications].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    porHorario[0].status = 'processing';

    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });
    expect(String(res.corpo.nextPublication._id)).toBe(String(porHorario[0]._id));
  });

  test('canceladas e falhadas não entram como próxima', async () => {
    const criada = await criar();
    const porHorario = [...db.publications].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    porHorario[0].status = 'cancelled';
    porHorario[1].status = 'failed';

    const res = await chamar(ctrl.get, { params: { id: criada.corpo.campaign._id } });
    expect(String(res.corpo.nextPublication._id)).toBe(String(porHorario[2]._id));
  });
});

/* ── 17 a 20 — publicações ─────────────────────────────────────────────────── */

describe('GET /campaigns/:id/publications', () => {
  let campanhaId;
  beforeEach(async () => { campanhaId = (await criar()).corpo.campaign._id; });

  test('lista ordenada por horário', async () => {
    const res = await chamar(ctrl.listPublications, { params: { id: campanhaId } });
    expect(res.corpo.publications).toHaveLength(16);
    const horarios = res.corpo.publications.map(p => new Date(p.scheduledAt).getTime());
    expect([...horarios].sort((a, b) => a - b)).toEqual(horarios);
  });

  test('filtra por conta', async () => {
    const contaId = String(CONTAS[0]._id);
    const res = await chamar(ctrl.listPublications, {
      params: { id: campanhaId }, query: { accountId: contaId },
    });
    expect(res.corpo.publications).toHaveLength(4);
  });

  test('filtra por conteúdo', async () => {
    const res = await chamar(ctrl.listPublications, {
      params: { id: campanhaId }, query: { contentId: String(MIDIAS[0]._id) },
    });
    expect(res.corpo.publications).toHaveLength(4);
  });

  test('filtra por status', async () => {
    const res = await chamar(ctrl.listPublications, {
      params: { id: campanhaId }, query: { status: 'published' },
    });
    expect(res.corpo.publications).toHaveLength(0);
  });

  test('detalhe de uma publicação', async () => {
    const pubId = String(db.publications[0]._id);
    const res = await chamar(ctrl.getPublication, {
      params: { id: campanhaId, publicationId: pubId },
    });
    expect(res.corpo.publication._id).toBeDefined();
    expect(res.corpo.publication.order).toBeGreaterThan(0);
    expect(res.corpo.campaign).toBeDefined();
  });

  test('publicação de outra campanha devolve 404', async () => {
    const res = await chamar(ctrl.getPublication, {
      params: { id: campanhaId, publicationId: String(oid()) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.corpo.code).toBe('PUBLICATION_NOT_FOUND');
  });
});

/* ── 21 a 25 — máquina de estados ──────────────────────────────────────────── */

describe('controle de estado', () => {
  let id;
  beforeEach(async () => { id = (await criar()).corpo.campaign._id; });

  test('start enfileira uma publicação por job, sem publicar nada', async () => {
    const res = await chamar(ctrl.start, { params: { id } });
    expect(res.corpo.campaign.status).toBe('scheduled');
    expect(res.corpo.scheduled).toBe(16);

    // Um job por publicação — não um job guarda-chuva da campanha.
    expect(mockFila.size).toBe(16);
    expect(db.publications.every(p => !!p.bullMqJobId)).toBe(true);

    // Enfileirar não é publicar: nada foi ao Instagram.
    expect(db.publications.every(p => p.status === 'scheduled')).toBe(true);
    expect(db.publications.every(p => !p.publishedAt)).toBe(true);
  });

  test('start duas vezes não duplica os jobs', async () => {
    await chamar(ctrl.start, { params: { id } });
    const segundo = await chamar(ctrl.start, { params: { id } });

    expect(mockFila.size).toBe(16);
    expect(segundo.corpo.scheduled).toBe(0);
    expect(segundo.corpo.alreadyQueued).toBe(16);
  });

  test('pause muda estado sem apagar publicações', async () => {
    const res = await chamar(ctrl.pause, { params: { id } });
    expect(res.corpo.campaign.status).toBe('paused');
    expect(db.publications).toHaveLength(16);
  });

  test('resume volta para scheduled sem recriar publicações', async () => {
    await chamar(ctrl.pause, { params: { id } });
    const res = await chamar(ctrl.resume, { params: { id } });
    expect(res.corpo.campaign.status).toBe('scheduled');
    expect(db.publications).toHaveLength(16);
  });

  test('resume só funciona a partir de paused', async () => {
    const res = await chamar(ctrl.resume, { params: { id } });
    expect(res.statusCode).toBe(409);
    expect(res.corpo.code).toBe('INVALID_CAMPAIGN_STATE');
  });

  test('cancel encerra e cancela pendentes, preservando histórico', async () => {
    db.publications[0].status = 'published';
    db.publications[1].status = 'failed';

    const res = await chamar(ctrl.cancel, { params: { id } });
    expect(res.corpo.campaign.status).toBe('cancelled');
    expect(res.corpo.cancelled).toBe(14);

    expect(db.publications[0].status).toBe('published');  // histórico intacto
    expect(db.publications[1].status).toBe('failed');
    expect(db.publications).toHaveLength(16);             // nada apagado
  });

  test('transição inválida é recusada: cancelada não volta a rodar', async () => {
    await chamar(ctrl.cancel, { params: { id } });
    const res = await chamar(ctrl.pause, { params: { id } });
    expect(res.statusCode).toBe(409);
    expect(res.corpo.code).toBe('INVALID_CAMPAIGN_STATE');
  });

  test('start recusa campanha sem publicações executáveis', async () => {
    db.publications.forEach(p => { p.status = 'published'; });
    const res = await chamar(ctrl.start, { params: { id } });
    expect(res.corpo.code).toBe('EMPTY_PLAN');
  });
});

/* ── 26 a 28 — retry e cancel ──────────────────────────────────────────────── */

describe('retry e cancelamento individual', () => {
  let id;
  beforeEach(async () => { id = (await criar()).corpo.campaign._id; });

  test('retry-failed reprograma falhas sem criar registros', async () => {
    db.publications[0].status = 'failed';
    db.publications[1].status = 'failed';
    db.publications[0].attempts = 2;

    const res = await chamar(ctrl.retryFailed, { params: { id } });
    expect(res.corpo.retried).toBe(2);
    expect(db.publications).toHaveLength(16);            // nada duplicado
    expect(db.publications[0].status).toBe('scheduled');
    expect(db.publications[0].attempts).toBe(2);         // histórico preservado
  });

  test('retry-failed em campanha cancelada é recusado', async () => {
    await chamar(ctrl.cancel, { params: { id } });
    const res = await chamar(ctrl.retryFailed, { params: { id } });
    expect(res.statusCode).toBe(409);
  });

  test('retry individual reaproveita a linha e mantém attempts', async () => {
    const pub = db.publications[0];
    pub.status = 'failed'; pub.attempts = 3; pub.error = 'timeout';

    const res = await chamar(ctrl.retryPublication, {
      params: { id, publicationId: String(pub._id) },
    });
    expect(res.corpo.publication.status).toBe('scheduled');
    expect(res.corpo.publication.attempts).toBe(3);
    expect(res.corpo.publication.error).toBe('');
    expect(db.publications).toHaveLength(16);
  });

  test('retry individual recusa publicação que não falhou', async () => {
    const res = await chamar(ctrl.retryPublication, {
      params: { id, publicationId: String(db.publications[0]._id) },
    });
    expect(res.corpo.code).toBe('INVALID_PUBLICATION_STATE');
  });

  test('cancel individual não afeta a campanha nem as outras', async () => {
    const pub = db.publications[0];
    const res = await chamar(ctrl.cancelPublication, {
      params: { id, publicationId: String(pub._id) },
    });

    expect(res.corpo.publication.status).toBe('cancelled');
    expect(db.campaigns[0].status).toBe('scheduled');           // campanha intacta
    expect(db.publications.filter(p => p.status === 'scheduled')).toHaveLength(15);
  });

  test('cancel individual recusa publicação já publicada', async () => {
    db.publications[0].status = 'published';
    const res = await chamar(ctrl.cancelPublication, {
      params: { id, publicationId: String(db.publications[0]._id) },
    });
    expect(res.corpo.code).toBe('INVALID_PUBLICATION_STATE');
  });
});

/* ── 29 — segurança ────────────────────────────────────────────────────────── */

describe('segurança das respostas', () => {
  const SEGREDOS = ['segredo123', 'TOKEN_SECRETO', 'TOTP', 'BLOB', 'user:pass@proxy'];

  const semSegredos = obj => {
    const texto = JSON.stringify(obj);
    for (const s of SEGREDOS) expect(texto).not.toContain(s);
    for (const campo of ['password', 'accessToken', 'totpSecret', 'instagrapiSession', 'igSession']) {
      expect(texto).not.toContain(`"${campo}"`);
    }
  };

  test('criação não vaza segredo', async () => {
    semSegredos((await criar()).corpo);
  });

  test('listagem e detalhe não vazam segredo', async () => {
    const id = (await criar()).corpo.campaign._id;
    semSegredos((await chamar(ctrl.list, {})).corpo);
    semSegredos((await chamar(ctrl.get, { params: { id } })).corpo);
  });

  test('publicações populadas não vazam segredo da conta', async () => {
    const id = (await criar()).corpo.campaign._id;
    // Simula o populate devolvendo o documento completo da conta.
    db.publications.forEach(p => {
      p.accountId = CONTAS[0];
      p.contentId = MIDIAS[0];
    });
    const res = await chamar(ctrl.listPublications, { params: { id } });
    semSegredos(res.corpo);
    // ...mas os dados úteis continuam presentes.
    expect(res.corpo.publications[0].account.username).toBe('conta01');
    expect(res.corpo.publications[0].account.hasProxy).toBe(true);
  });
});

/* ── 30 a 32 — entidades removidas e casos-limite ──────────────────────────── */

describe('entidades removidas', () => {
  test('retry recusa quando o conteúdo foi removido', async () => {
    const id = (await criar()).corpo.campaign._id;
    const pub = db.publications[0];
    pub.status = 'failed';
    pub.accountId = CONTAS[0];
    pub.contentId = null;                    // mídia apagada depois do plano

    const res = await chamar(ctrl.retryPublication, {
      params: { id, publicationId: String(pub._id) },
    });
    expect(res.corpo.code).toBe('CONTENT_NOT_FOUND');
  });

  test('retry recusa quando a conta foi removida', async () => {
    const id = (await criar()).corpo.campaign._id;
    const pub = db.publications[0];
    pub.status = 'failed';
    pub.accountId = null;
    pub.contentId = MIDIAS[0];

    const res = await chamar(ctrl.retryPublication, {
      params: { id, publicationId: String(pub._id) },
    });
    expect(res.corpo.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('delete remove campanha e suas publicações', async () => {
    const id = (await criar()).corpo.campaign._id;
    await chamar(ctrl.remove, { params: { id } });
    expect(db.campaigns).toHaveLength(0);
    expect(db.publications).toHaveLength(0);
  });
});

/* ── 33 — idempotência ─────────────────────────────────────────────────────── */

describe('idempotência', () => {
  const comChave = (chave, over = {}) => {
    const res = fakeRes();
    return ctrl.create(
      { params: {}, query: {}, body: payload(over), get: (h) => (h === 'Idempotency-Key' ? chave : undefined) },
      res
    ).then(() => res);
  };

  test('mesma Idempotency-Key não cria duas campanhas', async () => {
    const primeira = await comChave('abc-123');
    const segunda  = await comChave('abc-123');

    expect(primeira.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.corpo.idempotent).toBe(true);
    expect(segunda.corpo.campaign._id).toEqual(primeira.corpo.campaign._id);
    expect(db.campaigns).toHaveLength(1);
  });

  test('chaves diferentes criam campanhas diferentes', async () => {
    await comChave('k1');
    await comChave('k2');
    expect(db.campaigns).toHaveLength(2);
  });

  test('sem header o comportamento antigo é preservado', async () => {
    await criar();
    await criar();
    expect(db.campaigns).toHaveLength(2);
  });

  test('falha na criação libera a chave para nova tentativa', async () => {
    const ruim = await comChave('k3', { name: '' });
    expect(ruim.statusCode).toBe(400);

    const bom = await comChave('k3');
    expect(bom.statusCode).toBe(201);         // chave reutilizável após erro
  });
});

/* ── 34 — compatibilidade ──────────────────────────────────────────────────── */

describe('compatibilidade', () => {
  test('criar a campanha não enfileira nem publica nada', async () => {
    await criar();
    // Criar só materializa o plano. O enfileiramento é do start (fase 8).
    for (const p of db.publications) {
      expect(p.bullMqJobId || '').toBe('');
      expect(['scheduled']).toContain(p.status);
      expect(p.publishedAt ?? null).toBeNull();
    }
    expect(mockFila.size).toBe(0);
  });

  test('rotas de campanha não tocam os models de Job e Post', () => {
    // O controller de campanha continua sem mexer no Job Engine do Postar/Loop.
    // A fila `posts` é COMPARTILHADA de propósito — não existe segunda fila —,
    // então enfileirar não é violação; importar Job.js ou Post.js seria.
    const fonte = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/controllers/campaignController.js'), 'utf8'
    );
    expect(fonte).not.toMatch(/models\/Job/);
    expect(fonte).not.toMatch(/models\/Post/);
  });
});
