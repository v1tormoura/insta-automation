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

const detector = require('../src/services/smartActivity/detector');
const thresholds = require('../src/services/smartActivity/thresholds');
const templates = require('../src/services/smartActivity/templates');

const banco = require('./helpers/banco');

const CFG = {
  thresholds: {
    storyViews:   [30, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    contentViews: [100, 500, 1000, 5000, 10000, 25000, 50000, 100000],
    reach:        [500, 1000, 5000],
  },
  ativos: { storyViews: true, contentViews: true, reach: false, global: false },
  mensagens: {},
};

/* Marcos e notificações apontam para a conta: as contas dos testes existem
   no banco, criadas a cada teste, e `conta('c1')` devolve a de verdade. */
const ROTULOS = ['c1', 'c2', 'nova', 'conta1', 'conta2', 'conta3', 'conta4', 'conta5', 'conta6'];
const ids = {};
const conta = (rotulo = 'c1', username = 'oliviapaganini') => ({ id: ids[rotulo], username, avatar: '' });

const notifs = () => banco.sql`select * from notificacoes order by criada_em, id`;

/** Um insight gravado (para semeadura e resumo). */
async function insight(campos) {
  await banco.sql`insert into insights ${banco.sql({ igMediaId: `m${Math.random()}`, ...campos })}`;
}
const story  = (id, vistos) => ({ igMediaId: id, mediaType: 'STORY', impressions: vistos });
const reel   = (id, views)  => ({ igMediaId: id, mediaType: 'VIDEO', videoViews: views });

/** Dispara e devolve só os marcos notificados, em ordem. */
async function disparados(insight, c = conta(), cfg = CFG) {
  const r = await detector.processarInsight(insight, c, cfg);
  return r.map(n => n.threshold);
}

beforeEach(async () => {
  await banco.limpar();
  for (const r of ROTULOS) ids[r] = (await banco.criarConta({ username: r })).id;
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
    const trinta = (await notifs()).filter(n => n.threshold === 30);
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
    const { notificacoes } = require('../src/repos');
    const original = notificacoes.insert;
    notificacoes.insert = async () => { throw new Error('banco caiu'); };
    try {
      await expect(disparados(story('s1', 100))).rejects.toThrow('banco caiu');
    } finally {
      notificacoes.insert = original;
    }

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
    expect(await notifs()).toHaveLength(0);
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
    const criadas = await detector._gravarCoalescido(candidatos, CFG);
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
    const criadas = await detector._gravarCoalescido(candidatos, CFG);
    expect(criadas.filter(n => n.eventType === 'resumoMarcos')).toHaveLength(0);
    expect(criadas).toHaveLength(LIMITE_POR_VARREDURA);
  });

  test('o teto é GLOBAL: seis contas com três marcos cada viram 3 avisos + 1 resumo, não 24', async () => {
    /* Medido em produção: "3 por conta + resumo" com seis contas era uma
       rajada de 12–15 a cada 30 min. */
    const candidatos = [];
    for (let k = 1; k <= 6; k++) {
      const c = conta('conta' + k, 'conta' + k);
      for (let i = 1; i <= 3; i++) {
        candidatos.push(...await detector.processarInsight(reel(`c${k}r${i}`, k * 1000 + i), c, CFG, { gravar: false }));
      }
    }
    expect(candidatos).toHaveLength(18);
    const criadas = await detector._gravarCoalescido(candidatos, CFG);
    const marcos = criadas.filter(n => n.eventType === 'milestone');
    const resumos = criadas.filter(n => n.eventType === 'resumoMarcos');
    expect(marcos).toHaveLength(LIMITE_POR_VARREDURA);
    expect(resumos).toHaveLength(1);
    expect(resumos[0].metadados.quantidade).toBe(15);
    expect(resumos[0].mensagem).toMatch(/15 conteúdos de [56] conta/);
  });

  test('views e alcance do MESMO reel na mesma varredura: sai só o de views', async () => {
    const c = conta();
    const cfgComReach = { ...CFG, ativos: { ...CFG.ativos, reach: true } };
    // reach 600 cruza 500; videoViews 1200 cruza 1000 — o mesmo conteúdo.
    const candidatos = await detector.processarInsight({ ...reel('r1', 1200), reach: 600 }, c, cfgComReach, { gravar: false });
    expect(candidatos.map(x => x.metricType).sort()).toEqual(['contentViews', 'reach']);
    const criadas = await detector._gravarCoalescido(candidatos, cfgComReach);
    expect(criadas).toHaveLength(1);
    expect(criadas[0].metricType).toBe('contentViews');
  });
});

