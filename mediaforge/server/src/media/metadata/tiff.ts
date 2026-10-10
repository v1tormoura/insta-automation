/**
 * Leitura e escrita de estruturas TIFF/EXIF (usadas em JPEG APP1, PNG eXIf e
 * WEBP EXIF). Os valores são mantidos como bytes brutos na ordem de bytes
 * original, então a reescrita seletiva preserva exatamente os campos mantidos
 * e só recalcula os deslocamentos.
 */

export type ByteOrder = 'LE' | 'BE';
export type IfdName = 'ifd0' | 'exif' | 'gps' | 'interop' | 'ifd1';

export interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Bytes brutos do valor, na ordem de bytes do arquivo. */
  value: Buffer;
}

export interface TiffData {
  order: ByteOrder;
  ifd0: TiffEntry[];
  exif: TiffEntry[];
  gps: TiffEntry[];
  interop: TiffEntry[];
  ifd1: TiffEntry[];
  thumbnail: Buffer | null;
  warnings: string[];
}

export const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

export const TAG_EXIF_IFD = 0x8769;
export const TAG_GPS_IFD = 0x8825;
export const TAG_INTEROP_IFD = 0xa005;
export const TAG_ORIENTATION = 0x0112;
export const TAG_MAKERNOTE = 0x927c;
const POINTER_TAGS = new Set([TAG_EXIF_IFD, TAG_GPS_IFD, TAG_INTEROP_IFD]);

export class TiffParseError extends Error {}

function reader(buf: Buffer, order: ByteOrder) {
  const le = order === 'LE';
  return {
    u16: (o: number) => {
      if (o < 0 || o + 2 > buf.length) throw new TiffParseError('Fora dos limites');
      return le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    },
    u32: (o: number) => {
      if (o < 0 || o + 4 > buf.length) throw new TiffParseError('Fora dos limites');
      return le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    },
  };
}

export function parseTiff(input: Buffer): TiffData {
  const buf = input;
  if (buf.length < 8) throw new TiffParseError('Bloco TIFF curto demais');
  const bo = buf.toString('latin1', 0, 2);
  const order: ByteOrder = bo === 'II' ? 'LE' : bo === 'MM' ? 'BE' : (() => { throw new TiffParseError('Ordem de bytes inválida'); })();
  const r = reader(buf, order);
  if (r.u16(2) !== 42) throw new TiffParseError('Assinatura TIFF inválida');

  const warnings: string[] = [];
  const visited = new Set<number>();

  const readIfd = (offset: number, name: string): { entries: TiffEntry[]; next: number } => {
    if (offset === 0) return { entries: [], next: 0 };
    if (visited.has(offset)) {
      warnings.push(`IFD ${name} referenciado em ciclo; ignorado.`);
      return { entries: [], next: 0 };
    }
    visited.add(offset);
    const entries: TiffEntry[] = [];
    let count: number;
    try {
      count = r.u16(offset);
    } catch {
      warnings.push(`IFD ${name} fora dos limites.`);
      return { entries: [], next: 0 };
    }
    if (count > 1000) {
      warnings.push(`IFD ${name} com ${count} entradas; ignorado.`);
      return { entries: [], next: 0 };
    }
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      try {
        const tag = r.u16(e);
        const type = r.u16(e + 2);
        const cnt = r.u32(e + 4);
        const size = (TYPE_SIZE[type] ?? 0) * cnt;
        if (!TYPE_SIZE[type]) {
          warnings.push(`Campo 0x${tag.toString(16)} com tipo desconhecido ${type}; ignorado.`);
          continue;
        }
        if (size > 4 * 1024 * 1024) {
          warnings.push(`Campo 0x${tag.toString(16)} grande demais; ignorado.`);
          continue;
        }
        let value: Buffer;
        if (size <= 4) value = Buffer.from(buf.subarray(e + 8, e + 8 + size));
        else {
          const vo = r.u32(e + 8);
          if (vo + size > buf.length) {
            warnings.push(`Campo 0x${tag.toString(16)} aponta para fora do bloco; ignorado.`);
            continue;
          }
          value = Buffer.from(buf.subarray(vo, vo + size));
        }
        entries.push({ tag, type, count: cnt, value });
      } catch {
        warnings.push(`Entrada ${i} do IFD ${name} ilegível.`);
      }
    }
    let next = 0;
    try {
      next = r.u32(offset + 2 + count * 12);
    } catch {
      next = 0;
    }
    return { entries, next };
  };

  const pointer = (entries: TiffEntry[], tag: number): number => {
    const e = entries.find((x) => x.tag === tag);
    if (!e || e.value.length < 4) return 0;
    return order === 'LE' ? e.value.readUInt32LE(0) : e.value.readUInt32BE(0);
  };

  const ifd0 = readIfd(r.u32(4), 'IFD0');
  const exif = readIfd(pointer(ifd0.entries, TAG_EXIF_IFD), 'EXIF');
  const gps = readIfd(pointer(ifd0.entries, TAG_GPS_IFD), 'GPS');
  const interop = readIfd(pointer(exif.entries, TAG_INTEROP_IFD), 'Interop');
  const ifd1 = readIfd(ifd0.next, 'IFD1');

  let thumbnail: Buffer | null = null;
  const tOff = pointer(ifd1.entries, 0x0201);
  const tLen = pointer(ifd1.entries, 0x0202);
  if (tOff && tLen && tOff + tLen <= buf.length) thumbnail = Buffer.from(buf.subarray(tOff, tOff + tLen));

  const strip = (list: TiffEntry[]) => list.filter((e) => !POINTER_TAGS.has(e.tag));
  return {
    order,
    ifd0: strip(ifd0.entries),
    exif: strip(exif.entries),
    gps: gps.entries,
    interop: interop.entries,
    ifd1: ifd1.entries,
    thumbnail,
    warnings,
  };
}

