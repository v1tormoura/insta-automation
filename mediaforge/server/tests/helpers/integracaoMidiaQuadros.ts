import { spawnSync } from 'node:child_process';

/**
 * Ferramentas de comparação quadro a quadro, independentes do servidor
 * (usam só o FFmpeg instalado). Servem para provar QUAIS quadros da fonte
 * foram parar na saída — e não só quantos ou por quanto tempo.
 */

const W = 160;
const H = 120;

function grayFrames(file: string, extra: string[] = []): Float32Array[] {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-nostdin', ...extra, '-i', file, '-map', '0:v:0', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`decodificação falhou (${file}): ${String(r.stderr).slice(-500)}`);
  const buf = r.stdout as Buffer;
  const size = W * H;
  const out: Float32Array[] = [];
  for (let off = 0; off + size <= buf.length; off += size) out.push(Float32Array.from(buf.subarray(off, off + size)));
  return out;
}

function mse(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s / a.length;
}

/**
 * Para cada quadro decodificado da saída, o índice do quadro da fonte mais
 * parecido (menor erro quadrático). Com uma fonte em que todo quadro difere
 * do vizinho (testsrc2), isso revela cortes, repetições e saltos.
 */
export function sourceFrameIndices(output: string, source: string): number[] {
  const src = grayFrames(source);
  return grayFrames(output).map((f) => {
    let best = -1;
    let bestErr = Infinity;
    src.forEach((s, i) => {
      const e = mse(f, s);
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    });
    return best;
  });
}

/** Duração do áudio efetivamente decodificado (respeita listas de edição), em segundos. */
export function decodedAudioSeconds(file: string): number {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], {
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`decodificação de áudio falhou (${file}): ${String(r.stderr).slice(-500)}`);
  return (r.stdout as Buffer).length / 2 / 48000;
}

/** Sequência [a, a+step, …] com n elementos. */
export const seq = (a: number, n: number, step = 1) => Array.from({ length: n }, (_, i) => a + i * step);
