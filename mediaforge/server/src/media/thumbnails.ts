import type { MediaInfo } from '@mediaforge/shared';
import { orientationFilters } from './pipeline/geometry';
import { describeFailure, runProcess } from './process';
import type { MediaTools } from './tools';

/**
 * Gera uma miniatura JPEG (máx. 360 px). Também serve como teste de
 * decodificação na importação: se o FFmpeg não consegue extrair um quadro,
 * o arquivo é tratado como corrompido.
 */
export async function makeThumbnail(
  tools: MediaTools,
  input: string,
  output: string,
  info: MediaInfo,
  opts: { orientation?: number | null; signal?: AbortSignal } = {},
): Promise<void> {
  const dur = info.durationSec ?? 0;
  const seek = dur > 2 ? Math.min(1.5, dur * 0.1) : 0;
  const filters = [
    ...orientationFilters(opts.orientation),
    'scale=w=360:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2',
  ];
  const graph = info.hasAlpha
    ? `[0:v]${filters.join(',')},format=rgba,split[fg][b];[b]drawbox=c=0x0F1830@1:replace=1:t=fill[bg];[bg][fg]overlay=format=auto[out]`
    : `[0:v]${filters.join(',')}[out]`;
  const args = [
    '-hide_banner', '-nostdin', '-y', '-v', 'error',
    ...(seek > 0 ? ['-ss', seek.toFixed(3)] : []),
    '-i', input,
    '-filter_complex', graph, '-map', '[out]',
    '-frames:v', '1', '-update', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-f', 'image2', output,
  ];
  const r = await runProcess(tools.ffmpeg.path, args, { timeoutMs: 60_000, signal: opts.signal });
  if (r.code !== 0) throw new Error(describeFailure('ffmpeg (miniatura)', r));
}
