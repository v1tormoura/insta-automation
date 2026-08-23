'use strict';

/**
 * Ajustes de imagem do editor de vídeo.
 *
 * O que estes testes protegem: a interface fala em -100..100, o ffmpeg fala em
 * três escalas diferentes e nada intuitivas. Um erro de conversão aqui não
 * quebra nada — só entrega vídeo lavado, estourado ou preto, e ninguém liga o
 * defeito ao slider.
 */

const { buildAjustes, buildFilterComplex } = require('../src/services/renderEngine/filterBuilder');

/** Extrai `chave=valor` de dentro do filtro `eq=`. */
function eqValor(cadeia, chave) {
  const eq = cadeia.split(',').find(p => p.startsWith('eq='));
  if (!eq) return null;
  const m = eq.match(new RegExp(`${chave}=(-?[\\d.]+)`));
  return m ? Number(m[1]) : null;
}

describe('buildAjustes — neutro é neutro', () => {
  test('desativado não produz filtro nenhum', () => {
    expect(buildAjustes({ enabled: false, brilho: 100, contraste: 100 })).toBe('');
  });

  test('ativado com tudo em zero também não produz filtro', () => {
    // Um `eq` neutro custaria processamento em cada quadro sem mudar um pixel.
    expect(buildAjustes({ enabled: true })).toBe('');
  });

  test('sem argumento nenhum não quebra', () => {
    expect(buildAjustes()).toBe('');
  });
});

describe('buildAjustes — conversão das escalas', () => {
  test('brilho vai para a faixa do eq (-1..1), com 0 neutro', () => {
    expect(eqValor(buildAjustes({ enabled: true, brilho: 100 }), 'brightness')).toBeCloseTo(0.3, 4);
    expect(eqValor(buildAjustes({ enabled: true, brilho: -100 }), 'brightness')).toBeCloseTo(-0.3, 4);
    expect(eqValor(buildAjustes({ enabled: true, brilho: 50 }), 'brightness')).toBeCloseTo(0.15, 4);
  });

  test('contraste é multiplicador com 1 neutro, não 0', () => {
    // Mandar 0 para o eq deixaria o vídeo cinza chapado.
    expect(eqValor(buildAjustes({ enabled: true, contraste: 0, brilho: 10 }), 'contrast')).toBeCloseTo(1, 4);
    expect(eqValor(buildAjustes({ enabled: true, contraste: 100 }), 'contrast')).toBeCloseTo(1.5, 4);
    expect(eqValor(buildAjustes({ enabled: true, contraste: -100 }), 'contrast')).toBeCloseTo(0.5, 4);
  });

  test('saturação -100 não chega a zero — vídeo não vira preto e branco por acidente', () => {
    const s = eqValor(buildAjustes({ enabled: true, saturacao: -100 }), 'saturation');
    expect(s).toBeCloseTo(0.4, 4);
    expect(s).toBeGreaterThan(0);
  });

  test('valor fora da faixa é preso, não extrapolado', () => {
    expect(eqValor(buildAjustes({ enabled: true, brilho: 5000 }), 'brightness')).toBeCloseTo(0.3, 4);
    expect(eqValor(buildAjustes({ enabled: true, brilho: -5000 }), 'brightness')).toBeCloseTo(-0.3, 4);
  });

  test('valor não numérico vira zero em vez de NaN na cadeia', () => {
    const cadeia = buildAjustes({ enabled: true, brilho: 'muito', contraste: null, saturacao: undefined });
    expect(cadeia).not.toContain('NaN');
  });
});

