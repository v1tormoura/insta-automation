/**
 * Story agendado — o caminho que a fila usa para publicar histórias.
 *
 * ── O defeito que estes testes fecham
 *
 * O worker recusava story quando a conta era instagrapi, com a mensagem
 * "instagrapi não suporta stories — configure a conta com sessão mobile". A
 * afirmação era falsa em todas as camadas abaixo dela: o provider implementa
 * `publishStory`, o cliente HTTP monta o corpo com figurinha de link, e o
 * serviço Python expõe `/publish/story`.
 *
 * O custo desse tipo de erro não é só o story não sair. É a mensagem mandar
 * quem investiga para o lugar errado — "configure a sessão mobile" descreve
 * uma providência que já estava tomada, então a pessoa reconfigura, testa de
 * novo, falha de novo, e conclui que o problema é a conta.
 *
 * Existiam duas implementações da mesma decisão: a página de Stories escolhia
 * o provedor por conta e publicava; a fila escolhia de novo, por conta
 * própria, e escolhia errado. Agora a fila delega à primeira.
 */

jest.mock('../src/models/Account', () => ({ findById: jest.fn() }));
jest.mock('../src/services/instagramPrivateService', () => ({ createClient: jest.fn() }));
jest.mock('../src/services/storyWebSession', () => ({
  postStoryWebSession: jest.fn(),
  hasPuppeteerSession: jest.fn(() => false),
}));
jest.mock('../src/services/storyPuppeteer', () => ({ postStoryPuppeteer: jest.fn() }));

const mockPublishStory = jest.fn();
jest.mock('../src/providers/ProviderFactory', () => ({
  getProvider: () => ({ publishStory: mockPublishStory }),
}));

/* A queima da figurinha lê e escreve arquivo. Aqui interessa a ESCOLHA do
   caminho, não o desenho da pílula — que já tem os seus próprios testes. */
jest.mock('../src/services/storyStickerRenderer', () => ({
  // `rendered: false` = sem queima, então o serviço envia a mídia original e
  // deixa o link para a figurinha nativa. É o caminho mais simples e o que
  // interessa aqui: se o linkUrl chega ao provider.
  renderStoryWithLinkSticker: jest.fn(async () => ({ rendered: false, engine: 'nenhum' })),
  computeStickerBox: jest.fn(() => null),
  formatStickerLabel: jest.fn((t) => t),
  generateStickerPng: jest.fn(),
  STORY_W: 1080,
  STORY_H: 1920,
}));

const { readFileSync } = require('fs');
const { join } = require('path');

const storyService = require('../src/services/storyService');

beforeEach(() => {
  mockPublishStory.mockReset();
  mockPublishStory.mockResolvedValue({ media_id: '178551331', with_link: false });
});

describe('a capacidade existe de verdade', () => {
  test('o provider instagrapi implementa publishStory', () => {
    // Se um dia deixar de implementar, a recusa que foi removida volta a ser
    // verdadeira — e é melhor descobrir aqui do que por um story que sumiu.
    const InstagrapiProvider = require('../src/providers/InstagrapiProvider');
    const proto = InstagrapiProvider.prototype || InstagrapiProvider;
    expect(typeof proto.publishStory).toBe('function');
  });

  test('o cliente HTTP fala com /publish/story', () => {
    const fonte = readFileSync(
      join(__dirname, '..', 'src', 'services', 'instagrapi', 'InstagrapiHttpClient.js'), 'utf8'
    );
    expect(fonte).toContain('/publish/story');
  });
});

describe('escolha de caminho por conta', () => {
  test('conta instagrapi publica pelo provider, não cai em Graph nem em navegador', async () => {
    const conta = { _id: 'c1', username: 'oliviapaganini', provider: 'instagrapi' };
    const r = await storyService.postStory(conta, { imageUrl: '/uploads/x.jpg' });

    expect(mockPublishStory).toHaveBeenCalledTimes(1);
    expect(r.method).toBe('instagrapi');
    expect(r.id).toBe('178551331');
  });

  test('conta com sessão instagrapi sem provider declarado também vai por ele', async () => {
    // Contas mais antigas guardam a sessão sem ter o campo `provider` gravado.
    const conta = { _id: 'c2', username: 'antiga', instagrapiSession: 'blob' };
    await storyService.postStory(conta, { imageUrl: '/uploads/x.jpg' });
    expect(mockPublishStory).toHaveBeenCalledTimes(1);
  });

  test('o link chega ao provider', async () => {
    const conta = { _id: 'c3', username: 'x', provider: 'instagrapi' };
    await storyService.postStory(conta, {
      imageUrl: '/uploads/x.jpg', linkUrl: 'https://exemplo.com', linkText: 'Ver mais',
    });

    const [, dados] = mockPublishStory.mock.calls[0];
    expect(dados.linkUrl).toBe('https://exemplo.com');
    expect(dados.linkText).toBe('Ver mais');
  });
});

describe('a fila delega, não decide de novo', () => {
  /* O worker não é carregável em teste: ao ser requerido ele conecta no Redis
     e começa a consumir a fila. Então esta parte é lida da fonte.

     Um teste estrutural prova menos que um funcional, e é o que existe aqui.
     O que ele garante é justamente o que quebrou: que a fila não volte a
     tomar a decisão por conta própria nem a repetir a recusa. */
  const fonte = readFileSync(join(__dirname, '..', 'src', 'queue', 'worker.js'), 'utf8');

  test('story é desviado para o serviço de story', () => {
    expect(fonte).toMatch(/postType\s*\|\|\s*'reel'\)\s*===\s*'story'/);
    expect(fonte).toContain("require('../services/storyService')");
  });

  test('o desvio acontece ANTES da bifurcação por provedor', () => {
    // Depois dela, o story cairia no caminho de reel de novo.
    const desvio = fonte.indexOf('const ehStory');
    // Sem casar espaçamento exato: o que importa é a ordem, não a formatação.
    const bifurcacao = fonte.search(/\?\s*await publishViaInstagrapi\(account, post\)/);
    expect(desvio).toBeGreaterThan(-1);
    expect(bifurcacao).toBeGreaterThan(-1);
    expect(desvio).toBeLessThan(bifurcacao);
  });

  test('a mensagem falsa sobre o instagrapi não voltou', () => {
    expect(fonte).not.toMatch(/instagrapi não suporta stories/i);
  });
});
