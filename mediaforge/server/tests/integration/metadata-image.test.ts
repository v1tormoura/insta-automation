import fs from 'node:fs';
import type { AssetDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { fx, SENSITIVE } from '../helpers/fixtures';
import {
  buildExtendedWebp,
  buildSimpleTiff,
  decodeErrors,
  jpegComments,
  jpegExif,
  jpegHasXmp,
  mainStreams,
  parseJpegLayout,
  parseTiffTags,
  pixelMd5,
  pngChunks,
  sha256,
  webpChunks,
} from '../helpers/inspecaoMidia';
import { tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

const NONE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };
const ONLY_GPS = { ...NONE, gps: true };

const JPEG_SECRETS = [
  SENSITIVE.jpegMake,
  SENSITIVE.jpegModel,
  SENSITIVE.jpegSoftware,
  SENSITIVE.jpegDate,
  SENSITIVE.jpegArtist,
  SENSITIVE.jpegLens,
  SENSITIVE.jpegSerial,
  SENSITIVE.jpegComment,
  SENSITIVE.jpegXmpTool,
  SENSITIVE.jpegXmpCity,
  SENSITIVE.jpegTrailer,
  'MAKERNOTE-PRIVADO',
  'Casa da praia',
];
const PNG_SECRETS = [SENSITIVE.pngSoftware, SENSITIVE.pngComment, SENSITIVE.pngModel, 'Maria Souza', 'Google', '2024-01-02 03:04:05'];

let srv: TestServer;
let c: Client;
let photo: AssetDTO;
let graphic: AssetDTO;
let webp: AssetDTO;

beforeAll(async () => {
  srv = await startServer();
  c = new Client(srv.base);
  [photo, graphic, webp] = (await c.importOk(fx('photo.jpg'), fx('graphic.png'), fx('image.webp'))) as [AssetDTO, AssetDTO, AssetDTO];
});
afterAll(async () => srv?.close());

async function output(job: JobDetail, ext: string) {
  const r = await c.download(job.output!.downloadUrl);
  expect(r.status).toBe(200);
  expect(sha256(r.body)).toBe(job.output!.sha256);
  expect(r.headers.get('x-content-sha256')).toBe(job.output!.sha256);
  return { body: r.body, file: tmpFile(r.body, ext) };
}

describe('photo.jpg, modo rápido (limpeza total, mesmo formato)', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(photo.id, { mode: 'quick' });
    out = await output(job, 'jpg');
  });

  it('é limpeza sem perdas: mesmos pixels e mesmos dados comprimidos', () => {
    expect(job.report!.strategy).toBe('image-lossless');
    expect(job.report!.command.join(' ')).toMatch(/sem FFmpeg/);
    expect(pixelMd5(out.file)).toBe(pixelMd5(fx('photo.jpg')));
    const lin = parseJpegLayout(fs.readFileSync(fx('photo.jpg')));
    const lout = parseJpegLayout(out.body);
    expect(lout.entropy.equals(lin.entropy)).toBe(true);
    // Tabelas e cabeçalhos de quadro/varredura (DQT, DHT, SOF, SOS) idênticos.
    const imageSegs = (l: typeof lin) => l.segments.filter((s) => [0xdb, 0xc4, 0xc0, 0xc2, 0xda, 0xdd].includes(s.marker)).map((s) => s.payload.toString('hex'));
    expect(imageSegs(lout)).toEqual(imageSegs(lin));
    expect([job.output!.width, job.output!.height]).toEqual([400, 300]);
    expect(decodeErrors(out.file)).toEqual([]);
  });

  it('EXIF reduzido à orientação (6); sem XMP, sem COM e sem bytes após o EOI', () => {
    const l = parseJpegLayout(out.body);
    const exif = jpegExif(l);
    expect(exif).not.toBeNull();
    const t = parseTiffTags(exif!);
    expect([...t.ifd0.keys()]).toEqual([0x0112]);
    expect(t.ifd0.get(0x0112)!.value).toBe(6);
    expect(t.exif.size).toBe(0);
    expect(t.gps.size).toBe(0);
    expect(jpegHasXmp(l)).toBe(false);
    expect(jpegComments(l)).toEqual([]);
    expect(l.trailing.length).toBe(0);
    // Só JFIF/EXIF entre os APPn.
    const apps = l.segments.filter((s) => s.marker >= 0xe0 && s.marker <= 0xef).map((s) => s.marker.toString(16));
    expect(apps.every((m) => m === 'e0' || m === 'e1')).toBe(true);
    // Sem o segmento EXIF, o arquivo é exatamente a imagem-base (antes da injeção de metadados).
    const base = parseJpegLayout(fs.readFileSync(fx('base.jpg')));
    expect(l.segments.filter((s) => s.marker !== 0xe1).map((s) => s.payload.toString('hex'))).toEqual(base.segments.map((s) => s.payload.toString('hex')));
  });

  it('nenhum valor sensível sobra nos bytes', () => {
    const src = fs.readFileSync(fx('photo.jpg'));
    for (const s of JPEG_SECRETS) {
      expect(src.includes(s), `fixture deveria conter ${s}`).toBe(true);
      expect(out.body.includes(s), `saída contém "${s}"`).toBe(false);
    }
  });

  it('relatório: comprovado, orientação preservada como campo técnico, removidos a pedido', () => {
    const m = job.report!.metadata;
    expect(m.verdict).toBe('comprovado');
    expect(m.unverified).toEqual([]);
    expect(m.preserved.map((p) => p.id)).toEqual(['exif:ifd0:274']);
    const removed = new Map(m.removed.map((r) => [r.id, r]));
    for (const id of ['exif:ifd0:271', 'exif:ifd0:272', 'exif:gps:2', 'exif:exif:37500', 'exif:exif:42033', 'xmp0:photoshop:City', 'jpeg:comment:0', 'trailing']) {
      expect(removed.get(id)?.requested, id).toBe(true);
    }
  });
});

