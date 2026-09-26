export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Jitter uniforme em ±ratio para evitar que vários jobs acordem juntos. */
export function jitter(ms: number, ratio = 0.2): number {
  return Math.round(ms * (1 - ratio + Math.random() * ratio * 2));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
