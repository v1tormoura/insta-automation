'use strict';

/**
 * Figurinha de link do story — geometria e ligação com o publish.
 *
 * O que estes testes protegem: a caixa desenhada na mídia e a área de toque
 * enviada ao Instagram têm de ser a MESMA. Quando divergem, o link volta a
 * ficar "invisível" (toque num lugar, pílula em outro).
 */

jest.mock('../src/models/Account', () => ({ findById: jest.fn() }));
jest.mock('../src/services/instagramPrivateService', () => ({ createClient: jest.fn() }));
jest.mock('../src/services/storyWebSession', () => ({
  postStoryWebSession: jest.fn(),
  hasPuppeteerSession: jest.fn(() => false),
}));
jest.mock('../src/services/storyPuppeteer', () => ({ postStoryPuppeteer: jest.fn() }));

const {
  computeStickerBox, formatStickerLabel, STORY_W, STORY_H,
} = require('../src/services/storyStickerRenderer');

describe('computeStickerBox', () => {
  test('x/y são o centro e viram pixels do story 1080x1920', () => {
    const box = computeStickerBox({ label: 'ACESSAR LINK', linkX: 0.5, linkY: 0.8 });
    expect(box.xPx).toBe(STORY_W / 2);
    expect(box.yPx).toBe(Math.round(0.8 * STORY_H));
    expect(box.x).toBeCloseTo(0.5, 5);
    expect(box.y).toBeCloseTo(0.8, 5);
  });

  test('a caixa normalizada corresponde aos pixels — é ela que vira área de toque', () => {
    const box = computeStickerBox({ label: 'Ver oferta', linkX: 0.35, linkY: 0.62 });
    expect(box.width).toBeCloseTo(box.wPx / STORY_W, 5);
    expect(box.height).toBeCloseTo(box.hPx / STORY_H, 5);
    expect(box.x).toBeCloseTo(box.xPx / STORY_W, 5);
    expect(box.y).toBeCloseTo(box.yPx / STORY_H, 5);
  });

  test('figurinha pedida na borda é puxada para dentro do story inteira', () => {
    for (const [lx, ly] of [[0, 0], [1, 1], [0.01, 0.99]]) {
      const box = computeStickerBox({ label: 'MEUSITE.COM', linkX: lx, linkY: ly });
      expect(box.xPx - box.wPx / 2).toBeGreaterThanOrEqual(0);
      expect(box.xPx + box.wPx / 2).toBeLessThanOrEqual(STORY_W);
      expect(box.yPx - box.hPx / 2).toBeGreaterThanOrEqual(0);
      expect(box.yPx + box.hPx / 2).toBeLessThanOrEqual(STORY_H);
    }
  });

  test('largura acompanha o texto, dentro dos limites da pílula', () => {
    const curto = computeStickerBox({ label: 'OI' });
    const medio = computeStickerBox({ label: 'MEUSITE.COM' });
    expect(curto.wPx).toBe(360);                       // piso da pílula
    expect(medio.wPx).toBe(11 * 23 + 165);             // 11 maiúsculas + cromo
    expect(computeStickerBox({ label: 'X'.repeat(200) }).wPx).toBe(900);
    // Minúsculas ocupam menos que maiúsculas — a pílula acompanha.
    expect(computeStickerBox({ label: 'a'.repeat(30) }).wPx)
      .toBeLessThan(computeStickerBox({ label: 'A'.repeat(30) }).wPx);
  });

  test('emoji alarga a pílula — são quadrados, não letras', () => {
    // Contar emoji como letra encolhia a pílula e o texto saía com reticências.
    const comEmoji = computeStickerBox({ label: 'Oferta 🔥🔥🔥🔥🔥🔥' });
    const soLetras = computeStickerBox({ label: 'Oferta aaaaaa' });
    expect(comEmoji.wPx).toBeGreaterThan(soLetras.wPx);
  });

  test('largura/altura explícitas mandam sobre o cálculo automático', () => {
    const box = computeStickerBox({ label: 'OI', linkWidth: 0.6, linkHeight: 0.05 });
    expect(box.wPx).toBe(Math.round(0.6 * STORY_W));
    expect(box.hPx).toBe(Math.round(0.05 * STORY_H));
  });

  test('sem posição informada cai no rodapé, como o app', () => {
    const box = computeStickerBox({ label: 'MEUSITE.COM' });
    expect(box.y).toBeCloseTo(0.8, 3);
    expect(box.x).toBeCloseTo(0.5, 3);
  });
});

