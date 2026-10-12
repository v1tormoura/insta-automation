import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from './inspecaoMidia';

/**
 * Utilitários do teste de integridade/exportação. A leitura do ZIP usa o
 * módulo `zipfile` do Python (independente do yazl usado pelo servidor):
 * `testzip()` confere o CRC-32 de cada entrada e `extractall()` grava os
 * arquivos num diretório novo, para o teste recalcular os SHA-256.
 */

const PY_READ_ZIP = `
import json, sys, zipfile
src, dest = sys.argv[1], sys.argv[2]
try:
    with zipfile.ZipFile(src) as z:
        bad = z.testzip()
        infos = [{'name': i.filename, 'size': i.file_size, 'method': i.compress_type, 'crc': i.CRC} for i in z.infolist()]
        z.extractall(dest)
    print(json.dumps({'ok': True, 'bad': bad, 'entries': infos}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': type(e).__name__ + ': ' + str(e)}))
`;

export interface ZipEntry {
  name: string;
  size: number;
  method: number;
  crc: number;
}

export type ZipRead =
  | {
      ok: true;
      /** Primeira entrada com CRC errado (null = todas íntegras). */
      bad: string | null;
      entries: ZipEntry[];
      dir: string;
      /** Bytes de uma entrada extraída (caminho completo dentro do ZIP). */
      read(name: string): Buffer;
      sha(name: string): string;
    }
  | { ok: false; error: string };

/** Diretórios temporários criados por este utilitário (removidos por `removeTempDirs`). */
const tempDirs: string[] = [];

/** Cria um diretório temporário registrado para limpeza no fim do arquivo de teste. */
export function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/** Registra um diretório criado por outro helper (ex.: `tmpFile`) para a mesma limpeza. */
export function trackTempDir(dir: string): void {
  tempDirs.push(dir);
}

/** Remove os ZIPs/extrações e demais diretórios temporários registrados. */
export function removeTempDirs(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** Lê e extrai um ZIP com o Python (`python3 -I`), num diretório novo e vazio. */
export function readZip(buf: Buffer): ZipRead {
  const work = tempDir('mf-zip-');
  const zipPath = path.join(work, 'export.zip');
  const dir = path.join(work, 'extraido');
  fs.mkdirSync(dir);
  fs.writeFileSync(zipPath, buf);
  const r = spawnSync('python3', ['-I', '-c', PY_READ_ZIP, zipPath, dir], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`python3 falhou (${r.status}): ${r.stderr}`);
  const out = JSON.parse(r.stdout) as { ok: boolean; bad?: string | null; entries?: ZipEntry[]; error?: string };
  if (!out.ok) return { ok: false, error: out.error ?? '?' };
  const read = (name: string) => fs.readFileSync(path.join(dir, ...name.split('/')));
  return { ok: true, bad: out.bad ?? null, entries: out.entries!, dir, read, sha: (name) => sha256(read(name)) };
}

/**
 * Descritores abertos por ESTE processo (o servidor de teste roda no mesmo
 * processo do vitest — ver helpers/server.ts) que apontam para `dir`.
 */
export function openFdsInside(dir: string): string[] {
  const prefix = path.resolve(dir) + path.sep;
  const out: string[] = [];
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    try {
      const target = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (target.startsWith(prefix)) out.push(target);
    } catch {
      // descritor fechado entre o readdir e o readlink
    }
  }
  return out;
}

/** Espera (com prazo) uma condição observável; devolve o último valor lido. */
export async function waitFor<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, timeoutMs: number, what: string, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!ok(last)) {
    if (Date.now() > deadline) throw new Error(`prazo de ${timeoutMs} ms esgotado esperando ${what}; último valor: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, stepMs));
    last = await read();
  }
  return last;
}

/** Altera 1 byte no meio do arquivo (mesmo tamanho); devolve o byte original para restaurar. */
export function flipByte(file: string, offset?: number): { offset: number; original: number; restore(): void } {
  const size = fs.statSync(file).size;
  const at = offset ?? Math.floor(size / 2);
  const fd = fs.openSync(file, 'r+');
  try {
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, at);
    const original = b[0]!;
    fs.writeSync(fd, Buffer.from([original ^ 0xff]), 0, 1, at);
    return {
      offset: at,
      original,
      restore() {
        const f = fs.openSync(file, 'r+');
        try {
          fs.writeSync(f, Buffer.from([original]), 0, 1, at);
        } finally {
          fs.closeSync(f);
        }
      },
    };
  } finally {
    fs.closeSync(fd);
  }
}