describe('buildAjustes — filtros individuais', () => {
  test('nitidez vira unsharp', () => {
    expect(buildAjustes({ enabled: true, nitidez: 100 })).toContain('unsharp=');
  });

  test('ruído usa grão temporal, não sujeira parada', () => {
    // `allf=t` faz o grão mudar a cada quadro, como o de câmera. Sem isso o
    // ruído fica congelado na imagem e parece defeito.
    expect(buildAjustes({ enabled: true, ruido: 50 })).toContain('allf=t+u');
  });

  test('zoom corta e reescala para a resolução do canvas', () => {
    const cadeia = buildAjustes({ enabled: true, zoom: 100 }, 1080, 1920);
    expect(cadeia).toContain('crop=');
    expect(cadeia).toContain('scale=1080:1920');
  });

  test('zoom no máximo ainda é discreto — 10% no total', () => {
    const cadeia = buildAjustes({ enabled: true, zoom: 100 });
    expect(cadeia).toContain('crop=iw*0.9000');
  });

  test('espelhar entra como hflip', () => {
    expect(buildAjustes({ enabled: true, espelhar: true })).toContain('hflip');
  });

  test('o corte vem antes da cor — não se processa pixel que será descartado', () => {
    const cadeia = buildAjustes({ enabled: true, zoom: 50, brilho: 50 });
    expect(cadeia.indexOf('crop=')).toBeLessThan(cadeia.indexOf('eq='));
  });
});

describe('buildAjustes — quebra de hash', () => {
  const rand = () => 0.9;   // determinístico para o teste

  test('sozinha já muda os pixels', () => {
    expect(buildAjustes({ enabled: true, quebrarHash: true }, 1080, 1920, rand)).not.toBe('');
  });

  test('a variação é imperceptível — bem abaixo de um passo do slider', () => {
    const cadeia = buildAjustes({ enabled: true, quebrarHash: true }, 1080, 1920, rand);
    const b = eqValor(cadeia, 'brightness');
    // 1 ponto do slider já vale 0.003 de brilho; a variação fica abaixo disso.
    expect(Math.abs(b)).toBeLessThan(0.01);
  });

  test('renders diferentes produzem cadeias diferentes — é o ponto todo', () => {
    let n = 0;
    const sequencial = () => [0.1, 0.2, 0.3, 0.4][n++ % 4];
    const um   = buildAjustes({ enabled: true, quebrarHash: true }, 1080, 1920, sequencial);
    n = 0;
    const outro = buildAjustes({ enabled: true, quebrarHash: true }, 1080, 1920, () => 0.8);
    expect(um).not.toBe(outro);
  });

  test('não apaga o ajuste manual — soma a ele', () => {
    const cadeia = buildAjustes({ enabled: true, quebrarHash: true, brilho: 50 }, 1080, 1920, rand);
    expect(eqValor(cadeia, 'brightness')).toBeGreaterThan(0.14);
  });

  test('zoom manual maior prevalece sobre o micro-zoom da quebra', () => {
    const cadeia = buildAjustes({ enabled: true, quebrarHash: true, zoom: 100 }, 1080, 1920, rand);
    expect(cadeia).toContain('crop=iw*0.9000');
  });
});

describe('integração com o filter_complex', () => {
  const templateBase = {
    canvas: { width: 1080, height: 1920 },
    elements: [{ id: 'v', type: 'video', fit: 'cover' }],
    audio: {},
  };

  test('sem ajustes o grafo não ganha estágio novo', () => {
    const r = buildFilterComplex(templateBase, { VIDEO: '/x.mp4' });
    expect(r.filterComplex).not.toContain('[ajus]');
  });

  test('com ajustes o estágio entra e vira a saída de vídeo', () => {
    const r = buildFilterComplex(
      { ...templateBase, ajustes: { enabled: true, brilho: 30 } },
      { VIDEO: '/x.mp4' },
    );
    expect(r.filterComplex).toContain('[ajus]');
    expect(r.videoMap).toBe('[ajus]');
  });

  test('a borda é aplicada DEPOIS do ajuste — moldura não muda de cor', () => {
    const r = buildFilterComplex(
      {
        ...templateBase,
        ajustes: { enabled: true, saturacao: 80 },
        border: { enabled: true, thickness: 8, color: '#FFFFFF', opacity: 1 },
      },
      { VIDEO: '/x.mp4' },
    );
    expect(r.filterComplex.indexOf('[ajus]')).toBeLessThan(r.filterComplex.indexOf('drawbox'));
    expect(r.videoMap).toBe('[brd]');
  });

  test('template antigo, sem o campo ajustes, continua renderizando', () => {
    const r = buildFilterComplex(templateBase, { VIDEO: '/x.mp4' });
    expect(r.videoMap).toBe('[base]');
    expect(r.filterComplex).toBeTruthy();
  });
});
