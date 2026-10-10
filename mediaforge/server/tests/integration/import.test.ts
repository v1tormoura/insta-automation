import fs from 'node:fs';
import path from 'node:path';
import type { AssetDetailDTO, AssetDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { listFiles, mainStreams, psnr, rotationOf, sessionArea, sessionId, sha256 } from '../helpers/inspecaoMidia';
import { ffprobe, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => srv?.close());

const fileSha = (p: string) => sha256(fs.readFileSync(p));

/** Confere que o arquivo armazenado é byte a byte o original enviado. */
function expectStored(dataDir: string, sid: string, a: AssetDTO, original: string) {
  const stored = path.join(sessionArea(dataDir, sid, 'uploads'), `${a.id}.${a.ext}`);
  expect(fs.existsSync(stored), `arquivo armazenado de ${a.name}`).toBe(true);
  expect(fileSha(stored)).toBe(fileSha(original));
}

async function thumbnailOf(c: Client, a: AssetDTO) {
  expect(a.thumbnailUrl).toBe(`/api/assets/${a.id}/thumbnail`);
  const r = await c.download(a.thumbnailUrl!);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toMatch(/^image\/jpeg/);
  expect([...r.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const p = ffprobe(tmpFile(r.body, 'jpg'));
  const s = p.streams[0];
  expect(s.codec_name).toBe('mjpeg');
  expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(360);
  return { width: s.width as number, height: s.height as number };
}

describe('importação múltipla num único envio', () => {
  const c = () => client;
  let client: Client;
  let sid: string;
  const order = ['plain.mp4', 'rotated.mp4', 'photo.jpg', 'graphic.png', 'image.webp', 'track.mp3', 'legendas.srt', 'iphone.mov'];
  const byName = new Map<string, AssetDTO>();

  beforeAll(async () => {
    client = new Client(srv.base);
    const { status, data } = await client.upload(order.map((n) => ({ path: fx(n) })));
    expect(status).toBe(200);
    expect(data.results).toHaveLength(order.length);
    data.results.forEach((r, i) => {
      expect(r.ok, `${order[i]}: ${r.error}`).toBe(true);
      byName.set(order[i]!, r.asset!);
    });
    sid = await sessionId(client);
  });

  it('classifica cada arquivo pelo conteúdo (vídeo, imagem, áudio, legenda)', () => {
    const kinds = Object.fromEntries(order.map((n) => [n, byName.get(n)!.kind]));
    expect(kinds).toEqual({
      'plain.mp4': 'video',
      'rotated.mp4': 'video',
      'photo.jpg': 'image',
      'graphic.png': 'image',
      'image.webp': 'image',
      'track.mp3': 'audio',
      'legendas.srt': 'subtitle',
      'iphone.mov': 'video',
    });
    for (const a of byName.values()) {
      expect(a.status).toBe('ready');
      expect(a.error).toBeNull();
      expect(a.fileUrl).toBe(`/api/assets/${a.id}/file`);
    }
    expect(byName.get('iphone.mov')!.ext).toBe('mov');
    expect(byName.get('iphone.mov')!.container).toBe('QuickTime MOV');
    expect(byName.get('legendas.srt')!.ext).toBe('srt');
    expect(byName.get('track.mp3')!.ext).toBe('mp3');
  });

  it('informa dados técnicos reais (dimensões de exibição, duração, fps, codecs, áudio)', async () => {
    const plain = byName.get('plain.mp4')!;
    expect([plain.width, plain.height]).toEqual([320, 240]);
    expect(plain.fps).toBe(30);
    expect(plain.durationSec!).toBeCloseTo(2, 1);
    expect(plain.videoCodec).toBe('h264');
    expect(plain.audioCodec).toBe('aac');
    expect(plain.hasAudio).toBe(true);

    // Matriz de rotação de 90°: dimensões de exibição invertidas.
    const rot = byName.get('rotated.mp4')!;
    expect([rot.width, rot.height]).toEqual([240, 320]);
    const rotDetail = (await c().get<AssetDetailDTO>(`/api/assets/${rot.id}`)).data;
    expect(Math.abs(rotDetail.info!.rotation)).toBe(90);
    expect(Math.abs(rotDetail.info!.rotation)).toBe(Math.abs(rotationOf(mainStreams(fx('rotated.mp4')).v)));

    // JPEG com orientação EXIF 6: info armazenada 400×300 + orientação registrada;
    // as dimensões de exibição do DTO seguem a mesma regra do vídeo girado (retrato).
    const photo = byName.get('photo.jpg')!;
    const photoDetail = (await c().get<AssetDetailDTO>(`/api/assets/${photo.id}`)).data;
    const pv = photoDetail.info!.streams.find((s) => s.index === photoDetail.info!.videoIndex)!;
    expect([pv.width, pv.height]).toEqual([400, 300]);
    expect(photoDetail.metadata!.orientation).toBe(6);
    expect([photo.width, photo.height]).toEqual([300, 400]);

    const iphone = byName.get('iphone.mov')!;
    expect([iphone.width, iphone.height]).toEqual([640, 360]);
    expect(iphone.fps).toBe(25);
    expect(iphone.durationSec!).toBeCloseTo(3, 1);
    expect(iphone.metadataSummary.sensitive).toBeGreaterThan(0);
    expect(iphone.metadataSummary.byCategory.gps ?? 0).toBeGreaterThan(0);
    expect(iphone.metadataSummary.byCategory.device ?? 0).toBeGreaterThan(0);

    const png = byName.get('graphic.png')!;
    expect([png.width, png.height]).toEqual([200, 100]);
    const webp = byName.get('image.webp')!;
    expect([webp.width, webp.height]).toEqual([300, 200]);

    const mp3 = byName.get('track.mp3')!;
    expect(mp3.durationSec!).toBeGreaterThan(3.8);
    expect(mp3.durationSec!).toBeLessThan(4.3);
    expect(mp3.hasAudio).toBe(true);
    expect(mp3.width).toBeNull();
    expect(mp3.thumbnailUrl).toBeNull();
    expect(byName.get('legendas.srt')!.thumbnailUrl).toBeNull();
  });

  it('SHA-256 e tamanho do asset correspondem ao arquivo original, e o armazenado é idêntico', async () => {
    for (const n of order) {
      const a = byName.get(n)!;
      expect(a.sha256, n).toBe(fileSha(fx(n)));
      expect(a.size, n).toBe(fs.statSync(fx(n)).size);
      expectStored(srv.dataDir, sid, a, fx(n));
      // O download do arquivo da sessão devolve exatamente os bytes enviados.
      const r = await c().download(a.fileUrl);
      expect(r.status).toBe(200);
      expect(sha256(r.body), n).toBe(a.sha256);
    }
    // Nenhum resto de upload na área temporária.
    const tmp = listFiles(sessionArea(srv.dataDir, sid, 'tmp'));
    expect(tmp.filter((f) => path.basename(f).startsWith('upload-'))).toEqual([]);
  });

  it('serve miniaturas JPEG reais (vídeo girado em retrato)', async () => {
    const plain = await thumbnailOf(c(), byName.get('plain.mp4')!);
    expect(plain.width / plain.height).toBeCloseTo(320 / 240, 1);
    // Vídeo com matriz de rotação: miniatura em retrato.
    const rot = await thumbnailOf(c(), byName.get('rotated.mp4')!);
    expect(rot.height).toBeGreaterThan(rot.width);
    const png = await thumbnailOf(c(), byName.get('graphic.png')!);
    expect(png.width / png.height).toBeCloseTo(2, 1);
    await thumbnailOf(c(), byName.get('image.webp')!);
    await thumbnailOf(c(), byName.get('iphone.mov')!);
    // Áudio e legenda não têm miniatura.
    const mp3 = byName.get('track.mp3')!;
    expect((await c().download(`/api/assets/${mp3.id}/thumbnail`)).status).toBe(404);
  });

  it('miniatura de JPEG com orientação EXIF 6 aparece na posição correta (retrato, girada 90° horária)', async () => {
    const photo = byName.get('photo.jpg')!;
    const r = await c().download(photo.thumbnailUrl!);
    const thumb = tmpFile(r.body, 'jpg');
    const dims = await thumbnailOf(c(), photo);
    // Referência independente: pixels armazenados (sem autorrotação) girados 90° no sentido horário.
    const ref = psnr(thumb, fx('photo.jpg'), { filterB: 'transpose=1', size: `${dims.width}x${dims.height}` });
    expect(dims.height, `miniatura ${dims.width}×${dims.height}`).toBeGreaterThan(dims.width);
    expect(ref).toBeGreaterThan(28);
  });

  it('lista os arquivos da sessão com os mesmos DTOs', async () => {
    const { status, data } = await c().get<AssetDTO[]>('/api/assets');
    expect(status).toBe(200);
    const ids = new Set(data.map((a) => a.id));
    for (const a of byName.values()) expect(ids.has(a.id)).toBe(true);
  });
});

describe('arquivos inválidos', () => {
  let c: Client;
  let sid: string;
  const names = ['fake.mp4', 'empty.mp4', 'program.mp4', 'corrupt.mp4'];
  let results: Array<{ name: string; ok: boolean; asset?: AssetDTO; error?: string }>;

  beforeAll(async () => {
    c = new Client(srv.base);
    const r = await c.upload(names.map((n) => ({ path: fx(n) })));
    expect(r.status).toBe(200);
    results = r.data.results;
    sid = await sessionId(c);
  });

  it('são registrados como "invalid" com mensagem explicativa', () => {
    expect(results).toHaveLength(names.length);
    for (const [i, r] of results.entries()) {
      expect(r.ok, names[i]).toBe(false);
      expect(r.asset, names[i]).toBeDefined();
      expect(r.asset!.status).toBe('invalid');
      expect(r.asset!.error, names[i]).toBeTruthy();
      expect(r.error).toBe(r.asset!.error);
      expect(r.asset!.thumbnailUrl).toBeNull();
      expect(r.asset!.duplicateOf).toEqual([]);
    }
    const err = Object.fromEntries(names.map((n, i) => [n, results[i]!.asset!.error!]));
    expect(err['empty.mp4']).toMatch(/vazio/i);
    expect(err['program.mp4']).toMatch(/execut/i);
    expect(err['fake.mp4']).toMatch(/não reconhecido|ilegível|corromp/i);
    expect(err['corrupt.mp4']).toMatch(/ilegível|corromp|decodific|nenhum fluxo/i);
    // SHA-256 registrado para os não vazios (permite auditoria).
    expect(results[0]!.asset!.sha256).toBe(fileSha(fx('fake.mp4')));
    expect(results[2]!.asset!.size).toBe(fs.statSync(fx('program.mp4')).size);
  });

  it('não deixam bytes em uploads/, miniaturas nem temporários', () => {
    const ids = results.map((r) => r.asset!.id);
    const all = listFiles(path.join(srv.dataDir, 'sessions', sid));
    for (const id of ids) expect(all.filter((f) => path.basename(f).includes(id)), id).toEqual([]);
    expect(listFiles(sessionArea(srv.dataDir, sid, 'uploads'))).toEqual([]);
    expect(listFiles(sessionArea(srv.dataDir, sid, 'tmp'))).toEqual([]);
  });

  it('não podem ser baixados nem processados', async () => {
    const bad = results[3]!.asset!;
    expect((await c.download(`/api/assets/${bad.id}/file`)).status).toBe(404);
    expect((await c.download(`/api/assets/${bad.id}/thumbnail`)).status).toBe(404);
    const before = (await c.get('/api/jobs')).data.length;
    const r = await c.post('/api/batches', { assetIds: [bad.id], scope: 'common', settings: { mode: 'quick' } });
    expect(r.status).toBe(422);
    expect((await c.get('/api/jobs')).data.length).toBe(before);
    const detail = (await c.get<AssetDetailDTO>(`/api/assets/${bad.id}`)).data;
    expect(detail.status).toBe('invalid');
    expect(detail.info).toBeNull();
  });
});

describe('nomes de arquivo maliciosos', () => {
  let c: Client;
  let sid: string;

  beforeAll(async () => {
    c = new Client(srv.base);
    sid = await sessionId(c);
  });

  it('"../../etc/passwd.mp4" não escapa do diretório e é saneado', async () => {
    const [a] = await c.importOk({ path: fx('plain.mp4'), name: '../../etc/passwd.mp4' });
    expect(a!.name).toBe('passwd.mp4');
    expect(a!.name).not.toMatch(/[\\/]|\.\./);
    expectStored(srv.dataDir, sid, a!, fx('plain.mp4'));
    // Nada com o nome enviado foi criado em lugar nenhum (dentro ou fora do DATA_DIR).
    expect(listFiles(srv.dataDir).filter((f) => /passwd/.test(f))).toEqual([]);
    expect(fs.existsSync(path.resolve(sessionArea(srv.dataDir, sid, 'uploads'), '../../etc/passwd.mp4'))).toBe(false);
    expect(fs.existsSync(path.resolve(sessionArea(srv.dataDir, sid, 'tmp'), '../../etc/passwd.mp4'))).toBe(false);
  });

  it('"a\\u202Egpj.exe" perde o caractere de inversão e é tratado pelo conteúdo (JPEG)', async () => {
    const [a] = await c.importOk({ path: fx('photo.jpg'), name: 'a‮gpj.exe' });
    expect(a!.name).not.toContain('‮');
    expect(a!.name).toBe('agpj.exe');
    expect(a!.kind).toBe('image');
    expect(a!.ext).toBe('jpg');
    expectStored(srv.dataDir, sid, a!, fx('photo.jpg'));
    const detail = (await c.get<AssetDetailDTO>(`/api/assets/${a!.id}`)).data;
    expect(detail.metadata!.warnings.join(' ')).toMatch(/extensão \.exe não corresponde/i);
    const r = await c.download(a!.fileUrl);
    const cd = r.headers.get('content-disposition') ?? '';
    expect(cd).not.toContain('‮');
    expect(decodeURIComponent(cd.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? '')).toBe('agpj.exe');
  });

  it('outros nomes hostis viram nomes seguros', async () => {
    const cases: Array<[string, (n: string) => void]> = [
      ['..\\..\\windows\\evil.mp4', (n) => expect(n).toBe('evil.mp4')],
      ['....', (n) => expect(n).toBe('arquivo')],
      ['CON.mp4', (n) => expect(n).not.toMatch(/^con(\.|$)/i)],
      ['.oculto.mp4', (n) => expect(n).toBe('oculto.mp4')],
      ['nome<com>:"barras|e?*.mp4', (n) => expect(n).not.toMatch(/[<>:"|?*\\/]/)],
      ['x'.repeat(300) + '.mp4', (n) => {
        expect(n.length).toBeLessThanOrEqual(180);
        expect(n.endsWith('.mp4')).toBe(true);
      }],
    ];
    const { status, data } = await c.upload(cases.map(([name]) => ({ path: fx('noaudio.mp4'), name })));
    expect(status).toBe(200);
    data.results.forEach((r, i) => {
      expect(r.ok, cases[i]![0]).toBe(true);
      cases[i]![1](r.asset!.name);
      expect(r.asset!.name).not.toMatch(/[\u0000-\u001f]/);
    });
    // Todos foram armazenados pelo id, dentro de uploads/.
    const stored = fs.readdirSync(sessionArea(srv.dataDir, sid, 'uploads'));
    for (const r of data.results) expect(stored).toContain(`${r.asset!.id}.mp4`);
    expect(listFiles(srv.dataDir).filter((f) => /evil|windows|oculto|barras/.test(f))).toEqual([]);
  });
});

describe('extensão errada e duplicatas', () => {
  it('PNG renomeado para .jpg é aceito pelo conteúdo, com aviso', async () => {
    const c = new Client(srv.base);
    const sid = await sessionId(c);
    const [a] = await c.importOk({ path: fx('graphic.png'), name: 'grafico.jpg' });
    expect(a!.kind).toBe('image');
    expect(a!.ext).toBe('png');
    expect(a!.container).toBe('PNG');
    expect(a!.name).toBe('grafico.jpg');
    expectStored(srv.dataDir, sid, a!, fx('graphic.png'));
    const detail = (await c.get<AssetDetailDTO>(`/api/assets/${a!.id}`)).data;
    expect(detail.metadata!.warnings.some((w) => /extensão \.jpg não corresponde.*PNG/i.test(w))).toBe(true);
    // Extensões equivalentes não geram aviso.
    const [b] = await c.importOk({ path: fx('photo.jpg'), name: 'foto.JPEG' });
    const bd = (await c.get<AssetDetailDTO>(`/api/assets/${b!.id}`)).data;
    expect(bd.metadata!.warnings.filter((w) => /extensão/i.test(w))).toEqual([]);
    // MOV enviado como .mp4: aceito como MOV, com aviso.
    const [m] = await c.importOk({ path: fx('iphone.mov'), name: 'video.mp4' });
    expect(m!.ext).toBe('mov');
    const md = (await c.get<AssetDetailDTO>(`/api/assets/${m!.id}`)).data;
    expect(md.metadata!.warnings.some((w) => /extensão \.mp4 não corresponde/i.test(w))).toBe(true);
  });

  it('o mesmo arquivo duas vezes → duplicateOf aponta a cópia (só dentro da sessão)', async () => {
    const c = new Client(srv.base);
    const [a, b, other] = await c.importOk(fx('plain.mp4'), { path: fx('plain.mp4'), name: 'copia.mp4' }, fx('noaudio.mp4'));
    expect(a!.id).not.toBe(b!.id);
    expect(b!.sha256).toBe(a!.sha256);
    expect(b!.duplicateOf).toEqual([a!.id]);
    // Consultado depois, o primeiro também aponta o segundo.
    const first = (await c.get<AssetDTO>(`/api/assets/${a!.id}`)).data;
    expect(first.duplicateOf).toEqual([b!.id]);
    expect(other!.duplicateOf).toEqual([]);
    const list = (await c.get<AssetDTO[]>('/api/assets')).data;
    expect(list.find((x) => x.id === b!.id)!.duplicateOf).toEqual([a!.id]);
    const hist = (await c.get<Array<{ message: string; level: string }>>('/api/history')).data;
    expect(hist.some((h) => /idêntico \(SHA-256\)/.test(h.message) && h.level === 'warning')).toBe(true);

    // Outra sessão importando o mesmo arquivo não vê a cópia da primeira.
    const c2 = new Client(srv.base);
    const [x] = await c2.importOk(fx('plain.mp4'));
    expect(x!.duplicateOf).toEqual([]);
    // E a primeira sessão não passa a ver o arquivo da segunda.
    expect((await c.get<AssetDTO>(`/api/assets/${a!.id}`)).data.duplicateOf).toEqual([b!.id]);
    expect((await c.get(`/api/assets/${x!.id}`)).status).toBe(404);
  });
});

describe('limites configuráveis', () => {
  let lim: TestServer;
  beforeAll(async () => {
    lim = await startServer({ MAX_UPLOAD_MB: 1, MAX_DURATION_SEC: 1, MAX_RESOLUTION: 380 });
  });
  afterAll(async () => lim?.close());

  it('recusa arquivo acima do tamanho, duração ou resolução máximos — sem afetar os demais do envio', async () => {
    const c = new Client(lim.base);
    const names = ['long.mp4', 'plain.mp4', 'track.mp3', 'photo.jpg', 'graphic.png'];
    const { status, data } = await c.upload(names.map((n) => ({ path: fx(n) })));
    expect(status).toBe(200);
    expect(data.results).toHaveLength(names.length);
    const r = Object.fromEntries(names.map((n, i) => [n, data.results[i]!]));

    expect(r['long.mp4']!.ok).toBe(false);
    expect(r['long.mp4']!.asset!.status).toBe('invalid');
    expect(r['long.mp4']!.error).toMatch(/1 MB/);

    expect(r['plain.mp4']!.ok).toBe(false);
    expect(r['plain.mp4']!.error).toMatch(/Duração de 2 s excede o limite de 1 s/);
    expect(r['track.mp3']!.ok).toBe(false);
    expect(r['track.mp3']!.error).toMatch(/Duração de 4 s excede/);

    expect(r['photo.jpg']!.ok).toBe(false);
    expect(r['photo.jpg']!.error).toMatch(/Resolução (400×300|300×400) excede o limite de 380/);

    // Imagem pequena, sem duração, passa — mesmo depois de um arquivo truncado no mesmo envio.
    expect(r['graphic.png']!.ok, r['graphic.png']!.error).toBe(true);
    expect(r['graphic.png']!.asset!.sha256).toBe(fileSha(fx('graphic.png')));

    const sid = await sessionId(c);
    const stored = fs.readdirSync(sessionArea(lim.dataDir, sid, 'uploads'));
    expect(stored).toEqual([`${r['graphic.png']!.asset!.id}.png`]);
    expect(listFiles(sessionArea(lim.dataDir, sid, 'tmp'))).toEqual([]);
  });

  it('o limite de tamanho vale isoladamente para cada arquivo (arquivo pequeno depois do grande é aceito)', async () => {
    const c = new Client(lim.base);
    const { data } = await c.upload([{ path: fx('long.mp4') }, { path: fx('logo.png') }]);
    expect(data.results.map((x) => x.ok)).toEqual([false, true]);
    expect(data.results[1]!.asset!.sha256).toBe(fileSha(fx('logo.png')));
  });

  it('/api/system expõe os limites efetivos', async () => {
    const c = new Client(lim.base);
    const { data } = await c.get('/api/system');
    expect(data.limits.maxUploadMb).toBe(1);
    expect(data.limits.maxDurationSec).toBe(1);
    expect(data.limits.maxResolution).toBe(380);
  });
});

describe('limite de arquivos por envio', () => {
  let lim: TestServer;
  beforeAll(async () => {
    lim = await startServer({ MAX_FILES_PER_UPLOAD: 2 });
  });
  afterAll(async () => lim?.close());

  it('um envio com mais arquivos que o permitido é recusado com 413 e não deixa temporários', async () => {
    const c = new Client(lim.base);
    const sid = await sessionId(c);
    const r = await c.upload([{ path: fx('logo.png') }, { path: fx('graphic.png') }, { path: fx('image.webp') }]);
    expect(r.status).toBe(413);
    expect((r.data as any).error?.code).toBe('too-many-files');
    expect(listFiles(sessionArea(lim.dataDir, sid, 'tmp'))).toEqual([]);
    // O terceiro arquivo nunca é importado.
    const list = (await c.get<AssetDTO[]>('/api/assets')).data;
    expect(list.some((a) => a.sha256 === fileSha(fx('image.webp')))).toBe(false);
  });
});
