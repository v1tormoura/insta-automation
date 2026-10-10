import type { GeometrySettings, OperationRecord } from '@mediaforge/shared';

/**
 * Um passo da cadeia de vídeo. `simple` é um filtro linear ("scale=…");
 * `complex` é um subgrafo com rótulos próprios, montado pelo construtor.
 */
export type FilterStep = { kind: 'simple'; filter: string } | { kind: 'complex'; build: (input: string, output: string, uid: string) => string };

export interface GeometryResult {
  width: number;
  height: number;
  steps: FilterStep[];
  operations: OperationRecord[];
  warnings: string[];
  changed: boolean;
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const evenFloor = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const f3 = (n: number) => Number(n.toFixed(4)).toString();

export function parseAspect(a: GeometrySettings['aspect']): number | null {
  if (a === 'original') return null;
  const [w, h] = a.split(':').map(Number);
  return w! / h!;
}

const hex = (c: string) => `0x${c.replace('#', '').toUpperCase()}`;

/**
 * Calcula dimensões de saída e filtros a partir das dimensões de exibição da
 * fonte (já com rotação aplicada). Ordem: corte manual → proporção/resolução
 * (recortar, barras, fundo desfocado ou esticar) → SAR 1:1.
 */
export function computeGeometry(srcW: number, srcH: number, g: GeometrySettings): GeometryResult {
  const steps: FilterStep[] = [];
  const operations: OperationRecord[] = [];
  const warnings: string[] = [];
  let cw = srcW;
  let ch = srcH;

  if (g.crop) {
    const cx = Math.min(srcW - 2, Math.round(g.crop.x * srcW));
    const cy = Math.min(srcH - 2, Math.round(g.crop.y * srcH));
    cw = evenFloor(Math.min(srcW - cx, g.crop.w * srcW));
    ch = evenFloor(Math.min(srcH - cy, g.crop.h * srcH));
    steps.push({ kind: 'simple', filter: `crop=${cw}:${ch}:${cx}:${cy}` });
    operations.push({ id: 'crop', label: 'Corte de área', detail: `${cw}×${ch} a partir de (${cx}, ${cy}) em ${srcW}×${srcH}` });
  }

  const aspect = parseAspect(g.aspect) ?? cw / ch;
  let tw: number;
  let th: number;
  if (g.resolution === 'custom') {
    if (g.keepAspect) {
      if (g.aspect === 'original') {
        const s = Math.min(g.width / cw, g.height / ch);
        tw = even(cw * s);
        th = even(ch * s);
      } else if (g.width / g.height > aspect) {
        th = even(g.height);
        tw = even(g.height * aspect);
      } else {
        tw = even(g.width);
        th = even(g.width / aspect);
      }
    } else {
      tw = even(g.width);
      th = even(g.height);
    }
  } else if (g.resolution === 'original') {
    if (g.aspect === 'original') {
      tw = even(cw);
      th = even(ch);
    } else if (g.fit === 'crop') {
      if (cw / ch > aspect) {
        th = evenFloor(ch);
        tw = evenFloor(ch * aspect);
      } else {
        tw = evenFloor(cw);
        th = evenFloor(cw / aspect);
      }
    } else if (cw / ch > aspect) {
      tw = even(cw);
      th = even(cw / aspect);
    } else {
      th = even(ch);
      tw = even(ch * aspect);
    }
  } else {
    const short = Number(g.resolution);
    if (aspect >= 1) {
      th = even(short);
      tw = even(short * aspect);
    } else {
      tw = even(short);
      th = even(short / aspect);
    }
  }

  const aspectChanged = Math.abs(tw / th - cw / ch) > 0.01;
  const sizeChanged = tw !== cw || th !== ch;
  const ax = f3(g.anchorX);
  const ay = f3(g.anchorY);

  if (!aspectChanged) {
    if (sizeChanged) {
      steps.push({ kind: 'simple', filter: `scale=${tw}:${th}:flags=lanczos` });
      operations.push({ id: 'resize', label: 'Redimensionamento', detail: `${cw}×${ch} → ${tw}×${th}` });
    }
  } else {
    const ratioLabel = g.aspect === 'original' ? `${tw}:${th}` : g.aspect;
    switch (g.fit) {
      case 'crop':
        steps.push(
          { kind: 'simple', filter: `scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos` },
          { kind: 'simple', filter: `crop=${tw}:${th}:(iw-${tw})*${ax}:(ih-${th})*${ay}` },
        );
        operations.push({
          id: 'reframe',
          label: 'Reenquadramento',
          detail: `Proporção ${ratioLabel} por recorte, ${tw}×${th}, âncora ${Math.round(g.anchorX * 100)}% × ${Math.round(g.anchorY * 100)}%`,
        });
        break;
      case 'pad':
        steps.push(
          { kind: 'simple', filter: `scale=${tw}:${th}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos` },
          { kind: 'simple', filter: `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${hex(g.padColor)}` },
        );
        operations.push({ id: 'pad', label: 'Conversão de proporção', detail: `Proporção ${ratioLabel} com barras ${g.padColor}, ${tw}×${th}` });
        break;
      case 'blur':
        steps.push({
          kind: 'complex',
          build: (input, output, uid) =>
            `${input}split=2[bg${uid}][fg${uid}];` +
            `[bg${uid}]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},boxblur=luma_radius=min(h\\,w)/20:luma_power=2[bgb${uid}];` +
            `[fg${uid}]scale=${tw}:${th}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[fgs${uid}];` +
            `[bgb${uid}][fgs${uid}]overlay=(W-w)/2:(H-h)/2${output}`,
        });
        operations.push({ id: 'blur-pad', label: 'Conversão de proporção', detail: `Proporção ${ratioLabel} com fundo desfocado, ${tw}×${th}` });
        break;
      case 'stretch':
        steps.push({ kind: 'simple', filter: `scale=${tw}:${th}:flags=lanczos` });
        operations.push({ id: 'stretch', label: 'Conversão de proporção', detail: `Esticado para ${tw}×${th} (distorce a imagem)` });
        warnings.push('O modo "esticar" distorce a imagem.');
        break;
    }
  }

  const upscale = g.fit === 'crop' && aspectChanged ? Math.max(tw / cw, th / ch) : Math.min(tw / cw, th / ch);
  if (sizeChanged && upscale > 1.01) {
    warnings.push(`Ampliação de ${Math.round((upscale - 1) * 100)}% em relação à fonte: pode reduzir a nitidez.`);
  }
  const changed = steps.length > 0;
  if (changed) steps.push({ kind: 'simple', filter: 'setsar=1' });
  return { width: tw, height: th, steps, operations, warnings, changed };
}

/** Filtros que aplicam a orientação EXIF (1–8) aos pixels. */
export function orientationFilters(orientation: number | null | undefined): string[] {
  switch (orientation) {
    case 2:
      return ['hflip'];
    case 3:
      return ['hflip', 'vflip'];
    case 4:
      return ['vflip'];
    case 5:
      return ['transpose=0'];
    case 6:
      return ['transpose=1'];
    case 7:
      return ['transpose=3'];
    case 8:
      return ['transpose=2'];
    default:
      return [];
  }
}