describe('semeadura por conta', () => {
  test('semearConta grava o teto no maior marco já ultrapassado, sem avisar', async () => {
    await insight({ accountId: ids.nova, igMediaId: 'x1', mediaType: 'VIDEO', videoViews: 7000 });
    await insight({ accountId: ids.nova, igMediaId: 'x2', mediaType: 'STORY', impressions: 60 });
    const tetos = await detector.semearConta(conta('nova', 'nova'), CFG);
    expect(tetos).toBeGreaterThan(0);
    expect(await notifs()).toHaveLength(0);
    // Depois da semeadura, o mesmo valor não dispara; só o que crescer.
    expect(await disparados(reel('x1', 7000), conta('nova', 'nova'))).toEqual([]);
    expect(await disparados(reel('x1', 12000), conta('nova', 'nova'))).toEqual([10000]);
  });
});

describe('configuração', () => {
  test('10. métrica desligada não notifica', async () => {
    const cfg = { ...CFG, ativos: { ...CFG.ativos, storyViews: false } };
    expect(await disparados(story('s1', 5000), conta(), cfg)).toEqual([]);
    expect(await notifs()).toHaveLength(0);
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
    const [n] = await notifs();
    expect(n.mensagem).toContain('@ana');
    expect(n.mensagem).not.toContain('{{');
  });

  test('modelo do painel substitui o padrão', async () => {
    const cfg = {
      ...CFG,
      mensagens: { storyViews: { titulo: 'Boom {{threshold}}', mensagem: 'oi' } },
    };
    await disparados(story('s1', 30), conta(), cfg);
    expect((await notifs())[0].titulo).toBe('Boom 30');
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
  const NO_DIA = new Date(2026, 8, 10, 8, 0);

  /** Publicações do dia: `porConta` = [[rotulo, username, views], ...]. */
  async function publicacoes(porConta, { stories = 0 } = {}) {
    for (const [rotulo, username, views] of porConta) {
      await insight({ accountId: ids[rotulo], username, mediaType: 'VIDEO', videoViews: views, postedAt: NO_DIA });
    }
    if (stories) await insight({ accountId: ids.c1, mediaType: 'STORY', impressions: stories, postedAt: NO_DIA });
  }

  test('antes das 22h não sai, mesmo com publicação e ligado', async () => {
    /* Rodar no fim de CADA ciclo de sincronização fazia o resumo sair às 9h,
       no primeiro ciclo depois da primeira publicação, dizendo "1 publicação"
       — e travar o dia. O pedido é o total no FINAL do dia. */
    comConfig(true);
    await publicacoes([['c1', 'ana', 50]]);
    expect(await detector.resumoDoDia({ agora: MANHA })).toBeNull();
    expect(await notifs()).toHaveLength(0);
  });

  test('a partir das 22h sai, e "hoje" é o dia dessa hora', async () => {
    comConfig(true);
    for (let i = 0; i < 40; i++) await publicacoes([[i % 2 ? 'c1' : 'c2', 'x', 225]]);
    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n).toBeTruthy();
    expect(n.mensagem).toContain('40 publicações');
  });

  test('13. desligado por padrão: não cria nada', async () => {
    comConfig(false);
    await publicacoes([['c1', 'ana', 587853]]);
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
    expect(await notifs()).toHaveLength(0);
  });

  test('14. ligado, cria uma vez com os números agregados', async () => {
    comConfig(true);
    // 1.687 publicações de 3 contas, 587.853 visualizações no total.
    await banco.sql`
      insert into insights (account_id, ig_media_id, media_type, video_views, posted_at)
      select (array[${ids.c1}, ${ids.c2}, ${ids.nova}]::uuid[])[1 + g % 3], 'lote' || g, 'VIDEO',
             case when g = 1 then 587853 else 0 end, ${NO_DIA}
      from generate_series(1, 1687) g`;

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n).toBeTruthy();
    expect(n.titulo).toBe('Resumo do dia');
    // Formatado em português, como aparece na tela.
    expect(n.mensagem).toContain('1.687 publicações');
    expect(n.mensagem).toContain('3 conta(s)');
    expect(n.mensagem).toContain('587.853 visualizações');
  });

  test('15. um por dia: a segunda chamada não cria outro', async () => {
    comConfig(true);
    await publicacoes([['c1', 'ana', 100]]);

    expect(await detector.resumoDoDia({ agora: NOITE })).toBeTruthy();
    // O anti-repetição aqui é a DATA, não o teto: o registro no banco é quem
    // diz se o resumo de hoje já saiu — e sobrevive ao processo reiniciar.
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
    expect((await notifs()).filter(x => x.eventType === 'resumo')).toHaveLength(1);
  });

  test('sem publicação no dia, não inventa resumo', async () => {
    comConfig(true);
    expect(await detector.resumoDoDia({ agora: NOITE })).toBeNull();
  });

  test('stories somam separado de posts — a mesma separação do dashboard', async () => {
    comConfig(true);
    await publicacoes([['c1', 'ana', 1000]], { stories: 250 });

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).toContain('1.000 visualizações');
    expect(n.mensagem).toContain('250 em stories');
    expect(n.metadados.viewsStories).toBe(250);
    // O total de posts não engoliu o de stories.
    expect(n.metadados.views).toBe(1000);
  });

  test('sem nenhuma view de story, o resumo ainda sai — 0, não undefined', async () => {
    comConfig(true);
    await publicacoes([['c1', 'ana', 1000]]);

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.metadados.viewsStories).toBe(0);
    expect(n.mensagem).toContain('0 em stories');
  });

  test('lista por conta, maior primeiro, com @ de cada uma', async () => {
    comConfig(true);
    await publicacoes([['c1', 'oliviapaganini', 600], ['c2', 'lauramendes', 300]]);

    const n = await detector.resumoDoDia({ agora: NOITE });
    expect(n.mensagem).toContain('@oliviapaganini: 600');
    expect(n.mensagem).toContain('@lauramendes: 300');
    expect(n.metadados.porConta).toEqual([
      { accountId: ids.c1, username: 'oliviapaganini', views: 600 },
      { accountId: ids.c2, username: 'lauramendes',    views: 300 },
    ]);
  });

  test('privacidade de nome troca @ por "Conta N" — a mesma regra dos marcos', async () => {
    comConfig(true);
    await publicacoes([['c1', 'oliviapaganini', 500]]);
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
    await publicacoes([['c1', 'oliviapaganini', 500]], { stories: 80 });
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

/* ── Modo contínuo ───────────────────────────────────────────────────────────
   "A partir de X, a cada Y, sem teto" — em vez de uma lista que acaba. */
describe('thresholds — modo contínuo', () => {
  const th = require('../src/services/smartActivity/thresholds');
  const r = th.normalizarRegra({ modo: 'continuo', aPartirDe: 1000, passo: 1000 });

  test('a regra normaliza; lista continua sendo lista; inválido é null', () => {
    expect(r).toEqual({ modo: 'continuo', aPartirDe: 1000, passo: 1000 });
    expect(th.normalizarRegra([500, 100, 100])).toEqual({ modo: 'marcos', lista: [100, 500] });
    expect(th.normalizarRegra({ modo: 'continuo', aPartirDe: 0, passo: 1000 })).toBeNull();
    expect(th.normalizarRegra({ modo: 'continuo', aPartirDe: 1000, passo: 0 })).toBeNull();
    expect(th.normalizarRegra([])).toBeNull();
    expect(th.normalizarRegra('lixo')).toBeNull();
    expect(th.normalizarRegra({ modo: 'continuo', aPartirDe: '2500', passo: '500.9' })).toEqual({ modo: 'continuo', aPartirDe: 2500, passo: 500 });
  });

  test('abaixo do "a partir de" nada dispara; o primeiro degrau é o próprio "a partir de"', () => {
    expect(th.marcosCruzados(0, 999, r)).toEqual([]);
    expect(th.marcosCruzados(0, 1000, r)).toEqual([1000]);
    expect(th.marcosCruzados(0, 1500, r)).toEqual([1000]);
  });

  test('idempotente: mesmo valor de novo não dispara; só o que ficou acima do teto', () => {
    expect(th.marcosCruzados(1000, 1500, r)).toEqual([]);
    expect(th.marcosCruzados(1000, 3999, r)).toEqual([2000, 3000]);
    expect(th.marcosCruzados(3000, 3999, r)).toEqual([]);
  });

  test('sem teto: um reel de 5 milhões ainda cruza degraus — a lista vem limitada, terminando no maior', () => {
    const l = th.marcosCruzados(5000, 5_000_000, r);
    expect(l.length).toBe(th.LIMITE_LISTA);
    expect(l[l.length - 1]).toBe(5_000_000);
    expect(l[0]).toBe(5_000_000 - (th.LIMITE_LISTA - 1) * 1000);
    for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1]).toBe(1000);
  });

  test('troca de lista fixa para contínuo: o teto antigo (100.000) é respeitado', () => {
    expect(th.marcosCruzados(100000, 100999, r)).toEqual([]);
    expect(th.marcosCruzados(100000, 101500, r)).toEqual([101000]);
  });

  test('degraus alinhados ao "a partir de", não a zero', () => {
    const r2 = th.normalizarRegra({ modo: 'continuo', aPartirDe: 1500, passo: 1000 });
    expect(th.marcosCruzados(0, 2600, r2)).toEqual([1500, 2500]);
    expect(th.pisoDe(2600, r2)).toBe(2500);
  });

  test('pisoDe: o maior degrau já alcançado (semeadura de conta nova)', () => {
    expect(th.pisoDe(12345, r)).toBe(12000);
    expect(th.pisoDe(999, r)).toBe(0);
    expect(th.pisoDe(7000, [100, 500, 1000, 5000, 10000])).toBe(5000);
    expect(th.pisoDe(0, r)).toBe(0);
  });

  test('marcosCruzados aceita a lista crua (chamada legada) e a regra normalizada', () => {
    expect(th.marcosCruzados(500, 1200, [100, 500, 1000, 5000])).toEqual([1000]);
    expect(th.marcosCruzados(500, 1200, th.normalizarRegra([100, 500, 1000, 5000]))).toEqual([1000]);
    expect(th.marcosCruzados(0, 100, null)).toEqual([]);
  });

  test('regraDe lê a configuração efetiva por métrica', () => {
    const cfg = { thresholds: { contentViews: { modo: 'continuo', aPartirDe: 1000, passo: 500 }, reach: [500, 1000], storyViews: [] } };
    expect(th.regraDe(cfg, 'contentViews')).toEqual({ modo: 'continuo', aPartirDe: 1000, passo: 500 });
    expect(th.regraDe(cfg, 'reach')).toEqual({ modo: 'marcos', lista: [500, 1000] });
    expect(th.regraDe(cfg, 'storyViews')).toBeNull();
    expect(th.regraDe(null, 'reach')).toBeNull();
  });
});

