import type { EncoderAvailability } from '@mediaforge/shared';
import { runProcess } from './process';

export interface ToolStatus {
  available: boolean;
  path: string;
  version: string | null;
  error: string | null;
}

/**
 * Localização e capacidades do FFmpeg/FFprobe instalados. As capacidades são
 * descobertas consultando o próprio binário (encoders, filtros, bitstream
 * filters), então a interface só oferece o que a instalação suporta.
 */
export class MediaTools {
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  capabilities: EncoderAvailability = {
    h264: false,
    hevc: false,
    vp9: false,
    av1: false,
    aac: false,
    opus: false,
    mp3: false,
    webp: false,
    drawtext: false,
    textAlign: false,
    subtitles: false,
    filterUnits: false,
  };
  /** Encoder usado para AV1 (libsvtav1 preferido, libaom-av1 como alternativa). */
  av1Encoder: 'libsvtav1' | 'libaom-av1' | null = null;

  constructor(ffmpegPath: string, ffprobePath: string) {
    this.ffmpeg = { available: false, path: ffmpegPath, version: null, error: 'Ainda não verificado' };
    this.ffprobe = { available: false, path: ffprobePath, version: null, error: 'Ainda não verificado' };
  }

  get ready(): boolean {
    return this.ffmpeg.available && this.ffprobe.available;
  }

  async detect(): Promise<void> {
    this.ffmpeg = await this.version(this.ffmpeg.path, 'ffmpeg');
    this.ffprobe = await this.version(this.ffprobe.path, 'ffprobe');
    if (!this.ffmpeg.available) return;

    const list = async (flag: string) => {
      const r = await runProcess(this.ffmpeg.path, ['-hide_banner', flag], {
        collectStdoutBytes: 4 * 1024 * 1024,
        timeoutMs: 20_000,
      });
      return r.code === 0 ? r.stdout : '';
    };
    const [encoders, filters, bsfs] = await Promise.all([list('-encoders'), list('-filters'), list('-bsfs')]);
    const drawtextHelp = /\sdrawtext\s/.test(filters)
      ? (await runProcess(this.ffmpeg.path, ['-hide_banner', '-h', 'filter=drawtext'], { collectStdoutBytes: 256 * 1024, timeoutMs: 15_000 })).stdout
      : '';
    const hasEncoder = (name: string) => new RegExp(`^\\s*[VAS][A-Z.]{5}\\s+${name}\\s`, 'm').test(encoders);
    const hasFilter = (name: string) => new RegExp(`^\\s*[A-Z.]{2,3}\\s+${name}\\s`, 'm').test(filters);

    this.av1Encoder = hasEncoder('libsvtav1') ? 'libsvtav1' : hasEncoder('libaom-av1') ? 'libaom-av1' : null;
    this.capabilities = {
      h264: hasEncoder('libx264'),
      hevc: hasEncoder('libx265'),
      vp9: hasEncoder('libvpx-vp9'),
      av1: this.av1Encoder !== null,
      aac: hasEncoder('aac'),
      opus: hasEncoder('libopus'),
      mp3: hasEncoder('libmp3lame'),
      webp: hasEncoder('libwebp'),
      drawtext: hasFilter('drawtext'),
      textAlign: /^\s*text_align\s/m.test(drawtextHelp),
      subtitles: hasFilter('subtitles'),
      filterUnits: /^\s*filter_units\s*$/m.test(bsfs),
    };
  }

  private async version(bin: string, name: string): Promise<ToolStatus> {
    const r = await runProcess(bin, ['-hide_banner', '-version'], { collectStdoutBytes: 256 * 1024, timeoutMs: 15_000 });
    if (r.spawnError) {
      return {
        available: false,
        path: bin,
        version: null,
        error:
          r.spawnError.code === 'ENOENT'
            ? `${name} não encontrado em "${bin}". Instale o FFmpeg ou ajuste ${name.toUpperCase()}_PATH.`
            : r.spawnError.message,
      };
    }
    if (r.code !== 0) return { available: false, path: bin, version: null, error: `${name} retornou código ${r.code}` };
    const m = r.stdout.match(new RegExp(`${name} version (\\S+)`));
    return { available: true, path: bin, version: m?.[1] ?? 'desconhecida', error: null };
  }
}
