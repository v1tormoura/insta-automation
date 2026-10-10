import type { OverlayPosition, TextOverlay, TextPosition } from '@mediaforge/shared';

/**
 * Regras de segurança do filtergraph: só entram números formatados aqui,
 * cores validadas por regex (#RRGGBB) e nomes de arquivo fixos gerados pelo
 * servidor ("text-0.txt", "font.ttf"). Texto do usuário vai para arquivos
 * (textfile=) com expansion=none — nunca é interpolado no grafo.
 */

export const num = (n: number, digits = 4) => {
  if (!Number.isFinite(n)) throw new Error('Valor numérico inválido no filtro');
  return Number(n.toFixed(digits)).toString();
};

export const ffColor = (hex: string, alpha = 1) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Cor inválida');
  return `0x${hex.slice(1).toUpperCase()}@${num(Math.max(0, Math.min(1, alpha)), 3)}`;
};

/** Cor ASS (&HAABBGGRR) para o filtro de legendas. */
export const assColor = (hex: string, alpha = 0) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Cor inválida');
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
};

export function eqFilter(color: { brightness: number; contrast: number; saturation: number }): string | null {
  if (color.brightness === 0 && color.contrast === 0 && color.saturation === 0) return null;
  const brightness = (color.brightness / 100) * 0.3;
  const contrast = 1 + color.contrast / 100;
  const saturation = 1 + color.saturation / 100;
  return `eq=brightness=${num(brightness)}:contrast=${num(contrast)}:saturation=${num(saturation)}`;
}

/** atempo aceita 0,5–2,0 por estágio com melhor qualidade; encadeia quando preciso. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${num(s, 6)}`);
  return out;
}

export function textPositionExpr(pos: TextPosition, margin: number): { x: string; y: string } {
  const m = String(Math.round(margin));
  const cx = '(w-text_w)/2';
  switch (pos) {
    case 'top':
      return { x: cx, y: m };
    case 'center':
      return { x: cx, y: '(h-text_h)/2' };
    case 'bottom':
      return { x: cx, y: `h-text_h-${m}` };
    case 'top-left':
      return { x: m, y: m };
    case 'top-right':
      return { x: `w-text_w-${m}`, y: m };
    case 'bottom-left':
      return { x: m, y: `h-text_h-${m}` };
    case 'bottom-right':
      return { x: `w-text_w-${m}`, y: `h-text_h-${m}` };
  }
}

export function overlayPositionExpr(pos: OverlayPosition, margin: number): { x: string; y: string } {
  const m = String(Math.round(margin));
  switch (pos) {
    case 'top-left':
      return { x: m, y: m };
    case 'top-right':
      return { x: `W-w-${m}`, y: m };
    case 'bottom-left':
      return { x: m, y: `H-h-${m}` };
    case 'bottom-right':
      return { x: `W-w-${m}`, y: `H-h-${m}` };
    case 'center':
      return { x: '(W-w)/2', y: '(H-h)/2' };
  }
}

export function enableExpr(start: number, end: number | null): string {
  if (start <= 0 && end === null) return '';
  return `:enable='between(t,${num(start, 3)},${num(end ?? 1e9, 3)})'`;
}

export interface DrawtextOptions {
  textFile: string;
  fontFile: string;
  frameHeight: number;
  frameWidth: number;
  overlay: Pick<TextOverlay, 'position' | 'size' | 'color' | 'opacity' | 'box' | 'boxColor' | 'boxOpacity' | 'start' | 'end'>;
  /** FFmpeg suporta text_align (alinha as linhas entre si). */
  textAlign?: boolean;
}

export function drawtextFilter(o: DrawtextOptions): string {
  const t = o.overlay;
  const fontSize = Math.max(8, Math.round((o.frameHeight * t.size) / 100));
  const margin = Math.round(Math.min(o.frameWidth, o.frameHeight) * 0.05);
  const { x, y } = textPositionExpr(t.position, margin);
  const parts = [
    `drawtext=fontfile=${o.fontFile}`,
    `textfile=${o.textFile}`,
    'expansion=none',
    `fontsize=${fontSize}`,
    `fontcolor=${ffColor(t.color, t.opacity)}`,
    `line_spacing=${Math.round(fontSize * 0.25)}`,
    `x=${x}`,
    `y=${y}`,
  ];
  if (o.textAlign) parts.push(`text_align=${t.position.endsWith('left') ? 'L' : t.position.endsWith('right') ? 'R' : 'C'}`);
  if (t.box) parts.push('box=1', `boxcolor=${ffColor(t.boxColor, t.boxOpacity)}`, `boxborderw=${Math.round(fontSize * 0.35)}`);
  return parts.join(':') + enableExpr(t.start, t.end);
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
}

export const fmtSec = (s: number) => `${s.toFixed(s < 10 ? 2 : 1).replace('.', ',')} s`;
