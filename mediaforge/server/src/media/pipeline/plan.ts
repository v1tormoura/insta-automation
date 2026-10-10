import {
  effectiveSettings,
  METADATA_CATEGORY_LABELS,
  processingSettingsSchema,
  type AssetKind,
  type ImageFormat,
  type JobReport,
  type MediaInfo,
  type MetadataInspection,
  type OperationRecord,
  type ProcessingSettings,
  type SegmentSource,
  type VideoContainer,
} from '@mediaforge/shared';
import { z } from 'zod';
import { imageContainerOf } from '../metadata/imageMeta';
import { normalizeKey } from '../metadata/categories';
import type { MediaTools } from '../tools';
import {
  AUDIO_CODEC_LABEL,
  audioCodecAllowed,
  audioEncodeArgs,
  canCopyAudio,
  canCopyVideo,
  defaultAudioCodec,
  defaultVideoCodec,
  encoderAvailable,
  imageEncodeArgs,
  jpegQscale,
  MUXER,
  PROBE_NAME,
  qualityToCrf,
  VIDEO_CODEC_LABEL,
  videoCodecAllowed,
  videoEncodeArgs,
  type AudioCodec,
  type VideoCodec,
} from './codecs';
import { assColor, atempoChain, drawtextFilter, enableExpr, eqFilter, ffColor, fmtSec, fmtTime, num, overlayPositionExpr } from './filters';
import { computeGeometry, even, orientationFilters, type FilterStep } from './geometry';

export class PlanError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join(' '));
    this.name = 'PlanError';
  }
}

export interface PlanAsset {
  id: string;
  name: string;
  kind: AssetKind;
  ext: string;
  path: string;
  info: MediaInfo;
  metadata: MetadataInspection | null;
}

export interface PlanSegment {
  start: number;
  end: number;
  index: number;
  count: number;
}

export interface PlanContext {
  tools: MediaTools;
  ffmpegThreads: number;
  fontFileName: string;
  resolveAsset: (id: string) => PlanAsset | undefined;
  segment?: PlanSegment | null;
  preview?: { maxSeconds: number; offset: number } | null;
}

export interface ExpectedOutput {
  kind: 'video' | 'image';
  container: VideoContainer | ImageFormat;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  /** Cópia com corte: pontos de corte alinhados a keyframes (tolerância maior). */
  keyframeAligned: boolean;
}

export interface ProcessingPlan {
  strategy: JobReport['strategy'];
  strategyDescription: string;
  outputExt: string;
  outputFile: string;
  /** Argumentos do FFmpeg (null para limpeza de imagem sem perdas). */
  args: string[] | null;
  /** Arquivos que o executor grava no diretório da tarefa antes de rodar. */
  textFiles: Array<{ name: string; content: string }>;
  copyFiles: Array<{ from: string; to: string }>;
  needsFont: boolean;
  expected: ExpectedOutput;
  operations: OperationRecord[];
  skipped: Array<{ label: string; reason: string }>;
  warnings: string[];
  /** Duração usada no cálculo de progresso. */
  progressDuration: number | null;
  settings: ProcessingSettings;
  /** Imagem recodificada: reinserir EXIF/ICC preservados depois. */
  reinjectImageMetadata: boolean;
  /** Ids dos arquivos auxiliares usados (para conferência de integridade). */
  auxiliaryAssetIds: string[];
}

// ── Utilidades ─────────────────────────────────────────────────────────────

class Graph {
  private parts: string[] = [];
  private n = 0;
  label(prefix = 'l') {
    return `[${prefix}${this.n++}]`;
  }
  add(expr: string) {
    this.parts.push(expr);
  }
  /** Aplica passos a partir de um rótulo; devolve o rótulo de saída. */
  apply(input: string, steps: FilterStep[]): string {
    let cur = input;
    let pending: string[] = [];
    const flush = () => {
      if (!pending.length) return;
      const out = this.label('v');
      this.parts.push(`${cur}${pending.join(',')}${out}`);
      cur = out;
      pending = [];
    };
    for (const s of steps) {
      if (s.kind === 'simple') pending.push(s.filter);
      else {
        flush();
        const out = this.label('v');
        this.parts.push(s.build(cur, out, String(this.n++)));
        cur = out;
      }
    }
    flush();
    return cur;
  }
  applyAudio(input: string, filters: string[]): string {
    if (!filters.length) return input;
    const out = this.label('a');
    this.parts.push(`${input}${filters.join(',')}${out}`);
    return out;
  }
  get empty() {
    return this.parts.length === 0;
  }
  toString() {
    return this.parts.join(';');
  }
}

const simple = (filter: string): FilterStep => ({ kind: 'simple', filter });

function parseSettings(raw: unknown): ProcessingSettings {
  const r = processingSettingsSchema.safeParse(raw);
  if (!r.success) {
    throw new PlanError(r.error.issues.map((i) => `${i.path.join('.') || 'configuração'}: ${i.message}`));
  }
  return effectiveSettings(r.data);
}

const SOURCE_CONTAINER: Record<string, VideoContainer> = { mp4: 'mp4', mov: 'mov', webm: 'webm', mkv: 'mkv', m4v: 'mp4' };
const CONTAINER_LABEL: Record<string, string> = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', mkv: 'MKV', jpg: 'JPG', png: 'PNG', webp: 'WEBP' };
const IMAGE_FROM_EXT: Record<string, ImageFormat> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const STANDARD_MP4_TAGS = new Set([
  'title', 'artist', 'album', 'album_artist', 'comment', 'composer', 'copyright', 'date', 'description', 'encoder',
  'genre', 'grouping', 'lyrics', 'synopsis', 'show', 'episode_id', 'network', 'track', 'disc', 'creation_time', 'location',
  'keywords', 'compilation', 'media_type', 'hd_video', 'gapless_playback',
]);

function metadataOperation(s: ProcessingSettings): OperationRecord {
  const cats = Object.entries(s.metadata.remove)
    .filter(([, v]) => v)
    .map(([k]) => METADATA_CATEGORY_LABELS[k as keyof typeof METADATA_CATEGORY_LABELS].label);
  return {
    id: 'metadata',
    label: 'Limpeza de metadados',
    detail: cats.length ? `Remover: ${cats.join(', ')}` : 'Nenhuma categoria selecionada (metadados mantidos)',
  };
}

function anyMetadataRemoval(s: ProcessingSettings) {
  return Object.values(s.metadata.remove).some(Boolean);
}

// ── Entrada principal ──────────────────────────────────────────────────────

