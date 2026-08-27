/**
 * Smart Activity — detecção de marcos.
 *
 * A regra que estes testes protegem é uma só: **o mesmo marco nunca dispara
 * duas vezes**. Tudo o mais é consequência dela — o salto de 95 para 145, o
 * refresh que não duplica, as duas contas independentes.
 *
 * Por que isso merece quinze casos: uma notificação repetida não quebra nada
 * tecnicamente, então nenhum erro aparece nos logs. O sintoma é a pessoa
 * perdendo a confiança no recurso e desligando — o que só se descobre depois.
 */

/* Prefixo `mock` obrigatório: o Jest recusa fábrica de `jest.mock()` que
   referencie variável de fora do escopo, e abre exceção para esse prefixo. */
const mockMarcos = [];
const mockNotificacoes = [];

function mockBate(doc, filtro) {
  return Object.entries(filtro).every(([campo, cond]) => {
    const v = doc[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$ne' in cond) return String(v) !== String(cond.$ne);
      if ('$gte' in cond) return new Date(v) >= new Date(cond.$gte);
    }
    return String(v ?? null) === String(cond ?? null);
  });
}

jest.mock('../src/models/Milestone', () => ({
  findOne(filtro) {
    return { lean: async () => mockMarcos.find(m => mockBate(m, filtro)) || null };
  },
  async updateOne(filtro, atualizacao, opcoes = {}) {
    let alvo = mockMarcos.find(m => mockBate(m, filtro));
    if (!alvo) {
      if (!opcoes.upsert) return { matchedCount: 0 };
      alvo = { ...filtro, maiorDisparado: 0, ultimoValor: 0 };
      mockMarcos.push(alvo);
    }
    if (atualizacao.$set) Object.assign(alvo, atualizacao.$set);
    if (atualizacao.$max) {
      for (const [k, v] of Object.entries(atualizacao.$max)) {
        alvo[k] = Math.max(Number(alvo[k]) || 0, Number(v) || 0);
      }
    }
    return { matchedCount: 1 };
  },
}));

jest.mock('../src/models/Notificacao', () => ({
  findOne(filtro) {
    return { lean: async () => mockNotificacoes.find(n => mockBate(n, filtro)) || null };
  },
  async create(doc) {
    // O índice único do modelo real, reproduzido: mesmo marco não entra duas vezes.
    const repetida = mockNotificacoes.some(n =>
      n.eventType === 'milestone' &&
      String(n.accountId) === String(doc.accountId) &&
      n.contentId === doc.contentId &&
      n.metricType === doc.metricType &&
      n.threshold === doc.threshold);
    if (repetida) throw Object.assign(new Error('duplicate key'), { code: 11000 });
    const nova = { ...doc, _id: `n${mockNotificacoes.length + 1}`, criadaEm: new Date(), lidaEm: null };
    mockNotificacoes.push(nova);
    return nova;
  },
}));

const mockAgregado = { valor: null };

jest.mock('../src/models/Insight', () => ({
  find() { return { select: () => ({ limit: () => ({ lean: async () => [] }) }), lean: async () => [] }; },
  async aggregate() { return mockAgregado.valor ? [mockAgregado.valor] : []; },
}));

const detector = require('../src/services/smartActivity/detector');
const thresholds = require('../src/services/smartActivity/thresholds');
const templates = require('../src/services/smartActivity/templates');

/* Sem conexão real; `bancoConectado` existe como costura para isto. */
thresholds.bancoConectado = () => true;

