import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { metadataSettingsSchema, type MetadataItem, type MetadataSettings } from '@mediaforge/shared';
import { describe, expect, it } from 'vitest';
import { cleanImage, imageItems, injectImageMetadata, readImageBlocks, type ImageContainer } from '../../src/media/metadata/imageMeta';
import { exifSegment, JpegParseError, parseJpeg, rebuildJpeg, segmentBytes, segmentType } from '../../src/media/metadata/jpeg';
import { chunkBytes, decodeIccp, parsePng, PNG_IMAGE_CHUNKS, PngParseError, rebuildPng, textChunk } from '../../src/media/metadata/png';
import { asciiEntry, buildTiff, orientationOf, parseTiff, rationalEntry, shortEntry, TAG_ORIENTATION } from '../../src/media/metadata/tiff';
import { parseWebp, rebuildWebp, WebpParseError, type WebpChunk } from '../../src/media/metadata/webp';
import { fx, SENSITIVE } from '../helpers/fixtures';
import { ffprobe, frameMd5, tmpFile } from '../helpers/media';

const ALL_FALSE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };
const meta = (remove: Partial<MetadataSettings['remove']> | 'all' | 'none', extra: Partial<Omit<MetadataSettings, 'remove'>> = {}): MetadataSettings =>
  metadataSettingsSchema.parse({ remove: remove === 'all' ? {} : remove === 'none' ? ALL_FALSE : { ...ALL_FALSE, ...remove }, ...extra });

const read = (name: string) => fs.readFileSync(fx(name));
const PHOTO = read('photo.jpg');
const GRAPHIC = read('graphic.png');
const WEBP = read('image.webp');
const BASE_JPG = read('base.jpg');
const BASE_PNG = read('base.png');

