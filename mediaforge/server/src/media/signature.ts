import fsp from 'node:fs/promises';

export type SniffFamily = 'video' | 'image' | 'audio' | 'subtitle';

export interface SniffResult {
  /** Formato detectado pelo conteúdo (não pela extensão). */
  format: string;
  family: SniffFamily;
  /** Extensão canônica usada para armazenar o arquivo. */
  ext: string;
  label: string;
}

export interface SniffRejection {
  rejected: true;
  reason: string;
}

const ascii = (b: Buffer, start: number, len: number) => b.subarray(start, start + len).toString('latin1');

/**
 * Identifica o tipo real do arquivo pelos primeiros bytes. A extensão enviada
 * pelo usuário é ignorada para decidir o tipo; ela só aparece no nome exibido.
 */
export function sniffBuffer(b: Buffer): SniffResult | SniffRejection | null {
  if (b.length < 4) return { rejected: true, reason: 'Arquivo vazio ou pequeno demais para ser uma mídia.' };

  // Conteúdos explicitamente recusados
  if (ascii(b, 0, 2) === 'MZ') return { rejected: true, reason: 'Arquivo executável (Windows) não é mídia.' };
  if (b[0] === 0x7f && ascii(b, 1, 3) === 'ELF') return { rejected: true, reason: 'Arquivo executável (ELF) não é mídia.' };
  if (ascii(b, 0, 2) === '#!') return { rejected: true, reason: 'Script não é mídia.' };
  if (ascii(b, 0, 4) === 'PK\x03\x04') return { rejected: true, reason: 'Arquivo compactado (ZIP/Office) não é mídia.' };
  if (ascii(b, 0, 4) === '%PDF') return { rejected: true, reason: 'Documento PDF não é mídia.' };

  // Imagens
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: 'jpeg', family: 'image', ext: 'jpg', label: 'JPEG' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { format: 'png', family: 'image', ext: 'png', label: 'PNG' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { format: 'webp', family: 'image', ext: 'webp', label: 'WEBP' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { format: 'gif', family: 'image', ext: 'gif', label: 'GIF' };
  if (ascii(b, 0, 2) === 'BM' && b.length >= 26) return { format: 'bmp', family: 'image', ext: 'bmp', label: 'BMP' };
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return { format: 'tiff', family: 'image', ext: 'tif', label: 'TIFF' };

  // ISO Base Media (MP4/MOV/M4A/HEIF)
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'qt  ') return { format: 'mov', family: 'video', ext: 'mov', label: 'QuickTime MOV' };
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(brand))
      return { format: 'heif', family: 'image', ext: brand.startsWith('avi') ? 'avif' : 'heic', label: 'HEIF/AVIF' };
    if (brand === 'M4A ' || brand === 'M4B ') return { format: 'm4a', family: 'audio', ext: 'm4a', label: 'M4A' };
    if (brand.startsWith('3g')) return { format: '3gp', family: 'video', ext: '3gp', label: '3GP' };
    return { format: 'mp4', family: 'video', ext: 'mp4', label: 'MP4' };
  }
  if (b.length >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(b, 4, 4)))
    return { format: 'mov', family: 'video', ext: 'mov', label: 'QuickTime MOV' };

  // Matroska / WebM
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const isWebm = b.subarray(0, 64).includes(Buffer.from('webm'));
    return isWebm
      ? { format: 'webm', family: 'video', ext: 'webm', label: 'WebM' }
      : { format: 'mkv', family: 'video', ext: 'mkv', label: 'Matroska' };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ') return { format: 'avi', family: 'video', ext: 'avi', label: 'AVI' };
  if (ascii(b, 0, 3) === 'FLV') return { format: 'flv', family: 'video', ext: 'flv', label: 'FLV' };
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0xba)
    return { format: 'mpeg', family: 'video', ext: 'mpg', label: 'MPEG-PS' };
  if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return { format: 'mpegts', family: 'video', ext: 'ts', label: 'MPEG-TS' };

  // Áudio
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { format: 'wav', family: 'audio', ext: 'wav', label: 'WAV' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0))
    return { format: 'mp3', family: 'audio', ext: 'mp3', label: 'MP3' };
  if (ascii(b, 0, 4) === 'OggS') return { format: 'ogg', family: 'audio', ext: 'ogg', label: 'Ogg' };
  if (ascii(b, 0, 4) === 'fLaC') return { format: 'flac', family: 'audio', ext: 'flac', label: 'FLAC' };
  if (b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9)) return { format: 'aac', family: 'audio', ext: 'aac', label: 'AAC' };

  // Legendas SRT (texto)
  const text = b.toString('utf8').replace(/^﻿/, '');
  if (/^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(text))
    return { format: 'srt', family: 'subtitle', ext: 'srt', label: 'SubRip SRT' };

  return null;
}

export async function sniffFile(file: string): Promise<SniffResult | SniffRejection | null> {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return sniffBuffer(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

export function isRejection(r: SniffResult | SniffRejection | null): r is SniffRejection {
  return !!r && 'rejected' in r;
}
