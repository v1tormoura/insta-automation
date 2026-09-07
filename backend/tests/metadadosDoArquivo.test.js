'use strict';

/**
 * O metadado do arquivo de cada publicação.
 *
 * ── O que foi medido antes de escrever o módulo
 *
 * Três variantes de linha de comando, com ffmpeg de verdade:
 *
 *   `+bitexact` sozinho (o que havia)  → SEM `creation_time`, e
 *                                        `handler_name` com os nomes do ffmpeg
 *   sem `+bitexact` + metadado nosso   → grava a hora, mas volta a escrever
 *                                        `encoder: Lavf60.16.100` no container
 *   `+bitexact` + metadado nosso       → grava a hora E mantém as strings de
 *                                        versão suprimidas
 *
 * A terceira é a que o módulo usa. A suposição de partida — que `+bitexact`
 * impediria qualquer `creation_time` — estava errada, e só rodar mostrou.
 *
 * ── O que estes testes protegem
 *
 *   origem vazando        → o teste mais importante daqui. Ao ACRESCENTAR
 *                           metadado é fácil desarmar a limpeza sem notar, e
 *                           aí título, autor e modelo do dono original do
 *                           vídeo sobem junto
 *   hora do relógio       → quebraria a promessa de que reprocessar o mesmo
 *                           post gera o mesmo arquivo, e uma falha entre
 *                           upload e registro deixaria dois reels quase iguais
 *   hora igual em todas   → metadado idêntico em vinte contas é pior que
 *                           metadado nenhum: é um identificador de grupo
 *   ordem dos argumentos  → metadado ANTES de `-map_metadata -1` é apagado por
 *                           ele, e o arquivo sai como antes sem erro nenhum
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  argumentosDeMetadado, instanteDoPost, comoCreationTime,
  ATRASO_MIN_MS, ATRASO_MAX_MS, HANDLER_VIDEO, HANDLER_AUDIO,
} = require('../src/services/metadadosDoArquivo');

/** Um post com ObjectId de verdade, para o instante sair dele. */
const postCom = hex => ({ _id: { toString: () => hex, getTimestamp: () => new Date(parseInt(hex.slice(0, 8), 16) * 1000) } });
const HEX_POST = '68bd4a800000000000000001';   // ~ setembro de 2026
const CONTA_A = { _id: '64b000000000000000000001', username: 'conta_a' };
const CONTA_B = { _id: '64b000000000000000000002', username: 'conta_b' };

/** O valor de uma chave nos argumentos gerados. */
function valorDe(args, chave) {
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] === 'string' && args[i].startsWith(`${chave}=`)) return args[i].slice(chave.length + 1);
  }
  return null;
}

describe('a hora não vem do relógio', () => {
  test('sai do instante do post, que o ObjectId carrega', () => {
    /* O documento não muda, então o valor é o mesmo em toda reexecução — é o
       que mantém a promessa de "mesmo post, mesmo arquivo". */
    const esperado = parseInt(HEX_POST.slice(0, 8), 16) * 1000;
    expect(instanteDoPost(postCom(HEX_POST))).toBe(esperado);
  });

  test('ObjectId como string crua também funciona', () => {
    /* Depois de `.lean()` ou de um JSON, o `_id` chega como string de 24 hex e
       não tem mais `getTimestamp`. */
    const esperado = parseInt(HEX_POST.slice(0, 8), 16) * 1000;
    expect(instanteDoPost({ _id: HEX_POST })).toBe(esperado);
  });

  test('sem ObjectId, usa createdAt', () => {
    const quando = new Date('2026-03-03T10:00:00Z');
    expect(instanteDoPost({ createdAt: quando })).toBe(quando.getTime());
  });

  test('sem nada, cai no relógio em vez de falhar', () => {
    /* Um arquivo com hora plausível vale mais que nenhum arquivo. */
    const antes = Date.now();
    const r = instanteDoPost({});
    expect(r).toBeGreaterThanOrEqual(antes);
  });

  test('duas chamadas seguidas dão exatamente a mesma hora', () => {
    /* Se isto falhar, uma nova tentativa depois de um 429 manda outro arquivo
       e a conta termina com dois reels quase idênticos. */
    const a = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_A), 'creation_time');
    const b = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_A), 'creation_time');
    expect(a).toBe(b);
  });
});