/** Procura o texto nos bytes (UTF-8 e Latin-1). */
const has = (buf: Buffer, s: string) => buf.includes(Buffer.from(s, 'utf8')) || buf.includes(Buffer.from(s, 'latin1'));
const byId = (items: MetadataItem[]) => new Map(items.map((i) => [i.id, i]));
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** Bytes que descrevem a imagem (tabelas, SOF, SOS e dados entrópicos). */
function jpegImageData(buf: Buffer): Buffer {
  const s = parseJpeg(buf);
  return Buffer.concat(
    s.items.filter((i) => i.kind === 'entropy' || (i.kind === 'segment' && segmentType(i) === 'image')).map((i) => buf.subarray(i.start, i.end)),
  );
}
function pngImageData(buf: Buffer): Buffer {
  const s = parsePng(buf);
  return Buffer.concat(s.chunks.filter((c) => PNG_IMAGE_CHUNKS.has(c.type)).map((c) => buf.subarray(c.start, c.end)));
}
function pngCrcsValid(buf: Buffer): boolean {
  return parsePng(buf).chunks.every((c) => buf.readUInt32BE(c.end - 4) === zlib.crc32(buf.subarray(c.start + 4, c.end - 4)) >>> 0);
}
const md5 = (buf: Buffer, ext: string) => frameMd5(tmpFile(buf, ext));
/** MD5 dos pixels sem a rotação automática do FFmpeg (que aplica a orientação EXIF do JPEG). */
const rawMd5 = (file: string) =>
  execFileSync('ffmpeg', ['-v', 'error', '-autorotate', '0', '-i', file, '-map', '0:v:0', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();

/** Perfil ICC mínimo com tag "desc" (opcionalmente preenchido até `padTo` bytes). */
function fakeIcc(desc: string, padTo = 0): Buffer {
  const text = Buffer.from(desc + '\0', 'latin1');
  const tag = Buffer.concat([Buffer.from('desc\0\0\0\0', 'latin1'), u32be(text.length), text]);
  const table = Buffer.concat([u32be(1), Buffer.from('desc', 'latin1'), u32be(144), u32be(tag.length)]);
  let icc = Buffer.concat([Buffer.alloc(128), table, tag]);
  if (padTo > icc.length) icc = Buffer.concat([icc, Buffer.alloc(padTo - icc.length, 0x11)]);
  icc.writeUInt32BE(icc.length, 0);
  return icc;
}

function secretTiff(order: 'LE' | 'BE', opts: { orientation?: number; model?: string } = {}) {
  const ifd0 = [asciiEntry(0x010f, 'FabricanteSecreto'), asciiEntry(0x0110, opts.model ?? 'ModeloSecretoXYZ'), rationalEntry(0x011a, [[72, 1]], order)];
  if (opts.orientation) ifd0.push(shortEntry(TAG_ORIENTATION, opts.orientation, order));
  return buildTiff({
    order,
    ifd0,
    exif: [asciiEntry(0x9003, '1999:12:31 23:59:59')],
    gps: [asciiEntry(0x0001, 'N'), rationalEntry(0x0002, [[51, 1], [30, 1], [2604, 100]], order), asciiEntry(0x001b, 'GPSPROCSECRETO')],
  });
}

/** WEBP estendido (VP8X) a partir do image.webp das fixtures, com chunks de metadados. */
function extendedWebp(opts: { exif?: Buffer; xmp?: string; icc?: Buffer; unknown?: boolean }): Buffer {
  const vp8 = parseWebp(WEBP).find((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L')!;
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(300 - 1, 4, 3);
  vp8x.writeUIntLE(200 - 1, 7, 3);
  const list: WebpChunk[] = [{ fourcc: 'VP8X', data: vp8x }];
  if (opts.icc) list.push({ fourcc: 'ICCP', data: opts.icc });
  list.push(vp8);
  if (opts.exif) list.push({ fourcc: 'EXIF', data: opts.exif });
  if (opts.xmp) list.push({ fourcc: 'XMP ', data: Buffer.from(opts.xmp, 'utf8') });
  if (opts.unknown) list.push({ fourcc: 'ABCD', data: Buffer.from('SEGREDO-CHUNK-DESCONHECIDO') });
  return rebuildWebp(list, () => true);
}

const xmpPacket = (attrs: string) =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attrs}/>` +
  `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const xmpSegment = (xml: string) => segmentBytes(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')]));
const withJpegSegments = (base: Buffer, segs: Buffer[]) => rebuildJpeg(base, parseJpeg(base), () => true, segs, false);

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
  '2023-07-14T10:22:33',
];
const PNG_SECRETS = [
  SENSITIVE.pngSoftware,
  SENSITIVE.pngComment,
  SENSITIVE.pngModel,
  'Maria Souza',
  'Google',
  'Creation Time',
  '2024-01-02 03:04:05',
  SENSITIVE.jpegSoftware,
  SENSITIVE.jpegArtist,
  SENSITIVE.jpegLens,
  SENSITIVE.jpegSerial,
  'MAKERNOTE-PRIVADO',
];

describe('readImageBlocks + imageItems (fixtures)', () => {
  it('JPEG: lista GPS, aparelho, datas, software, autor, XMP, COM e dados após o EOI', () => {
    const b = readImageBlocks(PHOTO, 'jpeg');
    expect(b.exif?.order).toBe('BE');
    expect(b.orientation).toBe(6);
    expect(b.xmp.length).toBe(1);
    expect(b.comments).toEqual([SENSITIVE.jpegComment]);
    expect(b.trailingBytes).toBe(Buffer.byteLength(SENSITIVE.jpegTrailer, 'latin1'));
    expect(b.warnings).toEqual([]);

    const items = imageItems(b);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => i.removable)).toBe(true);
    const m = byId(items);
    const expectItem = (id: string, value: string, category: string, sensitive = true) => {
      const it = m.get(id);
      expect(it, id).toBeDefined();
      expect({ id, value: it!.value, category: it!.category, sensitive: it!.sensitive }).toEqual({ id, value, category, sensitive });
    };
    expectItem('exif:gps:1', 'S', 'gps');
    expectItem('exif:gps:2', '23, 33, 12.34', 'gps');
    expectItem('exif:gps:3', 'W', 'gps');
    expectItem('exif:gps:4', '46, 38, 56.78', 'gps');
    expectItem('exif:gps:6', '760', 'gps');
    expectItem('exif:ifd0:271', SENSITIVE.jpegMake, 'device');
    expectItem('exif:ifd0:272', SENSITIVE.jpegModel, 'device');
    expectItem('exif:ifd0:305', SENSITIVE.jpegSoftware, 'software');
    expectItem('exif:ifd0:306', SENSITIVE.jpegDate, 'dates');
    expectItem('exif:ifd0:315', SENSITIVE.jpegArtist, 'descriptive');
    expectItem('exif:exif:36867', SENSITIVE.jpegDate, 'dates');
    expectItem('exif:exif:42036', SENSITIVE.jpegLens, 'device');
    expectItem('exif:exif:42033', SENSITIVE.jpegSerial, 'device');
    expectItem('exif:exif:37500', 'MAKERNOTE-PRIVADO-0001', 'device');
    expectItem('exif:exif:37510', 'Casa da praia', 'descriptive');
    expectItem('exif:exif:33434', '0.004', 'device', false);
    expectItem('exif:ifd0:274', '6', 'technical', false);
    expect(m.get('exif:ifd0:274')!.note).toMatch(/posição/);
    expectItem('xmp0:xmp:CreatorTool', SENSITIVE.jpegXmpTool, 'software');
    expectItem('xmp0:photoshop:City', SENSITIVE.jpegXmpCity, 'gps');
    expectItem('xmp0:xmp:CreateDate', '2023-07-14T10:22:33', 'dates');
    expectItem('jpeg:comment:0', SENSITIVE.jpegComment, 'descriptive');
    expectItem('trailing', `<${SENSITIVE.jpegTrailer.length} bytes>`, 'custom');
  });

  it('PNG: lista eXIf (LE), tEXt/iTXt, data de criação e tIME', () => {
    const b = readImageBlocks(GRAPHIC, 'png');
    expect(b.exif?.order).toBe('LE');
    expect(b.orientation).toBeNull();
    expect(b.pngTexts.map((t) => t.keyword).sort()).toEqual(['Author', 'Comment', 'Creation Time', 'Software']);
    expect(b.pngTime).toBe('2024-01-02 03:04:05');
    expect(b.trailingBytes).toBe(0);
    const m = byId(imageItems(b));
    expect(m.get('png:text:Software')).toMatchObject({ value: SENSITIVE.pngSoftware, category: 'software', sensitive: true });
    expect(m.get('png:text:Comment')).toMatchObject({ value: SENSITIVE.pngComment, category: 'descriptive' });
    expect(m.get('png:text:Creation Time')).toMatchObject({ value: '2024-01-02 03:04:05', category: 'dates' });
    expect(m.get('png:text:Author')).toMatchObject({ value: 'Maria Souza', category: 'descriptive', location: 'Chunk iTXt' });
    expect(m.get('png:tIME')).toMatchObject({ value: '2024-01-02 03:04:05', category: 'dates' });
    expect(m.get('exif:ifd0:272')).toMatchObject({ value: SENSITIVE.pngModel, category: 'device' });
    expect(m.get('exif:ifd0:271')).toMatchObject({ value: 'Google', category: 'device' });
    expect(m.get('exif:gps:2')).toMatchObject({ value: '23, 33, 12.34', category: 'gps' });
  });

  it('WEBP simples (VP8) não tem metadados', () => {
    const b = readImageBlocks(WEBP, 'webp');
    expect(b.exif).toBeNull();
    expect(imageItems(b)).toEqual([]);
  });

  it('WEBP estendido: EXIF, XMP, ICC e chunk desconhecido aparecem na lista', () => {
    const webp = extendedWebp({ exif: secretTiff('LE'), xmp: xmpPacket('dc:creator="Autora Secreta" exif:GPSLatitude="51,30.43N"'), icc: fakeIcc('Perfil Teste MF'), unknown: true });
    const m = byId(imageItems(readImageBlocks(webp, 'webp')));
    expect(m.get('exif:ifd0:272')).toMatchObject({ value: 'ModeloSecretoXYZ', category: 'device' });
    expect(m.get('exif:gps:27')).toMatchObject({ value: 'GPSPROCSECRETO', category: 'gps' });
    expect(m.get('xmp0:exif:GPSLatitude')).toMatchObject({ value: '51,30.43N', category: 'gps' });
    expect(m.get('xmp0:dc:creator')).toMatchObject({ value: 'Autora Secreta', category: 'descriptive' });
    expect(m.get('icc')).toMatchObject({ value: 'Perfil Teste MF', category: 'technical' });
    expect(m.get('webp:chunk:ABCD')).toMatchObject({ category: 'custom', sensitive: true });
  });
});

describe('cleanImage — todas as categorias', () => {
  it('JPEG: remove tudo, preserva só a orientação e não toca nos dados comprimidos', () => {
    const r = cleanImage(PHOTO, 'jpeg', meta('all'));
    const out = r.buffer;
    // Parse independente da saída
    const b = readImageBlocks(out, 'jpeg');
    expect(b.exif).not.toBeNull();
    expect(b.exif!.ifd0.map((e) => e.tag)).toEqual([TAG_ORIENTATION]);
    expect(b.exif!.exif.length + b.exif!.gps.length + b.exif!.interop.length + b.exif!.ifd1.length).toBe(0);
    expect(b.orientation).toBe(6);
    expect(b.xmp).toEqual([]);
    expect(b.comments).toEqual([]);
    expect(b.others).toEqual([]);
    expect(b.trailingBytes).toBe(0);
    expect(imageItems(b).every((i) => i.category === 'technical')).toBe(true);
    // Busca de bytes pelos valores sensíveis
    for (const s of JPEG_SECRETS) expect(has(out, s), s).toBe(false);
    // Dados da imagem idênticos (byte a byte e pixels decodificados)
    expect(jpegImageData(out).equals(jpegImageData(PHOTO))).toBe(true);
    expect(md5(out, 'jpg')).toBe(frameMd5(fx('photo.jpg')));
    expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(out.subarray(-2).toString('hex')).toBe('ffd9');
    const p = ffprobe(tmpFile(out, 'jpg'));
    expect([p.streams[0].width, p.streams[0].height]).toEqual([400, 300]);
    expect(out.length).toBeLessThan(PHOTO.length);
    const actions = r.actions.join(' | ');
    expect(actions).toMatch(/orientação/);
    expect(actions).toMatch(/XMP/);
    expect(actions).toMatch(/COM/);
    expect(actions).toMatch(/após o fim/);
  });

  it('PNG: remove eXIf, textos e tIME; IDAT intacto, CRCs válidos e mesmos pixels (com alfa)', () => {
    const r = cleanImage(GRAPHIC, 'png', meta('all'));
    const out = r.buffer;
    const b = readImageBlocks(out, 'png');
    expect(b.exif).toBeNull(); // a orientação não existia: nada a manter
    expect(b.pngTexts).toEqual([]);
    expect(b.pngTime).toBeNull();
    expect(b.others).toEqual([]);
    expect(imageItems(b)).toEqual([]);
    for (const s of PNG_SECRETS) expect(has(out, s), s).toBe(false);
    expect(pngImageData(out).equals(pngImageData(GRAPHIC))).toBe(true);
    expect(pngCrcsValid(out)).toBe(true);
    expect(md5(out, 'png')).toBe(frameMd5(fx('graphic.png')));
    expect(ffprobe(tmpFile(out, 'png')).streams[0].pix_fmt).toBe('rgba');
  });

  it('PNG com orientação no eXIf: mantém só a orientação', () => {
    const src = rebuildPng(BASE_PNG, parsePng(BASE_PNG), () => true, [chunkBytes('eXIf', secretTiff('BE', { orientation: 8 }))]);
    const out = cleanImage(src, 'png', meta('all')).buffer;
    const b = readImageBlocks(out, 'png');
    expect(b.orientation).toBe(8);
    expect(b.exif!.ifd0.map((e) => e.tag)).toEqual([TAG_ORIENTATION]);
    expect(b.exif!.gps).toEqual([]);
    for (const s of ['FabricanteSecreto', 'ModeloSecretoXYZ', 'GPSPROCSECRETO', '1999:12:31']) expect(has(out, s), s).toBe(false);
    expect(pngCrcsValid(out)).toBe(true);
    expect(md5(out, 'png')).toBe(md5(BASE_PNG, 'png'));
  });

  it('PNG: dados após o IEND são removidos', () => {
    const src = Buffer.concat([GRAPHIC, Buffer.from('DADOS-ESCONDIDOS-APOS-IEND')]);
    expect(readImageBlocks(src, 'png').trailingBytes).toBe(26);
    const out = cleanImage(src, 'png', meta('all')).buffer;
    expect(has(out, 'DADOS-ESCONDIDOS')).toBe(false);
    expect(parsePng(out).trailing.length).toBe(0);
  });

  it('WEBP estendido: remove EXIF/XMP/chunk desconhecido, mantém ICC e corrige as flags do VP8X', () => {
    const icc = fakeIcc('Perfil Teste MF');
    const src = extendedWebp({ exif: secretTiff('LE'), xmp: xmpPacket('dc:creator="Autora Secreta"'), icc, unknown: true });
    const before = md5(src, 'webp');
    expect(before).toBe(frameMd5(fx('image.webp')));
    const out = cleanImage(src, 'webp', meta('all')).buffer;
    const chunks = parseWebp(out);
    expect(chunks.map((c) => c.fourcc)).toEqual(['VP8X', 'ICCP', 'VP8 ']);
    expect(chunks[1]!.data.equals(icc)).toBe(true);
    const flags = chunks[0]!.data[0]!;
    expect(flags & 0x20).toBe(0x20);
    expect(flags & 0x08).toBe(0);
    expect(flags & 0x04).toBe(0);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    for (const s of ['ModeloSecretoXYZ', 'GPSPROCSECRETO', 'Autora Secreta', 'SEGREDO-CHUNK']) expect(has(out, s), s).toBe(false);
    expect(md5(out, 'webp')).toBe(before);

    const noIcc = cleanImage(src, 'webp', meta('all', { preserveColorProfile: false })).buffer;
    const c2 = parseWebp(noIcc);
    expect(c2.map((c) => c.fourcc)).toEqual(['VP8X', 'VP8 ']);
    expect(c2[0]!.data[0]! & 0x20).toBe(0);
    expect(md5(noIcc, 'webp')).toBe(before);
  });

  it('JPEG: miniatura EXIF (IFD1), segmentos APPn desconhecidos e JFXX são removidos', () => {
    // EXIF com IFD1 + miniatura, APP5 proprietário e APP0 JFXX
    const tiff = secretTiff('LE', { orientation: 3 });
    const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('MINIATURA-ANTES-DO-CORTE'), Buffer.from([0xff, 0xd9])]);
    const le = Buffer.from(tiff);
    const ifd0 = le.readUInt32LE(4);
    const nextAt = ifd0 + 2 + le.readUInt16LE(ifd0) * 12;
    const ifd1At = le.length;
    const ifd1 = Buffer.alloc(2 + 2 * 12 + 4);
    ifd1.writeUInt16LE(2, 0);
    ifd1.writeUInt16LE(0x0201, 2), ifd1.writeUInt16LE(4, 4), ifd1.writeUInt32LE(1, 6), ifd1.writeUInt32LE(ifd1At + ifd1.length, 10);
    ifd1.writeUInt16LE(0x0202, 14), ifd1.writeUInt16LE(4, 16), ifd1.writeUInt32LE(1, 18), ifd1.writeUInt32LE(thumb.length, 22);
    const full = Buffer.concat([le, ifd1, thumb]);
    full.writeUInt32LE(ifd1At, nextAt);
    expect(parseTiff(full).thumbnail?.equals(thumb)).toBe(true);
    const src = withJpegSegments(BASE_JPG, [
      exifSegment(full),
      segmentBytes(0xe5, Buffer.from('FABRICANTE-APP5-SEGREDO')),
      segmentBytes(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10', 'latin1'), Buffer.from('JFXX-MINIATURA')])),
    ]);
    const ids = imageItems(readImageBlocks(src, 'jpeg')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['exif:ifd1', 'jpeg:app:e5', 'jpeg:jfxx']));
    const out = cleanImage(src, 'jpeg', meta('all')).buffer;
    for (const s of ['MINIATURA-ANTES', 'FABRICANTE-APP5', 'JFXX-MINIATURA', 'ModeloSecretoXYZ']) expect(has(out, s), s).toBe(false);
    expect(readImageBlocks(out, 'jpeg').orientation).toBe(3);
    expect(jpegImageData(out).equals(jpegImageData(BASE_JPG))).toBe(true);
  });
});

