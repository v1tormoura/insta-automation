'use strict';

/**
 * A marca d'água com o @ de cada conta.
 *
 * ── O pior defeito possível aqui
 *
 * A marca de uma conta aparecer no vídeo de outra. Num sistema cujo propósito é
 * as contas não se parecerem, isso não é um erro cosmético — é a assinatura de
 * que as duas saem do mesmo lugar, publicada no próprio vídeo. Dois testes
 * abaixo existem só para isso: o texto nunca vem do job, e o cache de arquivo
 * do `videoProcessor` leva a marca no nome.
 *
 * ── O que mais quebra calado
 *
 *   filtro vazio em vez de null → vira vírgula solta na cadeia de filtros, e o
 *                                 ffmpeg recusa a linha inteira: a conversão
 *                                 falha por causa de uma marca DESLIGADA
 *   `:` ou `'` no texto         → o drawtext usa os dois como sintaxe; texto
 *                                 livre ali é injeção. O @ passa por
 *                                 `normalizarArroba` antes justamente por isso
 *   marca fora da área segura   → o Instagram cobre ~150px no topo e ~270px na
 *                                 base; marca ali é marca escondida
 *   sombra de alfa fixo         → a 10% de opacidade o contorno apareceria mais
 *                                 que a própria marca
 *
 * ── Por que há teste com ffmpeg de verdade
 *
 * Um filtro `drawtext` montado errado é aceito por qualquer teste de string e
 * recusado pelo ffmpeg. Foi exatamente o que aconteceu com o texto livre do
 * story: a vírgula dentro de `max(a,b)` separa filtros, e só rodar mostrou.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  filtroDaMarca, normalizar, lerDoCorpo, alturaDe,
  TAMANHOS, POSICOES, PADRAO, OPACIDADE_MIN, ALTURA, MARGEM_TOPO, MARGEM_BASE,
} = require('../src/services/marcaDagua');
const { acharFonte } = require('../src/services/storyStickerRenderer');

const FONTE_FALSA = '/usr/share/fonts/truetype/x/Fake.ttf';
const LIGADA = { ativa: true, opacidade: 45, posicao: 'centro', tamanho: 'pequena' };

describe('a configuração, normalizada', () => {
  test('o padrão é desligada', () => {
    /* Nada muda para quem nunca pediu marca. */
    expect(PADRAO.ativa).toBe(false);
    expect(normalizar(undefined).ativa).toBe(false);
    expect(normalizar({}).ativa).toBe(false);
  });

  test('ativa só com o booleano', () => {
    /* `ativa: 'false'` é string, e string não vazia é verdadeira em JS: sem a
       comparação estrita, desligar a marca a ligaria. */
    expect(normalizar({ ativa: 'false' }).ativa).toBe(false);
    expect(normalizar({ ativa: 1 }).ativa).toBe(false);
    expect(normalizar({ ativa: true }).ativa).toBe(true);
  });

  test('a opacidade tem piso e teto', () => {
    /* ── O piso subiu de 5% para 20%, e o motivo foi medido ────────────────

       Num fundo cinza liso, com a marca na faixa inferior, o brilho médio da
       faixa (escala de 0 a 255):

         desligada      125,00
         10% pequena    125,04   ← delta de 0,04
         45% pequena    125,25
         45% grande     126,10
         100% grande    130,22

       A 10% a marca É desenhada e não é vista por ninguém. A tela dizia
       "Marca d'água ativa — 10%" e o vídeo saía sem marca aparente, o que
       parece defeito. Um controle que deixa escolher o que não funciona é pior
       que um controle que não existe.

       Este teste guarda o piso: baixá-lo de novo traz o problema de volta. */
    expect(OPACIDADE_MIN).toBe(20);
    expect(normalizar({ opacidade: 0 }).opacidade).toBe(OPACIDADE_MIN);
    expect(normalizar({ opacidade: -50 }).opacidade).toBe(OPACIDADE_MIN);
    expect(normalizar({ opacidade: 10 }).opacidade).toBe(OPACIDADE_MIN);
    expect(normalizar({ opacidade: 500 }).opacidade).toBe(100);
    expect(normalizar({ opacidade: 62.4 }).opacidade).toBe(62);
  });

  test('o padrão é uma opacidade que se vê', () => {
    /* 45% é onde uma marca discreta de verdade fica. O padrão anterior, 40%
       com tamanho pequeno, dava delta de 0,22 em 255 — quase nada. */
    expect(PADRAO.opacidade).toBeGreaterThanOrEqual(40);
  });

  test('os tamanhos ocupam largura suficiente para se ver', () => {
    /* 34px num vídeo de 1080 de largura são 3%. Marca d'água de verdade ocupa
       de 4% a 8% — abaixo disso ela existe no arquivo e não na tela. */
    for (const corpo of Object.values(TAMANHOS)) {
      expect(corpo / 1080).toBeGreaterThan(0.04);
    }
  });

  test('opacidade que não é número cai no padrão', () => {
    /* NaN sairia como `white@NaN` no filtro, e o ffmpeg recusaria a linha. */
    for (const v of ['muito', null, undefined, {}, [], NaN]) {
      expect(normalizar({ opacidade: v }).opacidade).toBe(PADRAO.opacidade);
    }
  });

  test('posição e tamanho desconhecidos caem no padrão', () => {
    /* Valor inventado viraria uma expressão inválida de `y`, ou `fontsize=undefined`. */
    expect(normalizar({ posicao: 'diagonal' }).posicao).toBe(PADRAO.posicao);
    expect(normalizar({ tamanho: 'gigante' }).tamanho).toBe(PADRAO.tamanho);
    expect(normalizar({ tamanho: 'constructor' }).tamanho).toBe(PADRAO.tamanho);
    expect(normalizar({ tamanho: '__proto__' }).tamanho).toBe(PADRAO.tamanho);
  });

  test('os três tamanhos e as três posições existem', () => {
    expect(Object.keys(TAMANHOS).sort()).toEqual(['grande', 'media', 'pequena']);
    expect(POSICOES).toEqual(['superior', 'centro', 'inferior']);
  });
});