describe('cada publicação tem a sua', () => {
  test('contas diferentes recebem horas diferentes', () => {
    /* Metadado idêntico em vinte contas é pior que metadado nenhum: é um
       identificador de grupo gravado dentro do arquivo. */
    const a = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_A), 'creation_time');
    const b = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_B), 'creation_time');
    expect(a).not.toBe(b);
  });

  test('posts diferentes recebem horas diferentes', () => {
    const outro = '68bd4a810000000000000009';
    const a = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_A), 'creation_time');
    const b = valorDe(argumentosDeMetadado(postCom(outro), CONTA_A), 'creation_time');
    expect(a).not.toBe(b);
  });

  test('trinta pares dão trinta horas distintas', () => {
    const vistas = new Set();
    for (let i = 0; i < 30; i++) {
      const conta = { _id: `64b0000000000000000000${String(i).padStart(2, '0')}` };
      vistas.add(valorDe(argumentosDeMetadado(postCom(HEX_POST), conta), 'creation_time'));
    }
    expect(vistas.size).toBe(30);
  });

  test('a gravação é anterior ao post, e por um tempo plausível', () => {
    /* Zero seria implausível: ninguém publica no mesmo segundo em que para de
       gravar. E a hora nunca pode ser DEPOIS do post. */
    const doPost = instanteDoPost(postCom(HEX_POST));
    for (let i = 0; i < 50; i++) {
      const conta = { _id: `c${i}` };
      const t = Date.parse(valorDe(argumentosDeMetadado(postCom(HEX_POST), conta), 'creation_time'));
      const atraso = doPost - t;
      expect(atraso).toBeGreaterThanOrEqual(ATRASO_MIN_MS);
      expect(atraso).toBeLessThanOrEqual(ATRASO_MAX_MS);
    }
  });
});

describe('o formato da hora', () => {
  test('é UTC com Z e microssegundos', () => {
    /* Hora local aqui seria gravada como se fosse UTC, e o arquivo diria que
       foi gravado três horas depois do que foi. */
    const v = comoCreationTime(Date.UTC(2026, 8, 7, 8, 12, 34));
    expect(v).toBe('2026-09-07T08:12:34.000000Z');
  });

  test('o ffmpeg reconhece o que sai daqui', () => {
    const v = valorDe(argumentosDeMetadado(postCom(HEX_POST), CONTA_A), 'creation_time');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });
});

describe('os nomes de handler', () => {
  test('são os do Android, sem o "r" final', () => {
    /* `VideoHandler` e `SoundHandler` são do ffmpeg. O MediaMuxer do Android
       escreve `VideoHandle` e `SoundHandle` — é a diferença entre um arquivo
       que diz "saí de um celular" e um que diz "saí de uma ferramenta". */
    expect(HANDLER_VIDEO).toBe('VideoHandle');
    expect(HANDLER_AUDIO).toBe('SoundHandle');
    const args = argumentosDeMetadado(postCom(HEX_POST), CONTA_A);
    expect(args.join(' ')).toContain('handler_name=VideoHandle');
    expect(args.join(' ')).toContain('handler_name=SoundHandle');
  });

  test('a hora vai no container e nos dois streams', () => {
    /* Um celular preenche os três. Só o global deixaria os streams sem hora,
       que é justamente a incoerência que se quer evitar. */
    const args = argumentosDeMetadado(postCom(HEX_POST), CONTA_A);
    const alvos = args.filter((a, i) => typeof args[i + 1] === 'string' && args[i + 1].startsWith('creation_time='));
    expect(alvos).toEqual(['-metadata', '-metadata:s:v:0', '-metadata:s:a:0']);
  });
});

