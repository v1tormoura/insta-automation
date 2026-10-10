import { createHash } from 'node:crypto';
import fs from 'node:fs';

export interface HashScanResult {
  sha256: string;
  size: number;
  /** Índices dos padrões encontrados nos bytes do arquivo. */
  found: Set<number>;
}

/**
 * Calcula o SHA-256 do arquivo em streaming e, na mesma leitura, procura
 * padrões de bytes (usado para confirmar que valores de metadados removidos
 * não sobraram em nenhuma parte do arquivo de saída).
 */
export function hashAndScan(file: string, patterns: Buffer[] = []): Promise<HashScanResult> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const valid = patterns.map((p, i) => ({ p, i })).filter((x) => x.p.length > 0);
    const maxLen = valid.reduce((m, x) => Math.max(m, x.p.length), 0);
    const found = new Set<number>();
    let carry = Buffer.alloc(0);
    let size = 0;

    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hash.update(buf);
      size += buf.length;
      if (valid.length > 0 && found.size < valid.length) {
        const window = carry.length ? Buffer.concat([carry, buf]) : buf;
        for (const { p, i } of valid) {
          if (!found.has(i) && window.indexOf(p) !== -1) found.add(i);
        }
        carry = maxLen > 1 ? Buffer.from(window.subarray(Math.max(0, window.length - (maxLen - 1)))) : Buffer.alloc(0);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size, found }));
  });
}

export async function sha256File(file: string): Promise<string> {
  return (await hashAndScan(file)).sha256;
}

/** Lê no máximo `bytes` do início do arquivo. */
export async function readHead(file: string, bytes = 8 * 1024 * 1024): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