describe('cleanImage — seletivo', () => {
  it('JPEG, só GPS: Make/Model ficam, GPS e XMP (com cidade) saem, COM e dados finais ficam', () => {
    const r = cleanImage(PHOTO, 'jpeg', meta({ gps: true }));
    const out = r.buffer;
    const b = readImageBlocks(out, 'jpeg');
    expect(b.exif!.gps).toEqual([]);
    const m = byId(imageItems(b));
    expect(m.get('exif:ifd0:271')?.value).toBe(SENSITIVE.jpegMake);
    expect(m.get('exif:ifd0:272')?.value).toBe(SENSITIVE.jpegModel);
    expect(m.get('exif:ifd0:306')?.value).toBe(SENSITIVE.jpegDate);
    expect(m.get('exif:exif:42036')?.value).toBe(SENSITIVE.jpegLens);
    expect(m.has('exif:exif:37500')).toBe(false); // MakerNote não sobrevive à reescrita
    expect(b.orientation).toBe(6);
    expect(b.xmp).toEqual([]);
    expect(has(out, SENSITIVE.jpegXmpCity)).toBe(false);
    expect(b.comments).toEqual([SENSITIVE.jpegComment]);
    expect(has(out, SENSITIVE.jpegTrailer)).toBe(true);
    expect(jpegImageData(out).equals(jpegImageData(PHOTO))).toBe(true);
    expect(r.actions.join(' ')).toMatch(/MakerNote/);
  });

  it('JPEG, só comentários/descrições: COM, Artist e UserComment saem; GPS e XMP ficam', () => {
    const out = cleanImage(PHOTO, 'jpeg', meta({ descriptive: true })).buffer;
    const b = readImageBlocks(out, 'jpeg');
    expect(b.comments).toEqual([]);
    for (const s of [SENSITIVE.jpegComment, SENSITIVE.jpegArtist, 'Casa da praia']) expect(has(out, s), s).toBe(false);
    expect(b.exif!.gps.length).toBe(6);
    expect(b.xmp.length).toBe(1);
    expect(has(out, SENSITIVE.jpegModel)).toBe(true);
    expect(has(out, SENSITIVE.jpegTrailer)).toBe(true);
  });

  it('PNG, só datas: Creation Time, tIME e datas do eXIf saem; software, comentário e autor ficam', () => {
    const out = cleanImage(GRAPHIC, 'png', meta({ dates: true })).buffer;
    const b = readImageBlocks(out, 'png');
    expect(b.pngTexts.map((t) => t.keyword).sort()).toEqual(['Author', 'Comment', 'Software']);
    expect(b.pngTime).toBeNull();
    expect(b.exif!.ifd0.some((e) => e.tag === 0x0132)).toBe(false);
    expect(b.exif!.exif.some((e) => e.tag === 0x9003)).toBe(false);
    expect(b.exif!.gps.length).toBe(6);
    expect(has(out, SENSITIVE.jpegDate)).toBe(false);
    expect(has(out, '2024-01-02 03:04:05')).toBe(false);
    expect(has(out, SENSITIVE.pngSoftware)).toBe(true);
    expect(pngCrcsValid(out)).toBe(true);
    expect(pngImageData(out).equals(pngImageData(GRAPHIC))).toBe(true);
  });

  it('nenhuma categoria selecionada: saída idêntica byte a byte (JPEG, PNG e WEBP)', () => {
    expect(cleanImage(PHOTO, 'jpeg', meta('none')).buffer.equals(PHOTO)).toBe(true);
    expect(cleanImage(GRAPHIC, 'png', meta('none')).buffer.equals(GRAPHIC)).toBe(true);
    const webp = extendedWebp({ exif: secretTiff('LE'), xmp: xmpPacket('dc:creator="X"'), icc: fakeIcc('P'), unknown: true });
    expect(cleanImage(webp, 'webp', meta('none')).buffer.equals(webp)).toBe(true);
  });

  it('sem preservar orientação: EXIF some por completo e há aviso', () => {
    const r = cleanImage(PHOTO, 'jpeg', meta('all', { preserveOrientation: false }));
    const b = readImageBlocks(r.buffer, 'jpeg');
    expect(b.exif).toBeNull();
    expect(b.orientation).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/orientação/i);
    expect(jpegImageData(r.buffer).equals(jpegImageData(PHOTO))).toBe(true);
  });

  it('perfil ICC do JPEG (2 segmentos APP2) é mantido ou removido conforme preserveColorProfile', () => {
    const icc = fakeIcc('Perfil Grande', 70_000);
    const iccSegs = injectImageMetadata(BASE_JPG, 'jpeg', { exif: null, icc }).buffer;
    const src = withJpegSegments(iccSegs, [exifSegment(secretTiff('BE'))]);
    expect(readImageBlocks(src, 'jpeg').icc?.equals(icc)).toBe(true);
    const keep = cleanImage(src, 'jpeg', meta('all')).buffer;
    expect(readImageBlocks(keep, 'jpeg').icc?.equals(icc)).toBe(true);
    expect(has(keep, 'ModeloSecretoXYZ')).toBe(false);
    const drop = cleanImage(src, 'jpeg', meta('all', { preserveColorProfile: false }));
    expect(readImageBlocks(drop.buffer, 'jpeg').icc).toBeNull();
    expect(drop.actions.join(' ')).toMatch(/ICC/);
    expect(jpegImageData(drop.buffer).equals(jpegImageData(BASE_JPG))).toBe(true);
  });
});

