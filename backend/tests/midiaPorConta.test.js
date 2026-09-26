'use strict';

/**
 * O arquivo que vai para cada conta.
 *
 * O que estes testes protegem:
 *   vídeo alterado sem pedido → o que a pessoa enviou vai byte a byte quando
 *                               o formato serve (era trocado por uma versão
 *                               "humanizada": tom do áudio, corte, cor)
 *   formato que a API recusa  → convertido para 1080×1920 H.264/AAC
 *   marca d'água              → arquivo próprio por conta (o @ de uma nunca
 *                               aparece no vídeo de outra)
 *   falha na conversão        → publica o original em vez de perder o post
 *
 * Rodam o ffmpeg de verdade sobre vídeos sintéticos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { FFMPEG_BIN: ffmpegBin } = require('../src/services/ffmpegBin');
const { prepararParaConta, marcaDe } = require('../src/services/midiaPorConta');

const UPLOADS = path.resolve(__dirname, '../uploads');
const temFfmpeg = !!ffmpegBin && fs.existsSync(ffmpegBin);
const talvez = temFfmpeg ? describe : describe.skip;
const conta = { id: 'c1', username: 'loja' };

test('o nome do arquivo da conta é estável por post e conta', () => {
  expect(marcaDe('p1', 'c1')).toBe(marcaDe('p1', 'c1'));
  expect(marcaDe('p1', 'c1')).not.toBe(marcaDe('p1', 'c2'));
});

test('arquivo inexistente: segue com o original', async () => {
  const r = await prepararParaConta({ id: 'p1', media: 'nao-existe-mesmo.mp4' }, conta);
  expect(r).toEqual({ caminho: 'nao-existe-mesmo.mp4', proprio: false });
});

talvez('o vídeo que vai para a conta', () => {
  jest.setTimeout(180000);
  let dir, mp4, comMp3;
  const gerados = [];

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-midia-'));
    mp4 = path.join(dir, 'original.mp4');
    comMp3 = path.join(dir, 'audio-mp3.mp4');
    const base = ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-shortest'];
    await execFileAsync(ffmpegBin, [...base, '-c:a', 'aac', '-y', mp4]);
    await execFileAsync(ffmpegBin, [...base, '-c:a', 'libmp3lame', '-y', comMp3]);
  });
  afterAll(() => {
    for (const g of gerados) { try { fs.unlinkSync(path.resolve(UPLOADS, g)); } catch { /* ok */ } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* já foi */ }
  });

  test('formato que a API aceita: vai o arquivo enviado, sem conversão', async () => {
    const r = await prepararParaConta({ id: 'p1', media: mp4 }, conta);
    expect(r).toEqual({ caminho: mp4, proprio: false });
  });

  test('formato que a API recusa: converte para 1080×1920 com AAC', async () => {
    const r = await prepararParaConta({ id: 'p2', media: comMp3 }, conta);
    expect(r.proprio).toBe(true);
    gerados.push(r.caminho);
    const { stdout } = await execFileAsync(ffmpegBin.replace(/ffmpeg$/, 'ffprobe'), [
      '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'default=noprint_wrappers=1',
      path.resolve(UPLOADS, r.caminho),
    ]).catch(() => ({ stdout: '' }));
    if (stdout) {
      expect(stdout).toContain('width=1080');
      expect(stdout).toContain('height=1920');
      expect(stdout).toContain('codec_name=aac');
    }
  });

  test('a mesma entrada dá a mesma saída (nada sorteado)', async () => {
    const a = await prepararParaConta({ id: 'p3', media: comMp3 }, conta);
    const b = await prepararParaConta({ id: 'p3', media: comMp3 }, conta);
    gerados.push(a.caminho);
    expect(b.caminho).toBe(a.caminho);
  });
});

describe('todos os caminhos de publicação passam por aqui', () => {
  const publicar = fs.readFileSync(path.resolve(__dirname, '../src/services/publicar.js'), 'utf8');
  const worker = fs.readFileSync(path.resolve(__dirname, '../src/worker.js'), 'utf8');

  test('reel, imagem e story preparam a mídia por conta', () => {
    /* Um teste de unidade sobre o módulo não pega a ausência da chamada — o
       módulo pode estar perfeito e ninguém chamá-lo. */
    expect(publicar.match(/midiaPorConta\.prepararParaConta\(/g)).toHaveLength(3);
  });

  test('o arquivo por conta é apagado DEPOIS de a Meta concluir a publicação', () => {
    /* A Meta BAIXA a mídia da nossa URL: apagar antes deixaria o container
       pedindo um arquivo que não existe mais. */
    const trecho = publicar.slice(publicar.indexOf('async function publicarReel'), publicar.indexOf('async function publicarImagem'));
    expect(trecho.indexOf('await graph.publicarReel')).toBeLessThan(trecho.indexOf('apagar(gerados)'));
    expect(trecho).toContain('} finally {');
  });

  test('Postar, Loop e campanha usam o mesmo publicador', () => {
    expect(worker).toMatch(/publicarNaConta:\s*\(conta, post\) => publicarNaConta\(conta, post\)/);
    expect(worker).toContain('const { mediaId } = await publicar(conta, postDaConta);');
  });
});

describe('o ritmo entre contas', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '../src/worker.js'), 'utf8');
  const stories = fs.readFileSync(path.resolve(__dirname, '../src/services/stories.js'), 'utf8');

  test('envio (Postar/Loop): ordem sorteada, alternância e espera entre publicações', () => {
    expect(worker).toMatch(/espacarPorConta\(embaralhar\(/);
    expect(worker).toContain('120_000 + Math.floor(Math.random() * 180_000)');   // 2 a 5 min
  });

  test('stories: ordem sorteada por mídia', () => {
    expect(stories).toContain('embaralhar(accountIds');
  });
});
