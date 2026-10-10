import type { AssetDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import {
  alphaMean,
  decodeErrors,
  decodedDuration,
  frameStats,
  mainStreams,
  makeReference,
  parseTiffTags,
  pngChunks,
  psnr,
  rotationOf,
  sha256,
  volumeDb,
} from '../helpers/inspecaoMidia';
import { frameMd5, meanLuma, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Todas as tarefas são enfileiradas no início (a fila processa 2 por vez) e
 * cada teste aguarda só as suas: o arquivo inteiro roda em ~1–2 min.
 */
const T = 300_000;

let srv: TestServer;
let c: Client;
const A: Record<string, AssetDTO> = {};
const runs = new Map<string, Promise<JobDetail[]>>();

function enqueue(key: string, asset: () => AssetDTO, settings: unknown) {
  const p = (async () => {
    const ids = await c.batch([asset().id], settings);
    return c.waitJobs(ids, T - 20_000);
  })();
  p.catch(() => undefined); // o erro aparece no teste que aguarda
  runs.set(key, p);
}

/** Aguarda a tarefa e exige conclusão; devolve o detalhe e o arquivo baixado. */
async function done(key: string, ext: string) {
  const jobs = await runs.get(key)!;
  const out = [];
  for (const j of jobs) {
    expect(j.status, `${key}: ${j.error}\n${j.logTail ?? ''}`).toBe('completed');
    const r = await c.download(j.output!.downloadUrl);
    expect(r.status).toBe(200);
    expect(sha256(r.body)).toBe(j.output!.sha256);
    out.push({ job: j, body: r.body, file: tmpFile(r.body, ext) });
  }
  return out;
}

const fast = { speed: 'fast' as const };

beforeAll(async () => {
  srv = await startServer();
  c = new Client(srv.base);
  const names = ['iphone.mov', 'plain.mp4', 'photo.jpg', 'graphic.png', 'rotated.mp4'];
  const assets = await c.importOk(...names.map((n) => fx(n)));
  names.forEach((n, i) => (A[n] = assets[i]!));
  const plain = () => A['plain.mp4']!;

  // Conversões de formato
  enqueue('mov→mp4', () => A['iphone.mov']!, { mode: 'quick', output: { format: 'mp4' } });
  enqueue('mp4→webm', plain, { mode: 'quick', output: { format: 'webm' } });
  enqueue('mp4→mkv', plain, { mode: 'quick', output: { format: 'mkv' } });
  enqueue('jpg→png', () => A['photo.jpg']!, { mode: 'quick', output: { format: 'png' } });
  enqueue('png→jpg', () => A['graphic.png']!, { mode: 'quick', output: { format: 'jpg' } });
  enqueue('png→webp', () => A['graphic.png']!, { mode: 'quick', output: { format: 'webp' } });
  enqueue('jpg 1:1', () => A['photo.jpg']!, { mode: 'custom', geometry: { aspect: '1:1', resolution: 'custom', width: 200, height: 200 } });
  // Geometria
  enqueue('9:16', plain, { mode: 'custom', video: fast, geometry: { aspect: '9:16', resolution: '1080', fit: 'crop' } });
  enqueue('4:5 pad', plain, { mode: 'custom', video: fast, geometry: { aspect: '4:5', resolution: '1080', fit: 'pad' } });
  enqueue('640x480 keep', () => A['rotated.mp4']!, { mode: 'custom', video: fast, geometry: { resolution: 'custom', width: 640, height: 480, keepAspect: true } });
  enqueue('640x480 exato', () => A['rotated.mp4']!, { mode: 'custom', video: fast, geometry: { resolution: 'custom', width: 640, height: 480, keepAspect: false } });
  enqueue('corte de área', plain, { mode: 'custom', video: fast, geometry: { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } } });
  // Tempo
  enqueue('trim', plain, { mode: 'custom', video: fast, trim: { start: 0.5, end: 1.5 } });
  enqueue('2x', plain, { mode: 'custom', video: fast, speed: 2 });
  enqueue('0.5x', plain, { mode: 'custom', video: fast, speed: 0.5 });
  enqueue('24fps', plain, { mode: 'custom', video: { ...fast, fps: '24' } });
  enqueue('partes', plain, { mode: 'custom', video: fast, segmentation: { mode: 'count', value: 2 } });
  enqueue('partes 1.5s', plain, { mode: 'custom', video: fast, segmentation: { mode: 'duration', value: 1.5 } });
  // Cor e codificação
  enqueue('brilho', plain, { mode: 'custom', video: fast, color: { brightness: 60 } });
  enqueue('400k', () => A['iphone.mov']!, { mode: 'custom', video: { ...fast, codec: 'h264', rateControl: 'bitrate', bitrateKbps: 400 } });
  enqueue('1600k', () => A['iphone.mov']!, { mode: 'custom', video: { ...fast, codec: 'h264', rateControl: 'bitrate', bitrateKbps: 1600 } });
  enqueue('hevc', plain, { mode: 'custom', output: { format: 'mp4' }, video: { ...fast, codec: 'hevc' } });
  enqueue('av1', plain, { mode: 'custom', output: { format: 'mp4' }, video: { ...fast, codec: 'av1' } });
}, T);
afterAll(async () => srv?.close());

describe('conversão de formato', () => {
  it('MOV → MP4 por cópia de fluxos (quadros idênticos, marca isom)', async () => {
    const [o] = await done('mov→mp4', 'mp4');
    expect(o!.job.report!.strategy).toBe('stream-copy');
    expect(o!.body.toString('latin1', 4, 8)).toBe('ftyp');
    expect(o!.body.toString('latin1', 8, 12)).not.toBe('qt  ');
    expect(mainStreams(o!.file).format.tags?.major_brand).toMatch(/isom|mp4/);
    const { v, a } = mainStreams(o!.file);
    expect([v.codec_name, a.codec_name]).toEqual(['h264', 'aac']);
    expect(frameMd5(o!.file)).toBe(frameMd5(fx('iphone.mov')));
    expect(o!.job.output!.name).toMatch(/\.mp4$/);
  }, T);

  it('MP4 → WebM recodifica para VP9 + Opus', async () => {
    const [o] = await done('mp4→webm', 'webm');
    expect(o!.job.report!.strategy).toBe('re-encode');
    expect(o!.body.subarray(0, 64).includes('webm')).toBe(true); // DocType do EBML
    const { v, a, format, duration } = mainStreams(o!.file);
    expect(format.format_name).toMatch(/webm/);
    expect(v.codec_name).toBe('vp9');
    expect(a.codec_name).toBe('opus');
    expect([v.width, v.height]).toEqual([320, 240]);
    expect(Math.abs(duration - 2)).toBeLessThan(0.15);
    expect(psnr(o!.file, fx('plain.mp4'), { ssA: 1, ssB: 1 })).toBeGreaterThan(28);
    expect(decodeErrors(o!.file)).toEqual([]);
  }, T);

  it('MP4 → MKV por cópia de fluxos', async () => {
    const [o] = await done('mp4→mkv', 'mkv');
    expect(o!.job.report!.strategy).toBe('stream-copy');
    expect(o!.body.subarray(0, 64).includes('matroska')).toBe(true);
    const { v, a } = mainStreams(o!.file);
    expect([v.codec_name, a.codec_name]).toEqual(['h264', 'aac']);
    expect(frameMd5(o!.file)).toBe(frameMd5(fx('plain.mp4')));
  }, T);

  it('JPG (EXIF 6) → PNG aplica a orientação nos pixels: 300×400, imagem na posição certa e sem tag de orientação', async () => {
    const [o] = await done('jpg→png', 'png');
    const v = mainStreams(o!.file).v;
    expect(v.codec_name).toBe('png');
    expect([v.width, v.height]).toEqual([300, 400]);
    // Referência: pixels armazenados girados 90° no sentido horário (EXIF 6).
    expect(psnr(o!.file, fx('photo.jpg'), { filterB: 'transpose=1', rawA: true })).toBeGreaterThan(35);
    const exif = pngChunks(o!.body).chunks.find((x) => x.type === 'eXIf');
    // Pixels já girados: uma tag de orientação ≠ 1 faria o visualizador girar de novo.
    const orient = exif ? parseTiffTags(exif.data).ifd0.get(0x0112)?.value : undefined;
    expect(orient === undefined || orient === 1).toBe(true);
  }, T);

  it('PNG com alfa → JPG: sem erro, transparência achatada sobre fundo branco', async () => {
    const [o] = await done('png→jpg', 'jpg');
    const v = mainStreams(o!.file).v;
    expect(v.codec_name).toBe('mjpeg');
    expect([v.width, v.height]).toEqual([200, 100]);
    const white = makeReference(['-f', 'lavfi', '-i', 'color=c=white:s=200x100', '-i', fx('graphic.png'), '-filter_complex', '[0][1]overlay=format=auto', '-frames:v', '1'], 'png');
    const black = makeReference(['-f', 'lavfi', '-i', 'color=c=black:s=200x100', '-i', fx('graphic.png'), '-filter_complex', '[0][1]overlay=format=auto', '-frames:v', '1'], 'png');
    const pw = psnr(o!.file, white);
    const pb = psnr(o!.file, black);
    expect(pw).toBeGreaterThan(30);
    expect(pw).toBeGreaterThan(pb + 6);
    expect(o!.job.report!.operations.some((op) => op.id === 'flatten')).toBe(true);
  }, T);

  it('PNG → WEBP mantém dimensões e o canal alfa', async () => {
    const [o] = await done('png→webp', 'webp');
    const v = mainStreams(o!.file).v;
    expect(v.codec_name).toBe('webp');
    expect([v.width, v.height]).toEqual([200, 100]);
    expect(o!.body.toString('latin1', 8, 12)).toBe('WEBP');
    const a = alphaMean(o!.file);
    expect(Math.abs(a - alphaMean(fx('graphic.png')))).toBeLessThan(4);
    expect(a).toBeLessThan(200); // continua translúcido
  }, T);
});

describe('modo personalizado: geometria', () => {
  it('foto com EXIF 6 recortada em 1:1 (200×200) usa a imagem já na posição de exibição', async () => {
    const [o] = await done('jpg 1:1', 'jpg');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([200, 200]);
    const ref = { filterB: 'transpose=1,scale=200:200:force_original_aspect_ratio=increase,crop=200:200', rawA: true };
    const wrong = { filterB: 'scale=200:200:force_original_aspect_ratio=increase,crop=200:200', rawA: true };
    const pOk = psnr(o!.file, fx('photo.jpg'), ref);
    expect(pOk).toBeGreaterThan(28);
    expect(pOk).toBeGreaterThan(psnr(o!.file, fx('photo.jpg'), wrong) + 5);
    // Sem EXIF de orientação sobrando (os pixels já estão girados).
    expect(o!.body.includes(Buffer.from('Exif\0\0'))).toBe(false);
  }, T);

  it('9:16, resolução 1080, recorte → 1080×1920 com SAR 1:1 e enquadramento central', async () => {
    const [o] = await done('9:16', 'mp4');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([1080, 1920]);
    expect(v.sample_aspect_ratio ?? '1:1').toBe('1:1');
    expect(o!.job.validationStatus).not.toBe('failed');
    const p = psnr(o!.file, fx('plain.mp4'), {
      ssA: 1,
      ssB: 1,
      filterB: 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      size: '270x480',
    });
    expect(p).toBeGreaterThan(25);
  }, T);

  it('4:5 com barras → 1080×1350, faixas pretas acima e abaixo do conteúdo', async () => {
    const [o] = await done('4:5 pad', 'mp4');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([1080, 1350]);
    // Conteúdo 4:3 ocupa 1080×810 no centro: 270 px de barra em cima e embaixo.
    const top = frameStats(o!.file, 1, '1080:240:0:0');
    const bottom = frameStats(o!.file, 1, '1080:240:0:1110');
    const middle = frameStats(o!.file, 1, '1080:600:0:375');
    expect(top.ymax).toBeLessThanOrEqual(20);
    expect(bottom.ymax).toBeLessThanOrEqual(20);
    expect(middle.yavg).toBeGreaterThan(40);
  }, T);

  it('personalizado 640×480 mantendo proporção encaixa o vídeo retrato em 360×480', async () => {
    const [o] = await done('640x480 keep', 'mp4');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([360, 480]);
    expect(rotationOf(v)).toBe(0);
    expect(psnr(o!.file, fx('rotated.mp4'), { ssA: 0.5, ssB: 0.5, size: '240x320' })).toBeGreaterThan(28);
  }, T);

  it('personalizado 640×480 sem manter proporção → exatamente 640×480', async () => {
    const [o] = await done('640x480 exato', 'mp4');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([640, 480]);
  }, T);

  it('corte de área (metade direita) → 160×240 com o conteúdo da metade direita', async () => {
    const [o] = await done('corte de área', 'mp4');
    const v = mainStreams(o!.file).v;
    expect([v.width, v.height]).toEqual([160, 240]);
    const right = psnr(o!.file, fx('plain.mp4'), { ssA: 1, ssB: 1, filterB: 'crop=160:240:160:0' });
    const left = psnr(o!.file, fx('plain.mp4'), { ssA: 1, ssB: 1, filterB: 'crop=160:240:0:0' });
    expect(right).toBeGreaterThan(30);
    expect(right).toBeGreaterThan(left + 5);
  }, T);
});

describe('modo personalizado: tempo', () => {
  it('corte 0,5–1,5 s → ~1 s começando no quadro de 0,5 s', async () => {
    const [o] = await done('trim', 'mp4');
    const { duration, a } = mainStreams(o!.file);
    expect(Math.abs(duration - 1)).toBeLessThan(0.1);
    expect(Math.abs(decodedDuration(o!.file, 'v') - 1)).toBeLessThan(0.1);
    expect(a).toBeDefined();
    const at05 = psnr(o!.file, fx('plain.mp4'), { ssB: 0.5 });
    const at0 = psnr(o!.file, fx('plain.mp4'));
    expect(at05).toBeGreaterThan(30);
    expect(at05).toBeGreaterThan(at0 + 3);
    expect(o!.job.report!.operations.some((op) => op.id === 'trim')).toBe(true);
  }, T);

  it('velocidade 2× → metade da duração (vídeo e áudio)', async () => {
    const [o] = await done('2x', 'mp4');
    expect(Math.abs(mainStreams(o!.file).duration - 1)).toBeLessThan(0.12);
    expect(Math.abs(decodedDuration(o!.file, 'v') - 1)).toBeLessThan(0.12);
    expect(Math.abs(decodedDuration(o!.file, 'a') - 1)).toBeLessThan(0.12);
    // Áudio acelerado sem mudar o tom: o seno de 660 Hz continua em 660 Hz (não vira 1320 Hz).
    expect(volumeDb(o!.file, { band: 660 })).toBeGreaterThan(volumeDb(o!.file, { band: 1320 }) + 10);
  }, T);

  it('velocidade 0,5× → dobro da duração (vídeo e áudio)', async () => {
    const [o] = await done('0.5x', 'mp4');
    expect(Math.abs(decodedDuration(o!.file, 'v') - 4)).toBeLessThan(0.15);
    expect(Math.abs(decodedDuration(o!.file, 'a') - 4)).toBeLessThan(0.15);
    expect(volumeDb(o!.file, { band: 660 })).toBeGreaterThan(volumeDb(o!.file, { band: 330 }) + 10);
  }, T);

  it('fps 24 → r_frame_rate 24/1 e ~48 quadros em 2 s', async () => {
    const [o] = await done('24fps', 'mp4');
    const v = mainStreams(o!.file).v;
    expect(v.r_frame_rate).toBe('24/1');
    expect(v.avg_frame_rate).toBe('24/1');
    expect(Math.abs(Number(v.nb_frames) - 48)).toBeLessThanOrEqual(1);
  }, T);

  it('divisão em 2 partes → 2 tarefas de ~1 s; a 2ª começa no quadro de 1 s', async () => {
    const parts = await done('partes', 'mp4');
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.job.label)).toEqual(['Personalizado · parte 1/2', 'Personalizado · parte 2/2']);
    for (const p of parts) expect(Math.abs(mainStreams(p.file).duration - 1)).toBeLessThan(0.1);
    expect(psnr(parts[1]!.file, fx('plain.mp4'), { ssB: 1 })).toBeGreaterThan(30);
    expect(psnr(parts[0]!.file, fx('plain.mp4'))).toBeGreaterThan(30);
    expect(parts[0]!.job.output!.name).not.toBe(parts[1]!.job.output!.name);
  }, T);

  it('divisão por duração (1,5 s) em vídeo de 2 s → partes de 1,5 s e 0,5 s', async () => {
    const parts = await done('partes 1.5s', 'mp4');
    expect(parts).toHaveLength(2);
    const d = parts.map((p) => decodedDuration(p.file, 'v'));
    expect(Math.abs(d[0]! - 1.5)).toBeLessThan(0.1);
    expect(Math.abs(d[1]! - 0.5)).toBeLessThan(0.1);
  }, T);

  it('corte com início além da duração é recusado no plano (422, sem tarefa)', async () => {
    const before = (await c.get('/api/jobs')).data.length;
    const plan = await c.post('/api/plan', { assetIds: [A['plain.mp4']!.id], scope: 'common', settings: { mode: 'custom', trim: { start: 5 } } });
    expect(plan.status).toBe(200);
    expect(plan.data.ok).toBe(false);
    expect(plan.data.errors.map((e: any) => e.message).join(' ')).toMatch(/posterior à duração/);
    const r = await c.post('/api/batches', { assetIds: [A['plain.mp4']!.id], scope: 'common', settings: { mode: 'custom', trim: { start: 5 } } });
    expect(r.status).toBe(422);
    expect((await c.get('/api/jobs')).data.length).toBe(before);
  }, T);
});

