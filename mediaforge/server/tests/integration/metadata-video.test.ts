import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetDetailDTO, AssetDTO, MetadataItem } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { fx, SENSITIVE } from '../helpers/fixtures';
import { decodeErrors, ff, mainStreams, mp4BoxPaths, packetHashes, pixelMd5, psnr, rotationOf, sha256 } from '../helpers/inspecaoMidia';
import { frameMd5, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

const ALL = { gps: true, dates: true, device: true, descriptive: true, software: true, custom: true, container: true, streams: true, embedded: true };
const NONE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };

let srv: TestServer;
let c: Client;
let iphone: AssetDTO;
let iphoneItems: MetadataItem[];
let rotated: AssetDTO;

beforeAll(async () => {
  srv = await startServer();
  c = new Client(srv.base);
  [iphone, rotated] = (await c.importOk(fx('iphone.mov'), fx('rotated.mp4'))) as [AssetDTO, AssetDTO];
  iphoneItems = (await c.get<AssetDetailDTO>(`/api/assets/${iphone.id}`)).data.metadata!.items;
});
afterAll(async () => srv?.close());

/** Baixa a saída conferindo o SHA-256 anunciado e devolve bytes + caminho temporário. */
async function output(job: JobDetail, ext: string) {
  const r = await c.download(job.output!.downloadUrl);
  expect(r.status).toBe(200);
  const hash = sha256(r.body);
  expect(r.headers.get('x-content-sha256')).toBe(hash);
  expect(job.output!.sha256).toBe(hash);
  expect(job.report!.integrity.outputSha256).toBe(hash);
  expect(job.report!.integrity.inputUnchangedAfterProcessing).toBe(true);
  return { body: r.body, file: tmpFile(r.body, ext) };
}

const tagsOf = (o: any) => ({ ...(o?.tags ?? {}) }) as Record<string, string>;