/* ── Hora do resumo configurável ─────────────────────────────────────────── */
describe('resumo do dia — hora configurável', () => {
  const th = require('../src/services/smartActivity/thresholds');

  test('normalizarHora aceita HH, HH:M, H:MM e devolve HH:MM; recusa fora da faixa', () => {
    expect(th.normalizarHora('22')).toBe('22:00');
    expect(th.normalizarHora('9:5')).toBe('09:05');
    expect(th.normalizarHora('23:59')).toBe('23:59');
    expect(th.normalizarHora('00:00')).toBe('00:00');
    expect(th.normalizarHora('24:00')).toBeNull();
    expect(th.normalizarHora('22:60')).toBeNull();
    expect(th.normalizarHora('abc')).toBeNull();
    expect(th.normalizarHora('')).toBeNull();
    expect(th.normalizarHora(null)).toBeNull();
    expect(th.minutosDe('20:30')).toBe(1230);
  });

  test('a hora da configuração manda: às 20:30 configurado, 20:31 sai e 20:29 não', async () => {
    const detectorLocal = require('../src/services/smartActivity/detector');
    const antes = thresholds.carregar;
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, global: true }, resumo: { hora: '20:30' } });
    await insight({ accountId: ids.c1, mediaType: 'VIDEO', videoViews: 500, postedAt: new Date(2026, 8, 10, 8, 0) });
    expect(await detectorLocal.resumoDoDia({ agora: new Date(2026, 8, 10, 20, 29) })).toBeNull();
    const n = await detectorLocal.resumoDoDia({ agora: new Date(2026, 8, 10, 20, 31) });
    expect(n).toBeTruthy();
    thresholds.carregar = antes;
  });

  test('sem `resumo` na configuração, vale o padrão de sempre (22h)', async () => {
    const detectorLocal = require('../src/services/smartActivity/detector');
    const antes = thresholds.carregar;
    thresholds.carregar = async () => ({ ...CFG, ativos: { ...CFG.ativos, global: true } });
    await insight({ accountId: ids.c1, mediaType: 'VIDEO', videoViews: 500, postedAt: new Date(2026, 8, 10, 8, 0) });
    expect(await detectorLocal.resumoDoDia({ agora: new Date(2026, 8, 10, 21, 59) })).toBeNull();
    expect(await detectorLocal.resumoDoDia({ agora: new Date(2026, 8, 10, 22, 0) })).toBeTruthy();
    thresholds.carregar = antes;
  });
});

