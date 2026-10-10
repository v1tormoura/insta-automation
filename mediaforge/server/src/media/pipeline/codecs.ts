import type { EncoderSpeed, ImageFormat, VideoContainer } from '@mediaforge/shared';
import type { MediaTools } from '../tools';

export type VideoCodec = 'h264' | 'hevc' | 'vp9' | 'av1';
export type AudioCodec = 'aac' | 'opus' | 'mp3';

/** Codecs que cada contêiner de saída aceita em cópia direta (codec_name do ffprobe). */
const COPY_COMPAT: Record<VideoContainer, { video: string[]; audio: string[] }> = {
  mp4: { video: ['h264', 'hevc', 'av1', 'mpeg4', 'vp9'], audio: ['aac', 'mp3', 'opus', 'alac', 'ac3', 'eac3', 'flac'] },
  mov: { video: ['h264', 'hevc', 'prores', 'mjpeg', 'mpeg4'], audio: ['aac', 'mp3', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s16be', 'pcm_s24be'] },
  webm: { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
  mkv: {
    video: ['h264', 'hevc', 'av1', 'vp8', 'vp9', 'mpeg4', 'prores', 'mjpeg', 'mpeg2video', 'ffv1'],
    audio: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'ac3', 'eac3', 'pcm_s16le', 'pcm_s24le'],
  },
};

/** Codecs que cada contêiner aceita quando recodificamos. */
const ENCODE_COMPAT: Record<VideoContainer, { video: VideoCodec[]; audio: AudioCodec[] }> = {
  mp4: { video: ['h264', 'hevc', 'av1', 'vp9'], audio: ['aac', 'mp3', 'opus'] },
  mov: { video: ['h264', 'hevc'], audio: ['aac', 'mp3'] },
  webm: { video: ['vp9', 'av1'], audio: ['opus'] },
  mkv: { video: ['h264', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus', 'mp3'] },
};

export const MUXER: Record<VideoContainer | ImageFormat, string> = {
  mp4: 'mp4',
  mov: 'mov',
  webm: 'webm',
  mkv: 'matroska',
  jpg: 'image2',
  png: 'image2',
  webp: 'image2',
};

export function canCopyVideo(codec: string | null, container: VideoContainer): boolean {
  return !!codec && COPY_COMPAT[container].video.includes(codec);
}
export function canCopyAudio(codec: string | null, container: VideoContainer): boolean {
  return !!codec && COPY_COMPAT[container].audio.includes(codec);
}
export function videoCodecAllowed(codec: VideoCodec, container: VideoContainer): boolean {
  return ENCODE_COMPAT[container].video.includes(codec);
}
export function audioCodecAllowed(codec: AudioCodec, container: VideoContainer): boolean {
  return ENCODE_COMPAT[container].audio.includes(codec);
}
export function defaultVideoCodec(container: VideoContainer): VideoCodec {
  return container === 'webm' ? 'vp9' : 'h264';
}
export function defaultAudioCodec(container: VideoContainer): AudioCodec {
  return container === 'webm' ? 'opus' : 'aac';
}

export function encoderAvailable(tools: MediaTools, codec: VideoCodec | AudioCodec): boolean {
  return tools.capabilities[codec];
}

export const VIDEO_CODEC_LABEL: Record<VideoCodec, string> = { h264: 'H.264', hevc: 'H.265/HEVC', vp9: 'VP9', av1: 'AV1' };
export const AUDIO_CODEC_LABEL: Record<AudioCodec, string> = { aac: 'AAC', opus: 'Opus', mp3: 'MP3' };

/** Converte a qualidade 0–100 da interface em CRF do codec. */
export function qualityToCrf(codec: VideoCodec, quality: number): number {
  const q = Math.max(0, Math.min(100, quality));
  switch (codec) {
    case 'h264':
      return Math.round(51 - q * 0.4); // 70 → 23
    case 'hevc':
      return Math.round(51 - q * 0.37); // 70 → 25
    case 'vp9':
      return Math.round(63 - q * 0.45); // 70 → 32
    case 'av1':
      return Math.round(63 - q * 0.42); // 70 → 34
  }
}

const X26X_PRESET: Record<EncoderSpeed, string> = { fast: 'veryfast', balanced: 'medium', quality: 'slow' };
const VPX_CPU: Record<EncoderSpeed, string> = { fast: '5', balanced: '3', quality: '1' };
const SVT_PRESET: Record<EncoderSpeed, string> = { fast: '10', balanced: '8', quality: '5' };
const AOM_CPU: Record<EncoderSpeed, string> = { fast: '8', balanced: '6', quality: '4' };

export interface VideoEncodeOptions {
  codec: VideoCodec;
  rateControl: 'quality' | 'bitrate';
  quality: number;
  bitrateKbps: number;
  speed: EncoderSpeed;
  threads: number;
  /** Prévia: prioriza velocidade. */
  preview?: boolean;
}

export function videoEncodeArgs(tools: MediaTools, o: VideoEncodeOptions): string[] {
  const args: string[] = [];
  const speed: EncoderSpeed = o.preview ? 'fast' : o.speed;
  const crf = qualityToCrf(o.codec, o.preview ? Math.min(o.quality, 55) : o.quality);
  const br = (k: number) => `${k}k`;
  switch (o.codec) {
    case 'h264':
      args.push('-c:v', 'libx264', '-preset', o.preview ? 'ultrafast' : X26X_PRESET[speed], '-pix_fmt', 'yuv420p', '-profile:v', 'high');
      if (o.rateControl === 'bitrate' && !o.preview)
        args.push('-b:v', br(o.bitrateKbps), '-maxrate', br(Math.round(o.bitrateKbps * 1.5)), '-bufsize', br(o.bitrateKbps * 2));
      else args.push('-crf', String(crf));
      break;
    case 'hevc':
      args.push('-c:v', 'libx265', '-preset', o.preview ? 'ultrafast' : X26X_PRESET[speed], '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1');
      args.push('-x265-params', 'log-level=error');
      if (o.rateControl === 'bitrate' && !o.preview)
        args.push('-b:v', br(o.bitrateKbps), '-maxrate', br(Math.round(o.bitrateKbps * 1.5)), '-bufsize', br(o.bitrateKbps * 2));
      else args.push('-crf', String(crf));
      break;
    case 'vp9':
      args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-row-mt', '1', '-deadline', o.preview ? 'realtime' : 'good', '-cpu-used', o.preview ? '8' : VPX_CPU[speed]);
      if (o.rateControl === 'bitrate' && !o.preview) args.push('-b:v', br(o.bitrateKbps));
      else args.push('-crf', String(crf), '-b:v', '0');
      break;
    case 'av1':
      if (tools.av1Encoder === 'libaom-av1') {
        args.push('-c:v', 'libaom-av1', '-cpu-used', o.preview ? '8' : AOM_CPU[speed], '-row-mt', '1', '-pix_fmt', 'yuv420p');
        if (o.rateControl === 'bitrate' && !o.preview) args.push('-b:v', br(o.bitrateKbps));
        else args.push('-crf', String(crf), '-b:v', '0');
      } else {
        args.push('-c:v', 'libsvtav1', '-preset', o.preview ? '12' : SVT_PRESET[speed], '-pix_fmt', 'yuv420p');
        if (o.rateControl === 'bitrate' && !o.preview) args.push('-b:v', br(o.bitrateKbps));
        else args.push('-crf', String(crf));
      }
      break;
  }
  if (o.threads > 0) args.push('-threads', String(o.threads));
  return args;
}

export function audioEncodeArgs(codec: AudioCodec, bitrateKbps: number): string[] {
  const b = `${bitrateKbps}k`;
  switch (codec) {
    case 'aac':
      return ['-c:a', 'aac', '-b:a', b];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', b];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', b];
  }
}

/** JPEG: qualidade 1–100 → -q:v 2–31 (escala não linear do mjpeg). */
export function jpegQscale(quality: number): number {
  const table: Array<[number, number]> = [
    [100, 2],
    [90, 3],
    [80, 4],
    [70, 5],
    [60, 7],
    [50, 9],
    [30, 14],
    [10, 24],
    [1, 31],
  ];
  for (let i = 0; i < table.length - 1; i++) {
    const [qa, sa] = table[i]!;
    const [qb, sb] = table[i + 1]!;
    if (quality <= qa && quality >= qb) return Math.round(sb + ((quality - qb) / (qa - qb)) * (sa - sb));
  }
  return 31;
}

export function imageEncodeArgs(format: ImageFormat, quality: number): string[] {
  switch (format) {
    case 'jpg':
      return ['-c:v', 'mjpeg', '-q:v', String(jpegQscale(quality)), '-pix_fmt', 'yuvj420p'];
    case 'png':
      return ['-c:v', 'png', '-compression_level', '9'];
    case 'webp':
      return ['-c:v', 'libwebp', '-quality', String(quality), '-lossless', '0'];
  }
}

/** codec_name esperado no ffprobe para cada codec de saída. */
export const PROBE_NAME: Record<VideoCodec | AudioCodec | ImageFormat, string> = {
  h264: 'h264',
  hevc: 'hevc',
  vp9: 'vp9',
  av1: 'av1',
  aac: 'aac',
  opus: 'opus',
  mp3: 'mp3',
  jpg: 'mjpeg',
  png: 'png',
  webp: 'webp',
};