describe('cleanImage — casos adversariais', () => {
  const benign = buildTiff({ order: 'BE', ifd0: [rationalEntry(0x011a, [[72, 1]], 'BE'), rationalEntry(0x011b, [[72, 1]], 'BE')] });

  it('JPEG com dois blocos EXIF: o segundo (com GPS/modelo) também é removido', () => {
    const src = withJpegSegments(BASE_JPG, [exifSegment(benign), exifSegment(secretTiff('BE'))]);
    const out = cleanImage(src, 'jpeg', meta('all')).buffer;
    for (const s of ['ModeloSecretoXYZ', 'FabricanteSecreto', 'GPSPROCSECRETO', '1999:12:31']) expect(has(out, s), s).toBe(false);
  });

  it('JPEG com dois blocos EXIF: a inspeção lista os campos do segundo bloco', () => {
    const src = withJpegSegments(BASE_JPG, [exifSegment(benign), exifSegment(secretTiff('BE'))]);
    const values = imageItems(readImageBlocks(src, 'jpeg')).map((i) => i.value);
    expect(values).toContain('ModeloSecretoXYZ');
    expect(values).toContain('GPSPROCSECRETO');
  });

  it('PNG com dois chunks eXIf: o segundo também é removido', () => {
    const src = rebuildPng(BASE_PNG, parsePng(BASE_PNG), () => true, [chunkBytes('eXIf', benign), chunkBytes('eXIf', secretTiff('LE'))]);
    const out = cleanImage(src, 'png', meta('all')).buffer;
    for (const s of ['ModeloSecretoXYZ', 'GPSPROCSECRETO']) expect(has(out, s), s).toBe(false);
  });

  it('XMP com atributos entre aspas simples (XML válido) não esconde o GPS da limpeza', () => {
    const xml = xmpPacket(`tiff:Orientation="1" exif:GPSLatitude='23,33.2058S' exif:GPSLongitude='46,38.9463W'`);
    const src = withJpegSegments(BASE_JPG, [xmpSegment(xml)]);
    const out = cleanImage(src, 'jpeg', meta('all')).buffer;
    expect(has(out, '23,33.2058S')).toBe(false);
    expect(has(out, '46,38.9463W')).toBe(false);
  });

  it('XMP com referência numérica inválida (&#99999999;) não derruba inspeção nem limpeza', () => {
    const xml = xmpPacket(`dc:title="Oi &#99999999; mundo" exif:GPSLatitude="23,33.2058S"`);
    const src = withJpegSegments(BASE_JPG, [xmpSegment(xml)]);
    expect(() => imageItems(readImageBlocks(src, 'jpeg'))).not.toThrow();
    let out: Buffer | null = null;
    expect(() => (out = cleanImage(src, 'jpeg', meta('all')).buffer)).not.toThrow();
    expect(has(out!, '23,33.2058S')).toBe(false);
  });

  it('PNG do ImageMagick ("Raw profile type exif" com GPS): pedir só GPS remove as coordenadas', () => {
    const tiff = secretTiff('BE');
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const hex = payload.toString('hex').replace(/(.{72})/g, '$1\n');
    const text = `\nexif\n${String(payload.length).padStart(8)}\n${hex}\n`;
    const ztxt = chunkBytes('zTXt', Buffer.concat([Buffer.from('Raw profile type exif\0\0', 'latin1'), zlib.deflateSync(Buffer.from(text, 'latin1'))]));
    const src = rebuildPng(BASE_PNG, parsePng(BASE_PNG), () => true, [ztxt]);
    const out = cleanImage(src, 'png', meta({ gps: true })).buffer;
    // Decodifica o perfil bruto remanescente (se houver) e procura o IFD de GPS.
    const remaining = parsePng(out)
      .chunks.filter((c) => c.type === 'zTXt' || c.type === 'tEXt')
      .map((c) => {
        const nul = c.data.indexOf(0);
        const body = c.type === 'zTXt' ? zlib.inflateSync(c.data.subarray(nul + 2)).toString('latin1') : c.data.toString('latin1', nul + 1);
        return { keyword: c.data.toString('latin1', 0, nul), body };
      })
      .filter((t) => /raw profile type exif/i.test(t.keyword));
    for (const r of remaining) {
      const bytes = Buffer.from(r.body.split('\n').slice(3).join(''), 'hex');
      const t = parseTiff(bytes.subarray(6));
      expect(t.gps.length, 'GPS ainda presente no perfil bruto do ImageMagick').toBe(0);
    }
  });
});

