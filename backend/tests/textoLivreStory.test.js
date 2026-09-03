'use strict';

/**
 * Texto livre queimado no story.
 *
 * ── O que ele é
 *
 * Uma camada de texto sua sobre a mídia, separada da figurinha de link — a
 * ferramenta de texto do Instagram, feita do nosso lado para que o story saia
 * pronto sem passar pelo aplicativo.
 *
 * ── Por que drawtext e não outro PNG
 *
 * A figurinha vira PNG porque tem forma: cantos, ícone, chevron. Texto é só
 * texto, e o ffmpeg desenha direto — sem arquivo, sem cache, sem dependência
 * nova. E entra na MESMA passada do overlay, o que importa em vídeo: duas
 * passadas re-codificariam tudo duas vezes.
 *
 * ── O que estes testes protegem
 *
 * Sobretudo o que o `drawtext` faz de errado sem ajuda: ele centraliza cada
 * chamada isoladamente, então o texto precisa ser uma linha por filtro; e ele
 * quebra a linha de comando inteira se um caractere não for escapado.
 */

const { filtrosDeTexto, TAMANHOS_TEXTO } = require('../src/services/storyStickerRenderer');

const FONTE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

describe('quando não há o que desenhar', () => {
  test('sem texto, sem filtros', () => {
    for (const v of [null, undefined, {}, { texto: '' }, { texto: '   ' }]) {
      expect(filtrosDeTexto(v, FONTE)).toEqual([]);
    }
  });

  test('sem fonte disponível, não inventa comando', () => {
    /* `acharFonte()` devolve null quando não há TTF no sistema. Montar o
       filtro assim mesmo produziria um ffmpeg que falha, e a falha levaria
       junto a figurinha de link, que não tinha nada a ver. */
    expect(filtrosDeTexto({ texto: 'oi' }, null)).toEqual([]);
  });

  test('só quebras de linha não conta como texto', () => {
    expect(filtrosDeTexto({ texto: '\n\n  \n' }, FONTE)).toEqual([]);
  });
});

describe('uma linha por filtro', () => {
  test('três linhas viram três drawtext', () => {
    /* `drawtext` centraliza cada chamada isoladamente. Passando o texto
       inteiro com quebras, as linhas sairiam alinhadas à esquerda dentro de um
       bloco centralizado — que não é texto centralizado. */
    const f = filtrosDeTexto({ texto: 'um\ndois\ntrês' }, FONTE);
    expect(f).toHaveLength(3);
    expect(f[0]).toContain("text='um'");
    expect(f[2]).toContain("text='três'");
  });

  test('linhas vazias no meio são descartadas', () => {
    expect(filtrosDeTexto({ texto: 'a\n\n\nb' }, FONTE)).toHaveLength(2);
  });

  test('teto de seis linhas — um story não é um documento', () => {
    const dez = Array.from({ length: 10 }, (_, i) => `linha ${i}`).join('\n');
    expect(filtrosDeTexto({ texto: dez }, FONTE)).toHaveLength(6);
  });

  test('aceita \r\n do Windows', () => {
    expect(filtrosDeTexto({ texto: 'um\r\ndois' }, FONTE)).toHaveLength(2);
  });
});

describe('posição e tamanho', () => {
  test('o bloco é CENTRADO no ponto pedido, não começa nele', () => {
    /* Sem isso, arrastar para o meio deixaria o texto começando no meio e
       descendo — e a posição vista no preview não seria a obtida. */
    const uma  = filtrosDeTexto({ texto: 'a', y: 0.5 }, FONTE)[0];
    const tres = filtrosDeTexto({ texto: 'a\nb\nc', y: 0.5 }, FONTE);

    const yDe = f => Number(f.match(/:y=(-?\d+)/)[1]);
    // Com três linhas o topo sobe: o centro do bloco continua em 0.5.
    expect(yDe(tres[0])).toBeLessThan(yDe(uma));
    const centroTres = (yDe(tres[0]) + yDe(tres[2])) / 2;
    expect(Math.abs(centroTres - yDe(uma))).toBeLessThan(2);
  });

  test('x centraliza cada linha pela própria largura', () => {
    /* `text_w` é resolvido pelo ffmpeg por chamada — é isso que faz linhas de
       comprimentos diferentes ficarem centradas entre si. */
    const f = filtrosDeTexto({ texto: 'curta\numa linha bem mais longa', x: 0.5 }, FONTE);
    for (const filtro of f) expect(filtro).toContain('-text_w/2)');
  });

  test('os três tamanhos são distintos e crescentes', () => {
    const fs = t => Number(filtrosDeTexto({ texto: 'a', tamanho: t }, FONTE)[0].match(/fontsize=(\d+)/)[1]);
    expect(fs('pequeno')).toBeLessThan(fs('medio'));
    expect(fs('medio')).toBeLessThan(fs('grande'));
  });

  test('tamanho desconhecido cai no médio', () => {
    const fs = t => filtrosDeTexto({ texto: 'a', tamanho: t }, FONTE)[0].match(/fontsize=(\d+)/)[1];
    expect(fs('gigante')).toBe(fs('medio'));
    expect(fs(undefined)).toBe(fs('medio'));
  });

  test('posição fora de 0..1 é presa nos limites', () => {
    /* Coordenada inválida colocaria o texto fora do quadro: ele seria
       renderizado, cobrado em tempo de processamento, e invisível. */
    const f = filtrosDeTexto({ texto: 'a', x: 5, y: -3 }, FONTE)[0];
    expect(f).toContain('1080-text_w/2');
    /* Era `toBeLessThanOrEqual(0)`: com y=-3 preso em 0, o topo do bloco
       ficava em `0 - altura/2`, negativo, e o ffmpeg desenhava metade do
       texto fora do quadro sem reclamar. Agora o limite é a margem — o
       texto encosta na borda de cima e para ali. */
    expect(Number(f.match(/:y=(-?\d+)/)[1])).toBe(28);
  });
});

