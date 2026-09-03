'use strict';

/**
 * O texto livre vem da rede e termina dentro de um comando de ffmpeg.
 *
 * O renderizador escapa o que é perigoso — isso já tem testes próprios em
 * textoLivreStory.test.js. Aqui o assunto é anterior: garantir que o que sai
 * daqui tenha forma conhecida, para o escape não ser a única coisa entre um
 * body arbitrário e uma linha de comando.
 */

const {
  limparTextoLivre, MAX_LINHAS, MAX_POR_LINHA,
} = require('../src/routes/textoDoStory');

describe('o que não é texto vira null', () => {
  /* `null` e não um objeto vazio: o serviço usa a ausência para decidir se
     vale reprocessar a mídia. Um objeto com string vazia dentro faria o ffmpeg
     rodar uma passada inteira para desenhar nada. */
  test.each([
    ['nada',            undefined],
    ['null',            null],
    ['string solta',    'só o texto'],
    ['número',          42],
    ['array',           [{ texto: 'a' }]],
    ['objeto sem texto', { x: 0.5 }],
    ['texto não-string', { texto: 123 }],
    ['texto vazio',     { texto: '' }],
    ['só espaços',      { texto: '   \n  \n ' }],
  ])('%s', (_, entrada) => {
    expect(limparTextoLivre(entrada)).toBeNull();
  });
});

describe('caracteres de controle', () => {
  test('somem, menos a quebra de linha', () => {
    const r = limparTextoLivre({ texto: 'a\x00b\x01c\x1Fd' });
    expect(r.texto).toBe('abcd');
  });

  test('a quebra de linha sobrevive — é a única formatação do campo', () => {
    const r = limparTextoLivre({ texto: 'primeira\nsegunda' });
    expect(r.texto).toBe('primeira\nsegunda');
  });

  test('o \\r do Windows não deixa resto', () => {
    /* CRLF vindo de um textarea no Windows. Sem tirar o \r, cada linha termina
       com um caractere invisível que o ffmpeg tenta desenhar. */
    const r = limparTextoLivre({ texto: 'uma\r\nduas' });
    expect(r.texto).toBe('uma\nduas');
  });

  test('DEL também sai', () => {
    expect(limparTextoLivre({ texto: 'a\x7Fb' }).texto).toBe('ab');
  });
});

describe('tetos', () => {
  test('mais de MAX_LINHAS linhas são cortadas', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => `linha ${i}`).join('\n');
    expect(limparTextoLivre({ texto: muitas }).texto.split('\n')).toHaveLength(MAX_LINHAS);
  });

  test('linha longa é cortada por caractere', () => {
    const r = limparTextoLivre({ texto: 'x'.repeat(500) });
    expect(r.texto).toHaveLength(MAX_POR_LINHA);
  });

  test('um body enorme não vira um comando enorme', () => {
    /* O motivo do teto. Sem ele, 4 MB de texto viram 4 MB de linha de comando
       — e o processo morre de um jeito que não parece ter relação com o campo
       de texto de um story. */
    const enorme = Array.from({ length: 5000 }, () => 'y'.repeat(300)).join('\n');
    const r = limparTextoLivre({ texto: enorme });
    expect(r.texto.length).toBeLessThanOrEqual(MAX_LINHAS * (MAX_POR_LINHA + 1));
  });

  test('linhas vazias no meio não gastam o teto', () => {
    const r = limparTextoLivre({ texto: 'a\n\n\n\n\nb' });
    expect(r.texto).toBe('a\nb');
  });
});

describe('posição', () => {
  test('sem x e y, cai no padrão', () => {
    const r = limparTextoLivre({ texto: 'a' });
    expect(r.x).toBe(0.5);
    expect(r.y).toBe(0.35);
  });

  test('zero é posição, não ausência', () => {
    /* A mesma armadilha do `||` que já mordeu no aquecimento: `0 || 0.5` é
       0.5. Encostar o texto na borda esquerda é uma escolha legítima. */
    expect(limparTextoLivre({ texto: 'a', x: 0 }).x).toBe(0);
  });

  test('null e string vazia são ausência, não zero', () => {
    expect(limparTextoLivre({ texto: 'a', x: null }).x).toBe(0.5);
    expect(limparTextoLivre({ texto: 'a', x: '' }).x).toBe(0.5);
  });

  test('valor fora da faixa é preso em 0..1', () => {
    expect(limparTextoLivre({ texto: 'a', x: 5, y: -3 })).toMatchObject({ x: 1, y: 0 });
  });

  test('lixo cai no padrão em vez de virar NaN', () => {
    /* Era o defeito real: NaN atravessava até o filtro, saía
       `x=(NaN-text_w/2)`, e o ffmpeg recusava a mídia inteira. */
    for (const ruim of ['abc', {}, [], NaN, Infinity]) {
      const r = limparTextoLivre({ texto: 'a', x: ruim, y: ruim });
      expect(r.x).toBe(0.5);
      expect(r.y).toBe(0.35);
    }
  });

  test('string numérica é aceita — é o que um input type=range manda', () => {
    expect(limparTextoLivre({ texto: 'a', x: '0.25' }).x).toBe(0.25);
  });
});

describe('tamanho e cor', () => {
  test('valor desconhecido cai no padrão em vez de sumir', () => {
    /* Se `tamanho` passasse cru, o renderizador leria
       `TAMANHOS_TEXTO['<script>']` como undefined e usaria o padrão de lá —
       o mesmo resultado, mas por acidente. Aqui é por decisão. */
    const r = limparTextoLivre({ texto: 'a', tamanho: 'gigante', cor: 'roxo' });
    expect(r.tamanho).toBe('medio');
    expect(r.cor).toBe('branco');
  });

  test('os valores válidos passam', () => {
    expect(limparTextoLivre({ texto: 'a', tamanho: 'grande', cor: 'preto' }))
      .toMatchObject({ tamanho: 'grande', cor: 'preto' });
  });
});

describe('o que o body não pode injetar', () => {
  test('campos extras não atravessam', () => {
    /* A saída é montada campo a campo, não por spread. Um `fontfile` no body
       não vira um `fontfile` na opção do ffmpeg. */
    const r = limparTextoLivre({ texto: 'a', fontfile: '/etc/passwd', qualquer: 1 });
    expect(Object.keys(r).sort()).toEqual(['cor', 'tamanho', 'texto', 'x', 'y']);
  });

  test('aspas e dois-pontos chegam intactos para o renderizador escapar', () => {
    /* A limpeza NÃO escapa: escapar é do renderizador, que sabe a sintaxe do
       drawtext. Tirar aspas aqui mutilaria o texto de quem escreveu "n'oferta"
       e ainda deixaria a impressão de que a sintaxe já está resolvida. */
    const r = limparTextoLivre({ texto: "50%: n'oferta" });
    expect(r.texto).toBe("50%: n'oferta");
  });
});