describe('a ligação com o pipeline', () => {
  const ler = p => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  test('o metadado entra DEPOIS da limpeza na linha de comando', () => {
    /* Antes, `-map_metadata -1` o apagaria — e o arquivo sairia exatamente
       como antes, sem erro nenhum que denunciasse. */
    const vp = ler('../src/services/videoProcessor.js');
    const bloco = vp.slice(vp.indexOf('...metadataOpts'), vp.indexOf('...bitstreamOpts'));
    expect(bloco).toContain('options.metadados');
  });

  test('o caminho por conta é quem monta, porque conhece post e conta', () => {
    const m = ler('../src/services/midiaPorConta.js');
    expect(m).toContain('argumentosDeMetadado(post, account)');
  });

  test('o fallback de encode também leva o metadado', () => {
    /* Sem isto, uma falha no preset slow viraria silenciosamente um arquivo
       sem hora de gravação. */
    const vp = ler('../src/services/videoProcessor.js');
    const fb = vp.slice(vp.indexOf('Fallback: tenta com preset'));
    expect(fb).toContain('options.metadados');
  });

  test('o metadado entra no nome do arquivo, junto com a marca', () => {
    /* `sem_limpeza` reaproveita a saída pelo caminho. Sem o metadado no nome,
       duas contas com o mesmo vídeo compartilhariam o arquivo — e com ele a
       hora de gravação, que é o que se está tentando distinguir. */
    const vp = ler('../src/services/videoProcessor.js');
    const bloco = vp.slice(vp.indexOf('const porConta'), vp.indexOf('const outputPath'));
    expect(bloco).toContain('options.metadados');
    expect(bloco).toContain('options.marcaDagua');
  });

  test('os três caminhos de publicação passam por aqui', () => {
    /* Postar, Loop e campanha convergem em `publishViaInstagrapi`, que chama
       `prepararParaConta`. A campanha chega por injeção
       (`publicarNaConta: (account, post) => publishOneAccount(...)`). */
    const w = ler('../src/queue/worker.js');
    expect(w).toContain('prepararParaConta(post, account)');
    expect(w).toMatch(/publicarNaConta:\s*\(account, post\) => publishOneAccount/);
  });
});

/* ── O arquivo de verdade ──────────────────────────────────────────────────
   Um argumento de metadado montado errado é aceito por qualquer teste de
   string e ignorado pelo ffmpeg — o arquivo sai sem a tag e ninguém percebe.
   Aqui o vídeo é gerado e lido de volta. */
