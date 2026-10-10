import type { AssetDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { decodedDuration, decodeErrors, frameStats, mainStreams, psnr, sha256, volumeDb } from '../helpers/inspecaoMidia';
import { frameMd5, meanVolumeDb, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

const T = 300_000;

let srv: TestServer;
let c: Client;
const A: Record<string, AssetDTO> = {};
const runs = new Map<string, Promise<JobDetail[]>>();

function enqueue(key: string, asset: string, settings: unknown) {
  const p = (async () => {
    const ids = await c.batch([A[asset]!.id], settings);
    return c.waitJobs(ids, T - 20_000);
  })();
  p.catch(() => undefined);
  runs.set(key, p);
}

async function done(key: string, ext = 'mp4') {
  const [j] = await runs.get(key)!;
  expect(j!.status, `${key}: ${j!.error}\n${j!.logTail ?? ''}`).toBe('completed');
  const r = await c.download(j!.output!.downloadUrl);
  expect(r.status).toBe(200);
  expect(sha256(r.body)).toBe(j!.output!.sha256);
  return { job: j!, body: r.body, file: tmpFile(r.body, ext) };
}

const fast = { speed: 'fast' as const };
const SILENCE = -60;
const AUDIBLE = -40;

beforeAll(async () => {
  srv = await startServer();
  c = new Client(srv.base);
  const names = ['plain.mp4', 'noaudio.mp4', 'scene.mp4', 'track.mp3', 'legendas.srt', 'logo.png', 'photo.jpg', 'long.mp4'];
  const assets = await c.importOk(...names.map((n) => fx(n)));
  names.forEach((n, i) => (A[n] = assets[i]!));
  const id = (n: string) => A[n]!.id;

  enqueue('sem áudio', 'plain.mp4', { mode: 'quick', audio: { mode: 'remove' } });
  enqueue('volume 0.5', 'plain.mp4', { mode: 'custom', video: fast, audio: { volume: 0.5 } });
  enqueue('volume 2', 'plain.mp4', { mode: 'custom', video: fast, audio: { volume: 2 } });
  enqueue('manter sem áudio', 'noaudio.mp4', { mode: 'quick' });
  enqueue('trilha', 'plain.mp4', { mode: 'editorial', video: fast, editorial: { audioTrack: { assetId: id('track.mp3'), mode: 'replace' } } });
  enqueue('mix', 'plain.mp4', {
    mode: 'editorial',
    video: fast,
    editorial: { audioTrack: { assetId: id('track.mp3'), mode: 'mix', volume: 1, originalVolume: 1 } },
  });
  // 1 s de cartela + 2 s principal + 2×2 s de cena = 7 s, maior que a trilha de 4 s.
  const longEditorial = (loop: boolean) => ({
    mode: 'editorial',
    video: fast,
    editorial: {
      intro: { type: 'card', text: 'Início', duration: 1 },
      scenes: [{ assetId: id('scene.mp4') }, { assetId: id('scene.mp4') }],
      audioTrack: { assetId: id('track.mp3'), mode: 'replace', loop },
    },
  });
  enqueue('trilha em loop', 'noaudio.mp4', longEditorial(true));
  enqueue('trilha sem loop', 'noaudio.mp4', longEditorial(false));
  enqueue('editorial completo', 'plain.mp4', {
    mode: 'editorial',
    output: { format: 'mp4' },
    video: fast,
    geometry: { aspect: '1:1', resolution: '480', fit: 'crop' },
    fade: { in: 0.3, out: 0.5 },
    editorial: {
      intro: { type: 'card', text: 'Abertura', duration: 1.5, background: '#0A1022', color: '#FFFFFF', size: 7 },
      outro: { type: 'asset', assetId: id('photo.jpg'), duration: 1.5 },
      scenes: [{ assetId: id('scene.mp4') }],
      texts: [{ text: 'Topo', position: 'top', size: 5 }],
      overlays: [{ assetId: id('logo.png'), position: 'top-right', scale: 0.18, opacity: 1 }],
      subtitles: { assetId: id('legendas.srt') },
    },
  });
}, T);
afterAll(async () => srv?.close());

describe('áudio', () => {
  it('áudio removido → nenhum fluxo de áudio, vídeo copiado intacto', async () => {
    const o = await done('sem áudio');
    const { a } = mainStreams(o.file);
    expect(a).toBeUndefined();
    expect(o.job.output!.hasAudio).toBe(false);
    expect(o.job.report!.strategy).toBe('stream-copy');
    expect(o.job.report!.operations.some((op) => op.id === 'audio-remove')).toBe(true);
    expect(frameMd5(o.file)).toBe(frameMd5(fx('plain.mp4')));
  }, T);

  it('volume 0,5 → volume médio ~6 dB menor; volume 2 → ~6 dB maior', async () => {
    const ref = meanVolumeDb(fx('plain.mp4'));
    const half = await done('volume 0.5');
    const dbl = await done('volume 2');
    expect(meanVolumeDb(half.file) - ref).toBeGreaterThan(-6.02 - 1);
    expect(meanVolumeDb(half.file) - ref).toBeLessThan(-6.02 + 1);
    expect(meanVolumeDb(dbl.file) - ref).toBeGreaterThan(6.02 - 1);
    expect(meanVolumeDb(dbl.file) - ref).toBeLessThan(6.02 + 1);
    expect(half.job.report!.operations.find((op) => op.id === 'volume')?.detail).toMatch(/-6,0 dB/);
  }, T);

  it('vídeo sem áudio com "manter" → saída sem áudio e o item aparece como não aplicado', async () => {
    const o = await done('manter sem áudio');
    expect(mainStreams(o.file).a).toBeUndefined();
    const sk = o.job.report!.skipped;
    expect(sk.some((s) => s.label === 'Áudio' && /não tem faixa de áudio/i.test(s.reason))).toBe(true);
    expect(o.job.validationStatus).toBe('passed');
  }, T);

  it('trilha substituta (track.mp3) → áudio da trilha (330 Hz) com a duração do vídeo', async () => {
    const o = await done('trilha');
    const { a, duration } = mainStreams(o.file);
    expect(a).toBeDefined();
    expect(Math.abs(decodedDuration(o.file, 'a') - 2)).toBeLessThan(0.1);
    expect(Math.abs(duration - 2)).toBeLessThan(0.15);
    const b330 = volumeDb(o.file, { band: 330 });
    const b660 = volumeDb(o.file, { band: 660 });
    expect(b330).toBeGreaterThan(AUDIBLE);
    expect(b330).toBeGreaterThan(b660 + 10); // o seno original (660 Hz) saiu
    expect(o.job.report!.operations.some((op) => op.id === 'audio-track' && /substituída/.test(op.label))).toBe(true);
  }, T);

  it('mixagem → trilha (330 Hz) e original (660 Hz) presentes', async () => {
    const o = await done('mix');
    const b330 = volumeDb(o.file, { band: 330 });
    const b660 = volumeDb(o.file, { band: 660 });
    expect(b330).toBeGreaterThan(AUDIBLE);
    expect(b660).toBeGreaterThan(AUDIBLE);
    expect(Math.abs(b330 - b660)).toBeLessThan(8);
    expect(Math.abs(decodedDuration(o.file, 'a') - 2)).toBeLessThan(0.1);
    expect(o.job.report!.operations.some((op) => op.id === 'audio-track' && /mixada/.test(op.label))).toBe(true);
  }, T);

  it('trilha em loop cobre o vídeo inteiro (7 s) mesmo sendo mais curta (4 s)', async () => {
    const o = await done('trilha em loop');
    expect(Math.abs(decodedDuration(o.file, 'v') - 7)).toBeLessThan(0.2);
    expect(Math.abs(decodedDuration(o.file, 'a') - 7)).toBeLessThan(0.2);
    expect(volumeDb(o.file, { ss: 1, t: 1 })).toBeGreaterThan(AUDIBLE);
    // Depois dos 4 s da trilha original, a repetição continua audível.
    expect(volumeDb(o.file, { ss: 5.5, t: 1 })).toBeGreaterThan(AUDIBLE);
    expect(volumeDb(o.file, { ss: 5.5, t: 1, band: 330 })).toBeGreaterThan(AUDIBLE);
  }, T);

  it('sem loop, a trilha termina e o resto do vídeo fica em silêncio (mesma duração total)', async () => {
    const o = await done('trilha sem loop');
    expect(Math.abs(decodedDuration(o.file, 'a') - 7)).toBeLessThan(0.2);
    expect(volumeDb(o.file, { ss: 1, t: 1 })).toBeGreaterThan(AUDIBLE);
    expect(volumeDb(o.file, { ss: 5.5, t: 1 })).toBeLessThan(SILENCE);
  }, T);
});

describe('editorial completo', () => {
  let o: Awaited<ReturnType<typeof done>>;
  beforeAll(async () => {
    o = await done('editorial completo');
  }, T);

  it('duração = abertura + principal + cena + encerramento, na resolução escolhida', () => {
    const { v, a, duration } = mainStreams(o.file);
    expect([v.width, v.height]).toEqual([480, 480]);
    expect(Math.abs(duration - 7)).toBeLessThan(0.2);
    expect(Math.abs(decodedDuration(o.file, 'v') - 7)).toBeLessThan(0.2);
    expect(Math.abs(decodedDuration(o.file, 'a') - 7)).toBeLessThan(0.2);
    expect(a).toBeDefined();
    expect(o.job.output!.width).toBe(480);
  });

  it('decodifica sem erros (validação do servidor e decodificação independente)', () => {
    expect(o.job.report!.validation.decode.ok).toBe(true);
    expect(o.job.report!.validation.decode.mode).toBe('full');
    expect(o.job.validationStatus).toBe('passed');
    expect(decodeErrors(o.file)).toEqual([]);
  });

  it('o relatório lista todas as operações editoriais', () => {
    const ops = o.job.report!.operations;
    const ids = ops.map((op) => op.id);
    for (const id of ['sequence', 'text-0', 'overlay-0', 'subtitles', 'fade', 'reframe', 'video-codec', 'audio-codec', 'validate']) {
      expect(ids, id).toContain(id);
    }
    const seq = ops.find((op) => op.id === 'sequence')!.detail;
    expect(seq).toMatch(/Abertura \(cartela\).*Principal: plain\.mp4.*Cena 1: scene\.mp4.*Encerramento: photo\.jpg/);
    expect(o.job.report!.strategy).toBe('re-encode');
  });

  it('quadros reais: cartela escura com texto, logotipo vermelho, texto no topo e legenda na base', () => {
    const t = 1.0; // dentro da cartela (0–1,5 s) e da 1ª legenda (0–1,5 s)
    const whole = frameStats(o.file, t);
    expect(whole.yavg).toBeLessThan(70); // fundo #0A1022
    expect(frameStats(o.file, t, '480:90:0:195').ymax).toBeGreaterThan(200); // título da cartela
    expect(frameStats(o.file, t, '480:70:0:405').ymax).toBeGreaterThan(200); // legenda
    expect(frameStats(o.file, t, '160:50:160:5').ymax).toBeGreaterThan(200); // texto "Topo"
    const logo = frameStats(o.file, t, '70:30:390:20');
    const left = frameStats(o.file, t, '70:30:20:100');
    expect(logo.vavg).toBeGreaterThan(left.vavg + 30); // vermelho → Cr alto
  });

  it('o áudio original só soa no trecho principal (1,5–3,5 s); abertura e cena em silêncio', () => {
    expect(volumeDb(o.file, { ss: 0.4, t: 0.9 })).toBeLessThan(SILENCE);
    expect(volumeDb(o.file, { ss: 2, t: 1 })).toBeGreaterThan(AUDIBLE);
    expect(volumeDb(o.file, { ss: 4, t: 1 })).toBeLessThan(SILENCE);
  });

  it('o principal entra em 1,5 s e o encerramento mostra a foto já na orientação de exibição', () => {
    // Encerramento (5,5–7 s): foto em 1:1 (480×480) — compara com a foto girada (EXIF 6) e recortada.
    const pRight = psnr(o.file, fx('photo.jpg'), {
      ssA: 6.0,
      filterB: 'transpose=1,scale=480:480:force_original_aspect_ratio=increase,crop=480:480',
      size: '240x240',
    });
    const pWrong = psnr(o.file, fx('photo.jpg'), {
      ssA: 6.0,
      filterB: 'scale=480:480:force_original_aspect_ratio=increase,crop=480:480',
      size: '240x240',
    });
    expect(pRight).toBeGreaterThan(pWrong + 3);
  });
});

describe('referências inválidas', () => {
  async function counts() {
    return { jobs: (await c.get('/api/jobs')).data.length, batches: (await c.get('/api/batches')).data.length };
  }
  const editorialWith = (editorial: unknown) => ({ mode: 'editorial', editorial });

  it('asset inexistente → 422 sem criar tarefas nem lote', async () => {
    const before = await counts();
    const r = await c.post('/api/batches', {
      assetIds: [A['plain.mp4']!.id],
      scope: 'common',
      settings: editorialWith({ overlays: [{ assetId: 'naoexiste12345' }] }),
    });
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe('invalid-batch');
    expect(JSON.stringify(r.data.error.details)).toMatch(/Elemento gráfico/);
    expect(await counts()).toEqual(before);
    const plan = await c.post('/api/plan', { assetIds: [A['plain.mp4']!.id], scope: 'common', settings: editorialWith({ overlays: [{ assetId: 'naoexiste12345' }] }) });
    expect(plan.data.ok).toBe(false);
  });

  it('asset de OUTRA sessão não pode ser usado como trilha/logotipo', async () => {
    const other = new Client(srv.base);
    const [foreign] = await other.importOk(fx('logo.png'));
    const before = await counts();
    const r = await c.post('/api/batches', {
      assetIds: [A['plain.mp4']!.id],
      scope: 'common',
      settings: editorialWith({ overlays: [{ assetId: foreign!.id }] }),
    });
    expect(r.status).toBe(422);
    expect(await counts()).toEqual(before);
  });

  it('tipo errado (áudio como logotipo, vídeo como legenda) → 422 com o motivo', async () => {
    const before = await counts();
    const r1 = await c.post('/api/batches', {
      assetIds: [A['plain.mp4']!.id],
      scope: 'common',
      settings: editorialWith({ overlays: [{ assetId: A['track.mp3']!.id }] }),
    });
    expect(r1.status).toBe(422);
    expect(JSON.stringify(r1.data.error.details)).toMatch(/não é do tipo esperado/);
    const r2 = await c.post('/api/batches', {
      assetIds: [A['plain.mp4']!.id],
      scope: 'common',
      settings: editorialWith({ subtitles: { assetId: A['scene.mp4']!.id } }),
    });
    expect(r2.status).toBe(422);
    expect(await counts()).toEqual(before);
  });

  it('um único arquivo com referência inválida derruba o lote inteiro (nenhuma tarefa parcial)', async () => {
    const before = await counts();
    const r = await c.post('/api/batches', {
      assetIds: [A['plain.mp4']!.id, A['noaudio.mp4']!.id],
      scope: 'individual',
      settings: { mode: 'quick' },
      perAsset: { [A['noaudio.mp4']!.id]: editorialWith({ audioTrack: { assetId: 'naoexiste12345' } }) },
    });
    expect(r.status).toBe(422);
    expect(await counts()).toEqual(before);
  });
});

describe('prévia (POST /api/preview)', () => {
  it('vídeo: MP4 reduzido (≤ 640 px), curto, reproduzível e começando no deslocamento pedido', async () => {
    const before = (await c.get('/api/jobs')).data.length;
    const r = await c.post('/api/preview', { assetId: A['long.mp4']!.id, settings: { mode: 'custom', color: { brightness: 10 } }, offset: 5 });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.url).toMatch(/^\/api\/previews\/[A-Za-z0-9_-]+\.mp4$/);
    expect(r.data.kind).toBe('video');
    const f = await c.download(r.data.url);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toMatch(/^video\/mp4/);
    const file = tmpFile(f.body, 'mp4');
    const { v, duration } = mainStreams(file);
    expect(v.codec_name).toBe('h264');
    expect(Math.max(v.width, v.height)).toBeLessThanOrEqual(640);
    expect([v.width, v.height]).toEqual([640, 360]);
    expect(duration).toBeLessThanOrEqual(8.1);
    expect(duration).toBeGreaterThan(7);
    expect(decodeErrors(file)).toEqual([]);
    // Primeiro quadro da prévia ≈ quadro de 5 s da fonte (com brilho +10, por isso a tolerância).
    const at5 = psnr(file, fx('long.mp4'), { ssB: 5, size: '640x360' });
    const at0 = psnr(file, fx('long.mp4'), { size: '640x360' });
    expect(at5).toBeGreaterThan(at0 + 3);
    // A prévia não cria tarefas.
    expect((await c.get('/api/jobs')).data.length).toBe(before);
  }, T);

  it('vídeo editorial: a prévia aplica a mesma composição (cartela) em tamanho reduzido', async () => {
    const r = await c.post('/api/preview', {
      assetId: A['plain.mp4']!.id,
      settings: { mode: 'editorial', geometry: { aspect: '9:16', resolution: '1080' }, editorial: { intro: { type: 'card', text: 'Oi', duration: 1 } } },
      offset: 0,
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const file = tmpFile((await c.download(r.data.url)).body, 'mp4');
    const { v, duration } = mainStreams(file);
    expect([v.width, v.height]).toEqual([360, 640]);
    expect(Math.abs(duration - 3)).toBeLessThan(0.2);
    expect(frameStats(file, 0.5).yavg).toBeLessThan(70); // cartela escura no início
  }, T);

  it('imagem: devolve JPG (orientação aplicada) e reproduzível', async () => {
    const r = await c.post('/api/preview', { assetId: A['photo.jpg']!.id, settings: { mode: 'custom', color: { brightness: 20 } }, offset: 0 });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.url).toMatch(/\.jpg$/);
    expect(r.data.kind).toBe('image');
    const f = await c.download(r.data.url);
    expect(f.headers.get('content-type')).toMatch(/^image\/jpeg/);
    expect([...f.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const file = tmpFile(f.body, 'jpg');
    const v = mainStreams(file).v;
    expect([v.width, v.height]).toEqual([300, 400]);
    expect(Math.max(v.width, v.height)).toBeLessThanOrEqual(960);
    expect(psnr(file, fx('photo.jpg'), { filterB: 'transpose=1,eq=brightness=0.06', rawA: true })).toBeGreaterThan(25);
  }, T);

  it('nome de prévia forjado é recusado (sem travessia de diretório)', async () => {
    expect((await c.download('/api/previews/..%2F..%2Fmediaforge.db')).status).toBe(400);
    expect((await c.download('/api/previews/naoexiste123.mp4')).status).toBe(404);
  });
});