describe('modo personalizado: cor e codificação', () => {
  it('brilho +60 aumenta a luminância média em relação à fonte', async () => {
    const [o] = await done('brilho', 'mp4');
    const before = meanLuma(fx('plain.mp4'));
    const after = meanLuma(o!.file);
    expect(after).toBeGreaterThan(before + 25);
  }, T);

  it('taxa de bits alvo: 400 e 1600 kb/s ficam próximas do pedido e bem separadas', async () => {
    const [lo] = await done('400k', 'mp4');
    const [hi] = await done('1600k', 'mp4');
    const kb = (f: string) => {
      const { v } = mainStreams(f);
      return Number(v.bit_rate) / 1000;
    };
    const l = kb(lo!.file);
    const h = kb(hi!.file);
    expect(l / 400).toBeGreaterThan(0.6);
    expect(l / 400).toBeLessThan(1.4);
    expect(h / 1600).toBeGreaterThan(0.6);
    expect(h / 1600).toBeLessThan(1.4);
    expect(h / l).toBeGreaterThan(2.5);
    expect(lo!.job.report!.validation.checks.find((ch) => ch.name === 'Taxa de bits do vídeo')?.status).toBe('ok');
  }, T);

  it('HEVC em MP4 (tag hvc1) decodifica sem erros', async () => {
    const [o] = await done('hevc', 'mp4');
    const v = mainStreams(o!.file).v;
    expect(v.codec_name).toBe('hevc');
    expect(v.codec_tag_string).toBe('hvc1');
    expect([v.width, v.height]).toEqual([320, 240]);
    expect(decodeErrors(o!.file)).toEqual([]);
    expect(psnr(o!.file, fx('plain.mp4'), { ssA: 1, ssB: 1 })).toBeGreaterThan(28);
  }, T);

  it('AV1 em MP4 decodifica sem erros', async () => {
    const [o] = await done('av1', 'mp4');
    const v = mainStreams(o!.file).v;
    expect(v.codec_name).toBe('av1');
    expect([v.width, v.height]).toEqual([320, 240]);
    expect(decodeErrors(o!.file)).toEqual([]);
    expect(psnr(o!.file, fx('plain.mp4'), { ssA: 1, ssB: 1 })).toBeGreaterThan(26);
  }, T);
});