/** Converte o valor bruto em texto legível. */
export function decodeEntry(e: TiffEntry, order: ByteOrder): string {
  const le = order === 'LE';
  const nums = (size: number, read: (o: number) => number) => {
    const out: number[] = [];
    for (let i = 0; i < e.count && i < 64; i++) out.push(read(i * size));
    return out;
  };
  switch (e.type) {
    case 2:
      return e.value.toString('utf8').replace(/\0+$/g, '').replace(/\0/g, ' ').trim();
    case 3:
      return nums(2, (o) => (le ? e.value.readUInt16LE(o) : e.value.readUInt16BE(o))).join(', ');
    case 8:
      return nums(2, (o) => (le ? e.value.readInt16LE(o) : e.value.readInt16BE(o))).join(', ');
    case 4:
    case 13:
      return nums(4, (o) => (le ? e.value.readUInt32LE(o) : e.value.readUInt32BE(o))).join(', ');
    case 9:
      return nums(4, (o) => (le ? e.value.readInt32LE(o) : e.value.readInt32BE(o))).join(', ');
    case 5:
    case 10: {
      const signed = e.type === 10;
      const parts: string[] = [];
      for (let i = 0; i < e.count && i < 16; i++) {
        const o = i * 8;
        const n = signed ? (le ? e.value.readInt32LE(o) : e.value.readInt32BE(o)) : le ? e.value.readUInt32LE(o) : e.value.readUInt32BE(o);
        const d = signed ? (le ? e.value.readInt32LE(o + 4) : e.value.readInt32BE(o + 4)) : le ? e.value.readUInt32LE(o + 4) : e.value.readUInt32BE(o + 4);
        parts.push(d === 0 ? String(n) : String(Math.round((n / d) * 1e6) / 1e6));
      }
      return parts.join(', ');
    }
    case 11:
      return nums(4, (o) => (le ? e.value.readFloatLE(o) : e.value.readFloatBE(o))).join(', ');
    case 12:
      return nums(8, (o) => (le ? e.value.readDoubleLE(o) : e.value.readDoubleBE(o))).join(', ');
    default: {
      // BYTE / SBYTE / UNDEFINED
      if (e.tag === 0x9286 && e.value.length >= 8) {
        const charset = e.value.toString('latin1', 0, 8).replace(/\0+$/, '');
        const body = e.value.subarray(8);
        const text = charset.startsWith('UNICODE') ? body.toString('utf16le') : body.toString('utf8');
        return text.replace(/\0/g, '').trim();
      }
      if (e.tag >= 0x9c9b && e.tag <= 0x9c9f) return e.value.toString('utf16le').replace(/\0/g, '').trim();
      const printable = e.value.length <= 64 && /^[\x20-\x7E\0]*$/.test(e.value.toString('latin1'));
      if (printable) return e.value.toString('latin1').replace(/\0/g, '').trim();
      return `<${e.value.length} bytes>`;
    }
  }
}

export function orientationOf(t: TiffData): number | null {
  const e = t.ifd0.find((x) => x.tag === TAG_ORIENTATION);
  if (!e || e.value.length < 2) return null;
  const v = t.order === 'LE' ? e.value.readUInt16LE(0) : e.value.readUInt16BE(0);
  return v >= 1 && v <= 8 ? v : null;
}

