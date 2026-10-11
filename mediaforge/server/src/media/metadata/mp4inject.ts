import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { scanMp4Boxes, type Mp4Box } from './mp4boxes';

/** O moov (e o que vem depois dele) é lido para a memória: limite de segurança. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

const headerSizeOf = (buf: Buffer, at: number) => (buf.readUInt32BE(at) === 1 ? 16 : 8);

/**
 * Reinsere em moov/udta da saída caixas de udta da entrada que o usuário
 * mandou manter e que o FFmpeg não regrava ao remultiplexar (ex.: "loci",
 * localização 3GPP). As caixas são copiadas byte a byte.
 *
 * Com o moov depois do mdat, só o fim do arquivo é reescrito. Com o moov antes
 * do mdat (+faststart), os deslocamentos de amostra (stco/co64) são somados ao
 * tamanho inserido e o arquivo é regravado. Em qualquer situação não suportada,
 * nada é tocado e o motivo volta em `warnings`.
 */
export async function reinjectUdtaBoxes(
  inputPath: string,
  outputPath: string,
  types: string[],
): Promise<{ inserted: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (types.length === 0) return { inserted: [], warnings };
  const src = await scanMp4Boxes(inputPath);
  const wanted = src.boxes.filter((b) => b.path === `moov/udta/${b.type}` && types.includes(b.type));
  if (wanted.length === 0) return { inserted: [], warnings };

  const out = await scanMp4Boxes(outputPath);
  const top = out.boxes.filter((b) => !b.path.includes('/'));
  const moov = top.find((b) => b.type === 'moov');
  const mdat = top.find((b) => b.type === 'mdat');
  if (!moov || !mdat) {
    warnings.push('Caixas de udta mantidas por escolha não foram reinseridas: estrutura MP4 da saída não reconhecida.');
    return { inserted: [], warnings };
  }
  if (moov.size > MAX_MOOV_BYTES) {
    warnings.push('Caixas de udta mantidas por escolha não foram reinseridas: índice (moov) grande demais.');
    return { inserted: [], warnings };
  }

  const present = new Set(out.boxes.filter((b) => b.path.startsWith('moov/udta/')).map((b) => b.type));
  const toInsert = wanted.filter((b) => !present.has(b.type));
  if (toInsert.length === 0) return { inserted: [], warnings };

  const readRange = async (file: string, start: number, size: number) => {
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, start);
      return buf;
    } finally {
      await fh.close();
    }
  };
  const payload = Buffer.concat(await Promise.all(toInsert.map((b: Mp4Box) => readRange(inputPath, b.start, b.size))));
  const moovBuf = await readRange(outputPath, moov.start, moov.size);
  if (headerSizeOf(moovBuf, 0) !== 8) {
    warnings.push('Caixas de udta mantidas por escolha não foram reinseridas: índice (moov) com tamanho de 64 bits.');
    return { inserted: [], warnings };
  }

  const moovFirst = moov.start < mdat.start;
  if (moovFirst) {
    // Os dados vão andar `payload.length` bytes: corrige cada deslocamento de amostra.
    const delta = payload.length;
    for (const b of out.boxes.filter((x) => x.path.startsWith('moov/') && (x.type === 'stco' || x.type === 'co64'))) {
      const rel = b.start - moov.start;
      if (headerSizeOf(moovBuf, rel) !== 8) return fail('tabela de deslocamentos com tamanho de 64 bits');
      const count = moovBuf.readUInt32BE(rel + 12);
      const width = b.type === 'stco' ? 4 : 8;
      if (16 + count * width > b.size) return fail('tabela de deslocamentos inconsistente');
      for (let i = 0; i < count; i++) {
        const at = rel + 16 + i * width;
        if (width === 4) {
          const v = moovBuf.readUInt32BE(at) + delta;
          if (v > 0xffffffff) return fail('deslocamento acima de 4 GB numa tabela de 32 bits');
          moovBuf.writeUInt32BE(v, at);
        } else moovBuf.writeBigUInt64BE(moovBuf.readBigUInt64BE(at) + BigInt(delta), at);
      }
    }
  }

  const udta = out.boxes.find((b) => b.path === 'moov/udta');
  let newMoov: Buffer;
  if (udta) {
    const rel = udta.start - moov.start;
    if (headerSizeOf(moovBuf, rel) !== 8) return fail('udta com tamanho de 64 bits');
    const udtaBuf = moovBuf.subarray(rel, rel + udta.size);
    // Em QuickTime, udta pode terminar com 4 bytes zerados; as caixas novas entram antes deles.
    const hasTerminator = udta.size >= 12 && udtaBuf.readUInt32BE(udta.size - 4) === 0;
    const body = hasTerminator ? udtaBuf.subarray(8, udta.size - 4) : udtaBuf.subarray(8);
    const newUdta = Buffer.concat([udtaBuf.subarray(0, 8), body, payload, hasTerminator ? Buffer.alloc(4) : Buffer.alloc(0)]);
    newUdta.writeUInt32BE(newUdta.length, 0);
    newMoov = Buffer.concat([moovBuf.subarray(0, rel), newUdta, moovBuf.subarray(rel + udta.size)]);
  } else {
    const newUdta = Buffer.concat([Buffer.alloc(8), payload]);
    newUdta.writeUInt32BE(newUdta.length, 0);
    newUdta.write('udta', 4, 'latin1');
    newMoov = Buffer.concat([moovBuf, newUdta]);
  }
  newMoov.writeUInt32BE(newMoov.length, 0);

  const moovEnd = moov.start + moov.size;
  if (!moovFirst) {
    // Índice no fim: reescreve só a partir do moov.
    const stat = await fsp.stat(outputPath);
    const after = await readRange(outputPath, moovEnd, stat.size - moovEnd);
    const fh = await fsp.open(outputPath, 'r+');
    try {
      await fh.truncate(moov.start);
      const tail = Buffer.concat([newMoov, after]);
      await fh.write(tail, 0, tail.length, moov.start);
    } finally {
      await fh.close();
    }
  } else {
    // Índice no início: regrava o arquivo (cabeçalho, novo moov, dados).
    const tmp = `${outputPath}.udta`;
    const w = fs.createWriteStream(tmp, { flags: 'wx' });
    try {
      if (moov.start > 0) w.write(await readRange(outputPath, 0, moov.start));
      w.write(newMoov);
      await pipeline(fs.createReadStream(outputPath, { start: moovEnd }), w);
      await fsp.rename(tmp, outputPath);
    } catch (err) {
      w.destroy();
      await fsp.rm(tmp, { force: true });
      throw err;
    }
  }
  return { inserted: toInsert.map((b) => b.type), warnings };

  function fail(reason: string) {
    warnings.push(`Caixas de udta mantidas por escolha não foram reinseridas: ${reason}.`);
    return { inserted: [] as string[], warnings };
  }
}
