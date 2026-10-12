import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BatchDTO, JobDTO, SystemInfoDTO } from '@mediaforge/shared';
import type { Client } from './client';

/**
 * Utilitários do teste da fila persistente (queue-recovery.test.ts): espera
 * com prazo, observação da fila por polling, processos FFmpeg vivos (via
 * /proc), mídia truncada gerada pelo FFmpeg e a tentativa de abrir o mesmo
 * DATA_DIR a partir de outro processo Node.
 */

export const TERMINAL = new Set(['completed', 'failed', 'canceled']);

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Repete `get` até `ok` aceitar o valor; falha com a última leitura quando o prazo vence. */
export async function waitFor<T>(
  get: () => T | Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs: number,
  what: string,
  intervalMs = 20,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const v = await get();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`prazo de ${timeoutMs} ms esgotado esperando ${what}; última leitura: ${JSON.stringify(v)?.slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Uma leitura da fila: tarefas da sessão, contagem global da fila e o lote observado. */
export interface Snapshot {
  /** Antes de enviar as requisições / depois de receber as respostas (mesmo relógio do servidor). */
  tSent: number;
  tRecv: number;
  jobs: Map<string, JobDTO>;
  /** Tarefas da sessão com status "running". */
  running: number;
  /** `queue.running` de GET /api/system (mapa em memória da fila). */
  queueRunning: number;
  batch: BatchDTO | null;
}

/** Faz polling de /api/jobs, /api/system e /api/batches até as tarefas `ids` terminarem. */
export async function observeQueue(c: Client, ids: string[], batchId: string | null, timeoutMs = 120_000): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  const start = Date.now();
  while (true) {
    const tSent = Date.now();
    const [jobs, sys, batches] = await Promise.all([
      c.get<JobDTO[]>('/api/jobs'),
      c.get<SystemInfoDTO>('/api/system'),
      batchId ? c.get<BatchDTO[]>('/api/batches') : Promise.resolve(null),
    ]);
    const tRecv = Date.now();
    if (jobs.status !== 200 || sys.status !== 200) throw new Error(`polling HTTP ${jobs.status}/${sys.status}`);
    const map = new Map(jobs.data.map((j) => [j.id, j]));
    out.push({
      tSent,
      tRecv,
      jobs: map,
      running: jobs.data.filter((j) => j.status === 'running').length,
      queueRunning: sys.data.queue.running,
      batch: batches?.data.find((b) => b.id === batchId) ?? null,
    });
    if (ids.every((id) => TERMINAL.has(map.get(id)?.status ?? ''))) return out;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`tarefas não terminaram em ${timeoutMs} ms: ${ids.map((id) => `${id}=${map.get(id)?.status}`).join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Maior número de intervalos [início, fim) sobrepostos num mesmo instante. */
export function maxOverlap(intervals: Array<[number, number]>): number {
  const ev: Array<[number, number]> = [];
  for (const [a, b] of intervals) ev.push([a, +1], [b, -1]);
  // No mesmo instante, o fim vem antes do início: [a, b) não encosta em [b, c).
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

/** PIDs de processos FFmpeg vivos cujo diretório de trabalho está dentro de `dir` (lido de /proc). */
export function ffmpegProcsIn(dir: string): number[] {
  const pids: number[] = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (fs.readFileSync(`/proc/${name}/comm`, 'utf8').trim() !== 'ffmpeg') continue;
      // Diretório já apagado aparece como "<caminho> (deleted)".
      const cwd = fs.readlinkSync(`/proc/${name}/cwd`).replace(/ \(deleted\)$/, '');
      if (cwd === dir || cwd.startsWith(dir + path.sep)) pids.push(Number(name));
    } catch {
      /* processo terminou durante a leitura */
    }
  }
  return pids;
}

/** Arquivos (caminho → tamanho) dentro de um diretório, recursivo; vazio se não existir. */
export function filesWithSize(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          out[path.relative(dir, p)] = fs.statSync(p).size;
        } catch {
          /* removido durante a leitura */
        }
      }
    }
  };
  try {
    walk(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return out;
}

/**
 * MP4 "faststart" de 6 s (640×360, H.264 + AAC) e uma cópia com só a primeira
 * metade dos bytes: o moov (no início) continua dizendo 6 s, então o ffprobe e
 * a miniatura da importação aceitam o arquivo, mas a segunda metade dos dados
 * não existe.
 */
export function buildTruncatedPair(dir: string): { full: string; half: string } {
  const full = path.join(dir, 'inteiro.mp4');
  const half = path.join(dir, 'metade.mp4');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=6',
    '-f', 'lavfi', '-i', 'sine=f=500:d=6:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-shortest',
    '-movflags', '+faststart', full,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg não gerou inteiro.mp4: ${r.stderr}`);
  const buf = fs.readFileSync(full);
  fs.writeFileSync(half, buf.subarray(0, Math.floor(buf.length / 2)));
  return { full, half };
}

export interface ChildBuildResult {
  exitCode: number | null;
  ok: boolean;
  name?: string;
  message?: string;
  stderr: string;
}

/**
 * Tenta `buildApp` no mesmo DATA_DIR a partir de OUTRO processo Node (via tsx),
 * como uma segunda instância iniciada pelo usuário. Assíncrono: o servidor do
 * teste continua processando enquanto o filho tenta abrir.
 */
export function buildAppInChildProcess(dataDir: string): Promise<ChildBuildResult> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-lock-child-'));
  const script = path.join(work, 'segunda-instancia.mts');
  const src = (p: string) => JSON.stringify(path.join(SERVER_DIR, 'src', p));
  fs.writeFileSync(
    script,
    `import ${src('silenceSqliteWarning.ts')};
import { buildApp } from ${src('app.ts')};
import { loadConfig } from ${src('config.ts')};
try {
  const mf = await buildApp(loadConfig({ DATA_DIR: ${JSON.stringify(dataDir)}, LOG_LEVEL: 'silent', SERVE_WEB: false }), { logger: false });
  console.log(JSON.stringify({ ok: true }));
  await mf.stop();
} catch (err) {
  console.log(JSON.stringify({ ok: false, name: err?.name, message: err?.message }));
}
`,
  );
  const tsxCli = path.join(SERVER_DIR, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [tsxCli, script],
      { cwd: SERVER_DIR, env: { ...process.env, MEDIAFORGE_SKIP_ENV_FILE: '1' }, timeout: 60_000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        fs.rmSync(work, { recursive: true, force: true });
        const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
        let parsed: { ok: boolean; name?: string; message?: string } = { ok: false, message: `saída ilegível: ${stdout}` };
        try {
          parsed = JSON.parse(line);
        } catch {
          /* fica a mensagem acima */
        }
        resolve({ exitCode: err ? ((err as { code?: number }).code ?? null) : 0, ...parsed, stderr });
      },
    );
  });
}