describe('photo.jpg, remoção seletiva (só GPS)', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(photo.id, { mode: 'quick', metadata: { remove: ONLY_GPS } });
    out = await output(job, 'jpg');
  });

  it('remove o GPS e mantém fabricante, modelo, datas, comentário e dados extras', () => {
    const l = parseJpegLayout(out.body);
    const t = parseTiffTags(jpegExif(l)!);
    expect(t.gps.size).toBe(0);
    expect(t.ifd0.has(0x8825)).toBe(false);
    expect(t.ifd0.get(0x010f)?.value).toBe(SENSITIVE.jpegMake);
    expect(t.ifd0.get(0x0110)?.value).toBe(SENSITIVE.jpegModel);
    expect(t.ifd0.get(0x0132)?.value).toBe(SENSITIVE.jpegDate);
    expect(t.ifd0.get(0x0112)?.value).toBe(6);
    expect(t.exif.get(0xa431)?.value).toBe(SENSITIVE.jpegSerial);
    expect(jpegComments(l)).toEqual([SENSITIVE.jpegComment]);
    expect(l.trailing.toString('latin1')).toBe(SENSITIVE.jpegTrailer);
    // A cidade do XMP é localização: não pode sobrar.
    expect(out.body.includes(SENSITIVE.jpegXmpCity)).toBe(false);
    expect(pixelMd5(out.file)).toBe(pixelMd5(fx('photo.jpg')));
  });

  it('o relatório marca Make/Model como preservados e o GPS como removido a pedido', () => {
    const m = job.report!.metadata;
    expect(m.verdict).toBe('comprovado');
    const pres = new Set(m.preserved.map((p) => p.id));
    for (const id of ['exif:ifd0:271', 'exif:ifd0:272', 'exif:ifd0:306', 'jpeg:comment:0', 'trailing']) expect(pres.has(id), id).toBe(true);
    for (const r of m.removed) if (r.requested) expect(r.category, r.id).toBe('gps');
    const removedIds = new Set(m.removed.map((r) => r.id));
    for (const id of ['exif:gps:1', 'exif:gps:2', 'exif:gps:4', 'xmp0:photoshop:City']) expect(removedIds.has(id), id).toBe(true);
  });
});

