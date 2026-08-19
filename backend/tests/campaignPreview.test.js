'use strict';

/**
 * Testes da fase 7 — variáveis, comentários por nível e prévia da campanha.
 *
 * Cobre três camadas:
 *
 *  - planner: o comentário é resolvido pelos QUATRO níveis, como a legenda.
 *    Esse era o ponto de falha real da fase: o planner já resolvia byContent e
 *    byAccountContent, mas o schema do Mongoose não os declarava e os
 *    descartava em silêncio, então os dois níveis nunca chegavam até aqui.
 *
 *  - model: o schema aceita e preserva os quatro níveis de comentário.
 *
 *  - API: /campaigns/variables e /campaigns/preview, com a prévia usando o
 *    mesmo resolvedor da execução e apontando problemas por publicação.
 */

const mongoose = require('mongoose');

const { generatePlan } = require('../src/services/publicationPlanner');
const { listarVariaveis } = require('../src/services/templateResolver');

const oid = () => new mongoose.Types.ObjectId();

/* ── Repositório em memória (mesmo padrão de campaignController.test.js) ────── */

const db = { campaigns: [], publications: [], accounts: [], medias: [], settings: [] };

function _combina(doc, filtro) {
  return Object.entries(filtro).every(([campo, cond]) => {
    const valor = doc[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof mongoose.Types.ObjectId)) {
      if (cond.$in) return cond.$in.map(String).includes(String(valor));
    }
    return String(valor) === String(cond);
  });
}

function mockCriarModel(colecao) {
  const consulta = resultado => {
    const q = {
      sort: () => q, skip: () => q, limit: () => q,
      select: () => q, populate: () => q, lean: () => q,
      then: (res, rej) => Promise.resolve(resultado).then(res, rej),
    };
    return q;
  };

  return {
    create:      jest.fn(async d => { const doc = { _id: oid(), ...d }; db[colecao].push(doc); return doc; }),
    insertMany:  jest.fn(async docs => docs.map(d => ({ _id: oid(), ...d }))),
    find:        jest.fn((f = {}) => consulta(db[colecao].filter(d => _combina(d, f)))),
    findOne:     jest.fn((f = {}) => consulta(db[colecao].find(d => _combina(d, f)) || null)),
    findById:    jest.fn(async id => db[colecao].find(d => String(d._id) === String(id)) || null),
    countDocuments: jest.fn(async (f = {}) => db[colecao].filter(d => _combina(d, f)).length),
    deleteMany:  jest.fn(async () => ({ deletedCount: 0 })),
    deleteOne:   jest.fn(async () => ({ deletedCount: 0 })),
    aggregate:   jest.fn(async () => []),
  };
}

jest.mock('../src/models/Campaign',            () => mockCriarModel('campaigns'));
jest.mock('../src/models/CampaignPublication', () => mockCriarModel('publications'));
jest.mock('../src/models/Account',             () => mockCriarModel('accounts'));
jest.mock('../src/models/Media',               () => mockCriarModel('medias'));
jest.mock('../src/models/Setting',             () => mockCriarModel('settings'));

const ctrl = require('../src/controllers/campaignController');
const svc  = require('../src/services/campaignService');

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function fakeRes() {
  return {
    statusCode: 200, corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.corpo = o; return this; },
  };
}

async function chamar(handler, body = {}) {
  const res = fakeRes();
  await handler({ params: {}, query: {}, body, get: () => undefined }, res);
  return res;
}

let CONTAS, MIDIAS;

function semear({ contas = 2, midias = 2 } = {}) {
  db.campaigns = []; db.publications = []; db.accounts = []; db.medias = []; db.settings = [];

  CONTAS = Array.from({ length: contas }, (_, i) => ({
    _id: oid(), username: `conta0${i + 1}`, name: `Conta ${i + 1}`,
    provider: 'instagrapi', healthStatus: 'ativa',
    postsToday: 0, dailyPostLimit: 20,
  }));
  MIDIAS = Array.from({ length: midias }, (_, i) => ({
    _id: oid(), filename: `video0${i + 1}.mp4`, originalName: `Video ${i + 1}`,
    url: `/uploads/video0${i + 1}.mp4`, type: 'video',
  }));
  db.accounts.push(...CONTAS);
  db.medias.push(...MIDIAS);
}

const payload = (over = {}) => ({
  name: 'Campanha 7',
  accountIds: CONTAS.map(c => String(c._id)),
  contentIds: MIDIAS.map(m => String(m._id)),
  strategy: { mode: 'sequential', seed: 'fixa' },
  schedule: { intervalMinMinutes: 10, intervalMaxMinutes: 10 },
  captionMode: 'global',
  captions: { global: 'Olá de {username}' },
  commentMode: 'disabled',
  comments: {},
  settings: { postType: 'reel', respectDailyLimit: false },
  ...over,
});