const CFG = {
  thresholds: {
    storyViews:   [30, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    contentViews: [100, 500, 1000, 5000, 10000, 25000, 50000, 100000],
    reach:        [500, 1000, 5000],
  },
  ativos: { storyViews: true, contentViews: true, reach: false, global: false },
  mensagens: {},
};

const conta  = (id = 'c1', username = 'oliviapaganini') => ({ _id: id, username, avatar: '' });
const story  = (id, vistos) => ({ igMediaId: id, mediaType: 'STORY', impressions: vistos });
const reel   = (id, views)  => ({ igMediaId: id, mediaType: 'VIDEO', videoViews: views });

/** Dispara e devolve só os marcos notificados, em ordem. */
async function disparados(insight, c = conta(), cfg = CFG) {
  const r = await detector.processarInsight(insight, c, cfg);
  return r.map(n => n.threshold);
}

beforeEach(() => {
  mockMarcos.length = 0;
  mockNotificacoes.length = 0;
  mockAgregado.valor = null;
});

/* ── 1 a 3: o marco simples ───────────────────────────────────────────────── */

describe('marco simples', () => {
  test('1. 29 → 30 dispara', async () => {
    expect(await disparados(story('s1', 29))).toEqual([]);
    expect(await disparados(story('s1', 30))).toEqual([30]);
  });

  test('2. 30 → 31 NÃO dispara de novo', async () => {
    await disparados(story('s1', 30));
    expect(await disparados(story('s1', 31))).toEqual([]);
  });

  test('3. 49 → 50 dispara', async () => {
    await disparados(story('s1', 49));
    expect(await disparados(story('s1', 50))).toEqual([50]);
  });
});

/* ── 4 e 5: o salto ───────────────────────────────────────────────────────── */

describe('salto entre leituras', () => {
  test('4. 95 → 145 detecta o 100', async () => {
    await disparados(story('s1', 95));
    expect(await disparados(story('s1', 145))).toEqual([100]);
  });

  test('5. 900 → 1.200 detecta o 1.000', async () => {
    await disparados(story('s1', 900));
    expect(await disparados(story('s1', 1200))).toEqual([1000]);
  });

  test('salto sobre VÁRIOS marcos dispara todos, em ordem', async () => {
    // Do zero a 2.600 atravessa 30, 50, 100, 250, 500, 1.000 e 2.500.
    expect(await disparados(story('s1', 2600)))
      .toEqual([30, 50, 100, 250, 500, 1000, 2500]);
  });
});

/* ── 6 e 7: independência ─────────────────────────────────────────────────── */

describe('independência', () => {
  test('6. duas contas não se contaminam', async () => {
    await disparados(story('s1', 100), conta('c1', 'ana'));
    // Mesmo ID de conteúdo, outra conta: o teto de uma não vale para a outra.
    expect(await disparados(story('s1', 100), conta('c2', 'bia'))).toEqual([30, 50, 100]);
  });

  test('7. dois stories da MESMA conta são independentes', async () => {
    await disparados(story('s1', 100));
    expect(await disparados(story('s2', 50))).toEqual([30, 50]);
  });

  test('story e reel não compartilham teto', async () => {
    await disparados(story('s1', 500));
    expect(await disparados(reel('r1', 500))).toEqual([100, 500]);
  });
});

/* ── 8 e 9: nunca duas vezes ──────────────────────────────────────────────── */

describe('não repete', () => {
  test('8. reprocessar a mesma leitura não duplica', async () => {
    // Equivale ao refresh da página: o estado vive no banco, não na tela.
    // Seis marcos até 1.000: 30, 50, 100, 250, 500 e 1.000.
    expect(await disparados(story('s1', 1000))).toEqual([30, 50, 100, 250, 500, 1000]);
    expect(await disparados(story('s1', 1000))).toEqual([]);
    expect(await disparados(story('s1', 1000))).toEqual([]);
  });

  test('9. mesmo threshold nunca gera duas notificações', async () => {
    await disparados(story('s1', 30));
    await disparados(story('s1', 30));
    await disparados(story('s1', 35));
    const trinta = mockNotificacoes.filter(n => n.threshold === 30);
    expect(trinta).toHaveLength(1);
  });

  test('métrica que CAI não reabre marco já disparado', async () => {
    // Coleta parcial pode devolver menos que a anterior. O teto não desce.
    await disparados(story('s1', 500));
    await disparados(story('s1', 120));
    expect(await disparados(story('s1', 500))).toEqual([]);
  });

  test('o teto sobe ANTES de notificar', async () => {
    // Se a notificação falhar, perde-se um aviso. Na ordem inversa, o marco
    // dispararia de novo a cada ciclo — para sempre.
    const Notificacao = require('../src/models/Notificacao');
    const original = Notificacao.create;
    Notificacao.create = async () => { throw new Error('banco caiu'); };
    await expect(disparados(story('s1', 100))).rejects.toThrow('banco caiu');
    Notificacao.create = original;

    // O teto ficou gravado: o marco não volta.
    expect(await disparados(story('s1', 100))).toEqual([]);
  });
});

/* ── 10 e 11: configuração ────────────────────────────────────────────────── */

describe('configuração', () => {
  test('10. métrica desligada não notifica', async () => {
    const cfg = { ...CFG, ativos: { ...CFG.ativos, storyViews: false } };
    expect(await disparados(story('s1', 5000), conta(), cfg)).toEqual([]);
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('11. marcos personalizados funcionam', async () => {
    const cfg = { ...CFG, thresholds: { ...CFG.thresholds, storyViews: [7, 77] } };
    expect(await disparados(story('s1', 80), conta(), cfg)).toEqual([7, 77]);
  });

  test('lista de marcos vazia não quebra', async () => {
    const cfg = { ...CFG, thresholds: { ...CFG.thresholds, storyViews: [] } };
    expect(await disparados(story('s1', 9999), conta(), cfg)).toEqual([]);
  });
});

/* ── 12: modelos de mensagem ──────────────────────────────────────────────── */

describe('modelos de mensagem', () => {
  test('12. variável inválida é sinalizada', () => {
    expect(templates.validar('{{account}} tem {{views}}')).toEqual([]);
    expect(templates.validar('{{acount}} chegou')).toEqual(['acount']);
  });

  test('variável desconhecida fica VISÍVEL, não vira vazio', () => {
    // Um `{{typo}}` na tela é consertado no mesmo dia; um espaço em branco não.
    expect(templates.render('{{account}} e {{typo}}', { account: '@ana' }))
      .toBe('@ana e {{typo}}');
  });

  test('a mensagem renderizada é gravada, não o modelo', async () => {
    await disparados(story('s1', 30), conta('c1', 'ana'));
    const n = mockNotificacoes[0];
    expect(n.mensagem).toContain('@ana');
    expect(n.mensagem).not.toContain('{{');
  });

  test('modelo do painel substitui o padrão', async () => {
    const cfg = {
      ...CFG,
      mensagens: { storyViews: { titulo: 'Boom {{threshold}}', mensagem: 'oi' } },
    };
    await disparados(story('s1', 30), conta(), cfg);
    expect(mockNotificacoes[0].titulo).toBe('Boom 30');
  });

  test('números saem formatados em português', () => {
    expect(templates.formatarNumero(1024)).toBe('1.024');
    expect(templates.formatarNumero(587853)).toBe('587.853');
  });
});

/* ── A trava, isolada ─────────────────────────────────────────────────────── */

describe('marcosCruzados', () => {
  const M = [30, 50, 100, 250, 500];

  test('nada abaixo do teto volta', () => {
    expect(thresholds.marcosCruzados(100, 400, M)).toEqual([250]);
  });

  test('teto igual ao valor não devolve nada', () => {
    expect(thresholds.marcosCruzados(500, 500, M)).toEqual([]);
  });

  test('do zero devolve tudo o que couber, em ordem', () => {
    expect(thresholds.marcosCruzados(0, 260, M)).toEqual([30, 50, 100, 250]);
  });

  test('valor zero não devolve nada', () => {
    expect(thresholds.marcosCruzados(0, 0, M)).toEqual([]);
  });
});

/* ── 13 a 15: resumo do dia ───────────────────────────────────────────────── */

describe('resumo do dia', () => {
  const comConfig = ativo => {
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, global: ativo } });
  };

  test('13. desligado por padrão: não cria nada', async () => {
    comConfig(false);
    mockAgregado.valor = { publicacoes: 1687, contas: ['a', 'b'], views: 587853 };
    expect(await detector.resumoDoDia()).toBeNull();
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('14. ligado, cria uma vez com os números agregados', async () => {
    comConfig(true);
    mockAgregado.valor = { publicacoes: 1687, contas: new Array(39).fill(0).map((_, i) => `c${i}`), views: 587853 };

    const n = await detector.resumoDoDia();
    expect(n).toBeTruthy();
    expect(n.titulo).toBe('Resumo do dia');
    // Formatado em português, como aparece na tela.
    expect(n.mensagem).toContain('1.687 publicações');
    expect(n.mensagem).toContain('39 conta(s)');
    expect(n.mensagem).toContain('587.853 visualizações');
  });

  test('15. um por dia: a segunda chamada não cria outro', async () => {
    comConfig(true);
    mockAgregado.valor = { publicacoes: 10, contas: ['a'], views: 100 };

    expect(await detector.resumoDoDia()).toBeTruthy();
    // O anti-repetição aqui é a DATA, não o teto: o registro no banco é quem
    // diz se o resumo de hoje já saiu — e sobrevive ao processo reiniciar.
    expect(await detector.resumoDoDia()).toBeNull();
    expect(mockNotificacoes.filter(x => x.eventType === 'resumo')).toHaveLength(1);
  });

  test('sem publicação no dia, não inventa resumo', async () => {
    comConfig(true);
    mockAgregado.valor = null;
    expect(await detector.resumoDoDia()).toBeNull();
  });
});
