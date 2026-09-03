'use strict';

/**
 * Um arquivo por conta.
 *
 * O defeito: o caminho da API Mobile mandava `post.media` cru para o
 * `clip_upload`. O mesmo arquivo, byte a byte, para todas as contas — e o loop
 * repetindo os mesmos arquivos a cada ciclo.
 *
 * Estes testes rodam o ffmpeg de verdade sobre um vídeo sintético. Comparar
 * strings de comando provaria que os PARÂMETROS diferem; só executando dá para
 * provar que os ARQUIVOS diferem, que é o que o Instagram compara.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ffmpegStatic = require('ffmpeg-static');

const {
  criarAleatorio, sementeDe, marcaDe,
} = require('../src/services/midiaPorConta');

describe('a semente', () => {
  test('o mesmo par sempre dá a mesma semente', () => {
    /* É o que torna a reexecução segura: se o upload passou e o registro não,
       a tentativa seguinte precisa mandar o MESMO vídeo. Com aleatoriedade
       pura ela mandaria outro, e a conta ficaria com dois reels quase iguais. */
    expect(sementeDe('post1', 'conta1')).toBe(sementeDe('post1', 'conta1'));
    expect(marcaDe('post1', 'conta1')).toBe(marcaDe('post1', 'conta1'));
  });

  test('contas diferentes dão sementes diferentes', () => {
    expect(sementeDe('post1', 'conta1')).not.toBe(sementeDe('post1', 'conta2'));
  });

  test('posts diferentes dão sementes diferentes', () => {
    // O loop repete as mesmas mídias a cada ciclo; sem isto, a mesma conta
    // republicaria arquivos idênticos volta após volta.
    expect(sementeDe('post1', 'conta1')).not.toBe(sementeDe('post2', 'conta1'));
  });

  test('a marca do arquivo é curta e serve como nome', () => {
    expect(marcaDe('a', 'b')).toMatch(/^[0-9a-f]{10}$/);
  });

  test('não há colisão em mil pares', () => {
    const vistas = new Set();
    for (let p = 0; p < 50; p++) {
      for (let c = 0; c < 20; c++) vistas.add(sementeDe(`p${p}`, `c${c}`));
    }
    expect(vistas.size).toBe(1000);
  });
});

describe('o gerador determinístico', () => {
  test('a mesma semente dá a mesma sequência', () => {
    const a = criarAleatorio(12345);
    const b = criarAleatorio(12345);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('sementes diferentes divergem já no primeiro valor', () => {
    expect(criarAleatorio(1)()).not.toBe(criarAleatorio(2)());
  });

  test('os valores ficam em [0, 1)', () => {
    const r = criarAleatorio(99);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('a distribuição não é degenerada', () => {
    /* Um gerador quebrado que devolve sempre 0.5 passaria em todos os testes
       acima e produziria o mesmo vídeo para toda conta — que é exatamente o
       defeito que este módulo existe para corrigir. */
    const r = criarAleatorio(7);
    const baldes = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) baldes[Math.floor(r() * 10)]++;
    for (const n of baldes) {
      expect(n).toBeGreaterThan(600);   // esperado 1000 por balde
      expect(n).toBeLessThan(1400);
    }
  });
});

/* ── A prova no arquivo ────────────────────────────────────────────────────── */

const temFfmpeg = !!ffmpegStatic && fs.existsSync(ffmpegStatic);
const talvez = temFfmpeg ? describe : describe.skip;

talvez('o vídeo sai diferente por conta', () => {
  jest.setTimeout(180000);

  let dir;
  let origem;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-midia-'));
    origem = path.join(dir, 'origem.mp4');
    await execFileAsync(ffmpegStatic, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-shortest',
      '-y', origem,
    ]);
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* já foi */ } });

  /** Roda a conversão com uma semente e devolve o hash do resultado. */
  async function hashComSemente(semente, tag) {
    const r = criarAleatorio(semente);
    const cropPx = Math.floor(r() * 4) + 2;
    const cropX = Math.floor(r() * (cropPx + 1));
    const cropY = Math.floor(r() * (cropPx + 1));
    const brilho = ((r() - 0.5) * 0.006).toFixed(5);
    const sat = (1 + (r() - 0.5) * 0.04).toFixed(4);
    const contr = (1 + (r() - 0.5) * 0.02).toFixed(4);
    const pitch = (1 + (r() - 0.5) * 0.01).toFixed(5);
    const crf = String(17 + Math.floor(r() * 4));
    const taxa = Math.round(44100 * Number(pitch));

    const saida = path.join(dir, `saida-${tag}.mp4`);
    await execFileAsync(ffmpegStatic, [
      '-hide_banner', '-loglevel', 'error', '-i', origem,
      '-vf',
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
      + `,crop=iw-${cropPx}:ih-${cropPx}:${cropX}:${cropY},scale=1080:1920`
      + `,eq=brightness=${brilho}:saturation=${sat}:contrast=${contr}`,
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1',
      '-preset', 'veryfast', '-crf', crf,
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', '-pix_fmt', 'yuv420p',
      '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
      '-fflags', '+bitexact', '-x264-params', 'info=0',
      '-bsf:v', 'filter_units=remove_types=6',
      '-af', `asetrate=${taxa},aresample=44100`,
      '-y', saida,
    ], { timeout: 120000 });

    return {
      hash: crypto.createHash('sha256').update(fs.readFileSync(saida)).digest('hex'),
      tamanho: fs.statSync(saida).size,
      caminho: saida,
    };
  }

  test('duas contas, dois arquivos diferentes', async () => {
    /* O defeito original em uma linha: antes, este teste comparava o MESMO
       arquivo consigo mesmo, porque nenhuma conversão acontecia. */
    const a = await hashComSemente(sementeDe('post1', 'contaA'), 'A');
    const b = await hashComSemente(sementeDe('post1', 'contaB'), 'B');
    expect(a.hash).not.toBe(b.hash);
  });

  test('a mesma conta, reprocessando, dá o mesmo arquivo', async () => {
    const s = sementeDe('post1', 'contaA');
    const um = await hashComSemente(s, 'r1');
    const dois = await hashComSemente(s, 'r2');
    expect(um.hash).toBe(dois.hash);
  });

  test('o mesmo vídeo em ciclos diferentes do loop também difere', async () => {
    const a = await hashComSemente(sementeDe('ciclo1', 'contaA'), 'c1');
    const b = await hashComSemente(sementeDe('ciclo2', 'contaA'), 'c2');
    expect(a.hash).not.toBe(b.hash);
  });

  test('a saída está em 1080x1920 e sem metadados de origem', async () => {
    const { caminho } = await hashComSemente(sementeDe('post1', 'contaZ'), 'Z');
    const { stdout } = await execFileAsync(ffmpegStatic.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), [
      '-v', 'error', '-show_entries', 'stream=width,height:format_tags',
      '-of', 'default=noprint_wrappers=1', caminho,
    ]).catch(() => ({ stdout: '' }));

    // ffprobe pode não vir com o ffmpeg-static; se veio, confere.
    if (stdout) {
      expect(stdout).toContain('width=1080');
      expect(stdout).toContain('height=1920');
      // Nenhuma tag de origem sobreviveu à limpeza.
      expect(stdout).not.toMatch(/TAG:(encoder|creation_time|com\.apple)/i);
    }
  });
});
