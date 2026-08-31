/**
 * Métricas de publicação pela sessão instagrapi.
 *
 * ── O defeito que estes testes fecham
 *
 * O ciclo de métricas varria só contas com `accessToken` + `igUserId`, o
 * caminho Graph API. Numa base só instagrapi ele encontrava ZERO contas e não
 * fazia nada — para sempre, sem erro, sem log. Métrica de post nunca
 * atualizava, os marcos de "visualizações de post" nunca disparavam, e o
 * painel exibia a opção ligada.
 *
 * Uma opção ligada que não pode funcionar é pior que uma desligada: quem a vê
 * conclui que só falta esperar, e espera indefinidamente.
 */

const mockInsights = [];
const mockMediaInsights = jest.fn();

jest.mock('../src/models/Insight', () => ({
  async findOneAndUpdate(filtro, dados) {
    const i = mockInsights.findIndex(x => x.igMediaId === filtro.igMediaId);
    if (i >= 0) mockInsights[i] = { ...mockInsights[i], ...dados };
    else mockInsights.push({ ...dados });
    return dados;
  },
  updateOne: async () => ({ modifiedCount: 0 }),
  find: () => ({ select: () => ({ lean: async () => [] }) }),
}));

jest.mock('../src/providers/ProviderFactory', () => ({
  getProvider: () => ({ mediaInsights: mockMediaInsights }),
}));

const { syncAccountInsightsInstagrapi } = require('../src/services/insightSyncService');

const conta = { _id: 'c1', username: 'oliviapaganini' };

const midia = (over = {}) => ({
  media_id: '178551331', media_type: 'VIDEO', code: 'Cxyz', caption: 'legenda',
  thumbnail_url: 'https://cdn/x.jpg', taken_at: '2026-08-20T12:00:00.000Z',
  like_count: 100, comment_count: 10, share_count: 4, saved_count: 6,
  reach: 0, impressions: 0, video_views: 5000, fonte: 'contadores', ...over,
});

beforeEach(() => {
  mockInsights.length = 0;
  mockMediaInsights.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('gravação', () => {
  test('grava as publicações vindas da sessão', async () => {
    mockMediaInsights.mockResolvedValue({ itens: [midia()], total: 1 });
    const r = await syncAccountInsightsInstagrapi(conta);

    expect(r.synced).toBe(1);
    expect(mockInsights[0].igMediaId).toBe('178551331');
    expect(mockInsights[0].videoViews).toBe(5000);
    expect(mockInsights[0].accountId).toBe('c1');
  });

  test('usa a MESMA fórmula de engajamento do caminho Graph', () => {
    /* Duas fórmulas para a mesma métrica fariam o ranking mudar de critério
       conforme a origem da conta — e dois posts iguais pontuariam diferente
       sem que nada na tela explicasse por quê. */
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'insightSyncService.js'), 'utf8');
    const formulas = fonte.match(
      /likeCount \+ commentsCount \* 3 \+ shareCount \* 5 \+ savedCount \* 4\s*\n?\s*\+ Math\.floor\(\(videoViews \|\| impressions\) \* 0\.1\)/g) || [];
    expect(formulas.length).toBe(2);
  });

  test('o score bate com a fórmula', async () => {
    mockMediaInsights.mockResolvedValue({ itens: [midia()], total: 1 });
    await syncAccountInsightsInstagrapi(conta);
    // 100 + 10*3 + 4*5 + 6*4 + floor(5000*0.1) = 100+30+20+24+500
    expect(mockInsights[0].engagementScore).toBe(674);
  });

  test('permalink é montado a partir do código da mídia', async () => {
    mockMediaInsights.mockResolvedValue({ itens: [midia({ code: 'ABC123' })], total: 1 });
    await syncAccountInsightsInstagrapi(conta);
    expect(mockInsights[0].permalink).toBe('https://www.instagram.com/p/ABC123/');
  });

  test('sem código, o permalink fica vazio em vez de virar link quebrado', async () => {
    mockMediaInsights.mockResolvedValue({ itens: [midia({ code: '' })], total: 1 });
    await syncAccountInsightsInstagrapi(conta);
    expect(mockInsights[0].permalink).toBe('');
  });
});

describe('alcance ausente não é alcance zero', () => {
  test('conta pessoal grava alcance 0 e o score cai nas reproduções', async () => {
    // O endpoint de insights só responde a conta profissional. Quando ele não
    // responde, o número não existe — e tratar isso como "ninguém viu" seria
    // uma afirmação falsa sobre a publicação.
    mockMediaInsights.mockResolvedValue({ itens: [midia({ reach: 0, fonte: 'contadores' })], total: 1 });
    const r = await syncAccountInsightsInstagrapi(conta);

    expect(mockInsights[0].reach).toBe(0);
    expect(mockInsights[0].engagementScore).toBeGreaterThan(0);
    expect(r.comAlcance).toBe(0);
  });

  test('conta profissional grava o alcance real e o relatório o conta', async () => {
    mockMediaInsights.mockResolvedValue({
      itens: [midia({ reach: 8400, impressions: 12100, fonte: 'insights' })], total: 1,
    });
    const r = await syncAccountInsightsInstagrapi(conta);

    expect(mockInsights[0].reach).toBe(8400);
    expect(mockInsights[0].impressions).toBe(12100);
    expect(r.comAlcance).toBe(1);
  });
});

describe('tolerância', () => {
  test('falha na sessão não derruba o ciclo das outras contas', async () => {
    mockMediaInsights.mockRejectedValue(Object.assign(new Error('sessão expirada'), { code: 'SESSION_EXPIRED' }));
    const r = await syncAccountInsightsInstagrapi(conta);
    expect(r.synced).toBe(0);
    expect(r.error).toContain('sessão expirada');
  });

  test('resposta vazia não quebra', async () => {
    mockMediaInsights.mockResolvedValue({ itens: [], total: 0 });
    expect((await syncAccountInsightsInstagrapi(conta)).synced).toBe(0);
  });
});

describe('o ciclo varre as duas fontes', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'services', 'insightSyncService.js'), 'utf8');

  test('a consulta de contas aceita Graph OU instagrapi', () => {
    // Era `{ accessToken, igUserId }` e nada mais — a razão de zero contas
    // serem varridas numa base inteira.
    expect(fonte).toMatch(/provider:\s*'instagrapi'/);
    expect(fonte).toMatch(/instagrapiSession:\s*\{\s*\$nin/);
  });

  test('conta com token da Meta continua indo pelo Graph', () => {
    // Graph traz alcance e impressões oficiais; trocar por instagrapi numa
    // conta que tem token seria perder dado por padronização.
    expect(fonte).toMatch(/temGraph[\s\S]{0,80}syncAccountInsights\(acc\)/);
  });
});
