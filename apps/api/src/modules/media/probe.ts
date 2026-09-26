import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const run = promisify(execFile);

export interface VideoInfo {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

let warned = false;
function warnOnce(err: unknown) {
  if (warned) return;
  warned = true;
  logger.warn({ err }, 'ffprobe/ffmpeg indisponível: vídeos seguem sem duração/miniatura (a Meta ainda valida)');
}

/** Lê duração, resolução e codecs com ffprobe. Sem ffprobe instalado, devolve null. */
export async function probeVideo(path: string): Promise<VideoInfo | null> {
  try {
    const { stdout } = await run(
      env.FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as {
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
      format?: { duration?: string };
    };
    const video = data.streams?.find((s) => s.codec_type === 'video');
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.[0]?.rotation ?? 0)) % 180;
    const [w, h] = rotation === 90 ? [video?.height, video?.width] : [video?.width, video?.height];
    const duration = Number(data.format?.duration);
    return {
      durationSeconds: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : null,
      width: w ?? null,
      height: h ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
    };
  } catch (err) {
    warnOnce(err);
    return null;
  }
}

/** Extrai um quadro do vídeo como JPEG (miniatura da biblioteca). */
export async function extractFrame(videoPath: string, outPath: string, atSeconds = 1): Promise<boolean> {
  try {
    await run(
      env.FFMPEG_PATH,
      ['-y', '-v', 'error', '-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=480:-2', outPath],
      { timeout: 30_000 },
    );
    return true;
  } catch (err) {
    warnOnce(err);
    return false;
  }
}