/**
 * Valida as configurações contra o arquivo e as capacidades instaladas e
 * produz o plano completo. Lança PlanError com mensagens em português quando
 * algo não pode ser feito — nada é silenciosamente ignorado: o que não se
 * aplica entra em `skipped` com o motivo.
 */
export function buildPlan(asset: PlanAsset, rawSettings: unknown, ctx: PlanContext): ProcessingPlan {
  const s = parseSettings(rawSettings);
  if (asset.kind === 'audio' || asset.kind === 'subtitle') {
    throw new PlanError([
      `"${asset.name}" é ${asset.kind === 'audio' ? 'um arquivo de áudio' : 'uma legenda'}: use-o como recurso auxiliar (trilha ou legenda) no modo editorial.`,
    ]);
  }
  if (!ctx.tools.ready) throw new PlanError(['FFmpeg/FFprobe indisponíveis. Verifique a instalação.']);
  return asset.kind === 'image' ? planImage(asset, s, ctx) : planVideo(asset, s, ctx);
}

// ── Imagens ────────────────────────────────────────────────────────────────

function planImage(asset: PlanAsset, s: ProcessingSettings, ctx: PlanContext): ProcessingPlan {
  const operations: OperationRecord[] = [{ id: 'inspect', label: 'Inspeção técnica', detail: `${asset.info.containerLong}` }];
  const skipped: ProcessingPlan['skipped'] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const info = asset.info;
  const srcFormat = IMAGE_FROM_EXT[asset.ext.toLowerCase()] ?? null;

  let format: ImageFormat;
  const requested = s.output.format;
  if (requested === 'jpg' || requested === 'png' || requested === 'webp') format = requested;
  else {
    format = srcFormat ?? 'png';
    if (requested !== 'original') skipped.push({ label: `Formato ${requested.toUpperCase()}`, reason: 'Formato de vídeo não se aplica a imagens; mantido o formato da imagem.' });
    if (!srcFormat) warnings.push(`${asset.ext.toUpperCase()} não é formato de saída; a imagem será gravada em PNG.`);
  }
  if (format === 'webp' && !ctx.tools.capabilities.webp) errors.push('O FFmpeg instalado não tem encoder WEBP (libwebp).');

  // Itens que não se aplicam a imagens
  const d = processingSettingsSchema.parse({ mode: s.mode });
  if (s.trim.start !== null || s.trim.end !== null) skipped.push({ label: 'Corte temporal', reason: 'Não se aplica a imagens.' });
  if (s.speed !== 1) skipped.push({ label: 'Velocidade', reason: 'Não se aplica a imagens.' });
  if (s.video.fps !== 'original') skipped.push({ label: 'Taxa de quadros', reason: 'Não se aplica a imagens.' });
  if (s.fade.in || s.fade.out) skipped.push({ label: 'Transições', reason: 'Não se aplica a imagens.' });
  if (s.audio.volume !== 1 || s.audio.mode !== d.audio.mode) skipped.push({ label: 'Áudio', reason: 'Imagens não têm áudio.' });
  const e = s.editorial;
  if (e.intro || e.outro || e.scenes.length) skipped.push({ label: 'Abertura/encerramento/cenas', reason: 'Disponível apenas para vídeos.' });
  if (e.audioTrack) skipped.push({ label: 'Trilha de áudio', reason: 'Imagens não têm áudio.' });
  if (e.subtitles) skipped.push({ label: 'Legendas', reason: 'Disponível apenas para vídeos.' });

  const orientation = asset.metadata?.orientation ?? null;
  const rotated = orientation !== null && orientation >= 5;
  const srcW = info.displayWidth ?? 0;
  const srcH = info.displayHeight ?? 0;
  const dispW = rotated ? srcH : srcW;
  const dispH = rotated ? srcW : srcH;
  const geo = computeGeometry(dispW, dispH, s.geometry);
  const eq = eqFilter(s.color);
  const hasTexts = e.texts.length > 0;
  const hasOverlays = e.overlays.length > 0;
  if (hasTexts && !ctx.tools.capabilities.drawtext) errors.push('O FFmpeg instalado não tem o filtro drawtext (textos).');

  // Geometria "original" sem mudança real não exige recodificação.
  const geometryChange = geo.changed && (geo.width !== even(dispW) || geo.height !== even(dispH) || s.geometry.crop !== null || geo.operations.length > 0);
  const transforms = geometryChange || !!eq || hasTexts || hasOverlays;
  const container = imageContainerOf(asset.ext);
  const lossless = !transforms && format === srcFormat && container !== null && !ctx.preview;

  if (errors.length) throw new PlanError(errors);

  const metaOp = metadataOperation(s);
  if (lossless) {
    operations.push({ ...metaOp, detail: `${metaOp.detail} — sem recodificar (dados da imagem copiados byte a byte)` });
    return {
      strategy: 'image-lossless',
      strategyDescription: 'Limpeza sem perdas: apenas os blocos de metadados são removidos ou reescritos; os dados comprimidos da imagem não são alterados.',
      outputExt: format,
      outputFile: `output.${format}`,
      args: null,
      textFiles: [],
      copyFiles: [],
      needsFont: false,
      expected: {
        kind: 'image',
        container: format,
        videoCodec: PROBE_NAME[format],
        audioCodec: null,
        width: info.streams.find((x) => x.index === info.videoIndex)?.width ?? null,
        height: info.streams.find((x) => x.index === info.videoIndex)?.height ?? null,
        durationSec: null,
        fps: null,
        bitrateKbps: null,
        keyframeAligned: false,
      },
      operations,
      skipped,
      warnings,
      progressDuration: null,
      settings: s,
      reinjectImageMetadata: false,
      auxiliaryAssetIds: [],
    };
  }

  // Recodificação via FFmpeg
  const g = new Graph();
  const inputs: string[] = ['-i', asset.path];
  const textFiles: ProcessingPlan['textFiles'] = [];
  const aux: string[] = [];
  const steps: FilterStep[] = [];
  const orient = orientationFilters(orientation);
  if (orient.length) {
    steps.push(...orient.map(simple));
    operations.push({ id: 'orientation', label: 'Orientação aplicada', detail: `EXIF ${orientation}: rotação gravada nos pixels` });
  }
  if (geometryChange) {
    steps.push(...geo.steps);
    operations.push(...geo.operations);
    warnings.push(...geo.warnings);
  }
  if (eq) {
    steps.push(simple(eq));
    operations.push(colorOperation(s));
  }
  const W = geometryChange ? geo.width : dispW;
  const H = geometryChange ? geo.height : dispH;
  e.texts.forEach((t, i) => {
    const name = `text-${i}.txt`;
    textFiles.push({ name, content: t.text });
    steps.push(
      simple(
        drawtextFilter({
          textFile: name,
          fontFile: ctx.fontFileName,
          textAlign: ctx.tools.capabilities.textAlign,
          frameHeight: H,
          frameWidth: W,
          overlay: { ...t, start: 0, end: null },
        }),
      ),
    );
    operations.push({ id: `text-${i}`, label: 'Texto sobreposto', detail: `"${clipText(t.text)}" — ${t.position}, ${t.size}% da altura` });
  });
  let cur = g.apply('[0:v]', steps);
  e.overlays.forEach((o, i) => {
    const a = requireAsset(ctx, o.assetId, ['image'], 'Elemento gráfico');
    aux.push(a.id);
    inputs.push('-i', a.path);
    const idx = inputs.filter((x) => x === '-i').length - 1;
    cur = addOverlay(g, cur, `[${idx}:v]`, a, o, W, H, i, operations, true);
  });

  const isPreview = !!ctx.preview;
  const outFormat: ImageFormat = isPreview ? 'jpg' : format;
  const finalSteps: FilterStep[] = [];
  if (isPreview) {
    const f = Math.min(1, 960 / Math.max(W, H));
    if (f < 1) finalSteps.push(simple(`scale=${even(W * f)}:${even(H * f)}`));
  }
  if (outFormat === 'jpg' && info.hasAlpha) {
    finalSteps.push({
      kind: 'complex',
      build: (input, output, uid) =>
        `${input}format=rgba,split[fgA${uid}][bgA${uid}];[bgA${uid}]drawbox=c=white@1:replace=1:t=fill[bgW${uid}];[bgW${uid}][fgA${uid}]overlay=format=auto${output}`,
    });
    operations.push({ id: 'flatten', label: 'Transparência', detail: 'Fundo branco aplicado (JPG não suporta transparência)' });
  }
  cur = g.apply(cur, finalSteps);
  if (format !== srcFormat)
    operations.push({ id: 'format', label: 'Conversão de formato', detail: `${(srcFormat ?? asset.ext).toUpperCase()} → ${format.toUpperCase()}` });
  operations.push(metaOp);
  const quality = isPreview ? 85 : s.image.quality;
  operations.push({
    id: 'image-codec',
    label: 'Codificação',
    detail: format === 'png' ? 'PNG sem perdas' : format === 'jpg' ? `JPEG qualidade ${quality} (q=${jpegQscale(quality)})` : `WEBP qualidade ${quality}`,
  });

  const args = [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats',
    ...inputs,
    ...(g.empty ? ['-map', '0:v:0'] : ['-filter_complex', g.toString(), '-map', cur]),
    ...imageEncodeArgs(outFormat, quality),
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-frames:v', '1', '-update', '1', '-f', 'image2',
    `output.${outFormat}`,
  ];
  const finalW = isPreview ? even(W * Math.min(1, 960 / Math.max(W, H))) : W;
  const finalH = isPreview ? even(H * Math.min(1, 960 / Math.max(W, H))) : H;
  return {
    strategy: 'image-encode',
    strategyDescription: 'Imagem recodificada pelo FFmpeg (transformações exigem decodificar e codificar os pixels). Campos preservados por escolha são reinseridos depois.',
    outputExt: outFormat,
    outputFile: `output.${outFormat}`,
    args,
    textFiles,
    copyFiles: [],
    needsFont: hasTexts,
    expected: {
      kind: 'image',
      container: outFormat,
      videoCodec: PROBE_NAME[outFormat],
      audioCodec: null,
      width: finalW,
      height: finalH,
      durationSec: null,
      fps: null,
      bitrateKbps: null,
      keyframeAligned: false,
    },
    operations,
    skipped,
    warnings,
    progressDuration: null,
    settings: s,
    reinjectImageMetadata: !isPreview,
    auxiliaryAssetIds: aux,
  };
}