beforeEach(() => semear());

/* ── 1. Planner: comentário resolvido pelos quatro níveis ──────────────────── */

describe('planner — prioridade do comentário', () => {
  const plano = (comments, commentMode) => generatePlan({
    accounts: [{ id: 'acc1' }, { id: 'acc2' }],
    contents: [{ id: 'cnt1', name: 'v1' }, { id: 'cnt2', name: 'v2' }],
    strategy: { mode: 'sequential' },
    schedule: { intervalMin: 10, intervalMax: 10 },
    startAt: new Date('2026-09-01T18:00:00'),
    commentMode, comments,
  });

  const achar = (p, a, c) => p.find(x => x.accountId === a && x.contentId === c).commentTemplate;

  test('per_content escolhe pelo conteúdo, não pela conta', () => {
    const p = plano({ global: 'geral', byContent: { cnt2: 'do video 2' } }, 'per_content');
    expect(achar(p, 'acc1', 'cnt2')).toBe('do video 2');
    expect(achar(p, 'acc2', 'cnt2')).toBe('do video 2');
    expect(achar(p, 'acc1', 'cnt1')).toBe('geral');
  });

  test('per_account_content usa a chave composta com "__"', () => {
    const p = plano({ global: 'geral', byAccountContent: { acc2__cnt1: 'exceção' } }, 'per_account_content');
    expect(achar(p, 'acc2', 'cnt1')).toBe('exceção');
    expect(achar(p, 'acc1', 'cnt1')).toBe('geral');
  });

  test('conta+conteúdo tem precedência sobre conta, conteúdo e geral', () => {
    const p = plano({
      global:           'geral',
      byAccount:        { acc1: 'da conta' },
      byContent:        { cnt1: 'do conteudo' },
      byAccountContent: { acc1__cnt1: 'do par' },
    }, 'per_account_content');
    expect(achar(p, 'acc1', 'cnt1')).toBe('do par');
  });

  test('sem o nível mais específico, cai para o seguinte até o geral', () => {
    const comments = { global: 'geral', byAccount: { acc1: 'da conta' }, byContent: { cnt2: 'do conteudo' } };
    const p = plano(comments, 'per_account_content');
    expect(achar(p, 'acc1', 'cnt1')).toBe('da conta');     // conta
    expect(achar(p, 'acc2', 'cnt2')).toBe('do conteudo');  // conteúdo
    expect(achar(p, 'acc2', 'cnt1')).toBe('geral');        // geral
  });
});

/* ── 2. Model: os quatro níveis de comentário sobrevivem ao schema ─────────── */

describe('model Campaign — comentários', () => {
  // O model real, não o mock: é o schema que está sendo testado.
  const Campaign = jest.requireActual('../src/models/Campaign');

  test('byContent e byAccountContent não são descartados', () => {
    const a = String(oid()), c = String(oid());
    const doc = new Campaign({
      name: 'x',
      comments: {
        global: 'g',
        byAccount:        { [a]: 'conta' },
        byContent:        { [c]: 'conteudo' },
        byAccountContent: { [`${a}__${c}`]: 'par' },
      },
    });

    expect(doc.comments.byContent.get(c)).toBe('conteudo');
    expect(doc.comments.byAccountContent.get(`${a}__${c}`)).toBe('par');
  });

  test('commentMode aceita per_content e per_account_content', () => {
    for (const modo of ['per_content', 'per_account_content']) {
      const doc = new Campaign({ name: 'x', commentMode: modo });
      expect(doc.validateSync()?.errors?.commentMode).toBeUndefined();
    }
  });

  test('commentMode continua rejeitando valor desconhecido', () => {
    const doc = new Campaign({ name: 'x', commentMode: 'inventado' });
    expect(doc.validateSync()?.errors?.commentMode).toBeDefined();
  });

  test('delayMinutes tem padrão de 2 minutos', () => {
    expect(new Campaign({ name: 'x' }).comments.delayMinutes).toBe(2);
  });
});

/* ── 3. Serviço: os novos modos passam pela validação ──────────────────────── */

describe('campaignService — modos de comentário', () => {
  test('aceita per_content e per_account_content', async () => {
    for (const modo of ['per_content', 'per_account_content']) {
      const r = await svc.preverCampanha(payload({
        commentMode: modo, comments: { global: 'oi' },
      }));
      expect(r.summary.commentMode).toBe(modo);
    }
  });

  test('rejeita modo de comentário desconhecido', async () => {
    await expect(svc.preverCampanha(payload({ commentMode: 'nao_existe' })))
      .rejects.toMatchObject({ code: 'INVALID_COMMENT_MODE' });
  });
});

/* ── 4. GET /campaigns/variables ───────────────────────────────────────────── */