/** Escreve uma estrutura TIFF com IFD0/EXIF/GPS/Interop (sem IFD1/miniatura). */
export function buildTiff(input: { order: ByteOrder; ifd0: TiffEntry[]; exif?: TiffEntry[]; gps?: TiffEntry[]; interop?: TiffEntry[] }): Buffer {
  const order = input.order;
  const le = order === 'LE';
  const sortEntries = (l: TiffEntry[]) => [...l].filter((e) => !POINTER_TAGS.has(e.tag)).sort((a, b) => a.tag - b.tag);
  const interop = sortEntries(input.interop ?? []);
  const exifBase = sortEntries(input.exif ?? []);
  const gps = sortEntries(input.gps ?? []);
  const ifd0Base = sortEntries(input.ifd0);

  const placeholder = (tag: number): TiffEntry => ({ tag, type: 4, count: 1, value: Buffer.alloc(4) });
  const exif = interop.length ? [...exifBase, placeholder(TAG_INTEROP_IFD)].sort((a, b) => a.tag - b.tag) : exifBase;
  const ifd0Entries = [...ifd0Base];
  if (exif.length) ifd0Entries.push(placeholder(TAG_EXIF_IFD));
  if (gps.length) ifd0Entries.push(placeholder(TAG_GPS_IFD));
  ifd0Entries.sort((a, b) => a.tag - b.tag);

  type Block = { name: string; entries: TiffEntry[]; offset: number; dataSize: number };
  const blocks: Block[] = [
    { name: 'ifd0', entries: ifd0Entries, offset: 0, dataSize: 0 },
    ...(exif.length ? [{ name: 'exif', entries: exif, offset: 0, dataSize: 0 }] : []),
    ...(interop.length ? [{ name: 'interop', entries: interop, offset: 0, dataSize: 0 }] : []),
    ...(gps.length ? [{ name: 'gps', entries: gps, offset: 0, dataSize: 0 }] : []),
  ];
  const even = (n: number) => n + (n % 2);
  let cursor = 8;
  for (const b of blocks) {
    b.offset = cursor;
    b.dataSize = b.entries.reduce((s, e) => s + (e.value.length > 4 ? even(e.value.length) : 0), 0);
    cursor = even(cursor + 2 + b.entries.length * 12 + 4 + b.dataSize);
  }
  const out = Buffer.alloc(cursor);
  const w16 = (o: number, v: number) => (le ? out.writeUInt16LE(v, o) : out.writeUInt16BE(v, o));
  const w32 = (o: number, v: number) => (le ? out.writeUInt32LE(v >>> 0, o) : out.writeUInt32BE(v >>> 0, o));
  out.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(2, 42);
  w32(4, 8);

  const offsetOf = (name: string) => blocks.find((b) => b.name === name)?.offset ?? 0;
  for (const b of blocks) {
    w16(b.offset, b.entries.length);
    let data = b.offset + 2 + b.entries.length * 12 + 4;
    b.entries.forEach((e, i) => {
      const eo = b.offset + 2 + i * 12;
      w16(eo, e.tag);
      if (POINTER_TAGS.has(e.tag)) {
        w16(eo + 2, 4);
        w32(eo + 4, 1);
        const target = e.tag === TAG_EXIF_IFD ? 'exif' : e.tag === TAG_GPS_IFD ? 'gps' : 'interop';
        w32(eo + 8, offsetOf(target));
        return;
      }
      w16(eo + 2, e.type);
      w32(eo + 4, e.count);
      if (e.value.length <= 4) e.value.copy(out, eo + 8);
      else {
        w32(eo + 8, data);
        e.value.copy(out, data);
        data = even(data + e.value.length);
      }
    });
    w32(b.offset + 2 + b.entries.length * 12, 0);
  }
  return out;
}

// ── Construtores de entradas (usados na escrita e nos testes) ───────────────

export function asciiEntry(tag: number, text: string): TiffEntry {
  const value = Buffer.from(text + '\0', 'utf8');
  return { tag, type: 2, count: value.length, value };
}

export function shortEntry(tag: number, values: number[] | number, order: ByteOrder): TiffEntry {
  const list = Array.isArray(values) ? values : [values];
  const value = Buffer.alloc(list.length * 2);
  list.forEach((v, i) => (order === 'LE' ? value.writeUInt16LE(v, i * 2) : value.writeUInt16BE(v, i * 2)));
  return { tag, type: 3, count: list.length, value };
}

export function longEntry(tag: number, values: number[] | number, order: ByteOrder): TiffEntry {
  const list = Array.isArray(values) ? values : [values];
  const value = Buffer.alloc(list.length * 4);
  list.forEach((v, i) => (order === 'LE' ? value.writeUInt32LE(v, i * 4) : value.writeUInt32BE(v, i * 4)));
  return { tag, type: 4, count: list.length, value };
}

export function rationalEntry(tag: number, values: Array<[number, number]>, order: ByteOrder): TiffEntry {
  const value = Buffer.alloc(values.length * 8);
  values.forEach(([n, d], i) => {
    if (order === 'LE') {
      value.writeUInt32LE(n, i * 8);
      value.writeUInt32LE(d, i * 8 + 4);
    } else {
      value.writeUInt32BE(n, i * 8);
      value.writeUInt32BE(d, i * 8 + 4);
    }
  });
  return { tag, type: 5, count: values.length, value };
}

export function byteEntry(tag: number, bytes: number[]): TiffEntry {
  return { tag, type: 1, count: bytes.length, value: Buffer.from(bytes) };
}

export function undefinedEntry(tag: number, data: Buffer): TiffEntry {
  return { tag, type: 7, count: data.length, value: Buffer.from(data) };
}

/** EXIF mínimo contendo só a orientação. */
export function orientationOnlyTiff(orientation: number, order: ByteOrder = 'BE'): Buffer {
  return buildTiff({ order, ifd0: [shortEntry(TAG_ORIENTATION, orientation, order)] });
}