describe('formatStickerLabel', () => {
  test('sem texto customizado usa o domínio', () => {
    expect(formatStickerLabel('https://www.meusite.com/uma/rota/bem/longa')).toBe('MEUSITE.COM');
  });
  test('rota curta entra no rótulo', () => {
    expect(formatStickerLabel('https://meusite.com/oferta')).toBe('MEUSITE.COM/OFERTA');
  });
  test('texto customizado vence e é limitado a 35 caracteres', () => {
    expect(formatStickerLabel('https://x.com', 'Ver oferta')).toBe('Ver oferta');
    expect(formatStickerLabel('https://x.com', 'A'.repeat(80))).toHaveLength(35);
  });
  test('emoji não é cortado ao meio no limite de 35', () => {
    // `.slice()` conta unidades UTF-16 e partiria o par substituto, deixando
    // meio caractere quebrado no fim da pílula.
    const rotulo = formatStickerLabel('https://x.com', 'A'.repeat(34) + '🔥');
    expect(rotulo).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(rotulo.endsWith('🔥')).toBe(true);
  });

  test('emoji composto conta como um caractere só', () => {
    // 👨‍👩‍👧 são vários code points unidos por ZWJ — cortar por code point
    // desmontaria a família em pessoas soltas.
    const rotulo = formatStickerLabel('https://x.com', '👨‍👩‍👧 familia');
    expect(rotulo).toContain('👨‍👩‍👧');
  });

  test('URL inválida não quebra a publicação', () => {
    expect(formatStickerLabel('nada disso :: aqui')).toBeTruthy();
  });
});