describe('o arquivo gerado', () => {
  const ffmpeg = (() => { try { return require('ffmpeg-static'); } catch { return null; } })();
  const talvez = ffmpeg ? test : test.skip;

  const roda = args => new Promise(r => execFile(ffmpeg, args, { timeout: 120_000 }, (e, o, s) => r({ e, s: String(s || '') })));
  const tmp = n => path.join(os.tmpdir(), `mf-meta-${Date.now()}-${Math.random().toString(36).slice(2)}-${n}.mp4`);

  /** Um vídeo COM metadados de origem, como um baixado de outra conta. */
  async function comOrigem() {
    const p = tmp('origem');
    await roda([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-metadata', 'title=TITULO_DO_DONO',
      '-metadata', 'artist=CONTA_DE_ORIGEM',
      '-metadata', 'com.android.model=APARELHO_DO_DONO',
      '-metadata', 'creation_time=2020-01-01T00:00:00.000000Z',
      '-c:v', 'libx264', '-c:a', 'aac', '-t', '1', p,
    ]);
    return p;
  }

  /** Converte com a cadeia real do pipeline e devolve o texto que o ffmpeg lê. */
  async function converterELer(entrada, metadados) {
    const saida = tmp('saida');
    const r = await roda([
      '-y', '-i', entrada,
      '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
      '-fflags', '+bitexact', '-x264-params', 'info=0',
      '-metadata:s:v:0', 'rotate=0',
      ...metadados,
      '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart',
      '-bsf:v', 'filter_units=remove_types=6',
      '-t', '1', saida,
    ]);
    if (r.e) return { erro: r.s.slice(-400), saida };
    const lido = await roda(['-i', saida]);
    return { texto: lido.s, saida };
  }

  talvez('a hora escolhida chega ao arquivo, no container e nos streams', async () => {
    const entrada = await comOrigem();
    const args = argumentosDeMetadado(postCom(HEX_POST), CONTA_A);
    const esperada = valorDe(args, 'creation_time');
    const { texto, erro, saida } = await converterELer(entrada, args);
    try {
      expect(erro).toBeUndefined();
      /* Três ocorrências: container, stream de vídeo, stream de áudio. */
      const quantas = (texto.match(new RegExp(esperada.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      expect(quantas).toBeGreaterThanOrEqual(3);
    } finally {
      for (const f of [entrada, saida]) { try { fs.unlinkSync(f); } catch { /* já foi */ } }
    }
  }, 180_000);

  talvez('NADA da origem sobrevive', async () => {
    /* O teste mais importante deste arquivo. Ao acrescentar metadado é fácil
       desarmar a limpeza sem notar, e aí o título, o autor e o aparelho do dono
       original do vídeo sobem junto com a publicação. */
    const entrada = await comOrigem();
    const args = argumentosDeMetadado(postCom(HEX_POST), CONTA_A);
    const { texto, erro, saida } = await converterELer(entrada, args);
    try {
      expect(erro).toBeUndefined();
      for (const vazamento of ['TITULO_DO_DONO', 'CONTA_DE_ORIGEM', 'APARELHO_DO_DONO', '2020-01-01']) {
        expect(texto).not.toContain(vazamento);
      }
    } finally {
      for (const f of [entrada, saida]) { try { fs.unlinkSync(f); } catch { /* já foi */ } }
    }
  }, 180_000);

  talvez('os nomes de handler do Android chegam ao arquivo', async () => {
    const entrada = await comOrigem();
    const { texto, erro, saida } = await converterELer(entrada, argumentosDeMetadado(postCom(HEX_POST), CONTA_A));
    try {
      expect(erro).toBeUndefined();
      expect(texto).toContain('VideoHandle');
      expect(texto).toContain('SoundHandle');
      /* E os do ffmpeg NÃO ficam: `VideoHandler` contém `VideoHandle`, então a
         checagem tem de ser pelo nome completo com o "r". */
      expect(texto).not.toMatch(/handler_name\s*:\s*VideoHandler/);
      expect(texto).not.toMatch(/handler_name\s*:\s*SoundHandler/);
    } finally {
      for (const f of [entrada, saida]) { try { fs.unlinkSync(f); } catch { /* já foi */ } }
    }
  }, 180_000);

  talvez('sem o metadado o arquivo sai SEM hora — a guarda não é vazia', async () => {
    /* Se este teste passasse com hora, os de cima passariam por acidente: seria
       o ffmpeg gravando a hora por conta própria, não o módulo. É esta a
       medição que mostrou o que havia antes. */
    const entrada = await comOrigem();
    const { texto, erro, saida } = await converterELer(entrada, []);
    try {
      expect(erro).toBeUndefined();
      expect(texto).not.toContain('creation_time');
      expect(texto).toMatch(/handler_name\s*:\s*VideoHandler/);
    } finally {
      for (const f of [entrada, saida]) { try { fs.unlinkSync(f); } catch { /* já foi */ } }
    }
  }, 180_000);

  talvez('duas contas geram arquivos com horas diferentes', async () => {
    const entrada = await comOrigem();
    const a = await converterELer(entrada, argumentosDeMetadado(postCom(HEX_POST), CONTA_A));
    const b = await converterELer(entrada, argumentosDeMetadado(postCom(HEX_POST), CONTA_B));
    try {
      const hora = t => t.match(/creation_time\s*:\s*(\S+)/)?.[1];
      expect(hora(a.texto)).toBeTruthy();
      expect(hora(a.texto)).not.toBe(hora(b.texto));
    } finally {
      for (const f of [entrada, a.saida, b.saida]) { try { fs.unlinkSync(f); } catch { /* já foi */ } }
    }
  }, 240_000);
});