describe('iphone.mov, modo rápido, todas as categorias + SEI', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(iphone.id, { mode: 'quick', metadata: { remove: ALL } });
    out = await output(job, 'mov');
  });

  it('usa cópia de fluxos (sem recodificar) e mantém o contêiner MOV', () => {
    expect(job.report!.strategy).toBe('stream-copy');
    expect(job.validationStatus).toBe('passed');
    expect(job.report!.command).toContain('copy');
    const { format, v, a } = mainStreams(out.file);
    expect(format.format_name).toMatch(/mov/);
    expect(tagsOf(format).major_brand).toBe('qt  ');
    expect(v.codec_name).toBe('h264');
    expect(a.codec_name).toBe('aac');
  });

  it('ffprobe independente não encontra GPS, aparelho, datas, software nem comentário', () => {
    const { format, v, a } = mainStreams(out.file);
    const ft = tagsOf(format);
    const forbidden = /location|iso6709|make|model|software|creation_time|comment|encoder|com\.apple|date/i;
    expect(Object.keys(ft).filter((k) => forbidden.test(k))).toEqual([]);
    expect(Object.keys(ft).sort()).toEqual(['compatible_brands', 'major_brand', 'minor_version']);
    for (const [k, val] of Object.entries({ ...tagsOf(v), ...tagsOf(a) })) {
      expect(k, `tag de fluxo ${k}=${val}`).not.toMatch(/creation_time|encoder|date/i);
    }
    expect(tagsOf(v).handler_name ?? '').not.toBe('Core Media Video');
    expect(tagsOf(a).language ?? 'und').toBe('und');
  });

  it('a caixa loci e as chaves mdta da Apple não existem mais na estrutura do arquivo', () => {
    const before = mp4BoxPaths(fs.readFileSync(fx('iphone.mov')));
    expect(before.some((p) => p.endsWith('/loci'))).toBe(true); // a fixture tinha
    const after = mp4BoxPaths(out.body);
    expect(after.filter((p) => /\/(loci|keys|ilst|©xyz|\xA9xyz|meta)$/.test(p))).toEqual([]);
    expect(after.filter((p) => p.includes('udta'))).toEqual([]);
  });

  it('nenhuma string sensível sobra nos bytes (inclusive a SEI "x264 - core")', () => {
    const src = fs.readFileSync(fx('iphone.mov'));
    const needles = [SENSITIVE.videoModel, SENSITIVE.videoComment, '+37.7749', 'com.apple.quicktime', '17.1.2', 'Core Media Video', 'x264 - core', 'Lavf60'];
    for (const n of needles) {
      expect(src.includes(n), `fixture deveria conter ${n}`).toBe(true);
      expect(out.body.includes(n), `saída ainda contém "${n}"`).toBe(false);
    }
  });

  it('assinatura de encoder no bitstream de áudio ("Lavc…" no AAC) não fica escondida atrás de um veredito "comprovado"', () => {
    // O AAC do FFmpeg grava "Lavc<versão>" num elemento de preenchimento do 1º quadro (como a SEI do x264 no vídeo).
    const src = fs.readFileSync(fx('iphone.mov'));
    expect(src.includes('Lavc60')).toBe(true);
    const stillThere = out.body.includes('Lavc60');
    const r = job.report!;
    const reported =
      r.metadata.verdict !== 'comprovado' ||
      [...r.warnings, ...r.metadata.notes, ...r.metadata.unverified.map((u) => `${u.key} ${u.value}`)].some((t) => /Lavc|áudio.*encoder|encoder.*áudio/i.test(t));
    expect(!stillThere || reported, 'a saída ainda contém "Lavc60…" no fluxo de áudio copiado, e o relatório diz "comprovado" sem mencioná-lo').toBe(true);
  });

  it('o vídeo não foi recodificado: quadros decodificados idênticos, pacotes iguais exceto a SEI removida', () => {
    const { v: vi, a: ai, duration: di } = mainStreams(fx('iphone.mov'));
    const { v: vo, a: ao, duration: dout } = mainStreams(out.file);
    expect([vo.width, vo.height]).toEqual([vi.width, vi.height]);
    expect(vo.nb_frames).toBe(vi.nb_frames);
    expect(vo.r_frame_rate).toBe(vi.r_frame_rate);
    expect(Math.abs(dout - di)).toBeLessThan(0.05);
    expect(ao.sample_rate).toBe(ai.sample_rate);
    expect(frameMd5(out.file)).toBe(frameMd5(fx('iphone.mov')));

    const pin = packetHashes(fx('iphone.mov'), 'v');
    const pout = packetHashes(out.file, 'v');
    expect(pout).toHaveLength(pin.length);
    const diff = pin.filter((h, i) => h !== pout[i]).length;
    expect(diff).toBeLessThanOrEqual(1); // só o primeiro quadro-chave (onde estava a SEI)
    expect(packetHashes(out.file, 'a')).toEqual(packetHashes(fx('iphone.mov'), 'a'));
    expect(decodeErrors(out.file)).toEqual([]);
  });

  it('relatório: veredito "comprovado" e listas removed/preserved coerentes', () => {
    const m = job.report!.metadata;
    expect(m.verdict).toBe('comprovado');
    expect(m.unverified).toEqual([]);
    const removedIds = new Set(m.removed.map((i) => i.id));
    const preservedIds = new Set(m.preserved.map((i) => i.id));
    for (const id of removedIds) expect(preservedIds.has(id), id).toBe(false);
    // Tudo o que não é técnico na entrada foi removido a pedido.
    for (const item of iphoneItems.filter((i) => i.category !== 'technical')) {
      expect(removedIds.has(item.id), `${item.id} deveria estar em removed`).toBe(true);
    }
    for (const r of m.removed.filter((i) => i.category !== 'technical')) expect(r.requested, r.id).toBe(true);
    // Só campos técnicos ficam.
    expect(m.preserved.filter((p) => p.category !== 'technical')).toEqual([]);
    for (const id of ['fmt:location', 'fmt:com.apple.quicktime.location.iso6709', 'fmt:com.apple.quicktime.model', 'fmt:comment', 'fmt:creation_time', 'box:moov/udta/loci', 'sei:x264']) {
      expect(removedIds.has(id), id).toBe(true);
    }
    expect(job.report!.operations.some((o) => o.id === 'sei')).toBe(true);
  });

  it('o relatório exportado mascara os valores sensíveis; ?raw=1 os mostra', async () => {
    const masked = await c.download(job.output!.reportUrl);
    expect(masked.status).toBe(200);
    const text = masked.body.toString('utf8');
    expect(text).not.toContain(SENSITIVE.videoModel);
    expect(text).not.toContain('+37.7749');
    expect(text).not.toContain(SENSITIVE.videoComment);
    const raw = (await c.download(`${job.output!.reportUrl}?raw=1`)).body.toString('utf8');
    expect(raw).toContain(SENSITIVE.videoModel);
  });
});