describe('injectImageMetadata', () => {
  it('JPEG: insere EXIF logo após o JFIF e ICC em 2 segmentos; pixels inalterados', () => {
    const icc = fakeIcc('Perfil Grande', 70_000);
    const exif = buildTiff({ order: 'BE', ifd0: [shortEntry(TAG_ORIENTATION, 6, 'BE'), asciiEntry(0x8298, 'Direitos (c) Fulana')] });
    const r = injectImageMetadata(BASE_JPG, 'jpeg', { exif, icc });
    const out = r.buffer;
    const s = parseJpeg(out);
    const types = s.items.filter((i) => i.kind === 'segment').map((i) => segmentType(i));
    const firstNonJfif = types.findIndex((t) => t !== 'jfif');
    expect(types[firstNonJfif]).toBe('exif');
    expect(types.filter((t) => t === 'icc').length).toBe(2);
    expect(types.filter((t) => t === 'exif').length).toBe(1);
    const b = readImageBlocks(out, 'jpeg');
    expect(b.orientation).toBe(6);
    expect(b.icc?.equals(icc)).toBe(true);
    expect(byId(imageItems(b)).get('exif:ifd0:33432')?.value).toBe('Direitos (c) Fulana');
    expect(jpegImageData(out).equals(jpegImageData(BASE_JPG))).toBe(true);
    // Pixels crus idênticos; com rotação automática, o FFmpeg passa a girar 90° (prova de que a orientação vale).
    expect(rawMd5(tmpFile(out, 'jpg'))).toBe(rawMd5(fx('base.jpg')));
    expect(md5(out, 'jpg')).not.toBe(frameMd5(fx('base.jpg')));
    expect(r.actions.length).toBe(2);
  });

  it('JPEG que já tem EXIF/ICC: o bloco antigo é substituído, não duplicado', () => {
    const out = injectImageMetadata(PHOTO, 'jpeg', { exif: buildTiff({ order: 'LE', ifd0: [shortEntry(TAG_ORIENTATION, 1, 'LE')] }), icc: null }).buffer;
    const types = parseJpeg(out).items.filter((i) => i.kind === 'segment').map((i) => segmentType(i));
    expect(types.filter((t) => t === 'exif').length).toBe(1);
    expect(has(out, SENSITIVE.jpegModel)).toBe(false);
    expect(readImageBlocks(out, 'jpeg').orientation).toBe(1);
  });

  it('PNG: iCCP e eXIf entram depois do IHDR, sRGB conflitante sai; CRCs e pixels corretos', () => {
    const withSrgb = rebuildPng(BASE_PNG, parsePng(BASE_PNG), () => true, [chunkBytes('sRGB', Buffer.from([0]))]);
    const icc = fakeIcc('Perfil PNG');
    const exif = buildTiff({ order: 'LE', ifd0: [shortEntry(TAG_ORIENTATION, 6, 'LE')] });
    const out = injectImageMetadata(withSrgb, 'png', { exif, icc }).buffer;
    const chunks = parsePng(out).chunks;
    expect(chunks.slice(0, 3).map((c) => c.type)).toEqual(['IHDR', 'iCCP', 'eXIf']);
    expect(decodeIccp(chunks[1]!)?.equals(icc)).toBe(true);
    expect(orientationOf(parseTiff(chunks[2]!.data))).toBe(6);
    expect(chunks.findIndex((c) => c.type === 'IDAT')).toBeGreaterThan(2);
    expect(pngCrcsValid(out)).toBe(true);
    expect(md5(out, 'png')).toBe(frameMd5(fx('base.png')));
    // Spec PNG: com iCCP presente, sRGB não deve coexistir (leitores dão prioridade ao sRGB e ignoram o perfil preservado).
    expect(chunks.some((c) => c.type === 'sRGB'), 'sRGB ainda presente junto do iCCP').toBe(false);
  });

  it('WEBP simples: nada é inserido e há aviso; sem dados: buffer intacto', () => {
    const r = injectImageMetadata(WEBP, 'webp', { exif: Buffer.from('x'), icc: null });
    expect(r.buffer.equals(WEBP)).toBe(true);
    expect(r.warnings.length).toBe(1);
    const n = injectImageMetadata(BASE_JPG, 'jpeg', { exif: null, icc: null });
    expect(n.buffer).toBe(BASE_JPG);
    expect(n.actions).toEqual([]);
  });
});

