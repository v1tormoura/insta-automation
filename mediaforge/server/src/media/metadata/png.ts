import zlib from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngChunk {
  type: string;
  data: Buffer;
  start: number;
  end: number;
}

export interface PngStructure {
  chunks: PngChunk[];
  trailing: Buffer;
}

export class PngParseError extends Error {}

/** Chunks que descrevem a imagem em si e nunca são removidos. */
export const PNG_IMAGE_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'pHYs', 'bKGD', 'hIST', 'sPLT',
  'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLi',
]);

export function parsePng(buf: Buffer): PngStructure {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new PngParseError('Não é PNG');
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngParseError('Tipo de chunk inválido');
    const end = pos + 12 + len;
    if (end > buf.length) throw new PngParseError(`Chunk ${type} truncado`);
    chunks.push({ type, data: buf.subarray(pos + 8, pos + 8 + len), start: pos, end });
    pos = end;
    if (type === 'IEND') break;
  }
  if (chunks.at(-1)?.type !== 'IEND') throw new PngParseError('PNG sem IEND');
  return { chunks, trailing: buf.subarray(pos) };
}

export function chunkBytes(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(Buffer.from(type, 'latin1'))) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const inflateLimited = (data: Buffer) => zlib.inflateSync(data, { maxOutputLength: 8 * 1024 * 1024 });

export interface PngText {
  type: 'tEXt' | 'zTXt' | 'iTXt';
  keyword: string;
  text: string;
}

export function decodeTextChunk(c: PngChunk): PngText | null {
  try {
    const nul = c.data.indexOf(0);
    if (nul <= 0) return null;
    const keyword = c.data.toString('latin1', 0, nul);
    if (c.type === 'tEXt') return { type: 'tEXt', keyword, text: c.data.toString('latin1', nul + 1) };
    if (c.type === 'zTXt') return { type: 'zTXt', keyword, text: inflateLimited(c.data.subarray(nul + 2)).toString('latin1') };
    if (c.type === 'iTXt') {
      const compressed = c.data[nul + 1] === 1;
      let p = nul + 3;
      const langEnd = c.data.indexOf(0, p);
      p = langEnd + 1;
      const transEnd = c.data.indexOf(0, p);
      const body = c.data.subarray(transEnd + 1);
      return { type: 'iTXt', keyword, text: (compressed ? inflateLimited(body) : body).toString('utf8') };
    }
  } catch {
    return null;
  }
  return null;
}

export function decodeIccp(c: PngChunk): Buffer | null {
  try {
    const nul = c.data.indexOf(0);
    return inflateLimited(c.data.subarray(nul + 2));
  } catch {
    return null;
  }
}

export function iccpChunk(icc: Buffer, name = 'ICC Profile'): Buffer {
  return chunkBytes('iCCP', Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(icc)]));
}

export function textChunk(keyword: string, text: string): Buffer {
  return chunkBytes('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]));
}

/** Reconstrói o PNG mantendo os chunks aprovados e inserindo novos depois do IHDR. */
export function rebuildPng(buf: Buffer, s: PngStructure, keep: (c: PngChunk) => boolean, insertAfterIhdr: Buffer[] = []): Buffer {
  const parts: Buffer[] = [PNG_SIGNATURE];
  for (const c of s.chunks) {
    if (c.type === 'IHDR') {
      parts.push(buf.subarray(c.start, c.end), ...insertAfterIhdr);
      continue;
    }
    if (PNG_IMAGE_CHUNKS.has(c.type) || keep(c)) parts.push(buf.subarray(c.start, c.end));
  }
  return Buffer.concat(parts);
}