describe('iphone.mov, remoção seletiva (só GPS)', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(iphone.id, { mode: 'quick', metadata: { remove: { ...NONE, gps: true } } });
    out = await output(job, 'mov');
  });

  it('remove GPS (tags, ISO6709 e loci) e preserva modelo, comentário e datas', () => {
    const { format } = mainStreams(out.file);
    const ft = tagsOf(format);
    expect(Object.keys(ft).filter((k) => /location|iso6709/i.test(k))).toEqual([]);
    expect(out.body.includes('+37.7749')).toBe(false);
    expect(mp4BoxPaths(out.body).some((p) => p.endsWith('/loci'))).toBe(false);

    expect(ft['com.apple.quicktime.model']).toBe(SENSITIVE.videoModel);
    expect(ft['com.apple.quicktime.make']).toBe('Apple');
    expect(ft.comment).toBe(SENSITIVE.videoComment);
    expect(ft.creation_time).toMatch(/^2024-05-01T10:00:00/);
    // SEI não foi pedida: continua no bitstream.
    expect(out.body.includes('x264 - core')).toBe(true);
    expect(job.report!.strategy).toBe('stream-copy');
  });

  it('o relatório marca os campos mantidos como preservados e o GPS como removido a pedido', () => {
    const m = job.report!.metadata;
    expect(m.verdict).toBe('comprovado');
    const pres = new Map(m.preserved.map((p) => [p.id, p]));
    for (const id of ['fmt:com.apple.quicktime.model', 'fmt:com.apple.quicktime.make', 'fmt:comment', 'fmt:creation_time', 'sei:x264']) {
      expect(pres.has(id), id).toBe(true);
      expect(pres.get(id)!.reason).toMatch(/Mantido por escolha/);
    }
    const rem = new Map(m.removed.map((r) => [r.id, r]));
    for (const id of ['fmt:location', 'fmt:com.apple.quicktime.location.iso6709', 'box:moov/udta/loci']) {
      expect(rem.get(id)?.requested, id).toBe(true);
    }
    // Nada de categoria não pedida foi contado como removido "a pedido".
    for (const r of m.removed) if (r.requested) expect(r.category).toBe('gps');
  });
});

describe('iphone.mov, nenhuma categoria selecionada', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(iphone.id, { mode: 'quick', metadata: { remove: NONE } });
    out = await output(job, 'mov');
  });

  it('veredito "nao-solicitado" e os metadados continuam no arquivo', () => {
    expect(job.report!.metadata.verdict).toBe('nao-solicitado');
    const ft = tagsOf(mainStreams(out.file).format);
    expect(ft['com.apple.quicktime.model']).toBe(SENSITIVE.videoModel);
    expect(ft['com.apple.quicktime.location.ISO6709']).toBe(SENSITIVE.videoIso6709);
    expect(ft.comment).toBe(SENSITIVE.videoComment);
    expect(ft.creation_time).toMatch(/^2024-05-01/);
    expect(out.body.includes('x264 - core')).toBe(true);
    expect(job.report!.metadata.unverified).toEqual([]);
    expect(job.report!.operations.find((o) => o.id === 'metadata')!.detail).toMatch(/Nenhuma categoria/);
  });

  it('nenhum campo de localização é descartado quando nada foi pedido (caixa loci preservada)', () => {
    const unrequested = job.report!.metadata.removed.filter((r) => !r.requested && r.category !== 'technical' && r.category !== 'software');
    expect(unrequested.map((r) => `${r.id} (${r.category})`)).toEqual([]);
    expect(mp4BoxPaths(out.body).some((p) => p.endsWith('/loci'))).toBe(true);
  });
});