describe('legibilidade', () => {
  test('sempre há caixa atrás, em contraste com a letra', () => {
    /* Texto branco sobre foto clara some, e preto sobre foto escura também.
       Não dá para saber qual é o caso sem analisar a imagem; a caixa
       semitransparente resolve os dois de uma vez. */
    const branco = filtrosDeTexto({ texto: 'a', cor: 'branco' }, FONTE)[0];
    expect(branco).toContain('fontcolor=white');
    expect(branco).toContain('boxcolor=black@0.45');

    const preto = filtrosDeTexto({ texto: 'a', cor: 'preto' }, FONTE)[0];
    expect(preto).toContain('fontcolor=black');
    expect(preto).toContain('boxcolor=white@0.45');
  });
});

describe('o que quebraria o ffmpeg', () => {
  test('apóstrofo e dois-pontos saem escapados', () => {
    /* Um apóstrofo cru fecha a string do filtro e o resto do comando vira
       argumento solto — o ffmpeg falha com um erro que não menciona texto
       nenhum, e o story sai sem nada. */
    const f = filtrosDeTexto({ texto: "hoje é 50%: n'oferta" }, FONTE)[0];
    expect(f).not.toMatch(/text='[^']*'[^:]/);
    expect(f.startsWith('drawtext=')).toBe(true);
  });

  test('o caminho da fonte tem os dois-pontos escapados', () => {
    /* No Windows a fonte vem como C:\... e o dois-pontos separa opções do
       filtro. Sem escapar, o ffmpeg lê "C" como caminho e o resto como opção
       desconhecida — e falha com um erro que não menciona fonte nenhuma.

       `String.raw` porque o caminho tem barras invertidas: escrito normal, o
       JS as consome antes de a função ver, e o teste mediria outra string. */
    const f = filtrosDeTexto({ texto: 'a' }, String.raw`C:\Windows\Fonts\arial.ttf`)[0];
    expect(f).toContain(String.raw`fontfile='C\:/Windows/Fonts/arial.ttf'`);
  });
});

describe('os tamanhos são fração da largura', () => {
  test('sobrevivem a uma mudança de resolução', () => {
    /* Em pixels, "grande" viraria pequeno no dia em que o story mudar de
       tamanho. Em fração, continua grande. */
    for (const v of Object.values(TAMANHOS_TEXTO)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(0.5);
    }
  });

  /* ── O caso que quebrou de verdade ───────────────────────────────

     A primeira versão lia `x` e `y` direto do objeto. Quando o front não
     mandava posição — texto recém-digitado, ainda não arrastado — saía
     `x=(NaN-text_w/2)`, o ffmpeg recusava o filtro inteiro, e o story ia sem
     texto. O erro do ffmpeg não menciona posição: ninguém acharia isso. */
  describe('posição ausente', () => {
    test('sem x e y, nada de NaN chega ao filtro', () => {
      const f = filtrosDeTexto({ texto: 'sem posicao' }, FONTE)[0];
      expect(f).not.toContain('NaN');
    });

    test('o padrão centraliza na horizontal', () => {
      const f = filtrosDeTexto({ texto: 'a' }, FONTE)[0];
      expect(f).toContain('540-text_w/2');    // 1080 / 2
    });

    test('x invalido também cai no padrão, não no canto', () => {
      for (const ruim of [null, undefined, '', 'abc', NaN, {}]) {
        const f = filtrosDeTexto({ texto: 'a', x: ruim, y: ruim }, FONTE)[0];
        expect(f).not.toContain('NaN');
        expect(f).toContain('540-text_w/2');
      }
    });

    test('x e y informados continuam mandando', () => {
      const f = filtrosDeTexto({ texto: 'a', x: 0.25, y: 0.8 }, FONTE)[0];
      expect(f).toContain('270-text_w/2');    // 1080 * 0.25
      expect(f).not.toContain('540-text_w/2');
    });

    test('zero é posição válida, não ausência', () => {
      /* `Number(0) || 0.5` daria 0.5 — a mesma armadilha do `||` que já
         mordeu no aquecimento. Encostar o texto na borda esquerda é uma
         escolha legítima. */
      const f = filtrosDeTexto({ texto: 'a', x: 0, y: 0.5 }, FONTE)[0];
      expect(f).toContain('0-text_w/2');
    });
  });
});
