import fsp from 'node:fs/promises';
import type { MediaInfo, MediaStreamInfo } from '@mediaforge/shared';
import { describeFailure, runProcess } from './process';
import type { MediaTools } from './tools';

/** Estrutura (parcial) do JSON do ffprobe. */
export interface FfprobeStream {
  index: number;
  codec_name?: string;
  codec_long_name?: string;
  codec_type?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
  nb_frames?: string;
  color_transfer?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown> & { side_data_type?: string }>;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  chapters?: Array<{ id: number; start_time?: string; end_time?: string; tags?: Record<string, string> }>;
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

export interface ProbeResult {
  info: MediaInfo;
  raw: FfprobeOutput;
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === 'N/A') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRate(rate?: string): number | null {
  if (!rate || rate === '0/0') return null;
  const [a, b] = rate.split('/').map(Number);
  if (!a || !Number.isFinite(a)) return null;
  const v = b ? a / b : a;
  return Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : null;
}

function streamRotation(s: FfprobeStream): number {
  for (const sd of s.side_data_list ?? []) {
    if (typeof sd.rotation === 'number') return sd.rotation;
    if (typeof sd.rotation === 'string' && Number.isFinite(Number(sd.rotation))) return Number(sd.rotation);
  }
  const tag = s.tags?.rotate;
  return tag && Number.isFinite(Number(tag)) ? -Number(tag) : 0;
}

const ALPHA_PIX = /^(rgba|bgra|argb|abgr|ya8|ya16|yuva|gbrap|rgba64|bgra64|pal8)/;
const IMAGE_FORMATS = /(image2|_pipe|^gif$|webp|png|mjpeg)/;

export function normalizeProbe(raw: FfprobeOutput, sizeBytes: number, decoderRotation: number | null = null): MediaInfo {
  const streams: MediaStreamInfo[] = (raw.streams ?? []).map((s) => {
    const type = (['video', 'audio', 'subtitle', 'data', 'attachment'] as const).find((t) => t === s.codec_type) ?? 'unknown';
    const out: MediaStreamInfo = {
      index: s.index,
      type,
      codec: s.codec_name ?? null,
      codecLong: s.codec_long_name ?? null,
      codecTag: s.codec_tag_string && !/^\[0\]/.test(s.codec_tag_string) ? s.codec_tag_string : null,
      bitrate: num(s.bit_rate),
      durationSec: num(s.duration),
    };
    if (type === 'video') {
      out.width = s.width;
      out.height = s.height;
      out.pixFmt = s.pix_fmt ?? null;
      out.fps = parseRate(s.avg_frame_rate) ?? parseRate(s.r_frame_rate);
      out.rotation = streamRotation(s);
      out.attachedPic = s.disposition?.attached_pic === 1;
      out.colorTransfer = s.color_transfer ?? null;
    }
    if (type === 'audio') {
      out.sampleRate = num(s.sample_rate);
      out.channels = s.channels ?? null;
    }
    return out;
  });

  const video = streams.find((s) => s.type === 'video' && !s.attachedPic && (s.width ?? 0) > 0);
  const audio = streams.find((s) => s.type === 'audio');
  const rotation = video?.rotation || decoderRotation || 0;
  const swap = Math.abs(rotation) % 180 === 90;
  const formatName = raw.format?.format_name ?? 'desconhecido';
  const rawVideo = (raw.streams ?? []).find((s) => s.index === video?.index);

  return {
    container: formatName,
    containerLong: raw.format?.format_long_name ?? formatName,
    durationSec: num(raw.format?.duration) ?? video?.durationSec ?? audio?.durationSec ?? null,
    bitrate: num(raw.format?.bit_rate),
    sizeBytes,
    streams,
    videoIndex: video?.index ?? null,
    audioIndex: audio?.index ?? null,
    displayWidth: video ? (swap ? video.height! : video.width!) : null,
    displayHeight: video ? (swap ? video.width! : video.height!) : null,
    rotation,
    fps: video?.fps ?? null,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    hasAlpha: !!video?.pixFmt && ALPHA_PIX.test(video.pixFmt),
    frames: num(rawVideo?.nb_frames),
    decoderRotation,
  };
}

export function looksLikeImageContainer(info: MediaInfo): boolean {
  return IMAGE_FORMATS.test(info.container);
}

/** Executa o ffprobe e devolve dados normalizados + JSON bruto. */
export async function probeFile(tools: MediaTools, file: string, timeoutMs = 60_000): Promise<ProbeResult> {
  const stat = await fsp.stat(file);
  const r = await runProcess(
    tools.ffprobe.path,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file],
    { collectStdoutBytes: 32 * 1024 * 1024, timeoutMs },
  );
  if (r.code !== 0) {
    throw new ProbeError(
      r.spawnError || r.timedOut
        ? describeFailure('ffprobe', r)
        : `Arquivo ilegível ou corrompido (${r.stderrTail.slice(-2).join(' | ') || 'ffprobe falhou'})`,
    );
  }
  if (r.stdoutTruncated) throw new ProbeError('Resposta do ffprobe grande demais.');
  let raw: FfprobeOutput;
  try {
    raw = JSON.parse(r.stdout) as FfprobeOutput;
  } catch {
    throw new ProbeError('Resposta do ffprobe inválida.');
  }
  if (!raw.format || !raw.streams || raw.streams.length === 0) {
    throw new ProbeError('Nenhum fluxo de mídia reconhecido no arquivo.');
  }
  const isImage = IMAGE_FORMATS.test(raw.format.format_name ?? '');
  const decoderRotation = isImage ? await frameRotation(tools, file) : null;
  return { info: normalizeProbe(raw, stat.size, decoderRotation), raw };
}

/**
 * Rotação exportada pelo decodificador no primeiro quadro (dado lateral do
 * quadro, não do fluxo). O FFmpeg 6+ faz isso com a orientação EXIF de JPEG e
 * gira a imagem automaticamente; PNG/WEBP não. Só consultado para imagens.
 */
async function frameRotation(tools: MediaTools, file: string): Promise<number | null> {
  const r = await runProcess(
    tools.ffprobe.path,
    ['-v', 'error', '-read_intervals', '%+#1', '-select_streams', 'v:0', '-show_entries', 'frame_side_data=rotation', '-of', 'json', file],
    { collectStdoutBytes: 1024 * 1024, timeoutMs: 30_000 },
  );
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout) as { frames?: Array<{ side_data_list?: Array<{ rotation?: number }> }> };
    for (const sd of j.frames?.[0]?.side_data_list ?? []) if (typeof sd.rotation === 'number' && sd.rotation !== 0) return sd.rotation;
  } catch {
    return null;
  }
  return null;
}
