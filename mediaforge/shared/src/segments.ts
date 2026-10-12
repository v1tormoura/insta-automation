import type { ProcessingSettings } from './settings';
import type { MediaInfo } from './types';

/** Trecho de um vídeo (parte da divisão), em segundos da fonte. */
export interface Segment {
  start: number;
  end: number;
  index: number;
  count: number;
}

/** Divisão impossível (partes demais ou curtas demais); a mensagem vai para o usuário. */
export class SegmentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentationError';
  }
}

export const MAX_SEGMENTS = 100;
export const MIN_SEGMENT_SEC = 0.1;

/** Valor numérico de uma taxa em fração do FFprobe ("30000/1001"). */
export function rateValue(rate: string | null | undefined): number | null {
  if (!rate || !/^\d+(\/\d+)?$/.test(rate)) return null;
  const [a, b = 1] = rate.split('/').map(Number);
  if (!a || !b) return null;
  const v = a / b;
  return v > 0 && v <= 240 ? v : null;
}

/**
 * Taxa da grade de quadros para alinhar cortes: só para fontes de cadência
 * constante, com a fração exata (nunca 29,97 arredondado). VFR → sem grade.
 */
export function frameGridFps(info: Pick<MediaInfo, 'constantFrameRate' | 'frameRateExact'>): number | null {
  return info.constantFrameRate ? rateValue(info.frameRateExact) : null;
}

/**
 * Primeiro quadro em/depois do instante `t`, numa grade de quadros de taxa
 * constante (`fps` exato). Tolerância de 1% de quadro para valores já
 * alinhados (2/3 s escrito 0,666667). Sem taxa conhecida, devolve `t`.
 */
export function snapToFrame(t: number, fps: number | null): number {
  if (!fps) return t;
  return Math.max(0, Math.ceil(t * fps - 0.01) / fps);
}

/**
 * Divide o trecho em partes iguais (por quantidade) ou de duração fixa, com
 * fronteiras na grade de quadros — a mesma regra no servidor e na interface.
 * Um resto final mais curto que 0,1 s é somado à parte anterior (nada se perde).
 * Devolve `null` quando não há divisão.
 */
export function computeSegments(durationSec: number | null, fps: number | null, s: ProcessingSettings): Segment[] | null {
  if (s.mode === 'quick' || s.segmentation.mode === 'none' || !durationSec) return null;
  const start = snapToFrame(s.trim.start ?? 0, fps);
  const rawEnd = Math.min(s.trim.end ?? durationSec, durationSec);
  const end = rawEnd < durationSec - 0.0005 ? Math.min(snapToFrame(rawEnd, fps), durationSec) : durationSec;
  const len = end - start;
  if (len <= 0) return null;

  const bounds: number[] = [start];
  if (s.segmentation.mode === 'count') {
    const count = Math.max(1, Math.min(MAX_SEGMENTS, Math.round(s.segmentation.value)));
    if (len / count < MIN_SEGMENT_SEC) {
      throw new SegmentationError(
        `A divisão em ${count} partes geraria trechos de ${(len / count).toFixed(2).replace('.', ',')} s (mínimo ${String(MIN_SEGMENT_SEC).replace('.', ',')} s). Use menos partes.`,
      );
    }
    for (let i = 1; i < count; i++) bounds.push(snapToFrame(start + (i * len) / count, fps));
  } else {
    const partLen = Math.max(1, s.segmentation.value);
    const count = Math.ceil(len / partLen - 1e-9);
    if (count > MAX_SEGMENTS) {
      throw new SegmentationError(`A divisão geraria ${count} partes (máximo ${MAX_SEGMENTS}). Aumente a duração de cada parte.`);
    }
    for (let i = 1; i < count; i++) bounds.push(snapToFrame(start + i * partLen, fps));
  }
  bounds.push(end);

  // Resto curto no fim (ex.: 30,03 s em partes de 10 s): vai para a parte anterior.
  while (bounds.length > 2 && bounds[bounds.length - 1]! - bounds[bounds.length - 2]! < MIN_SEGMENT_SEC) bounds.splice(bounds.length - 2, 1);

  const parts: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!;
    const b = bounds[i + 1]!;
    if (b > a) parts.push({ start: a, end: b, index: parts.length + 1, count: 0 });
  }
  return parts.map((p) => ({ ...p, count: parts.length }));
}