describe('photo.jpg, orientação removida a pedido', () => {
  it('sem preservar orientação, o EXIF some e o relatório avisa', async () => {
    const [job] = await c.processOk(photo.id, { mode: 'quick', metadata: { preserveOrientation: false } });
    const out = await output(job!, 'jpg');
    expect(jpegExif(parseJpegLayout(out.body))).toBeNull();
    expect(job!.report!.warnings.join(' ')).toMatch(/orientação EXIF foi removida/i);
    expect(pixelMd5(out.file)).toBe(pixelMd5(fx('photo.jpg')));
  });
});

describe('graphic.png, modo rápido', () => {
  let job: JobDetail;
  let out: { body: Buffer; file: string };

  beforeAll(async () => {
    [job] = await c.processOk(graphic.id, { mode: 'quick' });
    out = await output(job, 'png');
  });

  it('remove chunks de texto, tIME e eXIf, com CRCs válidos', () => {
    expect(job.report!.strategy).toBe('image-lossless');
    const { chunks, trailing } = pngChunks(out.body);
    const types = chunks.map((x) => x.type);
    for (const bad of ['tEXt', 'iTXt', 'zTXt', 'tIME', 'eXIf']) expect(types, bad).not.toContain(bad);
    expect(chunks.every((x) => x.crcOk)).toBe(true);
    expect(trailing.length).toBe(0);
    for (const s of PNG_SECRETS) expect(out.body.includes(s), s).toBe(false);
    // É exatamente a imagem-base, antes da injeção de metadados.
    expect(sha256(out.body)).toBe(sha256(fs.readFileSync(fx('base.png'))));
  });

  it('preserva a transparência e os pixels (RGBA idênticos)', () => {
    const ihdr = pngChunks(out.body).chunks.find((x) => x.type === 'IHDR')!;
    expect(ihdr.data[9]).toBe(6); // tipo de cor RGBA
    const v = mainStreams(out.file).v;
    expect(v.pix_fmt).toBe('rgba');
    expect([v.width, v.height]).toEqual([200, 100]);
    expect(pixelMd5(out.file, 'rgba')).toBe(pixelMd5(fx('graphic.png'), 'rgba'));
    // O alfa não é opaco (0.6 na fixture): o canal existe de verdade.
    expect(pixelMd5(out.file, 'rgba')).not.toBe(pixelMd5(out.file, 'rgb24'));
  });

  it('relatório: comprovado, todos os campos sensíveis removidos a pedido', () => {
    const m = job.report!.metadata;
    expect(m.verdict).toBe('comprovado');
    const removed = new Map(m.removed.map((r) => [r.id, r]));
    for (const id of ['png:text:Software', 'png:text:Comment', 'png:text:Author', 'png:text:Creation Time', 'png:tIME', 'exif:ifd0:272']) {
      expect(removed.get(id)?.requested, id).toBe(true);
    }
  });
});

describe('PNG recodificado com metadados mantidos por escolha', () => {
  it('campos preservados por escolha (EXIF e textos) sobrevivem à recodificação', async () => {
    const [job] = await c.processOk(graphic.id, { mode: 'custom', color: { brightness: 10 }, metadata: { remove: NONE } });
    const out = await output(job!, 'png');
    expect(job!.report!.strategy).toBe('image-encode');
    expect(job!.report!.metadata.verdict).toBe('nao-solicitado');
    const { chunks } = pngChunks(out.body);
    // EXIF é reinserido (com o aparelho)…
    const exif = chunks.find((x) => x.type === 'eXIf');
    expect(exif).toBeDefined();
    expect(parseTiffTags(exif!.data).ifd0.get(0x0110)?.value).toBe(SENSITIVE.pngModel);
    // …e os textos que o usuário mandou manter também deveriam estar lá (ou o relatório avisar a perda).
    const lost = job!.report!.metadata.removed.filter((r) => !r.requested && r.category !== 'technical').map((r) => r.id);
    const warned = job!.report!.warnings.some((w) => /texto|tEXt|comentário|não (foram|puderam ser) reinserid/i.test(w));
    expect(lost.length === 0 || warned, `perdidos sem aviso: ${lost.join(', ')}`).toBe(true);
  });
});

