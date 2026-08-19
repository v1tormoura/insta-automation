'use strict';

/**
 * Testes do PublicationPlanner e do templateResolver (fase 3).
 *
 * Rodam offline: o planner é puro por contrato — sem banco, sem fila, sem rede
 * e sem relógio (o instante inicial entra por parâmetro).
 */

const { generatePlan, PlannerError } = require('../src/services/publicationPlanner');
const { resolveTemplate, listarVariaveis } = require('../src/services/templateResolver');

const contas    = n => Array.from({ length: n }, (_, i) => ({ id: `acc${i + 1}` }));
const conteudos = n => Array.from({ length: n }, (_, i) => ({ id: `cnt${i + 1}`, name: `video0${i + 1}` }));

const INICIO = new Date('2026-09-01T18:00:00');   // terça-feira

const base = (extra = {}) => ({
  accounts: contas(4),
  contents: conteudos(4),
  strategy: { mode: 'interleaved_random', seed: 'campanha-123' },
  schedule: { intervalMin: 12, intervalMax: 28 },
  startAt:  INICIO,
  ...extra,
});

const par = p => `${p.accountId}|${p.contentId}`;

/* ── 1, 2, 6 — cobertura e ausência de duplicidade ─────────────────────────── */

describe('cobertura all_accounts_all_contents', () => {
  test('4 contas × 4 conteúdos = 16 publicações', () => {
    expect(generatePlan(base())).toHaveLength(16);
  });

  test('10 contas × 5 conteúdos = 50 publicações', () => {
    const plano = generatePlan(base({ accounts: contas(10), contents: conteudos(5) }));
    expect(plano).toHaveLength(50);
  });

  test('nenhuma combinação conta+conteúdo se repete', () => {
    for (const mode of ['interleaved_random', 'sequential', 'round_robin', 'account_first']) {
      const plano = generatePlan(base({ strategy: { mode, seed: 's' } }));
      const chaves = plano.map(par);
      expect(new Set(chaves).size).toBe(chaves.length);
    }
  });

  test('cada conta recebe todos os conteúdos', () => {
    const plano = generatePlan(base());
    for (const conta of contas(4)) {
      const meus = plano.filter(p => p.accountId === conta.id).map(p => p.contentId).sort();
      expect(meus).toEqual(['cnt1', 'cnt2', 'cnt3', 'cnt4']);
    }
  });

  test('order é sequencial a partir de 1', () => {
    const plano = generatePlan(base());
    expect(plano.map(p => p.order)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

/* ── 3, 4, 25 — determinismo por seed ──────────────────────────────────────── */

describe('seed determinística', () => {
  test('mesma seed produz exatamente o mesmo plano', () => {
    const a = generatePlan(base());
    const b = generatePlan(base());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('seeds diferentes produzem ordens diferentes', () => {
    const a = generatePlan(base({ strategy: { mode: 'interleaved_random', seed: 'A' } }));
    const b = generatePlan(base({ strategy: { mode: 'interleaved_random', seed: 'B' } }));
    expect(a.map(par)).not.toEqual(b.map(par));
  });

  test('seed ausente ainda é determinística', () => {
    const a = generatePlan(base({ strategy: { mode: 'interleaved_random' } }));
    const b = generatePlan(base({ strategy: { mode: 'interleaved_random' } }));
    expect(a.map(par)).toEqual(b.map(par));
  });

  test('plano é reproduzível também nos horários', () => {
    const a = generatePlan(base());
    const b = generatePlan(base());
    expect(a.map(p => p.scheduledAt.toISOString()))
      .toEqual(b.map(p => p.scheduledAt.toISOString()));
  });

  test('Math.random não é usado — plano não muda se Math.random for fixado', () => {
    const original = Math.random;
    Math.random = () => 0.42;                        // se fosse usado, mudaria tudo
    const comMock = generatePlan(base());
    Math.random = original;
    const semMock = generatePlan(base());
    expect(comMock.map(par)).toEqual(semMock.map(par));
  });
});

/* ── 5, 6, 7, 8 — estratégias ──────────────────────────────────────────────── */

describe('estratégias de distribuição', () => {
  test('sequential agrupa por conta na ordem literal', () => {
    const plano = generatePlan(base({ strategy: { mode: 'sequential' } }));
    expect(plano.slice(0, 4).map(par)).toEqual(['acc1|cnt1', 'acc1|cnt2', 'acc1|cnt3', 'acc1|cnt4']);
    expect(plano.slice(4, 8).map(p => p.accountId)).toEqual(['acc2', 'acc2', 'acc2', 'acc2']);
  });

  test('round_robin alterna as contas a cada publicação', () => {
    const plano = generatePlan(base({ strategy: { mode: 'round_robin' } }));
    expect(plano.slice(0, 4).map(p => p.accountId)).toEqual(['acc1', 'acc2', 'acc3', 'acc4']);
    expect(plano.slice(4, 8).map(p => p.accountId)).toEqual(['acc1', 'acc2', 'acc3', 'acc4']);
  });

  test('account_first termina uma conta antes de passar para a próxima', () => {
    const plano = generatePlan(base({ strategy: { mode: 'account_first', seed: 'x' } }));
    const blocos = [];
    for (let i = 0; i < plano.length; i += 4) {
      blocos.push(new Set(plano.slice(i, i + 4).map(p => p.accountId)));
    }
    // cada bloco de 4 publicações pertence a uma única conta
    for (const bloco of blocos) expect(bloco.size).toBe(1);
  });

  test('interleaved_random evita a mesma conta em publicações consecutivas', () => {
    const plano = generatePlan(base({ accounts: contas(4), contents: conteudos(4) }));
    let consecutivas = 0;
    for (let i = 1; i < plano.length; i++) {
      if (plano[i].accountId === plano[i - 1].accountId) consecutivas++;
    }
    expect(consecutivas).toBe(0);
  });

  test('interleaved_random não agrupa como o sequential', () => {
    const inter = generatePlan(base({ strategy: { mode: 'interleaved_random', seed: 'z' } }));
    const seq   = generatePlan(base({ strategy: { mode: 'sequential' } }));
    expect(inter.map(par)).not.toEqual(seq.map(par));
  });

  test('estratégia desconhecida cai no padrão sem quebrar', () => {
    const plano = generatePlan(base({ strategy: { mode: 'inexistente', seed: 's' } }));
    expect(plano).toHaveLength(16);
  });
});

/* ── 9, 10 — intervalos ────────────────────────────────────────────────────── */

describe('intervalos', () => {
  const minutosEntre = (a, b) => Math.round((b.scheduledAt - a.scheduledAt) / 60000);

  test('intervalo fixo usa sempre o mínimo', () => {
    const plano = generatePlan(base({
      schedule: { intervalMin: 30, intervalMax: 90, useFixedInterval: true },
    }));
    for (let i = 1; i < plano.length; i++) {
      expect(minutosEntre(plano[i - 1], plano[i])).toBe(30);
    }
  });

  test('intervalo variável fica dentro da faixa', () => {
    const plano = generatePlan(base({ schedule: { intervalMin: 12, intervalMax: 28 } }));
    for (let i = 1; i < plano.length; i++) {
      const m = minutosEntre(plano[i - 1], plano[i]);
      expect(m).toBeGreaterThanOrEqual(12);
      expect(m).toBeLessThanOrEqual(28);
    }
  });

  test('intervalo variável realmente varia', () => {
    const plano = generatePlan(base({ schedule: { intervalMin: 5, intervalMax: 60 } }));
    const medidos = new Set();
    for (let i = 1; i < plano.length; i++) medidos.add(minutosEntre(plano[i - 1], plano[i]));
    expect(medidos.size).toBeGreaterThan(1);
  });

  test('primeira publicação começa no startAt', () => {
    const plano = generatePlan(base());
    expect(plano[0].scheduledAt.getTime()).toBe(INICIO.getTime());
  });

  test('intervalo máximo menor que o mínimo é rejeitado', () => {
    expect(() => generatePlan(base({ schedule: { intervalMin: 30, intervalMax: 10 } })))
      .toThrow(PlannerError);
  });
});

/* ── 11, 12, 13 — janela e dias ────────────────────────────────────────────── */

describe('janela de horário e dias da semana', () => {
  test('nenhuma publicação fora da janela', () => {
    const plano = generatePlan(base({
      accounts: contas(6), contents: conteudos(5),
      schedule: { intervalMin: 40, intervalMax: 90, windowStart: '08:00', windowEnd: '23:00' },
      startAt:  new Date('2026-09-01T08:00:00'),
    }));
    for (const p of plano) {
      const min = p.scheduledAt.getHours() * 60 + p.scheduledAt.getMinutes();
      expect(min).toBeGreaterThanOrEqual(8 * 60);
      expect(min).toBeLessThanOrEqual(23 * 60);
    }
  });

  test('começar antes da janela empurra para o início dela', () => {
    const plano = generatePlan(base({
      schedule: { intervalMin: 10, intervalMax: 10, windowStart: '18:00', windowEnd: '22:00' },
      startAt:  new Date('2026-09-01T06:00:00'),
    }));
    expect(plano[0].scheduledAt.getHours()).toBe(18);
    expect(plano[0].scheduledAt.getMinutes()).toBe(0);
  });

  test('estouro da janela avança para o dia seguinte', () => {
    const plano = generatePlan(base({
      accounts: contas(4), contents: conteudos(4),
      schedule: { intervalMin: 60, intervalMax: 60, windowStart: '18:00', windowEnd: '21:00' },
      startAt:  new Date('2026-09-01T18:00:00'),
    }));
    const dias = new Set(plano.map(p => p.scheduledAt.toDateString()));
    expect(dias.size).toBeGreaterThan(1);
  });

  test('weekdays numéricos: só dias permitidos', () => {
    const plano = generatePlan(base({
      accounts: contas(5), contents: conteudos(4),
      schedule: { intervalMin: 300, intervalMax: 300, weekdays: [1, 2, 3, 4, 5] },
      startAt:  new Date('2026-09-04T09:00:00'),   // sexta
    }));
    for (const p of plano) {
      expect([1, 2, 3, 4, 5]).toContain(p.scheduledAt.getDay());
    }
  });

  test('weekdays por nome também são aceitos', () => {
    const plano = generatePlan(base({
      accounts: contas(4), contents: conteudos(3),
      schedule: {
        intervalMin: 400, intervalMax: 400,
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      },
      startAt: new Date('2026-09-04T09:00:00'),
    }));
    for (const p of plano) expect(p.scheduledAt.getDay()).not.toBe(0);
    for (const p of plano) expect(p.scheduledAt.getDay()).not.toBe(6);
  });

  test('janela invertida é rejeitada', () => {
    expect(() => generatePlan(base({ schedule: { windowStart: '22:00', windowEnd: '08:00' } })))
      .toThrow(/Janela de horário inválida/);
  });
});

/* ── 14 a 19 — legendas e comentários ──────────────────────────────────────── */

describe('legendas e comentários por prioridade', () => {
  test('legenda global aplica a todos', () => {
    const plano = generatePlan(base({
      captionMode: 'global',
      captions: { global: 'Confira {campaign}' },
    }));
    for (const p of plano) expect(p.captionTemplate).toBe('Confira {campaign}');
  });

  test('legenda por conta sobrepõe a global', () => {
    const plano = generatePlan(base({
      captionMode: 'per_account',
      captions: { global: 'GLOBAL', byAccount: { acc2: 'SÓ DA CONTA 2' } },
    }));
    for (const p of plano) {
      expect(p.captionTemplate).toBe(p.accountId === 'acc2' ? 'SÓ DA CONTA 2' : 'GLOBAL');
    }
  });

  test('legenda por conteúdo sobrepõe a global', () => {
    const plano = generatePlan(base({
      captionMode: 'per_content',
      captions: { global: 'GLOBAL', byContent: { cnt3: 'DO VIDEO 3' } },
    }));
    for (const p of plano) {
      expect(p.captionTemplate).toBe(p.contentId === 'cnt3' ? 'DO VIDEO 3' : 'GLOBAL');
    }
  });

  test('conta+conteúdo tem a maior prioridade', () => {
    const plano = generatePlan(base({
      captionMode: 'per_account_content',
      captions: {
        global:           'GLOBAL',
        byAccount:        { acc1: 'CONTA' },
        byContent:        { cnt1: 'CONTEUDO' },
        byAccountContent: { 'acc1__cnt1': 'ESPECIFICA' },
      },
    }));
    const alvo = plano.find(p => p.accountId === 'acc1' && p.contentId === 'cnt1');
    expect(alvo.captionTemplate).toBe('ESPECIFICA');
    // a de conta ainda vale nos outros conteúdos da acc1
    const outro = plano.find(p => p.accountId === 'acc1' && p.contentId === 'cnt2');
    expect(outro.captionTemplate).toBe('CONTA');
  });

  test('template fica bruto — variáveis não são resolvidas aqui', () => {
    const plano = generatePlan(base({
      captionMode: 'global',
      captions: { global: 'Olá @{username} — {campaign}' },
    }));
    expect(plano[0].captionTemplate).toBe('Olá @{username} — {campaign}');
  });

  test('comentário global e por conta', () => {
    const plano = generatePlan(base({
      commentMode: 'per_account',
      comments: { global: 'padrão 👇', byAccount: { acc3: 'só da 3' } },
    }));
    for (const p of plano) {
      expect(p.commentTemplate).toBe(p.accountId === 'acc3' ? 'só da 3' : 'padrão 👇');
    }
  });

  test('commentMode disabled zera o comentário mesmo com texto configurado', () => {
    const plano = generatePlan(base({
      commentMode: 'disabled',
      comments: { global: 'não deveria aparecer' },
    }));
    for (const p of plano) expect(p.commentTemplate).toBe('');
  });

  test('aceita Map do Mongoose, não só objeto', () => {
    const plano = generatePlan(base({
      captionMode: 'per_account',
      captions: { global: 'G', byAccount: new Map([['acc2', 'DO MAP']]) },
    }));
    expect(plano.find(p => p.accountId === 'acc2').captionTemplate).toBe('DO MAP');
  });
});

/* ── 20 — limite diário ────────────────────────────────────────────────────── */

describe('limite diário (camada 1)', () => {
  test('conta com 7 de 10 publicadas recebe no máximo 3', () => {
    const plano = generatePlan(base({
      accounts: [
        { id: 'acc1', dailyLimit: 10, postsToday: 7 },
        { id: 'acc2', dailyLimit: 10, postsToday: 0 },
      ],
      contents: conteudos(4),
      settings: { respectDailyLimit: true },
    }));
    expect(plano.filter(p => p.accountId === 'acc1')).toHaveLength(3);
    expect(plano.filter(p => p.accountId === 'acc2')).toHaveLength(4);
  });

  test('conta no limite não recebe nenhuma publicação', () => {
    const plano = generatePlan(base({
      accounts: [
        { id: 'acc1', dailyLimit: 5, postsToday: 5 },
        { id: 'acc2', dailyLimit: 5, postsToday: 0 },
      ],
      contents: conteudos(3),
      settings: { respectDailyLimit: true },
    }));
    expect(plano.filter(p => p.accountId === 'acc1')).toHaveLength(0);
    expect(plano).toHaveLength(3);
  });

  test('respectDailyLimit=false ignora o limite (camada 2 ainda protege)', () => {
    const plano = generatePlan(base({
      accounts: [{ id: 'acc1', dailyLimit: 1, postsToday: 1 }],
      contents: conteudos(4),
      settings: { respectDailyLimit: false },
    }));
    expect(plano).toHaveLength(4);
  });

  test('todas as contas no limite gera plano vazio, sem erro', () => {
    const plano = generatePlan(base({
      accounts: [{ id: 'acc1', dailyLimit: 2, postsToday: 2 }],
      contents: conteudos(3),
      settings: { respectDailyLimit: true },
    }));
    expect(plano).toEqual([]);
  });

  test('contas limitadas não recebem sempre o mesmo conteúdo', () => {
    const plano = generatePlan(base({
      accounts: [
        { id: 'acc1', dailyLimit: 1, postsToday: 0 },
        { id: 'acc2', dailyLimit: 1, postsToday: 0 },
      ],
      contents: conteudos(4),
      settings: { respectDailyLimit: true },
      strategy: { mode: 'sequential' },
    }));
    const escolhidos = plano.map(p => p.contentId);
    expect(new Set(escolhidos).size).toBe(2);   // deslocamento por conta funciona
  });
});

/* ── 21, 22, 23 — validação ────────────────────────────────────────────────── */

describe('validação de entrada', () => {
  test('lista de contas vazia é rejeitada', () => {
    expect(() => generatePlan(base({ accounts: [] }))).toThrow(/ao menos uma conta/i);
  });

  test('lista de conteúdos vazia é rejeitada', () => {
    expect(() => generatePlan(base({ contents: [] }))).toThrow(/ao menos um conteúdo/i);
  });

  test('conteúdo sem id é rejeitado antes de gerar o plano', () => {
    expect(() => generatePlan(base({ contents: [{ id: 'cnt1' }, { name: 'sem id' }] })))
      .toThrow(/conteúdo inexistente ou removido/i);
  });

  test('conta duplicada na seleção é rejeitada', () => {
    expect(() => generatePlan(base({ accounts: [{ id: 'a' }, { id: 'a' }] })))
      .toThrow(/contas repetidas/i);
  });

  test('conteúdo duplicado na seleção é rejeitado', () => {
    expect(() => generatePlan(base({ contents: [{ id: 'c' }, { id: 'c' }] })))
      .toThrow(/conteúdos repetidos/i);
  });

  test('startAt obrigatório — o planner não lê o relógio', () => {
    const entrada = base();
    delete entrada.startAt;
    expect(() => generatePlan(entrada)).toThrow(/startAt é obrigatório/i);
  });

  test('erros carregam código para a API tratar', () => {
    try {
      generatePlan(base({ accounts: [] }));
    } catch (e) {
      expect(e).toBeInstanceOf(PlannerError);
      expect(e.code).toBe('PLANNER_NO_ACCOUNTS');
    }
  });
});

/* ── 11 (marcações) — templateResolver ─────────────────────────────────────── */

describe('templateResolver', () => {
  const ctx = {
    username:    'conta01',
    name:        'Jessica',
    campaign:    'Campanha Agosto',
    contentName: 'video01',
    now:         new Date('2026-09-01T18:30:00'),
  };

  test('resolve username e account_username', () => {
    expect(resolveTemplate('Confira @{username}', ctx).text).toBe('Confira @conta01');
    expect(resolveTemplate('De {account_username}', ctx).text).toBe('De conta01');
  });

  test('resolve campanha e conteúdo', () => {
    expect(resolveTemplate('{campaign} — {content}', ctx).text)
      .toBe('Campanha Agosto — video01');
  });

  test('resolve data e hora a partir de now', () => {
    const r = resolveTemplate('{date} {time}', ctx);
    expect(r.text).toBe('01/09/2026 18:30');
  });

  test('resolve várias marcações na mesma frase', () => {
    const r = resolveTemplate('Confira {campaign} 🔥 {username}', ctx);
    expect(r.text).toBe('Confira Campanha Agosto 🔥 conta01');
    expect(r.unresolved).toEqual([]);
  });

  test('marcação desconhecida não quebra e é preservada', () => {
    const r = resolveTemplate('Olá {username}, veja {foo_bar}', ctx);
    expect(r.text).toBe('Olá conta01, veja {foo_bar}');
    expect(r.unresolved).toEqual(['foo_bar']);
  });

  test('marcação conhecida sem valor é preservada e reportada', () => {
    const r = resolveTemplate('{campaign} de {username}', { username: 'x' });
    expect(r.text).toBe('{campaign} de x');
    expect(r.unresolved).toEqual(['campaign']);
  });

  test('template vazio ou não-string devolve string vazia', () => {
    expect(resolveTemplate('', ctx).text).toBe('');
    expect(resolveTemplate(null, ctx).text).toBe('');
    expect(resolveTemplate(undefined).text).toBe('');
  });

  test('texto sem marcações passa intacto', () => {
    expect(resolveTemplate('Sem variáveis aqui!', ctx).text).toBe('Sem variáveis aqui!');
  });

  test('lista de variáveis alimenta o botão "Inserir variável"', () => {
    const vars = listarVariaveis();
    expect(vars).toEqual(expect.arrayContaining([
      'username', 'account_username', 'campaign', 'content', 'content_name', 'date', 'time',
    ]));
  });
});

/* ── 15, 16 — compatibilidade e reuso futuro (Postar/Loop) ─────────────────── */

describe('reuso por Postar e Loop', () => {
  test('aceita o vocabulário do model Campaign (intervalMinMinutes)', () => {
    const plano = generatePlan(base({
      schedule: { intervalMinMinutes: 20, intervalMaxMinutes: 20 },
    }));
    const dif = (plano[1].scheduledAt - plano[0].scheduledAt) / 60000;
    expect(dif).toBe(20);
  });

  test('uma conta e uma mídia — caso simples do Postar', () => {
    const plano = generatePlan(base({
      accounts: contas(1), contents: conteudos(1),
      strategy: { mode: 'sequential' },
    }));
    expect(plano).toHaveLength(1);
    expect(plano[0].scheduledAt.getTime()).toBe(INICIO.getTime());
  });

  test('não importa models — planner é puro', () => {
    const fonte = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/services/publicationPlanner.js'), 'utf8'
    );
    expect(fonte).not.toMatch(/require\(['"].*models/);
    // Chamada de verdade, com parêntese — a menção em comentário não conta.
    expect(fonte).not.toMatch(/Math\.random\s*\(/);
    expect(fonte).not.toMatch(/require\(['"](mongoose|bullmq|ioredis)/);
    expect(fonte).not.toMatch(/\bfetch\(/);
    expect(fonte).not.toMatch(/Date\.now\(\)/);   // nem o relógio
  });
});
