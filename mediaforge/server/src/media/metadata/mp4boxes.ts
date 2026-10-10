import fsp from 'node:fs/promises';

export interface Mp4Box {
  type: string;
  path: string;
  start: number;
  size: number;
  /** Conteúdo textual curto (quando legível), para exibição. */
  preview: string | null;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'udta', 'meta', 'edts', 'dinf', 'stbl']);
const KNOWN_TOP = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'moof', 'mfra', 'sidx', 'styp', 'emsg', 'prft', 'meta', 'udta', 'uuid', 'pdin']);

export const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';

/**
 * Percorre a árvore de caixas de MP4/MOV (sem ler o mdat) para achar
 * estruturas que o ffprobe não expõe como tags: caixas uuid (XMP, dados de
 * fabricante), filhos proprietários de udta (GoPro, Samsung…) e caixas
 * desconhecidas no nível superior.
 */
export async function scanMp4Boxes(file: string, maxBoxes = 4000): Promise<{ boxes: Mp4Box[]; warnings: string[] }> {
  const fh = await fsp.open(file, 'r');
  const boxes: Mp4Box[] = [];
  const warnings: string[] = [];
  try {
    const { size: fileSize } = await fh.stat();
    const header = Buffer.alloc(16);

    const walk = async (start: number, end: number, parent: string, depth: number) => {
      let pos = start;
      while (pos + 8 <= end && boxes.length < maxBoxes) {
        await fh.read(header, 0, 16, pos);
        let size = header.readUInt32BE(0);
        const type = header.toString('latin1', 4, 8);
        let headerSize = 8;
        if (size === 1) {
          const big = header.readBigUInt64BE(8);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
          size = Number(big);
          headerSize = 16;
        } else if (size === 0) size = end - pos;
        if (size < headerSize || pos + size > end) {
          if (depth === 0 && pos + size > end) warnings.push(`Caixa ${JSON.stringify(type)} ultrapassa o fim do arquivo.`);
          break;
        }
        if (!/^[\x20-\x7E\xA9]{4}$/.test(type)) break;
        const path = parent ? `${parent}/${type}` : type;
        let preview: string | null = null;
        const payloadSize = size - headerSize;
        if (type !== 'mdat' && payloadSize > 0 && payloadSize <= 512 && (parent.endsWith('udta') || depth === 0)) {
          const buf = Buffer.alloc(payloadSize);
          await fh.read(buf, 0, payloadSize, pos + headerSize);
          const text = buf.toString('latin1').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length >= 3) preview = text.slice(0, 120);
        }
        if (type === 'uuid') {
          const u = Buffer.alloc(16);
          await fh.read(u, 0, 16, pos + headerSize);
          preview = u.toString('hex');
        }
        boxes.push({ type, path, start: pos, size, preview });
        if (CONTAINERS.has(type) && depth < 8) {
          const inner = pos + headerSize + (type === 'meta' && (await isFullBoxMeta(fh, pos + headerSize)) ? 4 : 0);
          await walk(inner, pos + size, path, depth + 1);
        }
        pos += size;
      }
    };
    await walk(0, fileSize, '', 0);
  } finally {
    await fh.close();
  }
  return { boxes, warnings };
}

/** Em MP4, "meta" é FullBox (4 bytes de versão/flags); em QuickTime, não. */
async function isFullBoxMeta(fh: fsp.FileHandle, payloadStart: number): Promise<boolean> {
  const b = Buffer.alloc(12);
  await fh.read(b, 0, 12, payloadStart);
  const nextType = b.toString('latin1', 4, 8);
  return !/^(hdlr|keys|ilst|mhdr|xml |iinf|pitm|iloc)$/.test(nextType) || b.readUInt32BE(0) === 0;
}

export function isKnownTopLevel(type: string): boolean {
  return KNOWN_TOP.has(type);
}