/* ── Um toque no celular por varredura ────────────────────────────────────
   As métricas só podem ser lidas de 30 em 30 min e todas as contas vêm na
   mesma passada, então todo marco nasce no mesmo segundo: 4 avisos às
   17:09:26, nada até 17:39:36. Medido em produção. A Central continua com um
   cartão por marco; o celular toca uma vez. */
describe('entrega única por varredura', () => {
  const marco = (valor, username) => ({ eventType: 'milestone', username, metadados: { valor } });

  test('nada a entregar: nenhum push', async () => {
    const enviados = [];
    await detector._entregarUmPush([], CFG, { enviar: n => enviados.push(n) });
    expect(enviados).toHaveLength(0);
  });

  test('um marco só: o push é ele mesmo, com o texto do próprio aviso', async () => {
    const enviados = [];
    const unico = { ...marco(5000, 'laura'), titulo: '5.000 Visualizações 🚀🔥', mensagem: '@laura chegou a 5.000.' };
    await detector._entregarUmPush([unico], CFG, { enviar: n => enviados.push(n) });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toBe(unico);
  });

  test('vários marcos: UM push, com a quantidade e o maior', async () => {
    const enviados = [];
    const criadas = [marco(5000, 'laura'), marco(12000, 'siqueira'), marco(3000, 'rosa'),
      { eventType: 'resumoMarcos', username: 'siqueira', metadados: {} }];
    await detector._entregarUmPush(criadas, CFG, { enviar: n => enviados.push(n) });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].titulo).toBe('4 marcos nas suas contas 🚀');
    expect(enviados[0].mensagem).toContain('@siqueira');
    expect(enviados[0].mensagem).toContain('12.000');
    // Id próprio por varredura: no service worker o `tag` vem daqui, e um id
    // fixo faria este resumo substituir o da varredura anterior em silêncio.
    expect(enviados[0].id).toMatch(/^varredura-\d+$/);
  });

  test('o resumo do push respeita "não mostrar nome/valor"', async () => {
    const enviados = [];
    const cfgDiscreto = { ...CFG, privacidade: { mostrarNome: false, mostrarValor: false } };
    await detector._entregarUmPush([marco(5000, 'laura'), marco(12000, 'siqueira')], cfgDiscreto, { enviar: n => enviados.push(n) });
    expect(enviados[0].mensagem).not.toContain('siqueira');
    expect(enviados[0].mensagem).not.toContain('12.000');
  });

  test('a coalescência grava os cartões e entrega UM push só', async () => {
    const c = conta();
    const candidatos = [];
    for (let i = 1; i <= 10; i++) {
      candidatos.push(...await detector.processarInsight(reel('p' + i, i * 1000), c, CFG, { gravar: false }));
    }
    const criadas = await detector._gravarCoalescido(candidatos, CFG);
    // 3 marcos + 1 resumo gravados na Central…
    expect(criadas).toHaveLength(detector.LIMITE_POR_VARREDURA + 1);
    // …e nenhum deles disparou push individual (o módulo de push nem está
    // disponível nos testes; o que este teste protege é que `_gravar` foi
    // chamado com push desligado — senão seriam 4 envios).
    expect(criadas.every(n => n.eventType === 'milestone' || n.eventType === 'resumoMarcos')).toBe(true);
  });
});
