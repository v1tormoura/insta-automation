import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ffprobe em JSON (independente do código do servidor). */
export function ffprobe(file: string): any {
  const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  return JSON.parse(out);
}

/** Grava um Buffer em arquivo temporário e devolve o caminho. */
export function tmpFile(buf: Buffer, ext: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-out-'));
  const p = path.join(dir, `out.${ext}`);
  fs.writeFileSync(p, buf);
  return p;
}

/** MD5 dos quadros decodificados — compara pixels independentemente do contêiner. */
export function frameMd5(file: string, extra: string[] = []): string {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...extra, '-map', '0:v:0', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
}

/** Média de luminância (signalstats YAVG) do vídeo/imagem. */
export function meanLuma(file: string): number {
  const out = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const vals = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
}

/** Volume médio em dB (volumedetect escreve no stderr). */
export function meanVolumeDb(file: string): number {
  const res = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = String(res.stderr).match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (!m) throw new Error('volumedetect sem resultado');
  return Number(m[1]);
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