describe('postStory — instagrapi com link', () => {
  const publishStory = jest.fn();

  function carregar(modo) {
    jest.resetModules();
    process.env.STORY_LINK_MODE = modo;
    publishStory.mockReset().mockResolvedValue({ media_id: '99', with_link: true, link_native: false });

    jest.doMock('../src/providers/ProviderFactory', () => ({
      getProvider: () => ({ publishStory }),
    }));
    jest.doMock('../src/services/storyStickerRenderer', () => {
      const real = jest.requireActual('../src/services/storyStickerRenderer');
      return {
        ...real,
        renderStoryWithLinkSticker: jest.fn(async (entrada, opcoes) => ({
          path: require('path').resolve(__dirname, '../uploads/processed/queimada.jpg'),
          rendered: true,
          engine: 'chromium',
          box: real.computeStickerBox({
            label: real.formatStickerLabel(opcoes.linkUrl, opcoes.linkText), ...opcoes,
          }),
        })),
      };
    });
    return require('../src/services/storyService');
  }

  const conta = { _id: 'c1', username: 'teste', provider: 'instagrapi' };

  afterAll(() => { delete process.env.STORY_LINK_MODE; });

  test('modo burned: publica a mídia queimada e a área de toque é a caixa desenhada', async () => {
    const { postStory } = carregar('burned');
    const r = await postStory(conta, {
      imageUrl: 'http://srv/uploads/stories/1.jpg',
      linkUrl:  'https://meusite.com/oferta',
      linkText: 'Ver oferta',
      linkX: 0.5, linkY: 0.8,
    });

    const enviado = publishStory.mock.calls[0][1];
    const esperado = require('../src/services/storyStickerRenderer')
      .computeStickerBox({ label: 'Ver oferta', linkX: 0.5, linkY: 0.8 });

    expect(enviado.media).toBe('processed/queimada.jpg');
    expect(enviado.linkStickerMode).toBe('burned');
    expect(enviado.linkX).toBeCloseTo(esperado.x, 5);
    expect(enviado.linkY).toBeCloseTo(esperado.y, 5);
    expect(enviado.linkWidth).toBeCloseTo(esperado.width, 5);
    expect(enviado.linkHeight).toBeCloseTo(esperado.height, 5);
    expect(enviado.linkText).toBe('Ver oferta');
    expect(r.linkVisible).toBe(true);
  });

  test('modo native: mídia original, mas a caixa continua dimensionada', async () => {
    const { postStory } = carregar('native');
    await postStory(conta, {
      imageUrl: 'http://srv/uploads/stories/1.jpg',
      linkUrl:  'https://meusite.com',
      linkX: 0.5, linkY: 0.5,
    });

    const enviado = publishStory.mock.calls[0][1];
    expect(enviado.media).toBe('stories/1.jpg');
    expect(enviado.linkStickerMode).toBe('native');
    expect(enviado.linkWidth).toBeGreaterThan(0);
    expect(
      require('../src/services/storyStickerRenderer').renderStoryWithLinkSticker
    ).not.toHaveBeenCalled();
  });

  test('story sem link não passa pelo renderizador', async () => {
    const { postStory } = carregar('burned');
    await postStory(conta, { imageUrl: 'http://srv/uploads/stories/1.jpg' });

    expect(publishStory.mock.calls[0][1].media).toBe('stories/1.jpg');
    expect(
      require('../src/services/storyStickerRenderer').renderStoryWithLinkSticker
    ).not.toHaveBeenCalled();
  });

  test('falha ao queimar não derruba o story — publica a mídia original', async () => {
    jest.resetModules();
    process.env.STORY_LINK_MODE = 'burned';
    publishStory.mockReset().mockResolvedValue({ media_id: '99', with_link: true });

    jest.doMock('../src/providers/ProviderFactory', () => ({ getProvider: () => ({ publishStory }) }));
    jest.doMock('../src/services/storyStickerRenderer', () => {
      const real = jest.requireActual('../src/services/storyStickerRenderer');
      return {
        ...real,
        renderStoryWithLinkSticker: jest.fn(async (entrada, opcoes) => ({
          path: entrada, rendered: false, engine: null, error: 'sem chromium',
          box: real.computeStickerBox(opcoes),
        })),
      };
    });

    const { postStory } = require('../src/services/storyService');
    const r = await postStory(conta, {
      imageUrl: 'http://srv/uploads/stories/1.jpg',
      linkUrl:  'https://meusite.com',
    });

    expect(publishStory.mock.calls[0][1].media).toBe('stories/1.jpg');
    expect(r.id).toBe('99');
    expect(r.linkVisible).toBe(false);
  });

  test('a cópia queimada é apagada depois do upload e a original fica intacta', async () => {
    const fs = require('fs');
    const path = require('path');
    const processados = path.resolve(__dirname, '../uploads/processed');
    fs.mkdirSync(processados, { recursive: true });
    const queimada = path.join(processados, 'teste_descarte.jpg');
    const original = path.resolve(__dirname, '../uploads/stories/original_teste.jpg');
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(queimada, 'x');
    fs.writeFileSync(original, 'x');

    jest.resetModules();
    process.env.STORY_LINK_MODE = 'burned';
    publishStory.mockReset().mockResolvedValue({ media_id: '99', with_link: true });
    jest.doMock('../src/providers/ProviderFactory', () => ({ getProvider: () => ({ publishStory }) }));
    jest.doMock('../src/services/storyStickerRenderer', () => {
      const real = jest.requireActual('../src/services/storyStickerRenderer');
      return {
        ...real,
        renderStoryWithLinkSticker: jest.fn(async (entrada, opcoes) => ({
          path: queimada, rendered: true, engine: 'chromium',
          box: real.computeStickerBox(opcoes),
        })),
      };
    });

    const { postStory } = require('../src/services/storyService');
    await postStory(conta, {
      imageUrl: 'http://srv/uploads/stories/original_teste.jpg',
      linkUrl:  'https://meusite.com',
    });

    expect(fs.existsSync(queimada)).toBe(false);
    expect(fs.existsSync(original)).toBe(true);
    fs.unlinkSync(original);
  });
});
