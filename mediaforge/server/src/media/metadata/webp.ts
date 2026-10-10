export interface WebpChunk {
  fourcc: string;
  data: Buffer;
}

export class WebpParseError extends Error {}

export const WEBP_IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);

export function parseWebp(buf: Buffer): WebpChunk[] {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP')
    throw new WebpParseError('Não é WEBP');
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const chunks: WebpChunk[] = [];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (pos + 8 + size > riffEnd) throw new WebpParseError(`Chunk ${fourcc} truncado`);
    chunks.push({ fourcc, data: buf.subarray(pos + 8, pos + 8 + size) });
    pos += 8 + size + (size % 2);
  }
  return chunks;
}

/** Remove "Exif\0\0" opcional antes do TIFF. */
export function webpExifTiff(data: Buffer): Buffer {
  return data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? data.subarray(6) : data;
}

/**
 * Reconstrói o WEBP com os chunks mantidos e ajusta as flags do VP8X
 * (ICC 0x20, EXIF 0x08, XMP 0x04) e o tamanho do RIFF.
 */
export function rebuildWebp(chunks: WebpChunk[], keep: (c: WebpChunk) => boolean): Buffer {
  const kept = chunks.filter((c) => WEBP_IMAGE_CHUNKS.has(c.fourcc) || keep(c));
  const has = (f: string) => kept.some((c) => c.fourcc === f);
  const parts: Buffer[] = [];
  for (const c of kept) {
    let data = c.data;
    if (c.fourcc === 'VP8X' && data.length >= 1) {
      data = Buffer.from(data);
      let flags = data[0]!;
      flags = has('ICCP') ? flags | 0x20 : flags & ~0x20;
      flags = has('EXIF') ? flags | 0x08 : flags & ~0x08;
      flags = has('XMP ') ? flags | 0x04 : flags & ~0x04;
      data[0] = flags;
    }
    const head = Buffer.alloc(8);
    head.write(c.fourcc, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    parts.push(head, data);
    if (data.length % 2) parts.push(Buffer.from([0]));
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}
