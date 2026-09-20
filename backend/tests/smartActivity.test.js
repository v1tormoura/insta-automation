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

/* `resumoDoDia` faz TRÊS agregações — geral (sem story), story sozinha, e por
   conta — em paralelo. Um mock só que devolvesse o mesmo valor para as três
   já não bastava depois que a segunda e a terceira passaram a existir: a
   agregação por conta receberia os números da geral, por exemplo. O mock
   agora lê o PRÓPRIO pipeline para saber qual das três é, do mesmo jeito que
   o Mongo real distingue pela forma da consulta, não por quem chamou. */
const mockAgregados = { principal: null, stories: null, porConta: [] };

const mockInsights = [];

jest.mock('../src/models/Insight', () => ({
  find(filtro = {}) {
    const lista = () => mockInsights.filter(i => !filtro.accountId || String(i.accountId) === String(filtro.accountId));
    const q = { select: () => q, limit: () => q, lean: async () => lista() };
    return q;
  },
  async aggregate(pipeline) {
    const match = pipeline?.[0]?.$match || {};
    const group = pipeline?.find(s => s.$group)?.$group || {};
    if (match.mediaType === 'STORY') return mockAgregados.stories ? [mockAgregados.stories] : [];
    if (group._id === '$accountId') return mockAgregados.porConta || [];
    return mockAgregados.principal ? [mockAgregados.principal] : [];
  },
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
  mockInsights.length = 0;
  mockAgregados.principal = null;
  mockAgregados.stories = null;
  mockAgregados.porConta = [];
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

  test('salto sobre VÁRIOS marcos avisa só o MAIOR — os outros sobem o teto em silêncio', async () => {
    /* Era "dispara todos, em ordem": um reel que ia de 0 a 194 mil entre duas
       leituras gerava oito avisos do mesmo reel, e clicar em Sincronizar
       despejava a escada inteira. A pessoa quer saber que passou de 2.500,
       não receber 30, 50, 100, 250, 500 e 1.000 junto. */
    expect(await disparados(story('s1', 2600))).toEqual([2500]);
    // E os intermediários não voltam depois: o teto já está em 2.500.
    expect(await disparados(story('s1', 2700))).toEqual([]);
    expect(await disparados(story('s1', 5000))).toEqual([5000]);
  });
});

/* ── 6 e 7: independência ─────────────────────────────────────────────────── */

describe('independência', () => {
  test('6. duas contas não se contaminam', async () => {
    await disparados(story('s1', 100), conta('c1', 'ana'));
    // Mesmo ID de conteúdo, outra conta: o teto de uma não vale para a outra.
    expect(await disparados(story('s1', 100), conta('c2', 'bia'))).toEqual([100]);
  });

  test('7. dois stories da MESMA conta são independentes', async () => {
    await disparados(story('s1', 100));
    expect(await disparados(story('s2', 50))).toEqual([50]);
  });

  test('story e reel não compartilham teto', async () => {
    await disparados(story('s1', 500));
    expect(await disparados(reel('r1', 500))).toEqual([500]);
  });
});

/* ── 8 e 9: nunca duas vezes ──────────────────────────────────────────────── */

describe('não repete', () => {
  test('8. reprocessar a mesma leitura não duplica', async () => {
    // Equivale ao refresh da página: o estado vive no banco, não na tela.
    // Seis marcos até 1.000; só o maior avisa, e nunca de novo.
    expect(await disparados(story('s1', 1000))).toEqual([1000]);
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

describe('coalescência por varredura', () => {
  const { LIMITE_POR_VARREDURA } = detector;

  test('candidatos sem gravar: processarInsight devolve o doc, e nada vai ao banco', async () => {
    const r = await detector.processarInsight(story('s1', 100), conta(), CFG, { gravar: false });
    expect(r).toHaveLength(1);
    expect(r[0].threshold).toBe(100);
    expect(mockNotificacoes).toHaveLength(0);
  });

  test(`mais de ${LIMITE_POR_VARREDURA} conteúdos cruzando marcos viram ${LIMITE_POR_VARREDURA} avisos + 1 resumo`, async () => {
    /* O dia em que a conta estoura: dez reels cruzam marcos na mesma
       sincronização. Sem coalescer eram dez avisos de uma vez. */
    const c = conta();
    const candidatos = [];
    for (let i = 1; i <= 10; i++) {
      candidatos.push(...await detector.processarInsight(reel('r' + i, i * 1000), c, CFG, { gravar: false }));
    }
    expect(candidatos).toHaveLength(10);
    const criadas = await detector._gravarCoalescido(c, candidatos, CFG);
    const marcos = criadas.filter(n => n.eventType === 'milestone');
    const resumos = criadas.filter(n => n.eventType === 'resumoMarcos');
    expect(marcos).toHaveLength(LIMITE_POR_VARREDURA);
    expect(resumos).toHaveLength(1);
    // Os que saem inteiros são os MAIORES.
    expect(marcos.map(n => n.metadados.valor).sort((a, b) => b - a)).toEqual([10000, 9000, 8000]);
    expect(resumos[0].metadados.quantidade).toBe(10 - LIMITE_POR_VARREDURA);
    expect(resumos[0].mensagem).toContain('7');
    expect(resumos[0].mensagem).toContain('7.000');
  });

  test(`até ${LIMITE_POR_VARREDURA} conteúdos saem inteiros, sem resumo`, async () => {
    const c = conta();
    const candidatos = [];
    for (let i = 1; i <= LIMITE_POR_VARREDURA; i++) {
      candidatos.push(...await detector.processarInsight(reel('r' + i, 1000), c, CFG, { gravar: false }));
    }
    const criadas = await detector._gravarCoalescido(c, candidatos, CFG);
    expect(criadas.filter(n => n.eventType === 'resumoMarcos')).toHaveLength(0);
    expect(criadas).toHaveLength(LIMITE_POR_VARREDURA);
  });
});

describe('semeadura por conta', () => {
  test('semearConta grava o teto no maior marco já ultrapassado, sem avisar', async () => {
    mockInsights.push({ accountId: 'nova', igMediaId: 'x1', mediaType: 'VIDEO', videoViews: 7000 });
    mockInsights.push({ accountId: 'nova', igMediaId: 'x2', mediaType: 'STORY', impressions: 60 });
    const tetos = await detector.semearConta(conta('nova', 'nova'), CFG);
    expect(tetos).toBeGreaterThan(0);
    expect(mockNotificacoes).toHaveLength(0);
    // Depois da semeadura, o mesmo valor não dispara; só o que crescer.
    expect(await disparados(reel('x1', 7000), conta('nova', 'nova'))).toEqual([]);
    expect(await disparados(reel('x1', 12000), conta('nova', 'nova'))).toEqual([10000]);
  });
});

describe('configuração', () => {
  test('10. métrica desligada não notifica', async () => {
    const cfg = { ...CFG, ativos: { ...CFG.ativos, storyViews: false } };
    expect(await disparados(story('s1', 5000), conta(), cfg)).toEqual([]);
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('11. marcos personalizados funcionam', async () => {
    const cfg = { ...CFG, thresholds: { ...CFG.thresholds, storyViews: [7, 77] } };
    expect(await disparados(story('s1', 80), conta(), cfg)).toEqual([77]);
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

  /* Hora fixa, e à noite: o resumo só sai a partir das 22h (ver
     `HORA_DO_RESUMO`), e sem fixar a hora estes testes passariam de manhã e
     falhariam à tarde — ou o contrário. */
  const NOITE = new Date(2026, 8, 10, 22, 15);   // 10/09/2026 22:15
  const MANHA = new Date(2026, 8, 10, 9, 30);    // mesmo dia, 09:30

  test('antes das 22h não sai, mesmo com publicação e ligado', async () => {
    /* Rodar no fim de CADA ciclo de sincronização fazia o resumo sair às 9h,
       no primeiro ciclo depois da primeira publicação, dizendo "1 publicação"
       — e travar o dia. O pedido é o total no FINAL do dia. */
    comConfig(true);
    mockAgregados.principal = { publicacoes: 1, contas: ['a'], views: 50 };
    expect(await detector.resumoDoDia({ agora: MANHA })).toBeNull();
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('a partir das 22h sai, e "hoje" é o dia dessa hora', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 40, contas: ['a', 'b'], views: 9000 };
    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n).toBeTruthy();
    expect(n.mensagem).toContain('40 publicações');
  });

  test('13. desligado por padrão: não cria nada', async () => {
    comConfig(false);
    mockAgregados.principal = { publicacoes: 1687, contas: ['a', 'b'], views: 587853 };
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
    expect(mockNotificacoes).toHaveLength(0);
  });

  test('14. ligado, cria uma vez com os números agregados', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 1687, contas: new Array(39).fill(0).map((_, i) => `c${i}`), views: 587853 };

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n).toBeTruthy();
    expect(n.titulo).toBe('Resumo do dia');
    // Formatado em português, como aparece na tela.
    expect(n.mensagem).toContain('1.687 publicações');
    expect(n.mensagem).toContain('39 conta(s)');
    expect(n.mensagem).toContain('587.853 visualizações');
  });

  test('15. um por dia: a segunda chamada não cria outro', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 10, contas: ['a'], views: 100 };

    expect(await detector.resumoDoDia({ agora: NOITE })).toBeTruthy();
    // O anti-repetição aqui é a DATA, não o teto: o registro no banco é quem
    // diz se o resumo de hoje já saiu — e sobrevive ao processo reiniciar.
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
    expect(mockNotificacoes.filter(x => x.eventType === 'resumo')).toHaveLength(1);
  });

  test('sem publicação no dia, não inventa resumo', async () => {
    comConfig(true);
    mockAgregados.principal = null;
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
  });

  test('stories somam separado de posts — a mesma separação do dashboard', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 5, contas: ['a'], views: 1000 };
    mockAgregados.stories = { views: 250 };

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).toContain('1.000 visualizações');
    expect(n.mensagem).toContain('250 em stories');
    expect(n.metadados.viewsStories).toBe(250);
    // O total de posts não engoliu o de stories.
    expect(n.metadados.views).toBe(1000);
  });

  test('sem nenhuma view de story, o resumo ainda sai — 0, não undefined', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 5, contas: ['a'], views: 1000 };
    mockAgregados.stories = null;

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.metadados.viewsStories).toBe(0);
    expect(n.mensagem).toContain('0 em stories');
  });

  test('lista por conta, maior primeiro, com @ de cada uma', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 3, contas: ['a', 'b'], views: 900 };
    mockAgregados.porConta = [
      { _id: 'a', username: 'oliviapaganini', views: 600 },
      { _id: 'b', username: 'lauramendes',    views: 300 },
    ];

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).toContain('@oliviapaganini: 600');
    expect(n.mensagem).toContain('@lauramendes: 300');
    expect(n.metadados.porConta).toEqual([
      { accountId: 'a', username: 'oliviapaganini', views: 600 },
      { accountId: 'b', username: 'lauramendes',    views: 300 },
    ]);
  });

  test('privacidade de nome troca @ por "Conta N" — a mesma regra dos marcos', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 1, contas: ['a'], views: 500 };
    mockAgregados.porConta = [{ _id: 'a', username: 'oliviapaganini', views: 500 }];
    thresholds.carregar = async () => ({
      ...CFG, ativos: { ...CFG.ativos, global: true },
      privacidade: { mostrarNome: false, mostrarValor: true },
    });

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).not.toContain('oliviapaganini');
    expect(n.mensagem).toContain('Conta 1: 500');
  });

  test('privacidade de valor esconde os números, inclusive na lista por conta', async () => {
    comConfig(true);
    mockAgregados.principal = { publicacoes: 1, contas: ['a'], views: 500 };
    mockAgregados.stories = { views: 80 };
    mockAgregados.porConta = [{ _id: 'a', username: 'oliviapaganini', views: 500 }];
    thresholds.carregar = async () => ({
      ...CFG, ativos: { ...CFG.ativos, global: true },
      privacidade: { mostrarNome: true, mostrarValor: false },
    });

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).not.toContain('500');
    expect(n.mensagem).not.toContain('80');
    expect(n.mensagem).toContain('@oliviapaganini: •••');
  });
});