function clipText(t: string) {
  const one = t.replace(/\s+/g, ' ');
  return one.length > 40 ? one.slice(0, 40) + '…' : one;
}

function colorOperation(s: ProcessingSettings): OperationRecord {
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return {
    id: 'color',
    label: 'Ajuste de cor',
    detail: `brilho ${sign(s.color.brightness)}, contraste ${sign(s.color.contrast)}, saturação ${sign(s.color.saturation)}`,
  };
}

function requireAsset(ctx: PlanContext, id: string, kinds: AssetKind[], label: string): PlanAsset {
  const a = ctx.resolveAsset(id);
  if (!a) throw new PlanError([`${label}: arquivo auxiliar não encontrado nesta sessão (importe-o novamente).`]);
  if (!kinds.includes(a.kind)) throw new PlanError([`${label}: "${a.name}" não é do tipo esperado (${kinds.join(' ou ')}).`]);
  return a;
}

function addOverlay(
  g: Graph,
  base: string,
  inputLabel: string,
  a: PlanAsset,
  o: ProcessingSettings['editorial']['overlays'][number],
  W: number,
  H: number,
  i: number,
  operations: OperationRecord[],
  still: boolean,
): string {
  const ow = even(W * o.scale);
  const margin = Math.round(Math.min(W, H) * o.margin);
  const steps = [...orientationFilters(a.metadata?.orientation), `scale=${ow}:-2:flags=lanczos`, 'format=rgba'];
  if (o.opacity < 1) steps.push(`colorchannelmixer=aa=${num(o.opacity, 3)}`);
  const lg = g.label('ov');
  g.add(`${inputLabel}${steps.join(',')}${lg}`);
  const { x, y } = overlayPositionExpr(o.position, margin);
  const out = g.label('v');
  g.add(`${base}${lg}overlay=x=${x}:y=${y}${still ? '' : enableExpr(o.start, o.end)}:format=auto${out}`);
  operations.push({
    id: `overlay-${i}`,
    label: 'Elemento gráfico',
    detail: `"${a.name}" ${o.position}, ${Math.round(o.scale * 100)}% da largura, opacidade ${Math.round(o.opacity * 100)}%${still ? '' : `, ${o.start}s–${o.end ?? 'fim'}`}`,
  });
  return out;
}

// ── Vídeos ─────────────────────────────────────────────────────────────────