describe('vídeo recodificado com limpeza total', () => {
  it('saída redimensionada continua sem metadados nem SEI (inclusive a do novo encoder)', async () => {
    const [job] = await c.processOk(iphone.id, {
      mode: 'custom',
      geometry: { resolution: 'custom', width: 320, height: 180, keepAspect: true },
      video: { speed: 'fast' },
      metadata: { remove: ALL },
    });
    const out = await output(job!, 'mov');
    expect(job!.report!.strategy).toBe('re-encode');
    const { v, format } = mainStreams(out.file);
    expect([v.width, v.height]).toEqual([320, 180]);
    // (o áudio AAC é copiado: a assinatura "Lavc" dele é tratada no teste específico acima)
    expect(job!.report!.command).toContain('libx264');
    for (const n of [SENSITIVE.videoModel, SENSITIVE.videoComment, '+37.7749', 'com.apple.quicktime', 'x264 - core', 'Lavf']) {
      expect(out.body.includes(n), `saída contém "${n}"`).toBe(false);
    }
    expect(Object.keys(tagsOf(format)).sort()).toEqual(['compatible_brands', 'major_brand', 'minor_version']);
    expect(job!.report!.metadata.verdict).toBe('comprovado');
  });
});

describe('rotação (matriz de exibição)', () => {
  it('cópia de fluxo mantém a matriz de rotação e os pixels', async () => {
    const [job] = await c.processOk(rotated.id, { mode: 'quick' });
    const out = await output(job!, 'mp4');
    expect(job!.report!.strategy).toBe('stream-copy');
    const vin = mainStreams(fx('rotated.mp4')).v;
    const v = mainStreams(out.file).v;
    expect([v.width, v.height]).toEqual([320, 240]); // armazenado
    expect(rotationOf(v)).toBe(rotationOf(vin));
    expect(Math.abs(rotationOf(v))).toBe(90);
    expect(pixelMd5(out.file, 'yuv420p')).toBe(pixelMd5(fx('rotated.mp4'), 'yuv420p'));
    expect(job!.output!.width).toBe(320);
    expect(job!.output!.height).toBe(240);
  });

  it('recodificado fica 240×320 sem matriz, com a imagem na posição de exibição', async () => {
    const [job] = await c.processOk(rotated.id, { mode: 'custom', video: { codec: 'h264', speed: 'fast' } });
    const out = await output(job!, 'mp4');
    expect(job!.report!.strategy).toBe('re-encode');
    const v = mainStreams(out.file).v;
    expect([v.width, v.height]).toEqual([240, 320]);
    expect(rotationOf(v)).toBe(0);
    // Mesmo conteúdo que a fonte exibida (FFmpeg aplicando a rotação na referência).
    expect(psnr(out.file, fx('rotated.mp4'), { ssA: 0.5, ssB: 0.5 })).toBeGreaterThan(30);
    expect(decodeErrors(out.file)).toEqual([]);
  });

  it('preserveOrientation=false em vídeo não é ignorado em silêncio', async () => {
    const [job] = await c.processOk(rotated.id, { mode: 'quick', metadata: { preserveOrientation: false } });
    const out = await output(job!, 'mp4');
    const v = mainStreams(out.file).v;
    const r = job!.report!;
    const mentioned = [...r.warnings, ...r.skipped.map((s) => `${s.label} ${s.reason}`), ...r.operations.map((o) => o.detail)].some((t) =>
      /orienta|rota/i.test(t),
    );
    // Ou a matriz sai, ou o relatório explica por que ela ficou.
    expect(rotationOf(v) === 0 || mentioned, `rotação ${rotationOf(v)} mantida sem aviso`).toBe(true);
  });
});