describe('image.webp', () => {
  it('sem metadados: limpeza sem perdas, "nada-a-remover", bytes intactos', async () => {
    const [job] = await c.processOk(webp.id, { mode: 'quick' });
    const out = await output(job!, 'webp');
    expect(job!.report!.strategy).toBe('image-lossless');
    expect(job!.report!.metadata.verdict).toBe('nada-a-remover');
    expect(pixelMd5(out.file)).toBe(pixelMd5(fx('image.webp')));
    const w = webpChunks(out.body);
    expect(w.riffSize).toBe(out.body.length - 8);
    expect(sha256(out.body)).toBe(sha256(fs.readFileSync(fx('image.webp'))));
  });

  describe('WEBP estendido com EXIF (GPS, aparelho) e XMP', () => {
    let rich: AssetDTO;
    const richPath = () => tmpFile(buildRichWebp(), 'webp');
    function buildRichWebp() {
      const tiff = buildSimpleTiff('II', [[0x010f, 'Google'], [0x0110, 'Pixel 8 Pro'], [0x0131, 'Snapseed 2.0']], true);
      const xmp = Buffer.from(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
          '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Paraty-RJ"/></rdf:RDF></x:xmpmeta>',
        'utf8',
      );
      return buildExtendedWebp(fs.readFileSync(fx('image.webp')), 300, 200, [
        { fourcc: 'EXIF', data: tiff },
        { fourcc: 'XMP ', data: xmp },
      ]);
    }
    let src: string;

    beforeAll(async () => {
      src = richPath();
      // A fixture montada à mão precisa ser um WEBP válido (o FFmpeg decodifica).
      expect(decodeErrors(src)).toEqual([]);
      [rich] = (await c.importOk({ path: src, name: 'celular.webp' })) as [AssetDTO];
    });

    it('a importação enxerga o EXIF (GPS, modelo) e o XMP', async () => {
      const d = (await c.get(`/api/assets/${rich.id}`)).data;
      const ids = d.metadata.items.map((i: any) => i.id);
      expect(ids).toContain('exif:gps:2');
      expect(ids).toContain('exif:ifd0:272');
      expect(ids.some((i: string) => /photoshop:City/.test(i))).toBe(true);
    });

    it('limpeza total: sem EXIF/XMP, flags do VP8X coerentes, RIFF válido e pixels idênticos', async () => {
      const [job] = await c.processOk(rich.id, { mode: 'quick' });
      const out = await output(job!, 'webp');
      expect(job!.report!.strategy).toBe('image-lossless');
      const w = webpChunks(out.body);
      expect(w.riffSize).toBe(out.body.length - 8);
      const fourccs = w.chunks.map((x) => x.fourcc);
      expect(fourccs).not.toContain('EXIF');
      expect(fourccs).not.toContain('XMP ');
      const vp8x = w.chunks.find((x) => x.fourcc === 'VP8X');
      if (vp8x) expect(vp8x.data[0]! & 0x0c).toBe(0);
      for (const s of ['Pixel 8 Pro', 'Snapseed', 'Paraty-RJ', 'Google']) expect(out.body.includes(s), s).toBe(false);
      expect(pixelMd5(out.file)).toBe(pixelMd5(src));
      expect(decodeErrors(out.file)).toEqual([]);
      expect(job!.report!.metadata.verdict).toBe('comprovado');
    });

    it('seletiva (só GPS): EXIF reescrito sem GPS mantendo o modelo; flag de XMP desligada', async () => {
      const [job] = await c.processOk(rich.id, { mode: 'quick', metadata: { remove: ONLY_GPS } });
      const out = await output(job!, 'webp');
      const w = webpChunks(out.body);
      expect(w.riffSize).toBe(out.body.length - 8);
      const exif = w.chunks.find((x) => x.fourcc === 'EXIF');
      expect(exif).toBeDefined();
      const data = exif!.data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? exif!.data.subarray(6) : exif!.data;
      const t = parseTiffTags(data);
      expect(t.gps.size).toBe(0);
      expect(t.ifd0.get(0x0110)?.value).toBe('Pixel 8 Pro');
      expect(out.body.includes('Paraty-RJ')).toBe(false);
      const vp8x = w.chunks.find((x) => x.fourcc === 'VP8X')!;
      expect(vp8x.data[0]! & 0x08).toBe(0x08);
      expect(vp8x.data[0]! & 0x04).toBe(0);
      expect(pixelMd5(out.file)).toBe(pixelMd5(src));
    });
  });
});