interface Segment {
  role: 'intro' | 'main' | 'scene' | 'outro';
  label: string;
  duration: number;
  build: (g: Graph, W: number, H: number, F: number, withAudio: boolean) => { v: string; a: string | null };
}

function planVideo(asset: PlanAsset, s: ProcessingSettings, ctx: PlanContext): ProcessingPlan {
  const info = asset.info;
  const tools = ctx.tools;
  const operations: OperationRecord[] = [{ id: 'inspect', label: 'Inspeção técnica', detail: `${info.containerLong}, ${info.videoCodec ?? '?'} / ${info.audioCodec ?? 'sem áudio'}` }];
  const skipped: ProcessingPlan['skipped'] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const e = s.editorial;
  const preview = ctx.preview ?? null;
  if (info.videoIndex === null) throw new PlanError([`"${asset.name}" não tem fluxo de vídeo utilizável.`]);
  const vStream = info.streams.find((x) => x.index === info.videoIndex)!;
  const duration = info.durationSec ?? vStream.durationSec ?? 0;

  // Contêiner de saída
  let container: VideoContainer;
  const requested = s.output.format;
  if (requested === 'mp4' || requested === 'mov' || requested === 'webm' || requested === 'mkv') container = requested;
  else {
    const src = SOURCE_CONTAINER[asset.ext.toLowerCase()];
    container = src ?? 'mp4';
    if (requested !== 'original') skipped.push({ label: `Formato ${requested.toUpperCase()}`, reason: 'Formato de imagem não se aplica a vídeos; mantido o contêiner de vídeo.' });
    if (!src) warnings.push(`${asset.ext.toUpperCase()} não é contêiner de saída; o vídeo será gravado em MP4.`);
  }
  if (preview) container = 'mp4';

  // Corte (trim + divisão em partes)
  let start = s.trim.start ?? 0;
  let end = s.trim.end ?? duration;
  if (duration > 0 && start >= duration) errors.push(`Início do corte (${fmtSec(start)}) é posterior à duração do vídeo (${fmtSec(duration)}).`);
  if (duration > 0 && end > duration + 0.05) {
    warnings.push(`Fim do corte (${fmtSec(end)}) excede a duração; usado o fim do vídeo.`);
    end = duration;
  }
  if (ctx.segment) {
    start = ctx.segment.start;
    end = ctx.segment.end;
  }
  if (end - start < 0.1 && duration > 0) errors.push('O trecho selecionado é curto demais (mínimo 0,1 s).');
  const trimmed = start > 0.0005 || (duration > 0 && end < duration - 0.0005);
  const mainDur = Math.max(0, end - start) / s.speed;

  // Geometria
  const geo = computeGeometry(info.displayWidth ?? vStream.width ?? 2, info.displayHeight ?? vStream.height ?? 2, s.geometry);
  const W = geo.width;
  const H = geo.height;
  const eq = eqFilter(s.color);
  const fpsRequested = s.video.fps !== 'original' ? Number(s.video.fps) : null;
  const concat = !!(e.intro || e.outro || e.scenes.length);
  const F = fpsRequested ?? (concat ? Math.min(60, info.fps ?? 30) : null);
  const hasTexts = e.texts.length > 0;
  const fades = s.fade.in > 0 || s.fade.out > 0;
  if ((hasTexts || e.intro?.type === 'card' || e.outro?.type === 'card') && !tools.capabilities.drawtext)
    errors.push('O FFmpeg instalado não tem o filtro drawtext (textos e cartelas).');
  if (e.subtitles && !tools.capabilities.subtitles) errors.push('O FFmpeg instalado não tem o filtro de legendas (libass).');

  // Áudio
  const mainHasAudio = info.audioIndex !== null;
  const keepMainAudio = s.audio.mode === 'keep' && mainHasAudio;
  if (s.audio.mode === 'keep' && !mainHasAudio && !e.audioTrack && !concat)
    skipped.push({ label: 'Áudio', reason: 'O arquivo não tem faixa de áudio.' });
  const track = e.audioTrack;
  let trackAsset: PlanAsset | null = null;
  if (track) {
    trackAsset = requireAsset(ctx, track.assetId, ['audio', 'video'], 'Trilha de áudio');
    if (trackAsset.info.audioIndex === null) errors.push(`Trilha de áudio: "${trackAsset.name}" não tem fluxo de áudio.`);
  }

  // Segmentos (abertura, principal, cenas, encerramento)
  const aux: string[] = [];
  const inputs: string[][] = [];
  const textFiles: ProcessingPlan['textFiles'] = [];
  const copyFiles: ProcessingPlan['copyFiles'] = [];
  const addInput = (opts: string[], path: string) => {
    inputs.push([...opts, '-i', path]);
    return inputs.length - 1;
  };
  const mainInputOpts: string[] = [];
  if (start > 0.0005) mainInputOpts.push('-ss', num(start, 3));
  if (duration > 0 && end < duration - 0.0005) mainInputOpts.push('-t', num(end - start, 3));
  const mainIdx = addInput(mainInputOpts, asset.path);

  const contentSteps = (srcW: number, srcH: number, g0: typeof s.geometry, isMain: boolean): FilterStep[] => {
    const out: FilterStep[] = [];
    const gg = isMain ? geo : computeGeometry(srcW, srcH, { ...g0, crop: null, resolution: 'custom', width: W, height: H, keepAspect: false });
    out.push(...gg.steps);
    if (!isMain && gg.steps.length === 0) out.push(simple(`scale=${W}:${H}`), simple('setsar=1'));
    if (eq) out.push(simple(eq));
    if (s.speed !== 1) out.push(simple(`setpts=PTS/${num(s.speed, 6)}`));
    return out;
  };
  const audioPrep = (withConcat: boolean, speedApplies: boolean): string[] => {
    const f: string[] = [];
    if (s.audio.volume !== 1) f.push(`volume=${num(s.audio.volume, 3)}`);
    if (speedApplies && s.speed !== 1) f.push(...atempoChain(s.speed));
    if (withConcat) f.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    return f;
  };
  const silence = (g: Graph, dur: number) => {
    const out = g.label('sil');
    g.add(`anullsrc=r=48000:cl=stereo,atrim=0:${num(dur, 3)},asetpts=PTS-STARTPTS${out}`);
    return out;
  };
  const normalize = (F: number): FilterStep[] => [simple(`fps=${num(F, 3)}`), simple('format=yuv420p'), simple('setsar=1')];

  const sourceSegment = (src: SegmentSource, role: 'intro' | 'outro'): Segment => {
    if (src.type === 'card') {
      return {
        role,
        label: role === 'intro' ? 'Abertura (cartela)' : 'Encerramento (cartela)',
        duration: src.duration,
        build: (g, W2, H2, F2, withAudio) => {
          const idx = addInput(['-f', 'lavfi'], `color=c=${ffColor(src.background).replace(/@.*/, '')}:s=${W2}x${H2}:r=${num(F2, 3)}:d=${num(src.duration, 3)}`);
          const name = `card-${role}.txt`;
          textFiles.push({ name, content: src.text });
          const dt = drawtextFilter({
            textFile: name,
            fontFile: ctx.fontFileName,
            textAlign: ctx.tools.capabilities.textAlign,
            frameHeight: H2,
            frameWidth: W2,
            overlay: { position: 'center', size: src.size, color: src.color, opacity: 1, box: false, boxColor: '#000000', boxOpacity: 0, start: 0, end: null },
          });
          const v = g.apply(`[${idx}:v]`, [simple(dt), ...normalize(F2)]);
          return { v, a: withAudio ? silence(g, src.duration) : null };
        },
      };
    }
    const a = requireAsset(ctx, src.assetId, ['video', 'image'], role === 'intro' ? 'Abertura' : 'Encerramento');
    aux.push(a.id);
    const dur = a.kind === 'image' ? src.duration : a.info.durationSec ?? 0;
    return {
      role,
      label: `${role === 'intro' ? 'Abertura' : 'Encerramento'}: ${a.name}`,
      duration: dur,
      build: (g, W2, H2, F2, withAudio) => assetSegment(g, a, null, null, dur, W2, H2, F2, withAudio, false),
    };
  };

  const assetSegment = (
    g: Graph,
    a: PlanAsset,
    sStart: number | null,
    sEnd: number | null,
    dur: number,
    W2: number,
    H2: number,
    F2: number,
    withAudio: boolean,
    content: boolean,
  ): { v: string; a: string | null } => {
    if (a.kind === 'image') {
      const idx = addInput(['-loop', '1', '-framerate', num(F2, 3), '-t', num(dur, 3)], a.path);
      const o = a.metadata?.orientation ?? null;
      const rot = o !== null && o >= 5;
      const iw = rot ? a.info.displayHeight ?? 2 : a.info.displayWidth ?? 2;
      const ih = rot ? a.info.displayWidth ?? 2 : a.info.displayHeight ?? 2;
      const steps: FilterStep[] = [
        ...orientationFilters(o).map(simple),
        ...contentSteps(iw, ih, s.geometry, false).filter(
          (x) => !(x.kind === 'simple' && (x.filter.startsWith('setpts') || (!content && x.filter.startsWith('eq=')))),
        ),
      ];
      const v = g.apply(`[${idx}:v]`, [...steps, ...normalize(F2)]);
      return { v, a: withAudio ? silence(g, dur) : null };
    }
    const opts: string[] = [];
    if (sStart && sStart > 0) opts.push('-ss', num(sStart, 3));
    if (sEnd !== null) opts.push('-t', num(sEnd - (sStart ?? 0), 3));
    const idx = addInput(opts, a.path);
    const steps = content ? contentSteps(a.info.displayWidth ?? 2, a.info.displayHeight ?? 2, s.geometry, false) : contentSteps(a.info.displayWidth ?? 2, a.info.displayHeight ?? 2, s.geometry, false).filter((x) => !(x.kind === 'simple' && (x.filter.startsWith('eq=') || x.filter.startsWith('setpts'))));
    const v = g.apply(`[${idx}:${a.info.videoIndex}]`, [...steps, ...normalize(F2)]);
    let aud: string | null = null;
    if (withAudio) {
      aud =
        a.info.audioIndex !== null && s.audio.mode === 'keep'
          ? g.applyAudio(`[${idx}:${a.info.audioIndex}]`, [...audioPrep(true, content), `atrim=0:${num(dur, 3)}`, 'asetpts=PTS-STARTPTS'])
          : silence(g, dur);
    }
    return { v, a: aud };
  };

  const segments: Segment[] = [];
  if (e.intro) segments.push(sourceSegment(e.intro, 'intro'));
  segments.push({
    role: 'main',
    label: `Principal: ${asset.name}`,
    duration: mainDur,
    build: (g, _W, _H, F2, withAudio) => {
      const steps = contentSteps(0, 0, s.geometry, true);
      const v = g.apply(`[${mainIdx}:${info.videoIndex}]`, [...steps, ...normalize(F2)]);
      let a: string | null = null;
      if (withAudio) {
        a = keepMainAudio
          ? g.applyAudio(`[${mainIdx}:${info.audioIndex}]`, [...audioPrep(true, true), `atrim=0:${num(mainDur, 3)}`, 'asetpts=PTS-STARTPTS'])
          : silence(g, mainDur);
      }
      return { v, a };
    },
  });
  e.scenes.forEach((sc, i) => {
    const a = requireAsset(ctx, sc.assetId, ['video', 'image'], `Cena ${i + 1}`);
    aux.push(a.id);
    const aDur = a.info.durationSec ?? 0;
    const sStart = a.kind === 'video' ? sc.start ?? 0 : null;
    let sEnd = a.kind === 'video' ? sc.end ?? null : null;
    if (a.kind === 'video' && sEnd !== null && aDur && sEnd > aDur) sEnd = aDur;
    if (a.kind === 'video' && aDur && (sStart ?? 0) >= aDur) errors.push(`Cena ${i + 1}: início além da duração de "${a.name}".`);
    const dur = a.kind === 'image' ? sc.duration : ((sEnd ?? aDur) - (sStart ?? 0)) / s.speed;
    segments.push({
      role: 'scene',
      label: `Cena ${i + 1}: ${a.name}`,
      duration: dur,
      build: (g, W2, H2, F2, withAudio) => assetSegment(g, a, sStart, sEnd, dur, W2, H2, F2, withAudio, true),
    });
  });
  if (e.outro) segments.push(sourceSegment(e.outro, 'outro'));

  const totalDur = segments.reduce((acc, x) => acc + x.duration, 0);
  if (s.fade.in + s.fade.out > totalDur + 0.001) errors.push('As transições de entrada e saída somadas excedem a duração do resultado.');
  for (const [i, t] of e.texts.entries()) if (t.start >= totalDur) warnings.push(`Texto ${i + 1} começa depois do fim do vídeo e não aparecerá.`);

  const anySegmentAudio = segments.some((x) => x.role === 'main' ? keepMainAudio : x.role === 'scene' && s.audio.mode === 'keep');
  const hasAudioOut = !!trackAsset || (concat ? s.audio.mode === 'keep' && (keepMainAudio || anySegmentAudio) : keepMainAudio);

  const videoFiltersNeeded = geo.changed || !!eq || s.speed !== 1 || fpsRequested !== null || concat || hasTexts || e.overlays.length > 0 || !!e.subtitles || fades || !!preview;
  const audioFiltersNeeded = hasAudioOut && (s.audio.volume !== 1 || s.speed !== 1 || !!trackAsset || concat || fades);

  // Codecs
  let vCodec: VideoCodec | 'copy';
  const vChoice = s.video.codec;
  if (preview) vCodec = 'h264';
  // Automático: corte/divisão recodifica para os pontos de corte serem exatos
  // (cópia só corta em quadros-chave). Cópia com corte só quando pedida explicitamente.
  else if (vChoice === 'auto')
    vCodec = !videoFiltersNeeded && !trimmed && canCopyVideo(info.videoCodec, container) ? 'copy' : defaultVideoCodec(container);
  else if (vChoice === 'copy') {
    if (videoFiltersNeeded) errors.push('Cópia do fluxo de vídeo é impossível com as transformações selecionadas; escolha um codec.');
    else if (!canCopyVideo(info.videoCodec, container)) errors.push(`O codec ${info.videoCodec} não pode ser copiado para ${CONTAINER_LABEL[container]}.`);
    vCodec = 'copy';
  } else vCodec = vChoice;
  if (vCodec !== 'copy') {
    if (!videoCodecAllowed(vCodec, container)) errors.push(`${VIDEO_CODEC_LABEL[vCodec]} não é compatível com ${CONTAINER_LABEL[container]}.`);
    if (!encoderAvailable(tools, vCodec)) errors.push(`O FFmpeg instalado não tem encoder para ${VIDEO_CODEC_LABEL[vCodec]}.`);
  }

  let aCodec: AudioCodec | 'copy' | null = null;
  if (hasAudioOut) {
    const aChoice = s.audio.codec;
    if (preview) aCodec = 'aac';
    else if (aChoice === 'auto') aCodec = !audioFiltersNeeded && canCopyAudio(info.audioCodec, container) ? 'copy' : defaultAudioCodec(container);
    else if (aChoice === 'copy') {
      if (audioFiltersNeeded) errors.push('Cópia do fluxo de áudio é impossível com os ajustes de áudio selecionados; escolha um codec.');
      else if (!canCopyAudio(info.audioCodec, container)) errors.push(`O áudio ${info.audioCodec} não pode ser copiado para ${CONTAINER_LABEL[container]}.`);
      aCodec = 'copy';
    } else aCodec = aChoice;
    if (aCodec !== 'copy') {
      if (!audioCodecAllowed(aCodec, container)) errors.push(`${AUDIO_CODEC_LABEL[aCodec]} não é compatível com ${CONTAINER_LABEL[container]}.`);
      if (!encoderAvailable(tools, aCodec)) errors.push(`O FFmpeg instalado não tem encoder para ${AUDIO_CODEC_LABEL[aCodec]}.`);
    }
  }
  if (errors.length) throw new PlanError(errors);

  // Grafo de filtros
  const g = new Graph();
  let vOut: string;
  let aOut: string | null = null;
  if (concat) {
    const built = segments.map((seg) => seg.build(g, W, H, F!, hasAudioOut && !(trackAsset && track!.mode === 'replace')));
    const n = built.length;
    const withA = built.every((b) => b.a);
    const cv = g.label('cv');
    const ca = withA ? g.label('ca') : '';
    g.add(`${built.map((b) => `${b.v}${withA ? b.a : ''}`).join('')}concat=n=${n}:v=1:a=${withA ? 1 : 0}${cv}${ca}`);
    vOut = cv;
    aOut = withA ? ca : null;
    operations.push({
      id: 'sequence',
      label: 'Sequência',
      detail: segments.map((x) => `${x.label} (${fmtSec(x.duration)})`).join(' → '),
    });
  } else {
    const steps = contentSteps(0, 0, s.geometry, true);
    if (fpsRequested) steps.push(simple(`fps=${num(fpsRequested, 3)}`));
    vOut = g.apply(`[${mainIdx}:${info.videoIndex}]`, steps);
    if (keepMainAudio && !(trackAsset && track!.mode === 'replace')) {
      const af = audioPrep(false, true);
      aOut = af.length ? g.applyAudio(`[${mainIdx}:${info.audioIndex}]`, af) : `[${mainIdx}:${info.audioIndex}]`;
    }
  }

  // Textos, elementos gráficos, legendas e transições sobre o resultado
  const post: FilterStep[] = [];
  e.texts.forEach((t, i) => {
    const name = `text-${i}.txt`;
    textFiles.push({ name, content: t.text });
    post.push(
      simple(
        drawtextFilter({
          textFile: name,
          fontFile: ctx.fontFileName,
          textAlign: ctx.tools.capabilities.textAlign,
          frameHeight: H,
          frameWidth: W,
          overlay: t,
        }),
      ),
    );
    operations.push({
      id: `text-${i}`,
      label: 'Texto sobreposto',
      detail: `"${clipText(t.text)}" — ${t.position}, ${fmtTime(t.start)} até ${t.end === null ? 'o fim' : fmtTime(t.end)}`,
    });
  });
  vOut = g.apply(vOut, post);
  e.overlays.forEach((o, i) => {
    const a = requireAsset(ctx, o.assetId, ['image'], 'Elemento gráfico');
    aux.push(a.id);
    const idx = addInput([], a.path);
    vOut = addOverlay(g, vOut, `[${idx}:v]`, a, o, W, H, i, operations, false);
  });
  const post2: FilterStep[] = [];
  if (e.subtitles) {
    const sub = requireAsset(ctx, e.subtitles.assetId, ['subtitle'], 'Legendas');
    aux.push(sub.id);
    copyFiles.push({ from: sub.path, to: 'subs.srt' });
    const fontSize = Math.max(6, Math.round((e.subtitles.size * 288) / 100));
    const marginV = Math.round((e.subtitles.marginV * 288) / 100);
    const style = [
      'FontName=DejaVu Sans',
      'Bold=1',
      `FontSize=${fontSize}`,
      `PrimaryColour=${assColor(e.subtitles.color)}`,
      'OutlineColour=&H80000000',
      `BorderStyle=1`,
      `Outline=${e.subtitles.outline ? 2 : 0}`,
      'Shadow=0',
      `MarginV=${marginV}`,
    ].join(',');
    post2.push(simple(`subtitles=filename=subs.srt:fontsdir=fonts:force_style='${style}'`));
    operations.push({ id: 'subtitles', label: 'Legendas incorporadas', detail: `"${sub.name}" gravadas na imagem, ${e.subtitles.size}% da altura` });
  }
  if (s.fade.in > 0) post2.push(simple(`fade=t=in:st=0:d=${num(s.fade.in, 3)}`));
  if (s.fade.out > 0) post2.push(simple(`fade=t=out:st=${num(Math.max(0, totalDur - s.fade.out), 3)}:d=${num(s.fade.out, 3)}`));
  if (fades) operations.push({ id: 'fade', label: 'Transições', detail: `entrada ${fmtSec(s.fade.in)}, saída ${fmtSec(s.fade.out)}` });
  let previewDims: { w: number; h: number } | null = null;
  if (preview) {
    const f = Math.min(1, 640 / Math.max(W, H));
    previewDims = { w: even(W * f), h: even(H * f) };
    if (f < 1) post2.push(simple(`scale=${previewDims.w}:${previewDims.h}`));
  }
  vOut = g.apply(vOut, post2);

  // Trilha de áudio
  if (trackAsset && track) {
    const tIdx = addInput(track.loop ? ['-stream_loop', '-1'] : [], trackAsset.path);
    aux.push(trackAsset.id);
    const tf = [`volume=${num(track.volume, 3)}`];
    if (!track.loop) tf.push('apad');
    tf.push(`atrim=0:${num(totalDur, 3)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    const trk = g.applyAudio(`[${tIdx}:${trackAsset.info.audioIndex}]`, tf);
    if (track.mode === 'mix' && aOut) {
      const base = g.applyAudio(aOut, [`volume=${num(track.originalVolume, 3)}`, 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo']);
      const mixed = g.label('a');
      g.add(`${base}${trk}amix=inputs=2:duration=first:dropout_transition=0:normalize=0${mixed}`);
      aOut = mixed;
      operations.push({ id: 'audio-track', label: 'Trilha de áudio mixada', detail: `"${trackAsset.name}" a ${Math.round(track.volume * 100)}% + original a ${Math.round(track.originalVolume * 100)}%${track.loop ? ', em repetição' : ''}` });
    } else {
      if (track.mode === 'mix') warnings.push('Mixagem pedida, mas o vídeo não tem áudio a mixar: a trilha substitui o áudio.');
      aOut = trk;
      operations.push({ id: 'audio-track', label: 'Trilha de áudio substituída', detail: `"${trackAsset.name}" a ${Math.round(track.volume * 100)}%${track.loop ? ', em repetição' : ''}` });
    }
  }
  if (aOut && fades) {
    const af: string[] = [];
    if (s.fade.in > 0) af.push(`afade=t=in:st=0:d=${num(s.fade.in, 3)}`);
    if (s.fade.out > 0) af.push(`afade=t=out:st=${num(Math.max(0, totalDur - s.fade.out), 3)}:d=${num(s.fade.out, 3)}`);
    aOut = g.applyAudio(aOut, af);
  }

  // Registro das operações
  if (trimmed)
    operations.push({
      id: ctx.segment ? 'segment' : 'trim',
      label: ctx.segment ? 'Divisão em partes' : 'Corte temporal',
      detail: `${fmtTime(start)} → ${fmtTime(end)} (${fmtSec(end - start)})${ctx.segment ? `, parte ${ctx.segment.index} de ${ctx.segment.count}` : ''}`,
    });
  if (!concat) operations.push(...geo.operations);
  else if (geo.operations.length) operations.push(...geo.operations.map((o) => ({ ...o, detail: `${o.detail} (todas as cenas normalizadas)` })));
  warnings.push(...geo.warnings);
  if (eq) operations.push(colorOperation(s));
  if (s.speed !== 1) operations.push({ id: 'speed', label: 'Velocidade', detail: `${String(s.speed).replace('.', ',')}×${hasAudioOut ? ' (áudio ajustado sem alterar o tom)' : ''}` });
  if (fpsRequested) operations.push({ id: 'fps', label: 'Taxa de quadros', detail: `${fpsRequested} fps` });
  if (hasAudioOut && s.audio.volume !== 1 && (keepMainAudio || concat))
    operations.push({ id: 'volume', label: 'Volume do áudio', detail: `×${s.audio.volume} (${(20 * Math.log10(Math.max(s.audio.volume, 1e-4))).toFixed(1).replace('.', ',')} dB)` });
  if (s.audio.mode === 'remove' && mainHasAudio && !trackAsset) operations.push({ id: 'audio-remove', label: 'Remoção do áudio', detail: 'Faixa de áudio não incluída na saída' });
  const srcContainer = SOURCE_CONTAINER[asset.ext.toLowerCase()];
  if (container !== srcContainer && !preview)
    operations.push({ id: 'format', label: 'Conversão de formato', detail: `${(srcContainer ?? asset.ext).toUpperCase()} → ${CONTAINER_LABEL[container]}` });
  operations.push(metadataOperation(s));

  // Argumentos
  const args: string[] = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats'];
  for (const inp of inputs) args.push(...inp);
  const usesGraph = !g.empty;
  if (usesGraph) args.push('-filter_complex', g.toString());
  const isLabel = (x: string) => x.startsWith('[') && !/^\[\d+:\d+\]$/.test(x);
  args.push('-map', isLabel(vOut) ? vOut : `${mainIdx}:${info.videoIndex}`);
  if (aOut) args.push('-map', isLabel(aOut) ? aOut : `${mainIdx}:${info.audioIndex}`);

  if (vCodec === 'copy') {
    args.push('-c:v', 'copy');
    operations.push({ id: 'video-codec', label: 'Codec de vídeo', detail: `Cópia direta (${info.videoCodec}), sem recodificar` });
  } else {
    args.push(
      ...videoEncodeArgs(tools, {
        codec: vCodec,
        rateControl: s.video.rateControl,
        quality: s.video.quality,
        bitrateKbps: s.video.bitrateKbps,
        speed: s.video.speed,
        threads: ctx.ffmpegThreads,
        preview: !!preview,
      }),
    );
    operations.push({
      id: 'video-codec',
      label: 'Codec de vídeo',
      detail: `${VIDEO_CODEC_LABEL[vCodec]}, ${s.video.rateControl === 'bitrate' && !preview ? `${s.video.bitrateKbps} kb/s` : `qualidade ${s.video.quality} (CRF ${qualityToCrf(vCodec, s.video.quality)})`}, velocidade "${s.video.speed}"`,
    });
  }
  if (aOut) {
    if (aCodec === 'copy') {
      args.push('-c:a', 'copy');
      operations.push({ id: 'audio-codec', label: 'Codec de áudio', detail: `Cópia direta (${info.audioCodec})` });
    } else if (aCodec) {
      args.push(...audioEncodeArgs(aCodec, preview ? 128 : s.audio.bitrateKbps));
      operations.push({ id: 'audio-codec', label: 'Codec de áudio', detail: `${AUDIO_CODEC_LABEL[aCodec]} ${preview ? 128 : s.audio.bitrateKbps} kb/s` });
    }
  } else args.push('-an');
  args.push('-sn', '-dn');

  // Metadados: descarta tudo e regrava só o que foi preservado por escolha.
  const meta = s.metadata;
  args.push('-map_metadata', '-1');
  const chaptersKept = !meta.remove.container && !trimmed && !concat && s.speed === 1;
  args.push('-map_chapters', chaptersKept ? String(mainIdx) : '-1');
  let customTags = false;
  if (asset.metadata && !preview) {
    for (const item of asset.metadata.items) {
      if (item.category === 'technical' || meta.remove[item.category]) continue;
      if (item.scope === 'container') {
        if (normalizeKey(item.key) === 'encoder' && !meta.remove.software) continue; // o muxer regrava
        args.push('-metadata', `${item.key}=${item.value}`);
        if (!STANDARD_MP4_TAGS.has(normalizeKey(item.key))) customTags = true;
      } else if (item.scope === 'stream' && (item.id.startsWith('st:v:') || item.id.startsWith('st:a:'))) {
        const k = normalizeKey(item.key);
        if (k === 'encoder' || k === 'duration' || k.startsWith('_statistics') || k === 'number_of_frames' || k === 'number_of_bytes' || k === 'bps') continue;
        if (item.id.startsWith('st:a:') && !aOut) continue;
        args.push(`-metadata:s:${item.id.startsWith('st:v:') ? 'v' : 'a'}:0`, `${item.key}=${item.value}`);
      }
    }
  }
  if (meta.remove.software || preview) {
    args.push('-fflags', '+bitexact');
    if (vCodec !== 'copy') args.push('-flags:v', '+bitexact');
    if (aOut && aCodec !== 'copy') args.push('-flags:a', '+bitexact');
  }
  const outVideoCodec = vCodec === 'copy' ? info.videoCodec : vCodec;
  if (meta.remove.embedded && !preview) {
    const hdr = /smpte2084|arib-std-b67/.test(vStream.colorTransfer ?? '');
    if (!tools.capabilities.filterUnits) warnings.push('Filtro de bitstream "filter_units" indisponível: SEI não removida.');
    else if (outVideoCodec === 'h264') {
      args.push('-bsf:v', 'filter_units=remove_types=6');
      operations.push({ id: 'sei', label: 'Remoção de SEI', detail: 'Unidades SEI do H.264 removidas do bitstream (sem recodificar)' });
    } else if (outVideoCodec === 'hevc') {
      if (hdr && vCodec === 'copy') warnings.push('Vídeo HDR: a SEI do HEVC carrega metadados HDR e não foi removida para não alterar a imagem.');
      else {
        args.push('-bsf:v', 'filter_units=remove_types=39|40');
        operations.push({ id: 'sei', label: 'Remoção de SEI', detail: 'Unidades SEI do HEVC removidas do bitstream' });
      }
    } else skipped.push({ label: 'Remoção de SEI', reason: `${outVideoCodec?.toUpperCase()} não usa SEI.` });
  }
  if (container === 'mp4' || container === 'mov') args.push('-movflags', customTags ? '+faststart+use_metadata_tags' : '+faststart');
  if (preview) {
    if (preview.offset > 0) args.push('-ss', num(Math.min(preview.offset, Math.max(0, totalDur - 0.5)), 3));
    args.push('-t', num(preview.maxSeconds, 3));
  }
  args.push('-f', MUXER[container], `output.${container}`);

  // Resultado esperado
  const copyV = vCodec === 'copy';
  const expectedDur = preview ? Math.min(preview.maxSeconds, Math.max(0.1, totalDur - Math.min(preview.offset, Math.max(0, totalDur - 0.5)))) : totalDur;
  const strategy: JobReport['strategy'] = copyV && (!aOut || aCodec === 'copy') ? 'stream-copy' : 're-encode';
  const strategyDescription =
    strategy === 'stream-copy'
      ? 'Cópia de fluxos: vídeo e áudio são copiados sem recodificar; só o contêiner e os metadados são reescritos.'
      : copyV
        ? 'Vídeo copiado sem recodificar; áudio recodificado.'
        : 'Recodificação: as transformações exigem decodificar e codificar o vídeo.';
  if (copyV && trimmed) warnings.push('Corte com cópia de fluxo: os pontos de corte se alinham aos quadros-chave mais próximos.');

  return {
    strategy,
    strategyDescription,
    outputExt: container,
    outputFile: `output.${container}`,
    args,
    textFiles,
    copyFiles,
    needsFont: textFiles.length > 0 || !!e.subtitles,
    expected: {
      kind: 'video',
      container,
      videoCodec: outVideoCodec ? PROBE_NAME[outVideoCodec as VideoCodec] ?? outVideoCodec : null,
      audioCodec: aOut ? (aCodec === 'copy' ? info.audioCodec : PROBE_NAME[aCodec as AudioCodec]) : null,
      width: copyV ? vStream.width ?? null : previewDims?.w ?? W,
      height: copyV ? vStream.height ?? null : previewDims?.h ?? H,
      durationSec: expectedDur > 0 ? expectedDur : null,
      fps: preview ? null : F && (fpsRequested || concat) ? F : null,
      bitrateKbps: !preview && !copyV && s.video.rateControl === 'bitrate' ? s.video.bitrateKbps : null,
      keyframeAligned: copyV && trimmed,
    },
    operations,
    skipped,
    warnings,
    progressDuration: expectedDur > 0 ? expectedDur : null,
    settings: s,
    reinjectImageMetadata: false,
    auxiliaryAssetIds: [...new Set(aux)],
  };
}

/** Formata erros de validação do zod (exportado para as rotas). */
export function zodMessages(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`);
}

export { anyMetadataRemoval };