describe('arquivos malformados lançam erro (sem travar)', () => {
  const formats: Array<[ImageContainer, Buffer]> = [
    ['jpeg', PHOTO],
    ['png', GRAPHIC],
  ];

  it('JPEG: conteúdo que não é JPEG, truncado sem EOI, segmento com tamanho inválido e só preenchimento', () => {
    expect(() => parseJpeg(Buffer.from('isto não é jpeg'))).toThrow(JpegParseError);
    expect(() => readImageBlocks(Buffer.from('isto não é jpeg'), 'jpeg')).toThrow(JpegParseError);
    const truncated = PHOTO.subarray(0, Math.floor(PHOTO.length / 2));
    expect(() => cleanImage(truncated, 'jpeg', meta('all'))).toThrow(JpegParseError);
    expect(() => readImageBlocks(truncated, 'jpeg')).toThrow(JpegParseError);
    const badLen = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00, 0x00]);
    expect(() => cleanImage(badLen, 'jpeg', meta('all'))).toThrow(JpegParseError);
    const zeroLen = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0x00, 0x00]);
    expect(() => parseJpeg(zeroLen)).toThrow(JpegParseError);
    const fill = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200_000, 0xff)]);
    const t0 = Date.now();
    expect(() => parseJpeg(fill)).toThrow(JpegParseError);
    expect(Date.now() - t0).toBeLessThan(5000);
    const garbageAfterSoi = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56]);
    expect(() => parseJpeg(garbageAfterSoi)).toThrow(JpegParseError);
  });

  it('PNG: truncado, sem IEND e com tipo de chunk inválido', () => {
    expect(() => parsePng(GRAPHIC.subarray(0, GRAPHIC.length - 20))).toThrow(PngParseError);
    expect(() => cleanImage(GRAPHIC.subarray(0, 40), 'png', meta('all'))).toThrow(PngParseError);
    const badType = Buffer.from(GRAPHIC);
    badType.write('1@#$', 12, 'latin1');
    expect(() => parsePng(badType)).toThrow(PngParseError);
    expect(() => parsePng(Buffer.from('não é png'))).toThrow(PngParseError);
  });

  it('WEBP: chunk truncado e cabeçalho inválido', () => {
    const t = Buffer.from(WEBP.subarray(0, WEBP.length - 50));
    t.writeUInt32LE(WEBP.readUInt32LE(4), 4); // RIFF diz que há mais dados do que existem
    // riffEnd é limitado ao tamanho real; o chunk VP8 declarado não cabe → erro
    expect(() => parseWebp(t)).toThrow(WebpParseError);
    expect(() => cleanImage(Buffer.from('RIFF\0\0\0\0WAVE'), 'webp', meta('all'))).toThrow(WebpParseError);
  });

  it('fuzz: bytes corrompidos em JPEG/PNG só produzem erros de parse conhecidos ou saída válida', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const t0 = Date.now();
    for (const [fmt, src] of formats) {
      for (let i = 0; i < 150; i++) {
        const c = Buffer.from(src);
        // corrompe só a região de metadados (primeiros 2 KB), onde ficam os blocos lidos
        for (let j = 0; j < 4; j++) c[2 + Math.floor(rnd() * Math.min(2048, c.length - 2))] = Math.floor(rnd() * 256);
        try {
          cleanImage(c, fmt, meta('all'));
        } catch (err) {
          expect((err as Error).constructor.name, `${fmt} #${i}: ${(err as Error).message}`).toMatch(/JpegParseError|PngParseError/);
        }
      }
    }
    expect(Date.now() - t0).toBeLessThan(30_000);
  });
});
