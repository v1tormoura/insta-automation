/**
 * Estrutura de JPEG: segmentos de marcador + dados entrópicos. Permite remover
 * segmentos de metadados (APPn/COM) e dados após o EOI sem tocar nos dados
 * comprimidos da imagem — ou seja, limpeza sem perda de qualidade.
 */

export type JpegItem =
  | { kind: 'segment'; marker: number; start: number; end: number; payload: Buffer }
  | { kind: 'standalone'; marker: number; start: number; end: number }
  | { kind: 'entropy'; start: number; end: number };

export interface JpegStructure {
  items: JpegItem[];
  /** Fim do marcador EOI (bytes depois disso são "dados extras"). */
  eoiEnd: number;
  trailing: Buffer;
}

export class JpegParseError extends Error {}

export function parseJpeg(buf: Buffer): JpegStructure {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new JpegParseError('Não é JPEG');
  const items: JpegItem[] = [{ kind: 'standalone', marker: 0xd8, start: 0, end: 2 }];
  let pos = 2;
  let eoiEnd = -1;
  let guard = 0;
  while (pos < buf.length && guard++ < 100_000) {
    if (buf[pos] !== 0xff) throw new JpegParseError(`Marcador esperado na posição ${pos}`);
    while (buf[pos + 1] === 0xff) pos++; // bytes de preenchimento
    const marker = buf[pos + 1];
    if (marker === undefined) break;
    if (marker === 0xd9) {
      items.push({ kind: 'standalone', marker, start: pos, end: pos + 2 });
      eoiEnd = pos + 2;
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      items.push({ kind: 'standalone', marker, start: pos, end: pos + 2 });
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) throw new JpegParseError('Segmento truncado');
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) throw new JpegParseError('Tamanho de segmento inválido');
    items.push({ kind: 'segment', marker, start: pos, end: pos + 2 + len, payload: buf.subarray(pos + 4, pos + 2 + len) });
    pos += 2 + len;
    if (marker === 0xda) {
      // Dados entrópicos até o próximo marcador real (FF seguido de algo que não seja 00/RSTn/FF).
      let p = pos;
      while (true) {
        const idx = buf.indexOf(0xff, p);
        if (idx < 0 || idx + 1 >= buf.length) throw new JpegParseError('Dados da imagem sem EOI');
        const n = buf[idx + 1]!;
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) {
          p = idx + 1;
          continue;
        }
        items.push({ kind: 'entropy', start: pos, end: idx });
        pos = idx;
        break;
      }
    }
  }
  if (eoiEnd < 0) throw new JpegParseError('JPEG sem marcador de fim (EOI)');
  return { items, eoiEnd, trailing: buf.subarray(eoiEnd) };
}

export const JPEG_SIGNATURES = {
  exif: Buffer.from('Exif\0\0', 'latin1'),
  xmp: Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
  xmpExt: Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1'),
  icc: Buffer.from('ICC_PROFILE\0', 'latin1'),
  photoshop: Buffer.from('Photoshop 3.0\0', 'latin1'),
  jfif: Buffer.from('JFIF\0', 'latin1'),
  jfxx: Buffer.from('JFXX\0', 'latin1'),
  adobe: Buffer.from('Adobe', 'latin1'),
  mpf: Buffer.from('MPF\0', 'latin1'),
};

export type JpegSegmentType =
  | 'jfif'
  | 'jfxx'
  | 'exif'
  | 'xmp'
  | 'xmp-ext'
  | 'icc'
  | 'photoshop'
  | 'adobe'
  | 'mpf'
  | 'comment'
  | 'app-other'
  | 'image';

export function segmentType(item: JpegItem): JpegSegmentType {
  if (item.kind !== 'segment') return 'image';
  const { marker, payload } = item;
  const starts = (sig: Buffer) => payload.subarray(0, sig.length).equals(sig);
  if (marker === 0xfe) return 'comment';
  if (marker === 0xe0) return starts(JPEG_SIGNATURES.jfif) ? 'jfif' : starts(JPEG_SIGNATURES.jfxx) ? 'jfxx' : 'app-other';
  if (marker === 0xe1) {
    if (starts(JPEG_SIGNATURES.exif)) return 'exif';
    if (starts(JPEG_SIGNATURES.xmp)) return 'xmp';
    if (starts(JPEG_SIGNATURES.xmpExt)) return 'xmp-ext';
    return 'app-other';
  }
  if (marker === 0xe2) return starts(JPEG_SIGNATURES.icc) ? 'icc' : starts(JPEG_SIGNATURES.mpf) ? 'mpf' : 'app-other';
  if (marker === 0xed) return starts(JPEG_SIGNATURES.photoshop) ? 'photoshop' : 'app-other';
  if (marker === 0xee) return starts(JPEG_SIGNATURES.adobe) ? 'adobe' : 'app-other';
  if (marker >= 0xe0 && marker <= 0xef) return 'app-other';
  return 'image';
}

/** Reagrupa um perfil ICC dividido em vários segmentos APP2. */
export function assembleIcc(segments: Buffer[]): Buffer | null {
  if (segments.length === 0) return null;
  const parts = segments
    .filter((p) => p.length > 14)
    .map((p) => ({ seq: p[12]!, data: p.subarray(14) }))
    .sort((a, b) => a.seq - b.seq);
  return parts.length ? Buffer.concat(parts.map((p) => p.data)) : null;
}

export function segmentBytes(marker: number, payload: Buffer): Buffer {
  if (payload.length + 2 > 0xffff) throw new JpegParseError('Segmento grande demais para JPEG');
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export function exifSegment(tiff: Buffer): Buffer {
  return segmentBytes(0xe1, Buffer.concat([JPEG_SIGNATURES.exif, tiff]));
}

/** Divide um perfil ICC em segmentos APP2 (limite de 65519 bytes de dados por segmento). */
export function iccSegments(icc: Buffer): Buffer[] {
  const max = 65_519;
  const count = Math.ceil(icc.length / max);
  if (count > 255) return [];
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = icc.subarray(i * max, (i + 1) * max);
    out.push(segmentBytes(0xe2, Buffer.concat([JPEG_SIGNATURES.icc, Buffer.from([i + 1, count]), chunk])));
  }
  return out;
}

/**
 * Reconstrói o JPEG mantendo apenas os segmentos aprovados por `keep`.
 * `insertAfterApp0` é inserido logo depois do JFIF (ou do SOI).
 */
export function rebuildJpeg(
  buf: Buffer,
  s: JpegStructure,
  keep: (item: JpegItem, type: JpegSegmentType) => boolean,
  insertAfterApp0: Buffer[] = [],
  keepTrailing = false,
): Buffer {
  const parts: Buffer[] = [];
  let inserted = insertAfterApp0.length === 0;
  for (const item of s.items) {
    const type = segmentType(item);
    if (!inserted && item.kind !== 'standalone' && type !== 'jfif') {
      parts.push(...insertAfterApp0);
      inserted = true;
    }
    if (item.kind === 'standalone' || item.kind === 'entropy' || keep(item, type)) {
      parts.push(buf.subarray(item.start, item.end));
    }
  }
  if (!inserted) parts.splice(parts.length - 1, 0, ...insertAfterApp0);
  if (keepTrailing && s.trailing.length) parts.push(s.trailing);
  return Buffer.concat(parts);
}