describe('quando NÃO há marca a desenhar', () => {
  test('desligada devolve null, não string vazia', () => {
    /* String vazia viraria uma vírgula solta na cadeia de filtros e o ffmpeg
       recusaria a linha inteira — a conversão falharia por causa de uma marca
       que está DESLIGADA. */
    expect(filtroDaMarca({ ativa: false }, 'fulano', FONTE_FALSA)).toBeNull();
    expect(filtroDaMarca(null, 'fulano', FONTE_FALSA)).toBeNull();
    expect(filtroDaMarca(undefined, 'fulano', FONTE_FALSA)).toBeNull();
  });

  test('@ inválido não vira marca', () => {
    /* Conta sem username, ou com algo que não é um @, sai sem marca em vez de
       sair com `@undefined` gravado no vídeo. */
    for (const u of ['', '   ', null, undefined, 42, {}, 'com espaço', 'a'.repeat(31)]) {
      expect(filtroDaMarca(LIGADA, u, FONTE_FALSA)).toBeNull();
    }
  });

  test('sem fonte no sistema, sai sem marca em vez de falhar', () => {
    /* Perder a publicação por causa de um enfeite seria troca ruim. */
    expect(filtroDaMarca(LIGADA, 'fulano', null)).toBeNull();
    expect(filtroDaMarca(LIGADA, 'fulano', '')).toBeNull();
  });
});