describe('GET /campaigns/variables', () => {
  test('devolve exatamente a lista do templateResolver', async () => {
    const res = await chamar(ctrl.variables);
    expect(res.corpo.variables).toEqual(listarVariaveis());
  });

  test('inclui as marcações que a interface oferece', async () => {
    const res = await chamar(ctrl.variables);
    for (const v of ['username', 'campaign', 'content', 'date', 'time']) {
      expect(res.corpo.variables).toContain(v);
    }
  });
});

/* ── 5. POST /campaigns/preview ────────────────────────────────────────────── */

describe('POST /campaigns/preview', () => {
  test('resolve as variáveis com os dados reais de cada conta', async () => {
    const res = await chamar(ctrl.preview, payload());
    expect(res.statusCode).toBe(200);

    const usuarios = CONTAS.map(c => c.username);
    for (const p of res.corpo.publications) {
      expect(usuarios).toContain(p.account.username);
      expect(p.resolvedCaption).toBe(`Olá de ${p.account.username}`);
    }
  });

  test('não persiste nada — é só planejamento', async () => {
    await chamar(ctrl.preview, payload());
    expect(db.campaigns).toHaveLength(0);
    expect(db.publications).toHaveLength(0);
  });

  test('o resumo conta contas, conteúdos e publicações do plano real', async () => {
    const res = await chamar(ctrl.preview, payload());
    expect(res.corpo.summary).toMatchObject({
      accounts: 2, contents: 2, publications: 4, invalid: 0, valid: 4,
    });
  });

  test('publicações saem ordenadas e com horário definido', async () => {
    const { corpo } = await chamar(ctrl.preview, payload());
    const ordens = corpo.publications.map(p => p.order);
    expect(ordens).toEqual([...ordens].sort((a, b) => a - b));
    for (const p of corpo.publications) expect(p.scheduledAt).toBeInstanceOf(Date);
  });

  test('legenda longa demais vira problema na publicação exata', async () => {
    const alvo = String(CONTAS[0]._id);
    const res = await chamar(ctrl.preview, payload({
      captionMode: 'per_account',
      captions: { global: 'curta', byAccount: { [alvo]: 'x'.repeat(2201) } },
    }));

    const ruins = res.corpo.publications.filter(p => p.problemas.length);
    expect(ruins).toHaveLength(2);                       // as 2 mídias dessa conta
    expect(ruins.every(p => p.account.id === alvo)).toBe(true);
    expect(ruins[0].problemas[0]).toMatchObject({ tipo: 'CAPTION_TOO_LONG', detalhe: '2201/2200' });
    expect(res.corpo.summary.invalid).toBe(2);
  });

  test('marcação inexistente é reportada e o texto preservado', async () => {
    const res = await chamar(ctrl.preview, payload({
      captions: { global: 'Compre {produto} agora' },
    }));

    const p = res.corpo.publications[0];
    expect(p.resolvedCaption).toBe('Compre {produto} agora');
    expect(p.problemas).toContainEqual({ tipo: 'UNRESOLVED_VARIABLE', detalhe: 'produto' });
  });

  test('comentário desativado não gera texto nem problema', async () => {
    const res = await chamar(ctrl.preview, payload({
      commentMode: 'disabled',
      comments: { global: 'x'.repeat(2201) },
    }));
    for (const p of res.corpo.publications) {
      expect(p.resolvedComment).toBe('');
      expect(p.problemas).toHaveLength(0);
    }
  });

  test('comentário ativo é resolvido e traz o atraso configurado', async () => {
    const res = await chamar(ctrl.preview, payload({
      commentMode: 'global',
      comments: { global: 'Link na bio, {username}', delayMinutes: 7 },
    }));

    const p = res.corpo.publications[0];
    expect(p.resolvedComment).toBe(`Link na bio, ${p.account.username}`);
    expect(p.commentDelayMinutes).toBe(7);
  });

  test('comentário longo demais é acusado separado da legenda', async () => {
    const res = await chamar(ctrl.preview, payload({
      commentMode: 'global',
      comments: { global: 'y'.repeat(2201) },
    }));
    const tipos = res.corpo.publications[0].problemas.map(p => p.tipo);
    expect(tipos).toContain('COMMENT_TOO_LONG');
    expect(tipos).not.toContain('CAPTION_TOO_LONG');
  });

  test('erro de validação vira resposta 4xx, não 500', async () => {
    const res = await chamar(ctrl.preview, payload({ accountIds: [] }));
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.corpo.code).toBeTruthy();
  });

  test('a prévia usa a mesma semente e reproduz o mesmo plano', async () => {
    const p = payload({ strategy: { mode: 'interleaved_random', seed: 'abc' } });
    const a = await chamar(ctrl.preview, p);
    const b = await chamar(ctrl.preview, p);

    const chave = r => r.corpo.publications.map(x => `${x.account.id}|${x.content.id}`).join(',');
    expect(chave(a)).toBe(chave(b));
  });
});
