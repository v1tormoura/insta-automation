import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Client } from './client';
import { ffprobe } from './media';

/**
 * Inspeção independente do servidor: tudo aqui usa FFmpeg/FFprobe diretamente
 * ou parsers mínimos escritos só para os testes (JPEG, TIFF/EXIF, PNG, WEBP,
 * caixas MP4). Nada importa código de server/src, para que a verificação não
 * herde os mesmos erros do código verificado.
 */

// ── Processos ────────────────────────────────────────────────────────────

export function ff(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

/** Fluxos principais do JSON do ffprobe. */
export function mainStreams(file: string) {
  const p = ffprobe(file);
  const v = (p.streams ?? []).find((s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = (p.streams ?? []).find((s: any) => s.codec_type === 'audio');
  return { probe: p, v, a, format: p.format, duration: Number(p.format?.duration ?? NaN) };
}

/** Rotação da matriz de exibição (0 quando ausente). */
export function rotationOf(stream: any): number {
  for (const sd of stream?.side_data_list ?? []) if (typeof sd.rotation === 'number') return sd.rotation;
  const tag = stream?.tags?.rotate;
  return tag ? -Number(tag) : 0;
}

/** Decodifica o arquivo inteiro descartando os quadros; devolve as linhas de erro. */
export function decodeErrors(file: string): string[] {
  const r = ff(['-v', 'error', '-i', file, '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-']);
  const lines = r.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  if (r.code !== 0) lines.push(`ffmpeg saiu com código ${r.code}`);
  return lines;
}

/** Duração real de um fluxo, contando pacotes (não confia no cabeçalho). */
export function decodedDuration(file: string, sel: 'v' | 'a'): number {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', `${sel}:0`, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  let min = Infinity;
  let max = -Infinity;
  for (const line of out.split('\n')) {
    const [pts, dur] = line.split(',').map(Number);
    if (!Number.isFinite(pts)) continue;
    min = Math.min(min, pts!);
    max = Math.max(max, pts! + (Number.isFinite(dur) ? dur! : 0));
  }
  return max - min;
}

/** MD5 dos pixels armazenados (sem autorrotação), num formato fixo (independe do contêiner). */
export function pixelMd5(file: string, pixFmt = 'rgba', extra: string[] = []): string {
  const r = ff(['-v', 'error', '-noautorotate', '-i', file, '-map', '0:v:0', ...extra, '-pix_fmt', pixFmt, '-f', 'md5', '-']);
  if (r.code !== 0) throw new Error(`pixelMd5 falhou: ${r.stderr}`);
  return r.stdout.trim();
}

/** Hash de cada pacote copiado (sem decodificar) de um fluxo. */
export function packetHashes(file: string, sel: 'v' | 'a'): string[] {
  const r = ff(['-v', 'error', '-i', file, '-map', `0:${sel}:0`, '-c', 'copy', '-f', 'framemd5', '-']);
  if (r.code !== 0) throw new Error(`framemd5 falhou: ${r.stderr}`);
  return r.stdout
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').map((x) => x.trim()))
    .map((cols) => `${cols[4]}:${cols[5]}`); // tamanho + md5 do pacote
}

/**
 * PSNR médio (dB) entre um quadro de A e um de B, ambos convertidos para a
 * mesma resolução/formato. `inf` vira 100. Quando há filtro explícito (ou
 * raw*), a entrada é lida SEM autorrotação do FFmpeg (pixels armazenados).
 */
export function psnr(
  a: string,
  b: string,
  o: { ssA?: number; ssB?: number; filterA?: string; filterB?: string; size?: string; frames?: number; rawA?: boolean; rawB?: boolean } = {},
): number {
  const size = o.size ? `,scale=${o.size}:flags=bicubic` : '';
  const fa = [o.filterA, `format=yuv420p${size}`].filter(Boolean).join(',');
  const fb = [o.filterB, `format=yuv420p${size}`].filter(Boolean).join(',');
  const args = [
    '-v', 'info',
    ...(o.ssA ? ['-ss', String(o.ssA)] : []), ...(o.rawA || o.filterA ? ['-noautorotate'] : []), '-i', a,
    ...(o.ssB ? ['-ss', String(o.ssB)] : []), ...(o.rawB || o.filterB ? ['-noautorotate'] : []), '-i', b,
    '-lavfi', `[0:v]${fa},setpts=PTS-STARTPTS[x];[1:v]${fb},setpts=PTS-STARTPTS[y];[x][y]psnr`,
    '-frames:v', String(o.frames ?? 1), '-f', 'null', '-',
  ];
  const r = ff(args);
  const m = r.stderr.match(/PSNR .*average:(inf|[\d.]+)/);
  if (!m) throw new Error(`psnr sem resultado: ${r.stderr.slice(-800)}`);
  return m[1] === 'inf' ? 100 : Number(m[1]);
}

export interface FrameStats {
  yavg: number;
  ymax: number;
  ymin: number;
  uavg: number;
  vavg: number;
}

/** Estatísticas (signalstats) de um quadro no instante t, opcionalmente recortado. */
export function frameStats(file: string, t: number, crop?: string): FrameStats {
  const vf = [crop ? `crop=${crop}` : null, 'signalstats', 'metadata=print:file=-'].filter(Boolean).join(',');
  const r = ff(['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'null', '-']);
  const get = (k: string) => {
    const m = r.stdout.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`));
    if (!m) throw new Error(`signalstats sem ${k}: ${r.stderr.slice(-500)}`);
    return Number(m[1]);
  };
  return { yavg: get('YAVG'), ymax: get('YMAX'), ymin: get('YMIN'), uavg: get('UAVG'), vavg: get('VAVG') };
}

/** Volume médio (dB) de um trecho, opcionalmente filtrado numa banda de frequência. */
export function volumeDb(file: string, o: { ss?: number; t?: number; band?: number } = {}): number {
  const af = [o.band ? `bandpass=f=${o.band}:width_type=q:w=8` : null, 'volumedetect'].filter(Boolean).join(',');
  const r = ff([
    '-v', 'info',
    ...(o.ss !== undefined ? ['-ss', String(o.ss)] : []),
    ...(o.t !== undefined ? ['-t', String(o.t)] : []),
    '-i', file, '-map', '0:a:0', '-af', af, '-f', 'null', '-',
  ]);
  const m = r.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  if (!m) throw new Error(`volumedetect sem resultado: ${r.stderr.slice(-500)}`);
  return m[1] === '-inf' ? -200 : Number(m[1]);
}

// ── Arquivos da sessão ───────────────────────────────────────────────────

export async function sessionId(c: Client): Promise<string> {
  const { data } = await c.get('/api/session');
  return data.id as string;
}

export function sessionArea(dataDir: string, sid: string, area: 'uploads' | 'thumbs' | 'outputs' | 'previews' | 'tmp'): string {
  return path.join(dataDir, 'sessions', sid, area);
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

// ── JPEG ─────────────────────────────────────────────────────────────────

export interface JpegSeg {
  marker: number;
  payload: Buffer;
}

export interface JpegLayout {
  segments: JpegSeg[];
  /** Dados entrópicos (todas as varreduras concatenadas). */
  entropy: Buffer;
  /** Bytes após o marcador EOI. */
  trailing: Buffer;
}

export function parseJpegLayout(buf: Buffer): JpegLayout {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('não é JPEG');
  const segments: JpegSeg[] = [];
  const entropy: Buffer[] = [];
  let p = 2;
  let eoiEnd = -1;
  while (p < buf.length) {
    if (buf[p] !== 0xff) throw new Error(`marcador esperado em ${p}`);
    let m = buf[p + 1]!;
    while (m === 0xff) {
      p++;
      m = buf[p + 1]!;
    }
    if (m === 0xd9) {
      eoiEnd = p + 2;
      break;
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      p += 2;
      continue;
    }
    const len = buf.readUInt16BE(p + 2);
    segments.push({ marker: m, payload: buf.subarray(p + 4, p + 2 + len) });
    p += 2 + len;
    if (m === 0xda) {
      let q = p;
      while (true) {
        const i = buf.indexOf(0xff, q);
        if (i < 0 || i + 1 >= buf.length) throw new Error('varredura sem fim');
        const n = buf[i + 1]!;
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) {
          q = i + 1;
          continue;
        }
        entropy.push(buf.subarray(p, i));
        p = i;
        break;
      }
    }
  }
  if (eoiEnd < 0) throw new Error('JPEG sem EOI');
  return { segments, entropy: Buffer.concat(entropy), trailing: buf.subarray(eoiEnd) };
}

const startsWith = (b: Buffer, s: string) => b.subarray(0, s.length).toString('latin1') === s;

export function jpegExif(l: JpegLayout): Buffer | null {
  const s = l.segments.find((x) => x.marker === 0xe1 && startsWith(x.payload, 'Exif\0\0'));
  return s ? s.payload.subarray(6) : null;
}
export function jpegHasXmp(l: JpegLayout): boolean {
  return l.segments.some((x) => x.marker === 0xe1 && startsWith(x.payload, 'http://ns.adobe.com/'));
}
export function jpegComments(l: JpegLayout): string[] {
  return l.segments.filter((x) => x.marker === 0xfe).map((x) => x.payload.toString('utf8'));
}

// ── TIFF / EXIF ──────────────────────────────────────────────────────────

export interface TiffTag {
  type: number;
  count: number;
  raw: Buffer;
  /** Valor decodificado (texto, número ou lista de números). */
  value: string | number | number[];
}

export interface TiffTags {
  order: 'II' | 'MM';
  ifd0: Map<number, TiffTag>;
  exif: Map<number, TiffTag>;
  gps: Map<number, TiffTag>;
}

const TIFF_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

export function parseTiffTags(t: Buffer): TiffTags {
  const order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('ordem de bytes TIFF inválida');
  const le = order === 'II';
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error('assinatura TIFF inválida');
  const readIfd = (off: number): Map<number, TiffTag> => {
    const m = new Map<number, TiffTag>();
    if (!off) return m;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TIFF_SIZES[type] ?? 1) * count;
      const dataOff = size <= 4 ? e + 8 : u32(e + 8);
      const raw = t.subarray(dataOff, dataOff + size);
      let value: TiffTag['value'];
      if (type === 2) value = raw.toString('latin1').replace(/\0+$/, '');
      else if (type === 3) value = count === 1 ? u16(dataOff) : Array.from({ length: count }, (_, k) => u16(dataOff + k * 2));
      else if (type === 4) value = count === 1 ? u32(dataOff) : Array.from({ length: count }, (_, k) => u32(dataOff + k * 4));
      else value = raw.toString('latin1');
      m.set(tag, { type, count, raw, value });
    }
    return m;
  };
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769)?.value;
  const gpsPtr = ifd0.get(0x8825)?.value;
  return {
    order,
    ifd0,
    exif: typeof exifPtr === 'number' ? readIfd(exifPtr) : new Map(),
    gps: typeof gpsPtr === 'number' ? readIfd(gpsPtr) : new Map(),
  };
}

// ── PNG ──────────────────────────────────────────────────────────────────

export interface PngChunkInfo {
  type: string;
  data: Buffer;
  crcOk: boolean;
}

export function pngChunks(buf: Buffer): { chunks: PngChunkInfo[]; trailing: Buffer } {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('não é PNG');
  const chunks: PngChunkInfo[] = [];
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    const crc = buf.readUInt32BE(p + 8 + len);
    const calc = zlib.crc32(data, zlib.crc32(Buffer.from(type, 'latin1'))) >>> 0;
    chunks.push({ type, data, crcOk: crc === calc });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return { chunks, trailing: buf.subarray(p) };
}

// ── WEBP ─────────────────────────────────────────────────────────────────

export function webpChunks(buf: Buffer): { riffSize: number; chunks: Array<{ fourcc: string; data: Buffer }> } {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('não é WEBP');
  const riffSize = buf.readUInt32LE(4);
  const chunks: Array<{ fourcc: string; data: Buffer }> = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    chunks.push({ fourcc, data: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size % 2);
  }
  return { riffSize, chunks };
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

/** Monta um WEBP estendido (VP8X) com os chunks extras indicados. */
export function buildExtendedWebp(simple: Buffer, width: number, height: number, extra: Array<{ fourcc: string; data: Buffer }>): Buffer {
  const { chunks } = webpChunks(simple);
  const image = chunks.find((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
  if (!image) throw new Error('WEBP sem dados de imagem');
  let flags = 0;
  if (extra.some((c) => c.fourcc === 'ICCP')) flags |= 0x20;
  if (extra.some((c) => c.fourcc === 'EXIF')) flags |= 0x08;
  if (extra.some((c) => c.fourcc === 'XMP ')) flags |= 0x04;
  const vp8x = Buffer.alloc(10);
  vp8x[0] = flags;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    ...extra.filter((c) => c.fourcc === 'ICCP').map((c) => riffChunk(c.fourcc, c.data)),
    riffChunk(image.fourcc, image.data),
    ...extra.filter((c) => c.fourcc !== 'ICCP').map((c) => riffChunk(c.fourcc, c.data)),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** TIFF mínimo (big ou little endian) com IFD0 de textos + GPS, escrito à mão. */
export function buildSimpleTiff(order: 'II' | 'MM', ascii: Array<[number, string]>, withGps: boolean): Buffer {
  const le = order === 'II';
  const w16 = (b: Buffer, v: number, o: number) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b: Buffer, v: number, o: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  const entries: Array<{ tag: number; type: number; count: number; data: Buffer }> = ascii.map(([tag, s]) => {
    const data = Buffer.from(s + '\0', 'latin1');
    return { tag, type: 2, count: data.length, data };
  });
  const gpsEntries: typeof entries = [];
  if (withGps) {
    const rat = (vals: Array<[number, number]>) => {
      const b = Buffer.alloc(vals.length * 8);
      vals.forEach(([n, d], i) => {
        w32(b, n, i * 8);
        w32(b, d, i * 8 + 4);
      });
      return b;
    };
    gpsEntries.push({ tag: 1, type: 2, count: 2, data: Buffer.from('S\0') });
    gpsEntries.push({ tag: 2, type: 5, count: 3, data: rat([[22, 1], [54, 1], [1234, 100]]) });
    gpsEntries.push({ tag: 3, type: 2, count: 2, data: Buffer.from('W\0') });
    gpsEntries.push({ tag: 4, type: 5, count: 3, data: rat([[43, 1], [12, 1], [5678, 100]]) });
    entries.push({ tag: 0x8825, type: 4, count: 1, data: Buffer.alloc(4) });
  }
  entries.sort((a, b) => a.tag - b.tag);
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Off = 8;
  const gpsOff = ifd0Off + ifdSize(entries.length);
  let dataOff = gpsOff + (withGps ? ifdSize(gpsEntries.length) : 0);
  const blobs: Buffer[] = [];
  const writeIfd = (list: typeof entries) => {
    const b = Buffer.alloc(ifdSize(list.length));
    w16(b, list.length, 0);
    list.forEach((e, i) => {
      const o = 2 + i * 12;
      w16(b, e.tag, o);
      w16(b, e.type, o + 2);
      w32(b, e.count, o + 4);
      if (e.tag === 0x8825) w32(b, gpsOff, o + 8);
      else if (e.data.length <= 4) e.data.copy(b, o + 8);
      else {
        w32(b, dataOff, o + 8);
        blobs.push(e.data);
        dataOff += e.data.length;
      }
    });
    return b;
  };
  const head = Buffer.alloc(8);
  head.write(order, 0, 'latin1');
  w16(head, 42, 2);
  w32(head, ifd0Off, 4);
  const ifd0 = writeIfd(entries);
  const gps = withGps ? writeIfd(gpsEntries) : Buffer.alloc(0);
  return Buffer.concat([head, ifd0, gps, ...blobs]);
}

// ── MP4 / MOV ────────────────────────────────────────────────────────────

const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf', 'meta', 'ilst']);

/** Caminhos de todas as caixas (ex.: "moov/udta/loci"). */
export function mp4BoxPaths(buf: Buffer): string[] {
  const out: string[] = [];
  const walk = (start: number, end: number, parent: string, depth: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8));
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      const full = parent ? `${parent}/${type}` : type;
      out.push(full);
      if (MP4_CONTAINERS.has(type) && depth < 10) {
        let inner = p + hdr;
        if (type === 'meta') {
          // MP4: FullBox (versão/flags); QuickTime: não.
          const next = buf.toString('latin1', inner + 4, inner + 8);
          if (!/^(hdlr|keys|ilst)$/.test(next)) inner += 4;
        }
        walk(inner, p + size, full, depth + 1);
      }
      p += size;
    }
  };
  walk(0, buf.length, '', 0);
  return out;
}

/** Média do canal alfa (0–255) do primeiro quadro; 255 = opaco. */
export function alphaMean(file: string): number {
  const r = ff(['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'format=rgba,alphaextract,signalstats,metadata=print:file=-', '-f', 'null', '-']);
  const m = r.stdout.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  if (!m) throw new Error(`alphaextract sem resultado: ${r.stderr.slice(-500)}`);
  return Number(m[1]);
}

/** Gera um arquivo de referência com o FFmpeg (filtro arbitrário) num diretório temporário. */
export function makeReference(args: string[], ext: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ref-'));
  const out = path.join(dir, `ref.${ext}`);
  const r = ff(['-v', 'error', '-y', ...args, out]);
  if (r.code !== 0) throw new Error(`referência falhou: ${r.stderr}`);
  return out;
}