describe('outros contêineres e estruturas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-meta-video-'));
  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    const r = ff(['-v', 'error', '-y', ...args, out]);
    if (r.code !== 0) throw new Error(r.stderr);
    return out;
  };
  let mkv: string;
  let chapters: string;
  let android: string;
  const A: Record<string, AssetDTO> = {};

  beforeAll(async () => {
    mkv = make('tags.mkv', [
      '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
      '-metadata', 'title=Filme confidencial', '-metadata', 'ARTIST=Fulano Secreto', '-metadata', 'DATE_RECORDED=2023-01-01',
      '-metadata:s:v:0', 'title=Faixa da camera X', '-metadata:s:a:0', 'language=por',
    ]);
    const meta = path.join(dir, 'chapters.txt');
    fs.writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Capitulo secreto um\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Capitulo secreto dois\n');
    chapters = make('chapters.mp4', ['-i', fx('plain.mp4'), '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy']);
    android = make('android.mp4', ['-i', fx('plain.mp4'), '-c', 'copy', '-metadata', 'location=+48.8584+002.2945/', '-metadata', 'title=Torre secreta']);
    const assets = await c.importOk(mkv, chapters, android);
    [A.mkv, A.chapters, A.android] = assets as [AssetDTO, AssetDTO, AssetDTO];
  });

  const chaptersOf = (file: string) =>
    JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file], { encoding: 'utf8' })).chapters as any[];

  it('MKV: tags de título, artista, data e encoder removidas (cópia), veredito comprovado', async () => {
    const [job] = await c.processOk(A.mkv!.id, { mode: 'quick', metadata: { remove: ALL } });
    const out = await output(job!, 'mkv');
    expect(job!.report!.strategy).toBe('stream-copy');
    const { format, v, a } = mainStreams(out.file);
    expect(format.format_name).toMatch(/matroska/);
    const keys = [...Object.keys(tagsOf(format)), ...Object.keys(tagsOf(v)), ...Object.keys(tagsOf(a))];
    expect(keys.filter((k) => /title|artist|date|encoder/i.test(k))).toEqual([]);
    for (const n of ['Filme confidencial', 'Fulano Secreto', '2023-01-01', 'Faixa da camera X', 'Lavf60', 'Lavc60.31.102 libx264']) {
      expect(fs.readFileSync(mkv).includes(n), `fixture contém ${n}`).toBe(true);
      expect(out.body.includes(n), `saída contém "${n}"`).toBe(false);
    }
    expect(tagsOf(a).language ?? 'und').not.toBe('por');
    // Tags técnicas que o muxer Matroska sempre regrava (DURATION) não podem derrubar o veredito.
    const m = job!.report!.metadata;
    expect(m.unverified.map((u) => `${u.id}: ${u.reason}`)).toEqual([]);
    expect(m.verdict).toBe('comprovado');
  });

  it('MP4 com capítulos: removidos com "Tags do contêiner"; mantidos quando nada é pedido', async () => {
    expect(chaptersOf(chapters)).toHaveLength(2);
    const [rm] = await c.processOk(A.chapters!.id, { mode: 'quick', metadata: { remove: ALL } });
    const outRm = await output(rm!, 'mp4');
    expect(chaptersOf(outRm.file)).toEqual([]);
    expect(outRm.body.includes('Capitulo secreto')).toBe(false);
    expect(rm!.report!.metadata.verdict).toBe('comprovado');

    const [keep] = await c.processOk(A.chapters!.id, { mode: 'quick', metadata: { remove: NONE } });
    const outKeep = await output(keep!, 'mp4');
    const ch = chaptersOf(outKeep.file);
    expect(ch.map((x: any) => x.tags?.title)).toEqual(['Capitulo secreto um', 'Capitulo secreto dois']);
  });

  it('MP4 estilo Android: título (©nam) e localização binária (loci) removidos', async () => {
    expect(mp4BoxPaths(fs.readFileSync(android)).some((p) => p.endsWith('/loci'))).toBe(true);
    const [job] = await c.processOk(A.android!.id, { mode: 'quick', metadata: { remove: ALL } });
    const out = await output(job!, 'mp4');
    const paths = mp4BoxPaths(out.body);
    expect(paths.filter((p) => /loci|ilst|©nam|\xA9nam/.test(p))).toEqual([]);
    expect(out.body.includes('Torre secreta')).toBe(false);
    expect(Object.keys(tagsOf(mainStreams(out.file).format)).filter((k) => /location|title/.test(k))).toEqual([]);
    expect(job!.report!.metadata.verdict).toBe('comprovado');
    expect(frameMd5(out.file)).toBe(frameMd5(android));
  });
});