describe('o filtro montado', () => {
  const filtro = () => filtroDaMarca(LIGADA, 'fulano', FONTE_FALSA);

  test('escreve o @ da conta', () => {
    expect(filtro()).toContain("text='@fulano'");
  });

  test('o @ é normalizado, não colado cru', () => {
    /* Quem chama passa `account.username`, que pode vir com arroba ou em
       maiúscula dependendo de qual sincronização gravou. */
    expect(filtroDaMarca(LIGADA, '@Fulano', FONTE_FALSA)).toContain("text='@fulano'");
  });

  test('nada que o drawtext interprete sobrevive no texto', () => {
    /* `:` separa opções e `'` e `\\` são escape. O @ passa por
       `normalizarArroba`, que só deixa `[a-z0-9._]` — então não há como injetar
       uma opção pelo nome de usuário. */
    const f = filtroDaMarca(LIGADA, 'nome.com_ponto9', FONTE_FALSA);
    const texto = f.match(/text='([^']*)'/)[1];
    expect(texto).toBe('@nome.com_ponto9');
    expect(texto).not.toMatch(/[:'\\%]/);
  });

  test('a opacidade vira alfa da cor', () => {
    expect(filtroDaMarca({ ...LIGADA, opacidade: 45 }, 'f', FONTE_FALSA)).toContain('fontcolor=white@0.45');
    expect(filtroDaMarca({ ...LIGADA, opacidade: 100 }, 'f', FONTE_FALSA)).toContain('fontcolor=white@1.00');
  });

  test('a sombra acompanha a opacidade do texto', () => {
    /* Fixa, uma marca a 10% ficaria com um contorno duro por trás — a sombra
       apareceria mais que a marca. */
    const fraca = filtroDaMarca({ ...LIGADA, opacidade: OPACIDADE_MIN }, 'f', FONTE_FALSA);
    const forte = filtroDaMarca({ ...LIGADA, opacidade: 100 }, 'f', FONTE_FALSA);
    const alfaDe = f => Number(f.match(/shadowcolor=black@([\d.]+)/)[1]);
    expect(alfaDe(fraca)).toBeLessThan(alfaDe(forte));
    expect(alfaDe(fraca)).toBeCloseTo((OPACIDADE_MIN / 100) * 0.9, 2);
    expect(alfaDe(forte)).toBeLessThanOrEqual(1);
  });

  test('cada tamanho tem um corpo de letra diferente e crescente', () => {
    const corpo = t => Number(filtroDaMarca({ ...LIGADA, tamanho: t }, 'f', FONTE_FALSA).match(/fontsize=(\d+)/)[1]);
    expect(corpo('pequena')).toBeLessThan(corpo('media'));
    expect(corpo('media')).toBeLessThan(corpo('grande'));
  });

  test('o caminho da fonte é escapado — no Windows ele tem C: e barras', () => {
    /* `C:` seria lido como fim da opção `fontfile`. */
    const f = filtroDaMarca(LIGADA, 'fulano', 'C:\\Windows\\Fonts\\arialbd.ttf');
    expect(f).toContain("fontfile='C\\:/Windows/Fonts/arialbd.ttf'");
  });

  test('é centralizado na horizontal', () => {
    expect(filtro()).toContain('x=(w-text_w)/2');
  });
});

describe('a marca fica dentro da área que o Instagram deixa livre', () => {
  test('superior fica abaixo da interface do topo', () => {
    /* Acima disso ficam o autor e o botão de câmera: a marca existiria e não
       seria vista. */
    expect(Number(alturaDe('superior', 34))).toBeGreaterThanOrEqual(MARGEM_TOPO);
  });

  test('inferior fica acima da legenda e dos botões', () => {
    /* Descontando a própria altura da letra: sem o desconto, a base do texto
       cairia dentro da área dos botões. */
    for (const corpo of Object.values(TAMANHOS)) {
      const y = Number(alturaDe('inferior', corpo));
      expect(y + corpo).toBeLessThanOrEqual(ALTURA - MARGEM_BASE);
      expect(y).toBeGreaterThan(0);
    }
  });

  test('centro é expressão, não número', () => {
    /* `text_h` só é conhecido pelo ffmpeg depois de medir a fonte — centralizar
       de verdade precisa da conta feita lá. */
    expect(alturaDe('centro', 34)).toBe('(h-text_h)/2');
  });
});

describe('a configuração vinda do corpo da requisição', () => {
  test('aceita objeto (Loop e campanha enviam JSON)', () => {
    expect(lerDoCorpo({ ativa: true, opacidade: 70 })).toMatchObject({ ativa: true, opacidade: 70 });
  });

  test('aceita string (o Postar envia multipart, e ali tudo é texto)', () => {
    /* Sem isto, a marca escolhida no Postar chegaria como a string
       '[object Object]' e seria ignorada em silêncio. */
    expect(lerDoCorpo('{"ativa":true,"tamanho":"grande"}')).toMatchObject({ ativa: true, tamanho: 'grande' });
  });

  test('desligada devolve null, para o controller não gravar nada', () => {
    expect(lerDoCorpo({ ativa: false, opacidade: 70 })).toBeNull();
    expect(lerDoCorpo('{"ativa":false}')).toBeNull();
    expect(lerDoCorpo('')).toBeNull();
    expect(lerDoCorpo('   ')).toBeNull();
    expect(lerDoCorpo(undefined)).toBeNull();
  });

  test('JSON quebrado não derruba a publicação', () => {
    /* Um corpo malformado deve custar a marca, não o post. */
    expect(lerDoCorpo('{ativa:true')).toBeNull();
    expect(lerDoCorpo('não é json')).toBeNull();
  });
});

describe('o texto nunca vem do job', () => {
  const fs2 = require('fs');
  const ler = p => fs2.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('nenhum schema guarda o texto da marca', () => {
    /* Se um dia alguém acrescentar `texto` a estes schemas, a marca de uma
       conta passa a poder aparecer no vídeo de outra — e este teste é o que
       avisa antes de acontecer. */
    for (const arquivo of ['../src/models/Job.js', '../src/models/Post.js', '../src/models/Campaign.js']) {
      const fonte = ler(arquivo);
      const bloco = fonte.slice(fonte.indexOf('marcaDagua'), fonte.indexOf('marcaDagua') + 600);
      expect(bloco).not.toMatch(/\btexto\s*:/);
      expect(bloco).not.toMatch(/\busername\s*:/);
    }
  });

  test('o filtro é montado onde a conta é conhecida', () => {
    /* `midiaPorConta` é quem sabe QUAL conta publica. Montar o filtro no
       `videoProcessor`, que não conhece contas, exigiria passar o @ por lá — e
       aí o texto voltaria a poder ser o de outra conta. */
    const midia = ler('../src/services/midiaPorConta.js');
    expect(midia).toContain('filtroDaMarca(configDaMarca, account.username)');
  });

  test('a marca entra no nome do arquivo convertido', () => {
    /* `sem_limpeza` reaproveita o arquivo já convertido pelo caminho de saída.
       Sem a marca no nome, duas contas com o mesmo vídeo compartilhariam o
       arquivo e o @ da primeira apareceria no vídeo da segunda. */
    const vp = ler('../src/services/videoProcessor.js');
    expect(vp).toMatch(/suffix \+= `-m\$\{digital\}`/);
  });

  test('a marca desce do job e da campanha para o post', () => {
    /* Um campo que existe nos dois schemas e nunca é copiado é o defeito mais
       barato de cometer aqui: a tela salva, e nada aparece no vídeo. */
    expect(ler('../src/queue/worker.js')).toContain('jobDoc.marcaDagua?.ativa');
    expect(ler('../src/services/campaignExecutor.js')).toContain('campanha.settings?.marcaDagua?.ativa');
  });
});

/* ── O ffmpeg de verdade ───────────────────────────────────────────────────
   Um `drawtext` montado errado passa em qualquer teste de string e é recusado
   pelo ffmpeg. Aqui a cadeia é executada num vídeo sintético de meio segundo. */
describe('o ffmpeg aceita o filtro', () => {
  const fonte = acharFonte();
  const ffmpeg = (() => {
    try { return require('ffmpeg-static'); } catch { return null; }
  })();
  const podeRodar = !!fonte && !!ffmpeg;

  const talvez = podeRodar ? test : test.skip;

  /** Roda o ffmpeg com a cadeia completa e devolve `{ ok, erro }`. */
  function rodar(filtroExtra) {
    return new Promise(resolve => {
      const saida = path.join(os.tmpdir(), `mf-marca-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
      const cadeia = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
        + (filtroExtra ? `,${filtroExtra}` : '');
      execFile(ffmpeg, [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=15:duration=0.5',
        '-vf', cadeia,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-t', '0.5',
        saida,
      ], { timeout: 60_000 }, (err, _o, stderr) => {
        try { fs.unlinkSync(saida); } catch { /* já não está lá */ }
        resolve({ ok: !err, erro: String(stderr || err?.message || '').slice(-400) });
      });
    });
  }

  talvez('a cadeia com a marca é aceita', async () => {
    const f = filtroDaMarca(LIGADA, 'fulano_teste', fonte);
    expect(f).toBeTruthy();
    const r = await rodar(f);
    expect(r.ok ? 'ok' : r.erro).toBe('ok');
  }, 90_000);

  talvez('as três posições e os três tamanhos são aceitos', async () => {
    /* A posição `inferior` é a que mais tem como sair errada: é a única com
       aritmética nossa em vez de expressão do ffmpeg. */
    for (const posicao of POSICOES) {
      for (const tamanho of Object.keys(TAMANHOS)) {
        const f = filtroDaMarca({ ...LIGADA, posicao, tamanho }, 'conta_x', fonte);
        const r = await rodar(f);
        expect(r.ok ? 'ok' : `${posicao}/${tamanho}: ${r.erro}`).toBe('ok');
      }
    }
  }, 300_000);

  talvez('opacidade no piso e no teto são aceitas', async () => {
    for (const opacidade of [5, 100]) {
      const r = await rodar(filtroDaMarca({ ...LIGADA, opacidade }, 'conta_y', fonte));
      expect(r.ok ? 'ok' : `${opacidade}: ${r.erro}`).toBe('ok');
    }
  }, 120_000);

  talvez('a guarda não é vazia — a cadeia sozinha passa', async () => {
    /* Se este teste falhasse, os de cima passariam por acidente: seria o
       ambiente recusando tudo, não o filtro sendo aceito. */
    const r = await rodar(null);
    expect(r.ok ? 'ok' : r.erro).toBe('ok');
  }, 90_000);
});
