import { z } from 'zod';

/**
 * Esquema único das configurações de processamento.
 *
 * O mesmo esquema é usado pela interface (para montar os controles) e pelo
 * servidor (para validar cada requisição antes de criar tarefas). Todo campo
 * tem limite explícito: nada chega ao FFmpeg sem passar por aqui.
 */

export const PROCESSING_MODES = ['quick', 'custom', 'editorial'] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const OUTPUT_FORMATS = ['original', 'mp4', 'mov', 'webm', 'mkv', 'jpg', 'png', 'webp'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export const VIDEO_CONTAINERS = ['mp4', 'mov', 'webm', 'mkv'] as const;
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];
export const IMAGE_FORMATS = ['jpg', 'png', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const VIDEO_CODECS = ['auto', 'copy', 'h264', 'hevc', 'vp9', 'av1'] as const;
export type VideoCodecChoice = (typeof VIDEO_CODECS)[number];
export const AUDIO_CODECS = ['auto', 'copy', 'aac', 'opus', 'mp3'] as const;
export type AudioCodecChoice = (typeof AUDIO_CODECS)[number];

export const ASPECTS = ['original', '9:16', '4:5', '1:1', '16:9'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const FITS = ['crop', 'pad', 'blur', 'stretch'] as const;
export type FitMode = (typeof FITS)[number];
export const RESOLUTIONS = ['original', '2160', '1440', '1080', '720', '540', '480', '360', 'custom'] as const;
export type ResolutionChoice = (typeof RESOLUTIONS)[number];
export const ENCODER_SPEEDS = ['fast', 'balanced', 'quality'] as const;
export type EncoderSpeed = (typeof ENCODER_SPEEDS)[number];
export const FPS_CHOICES = ['original', '24', '25', '30', '50', '60'] as const;
export type FpsChoice = (typeof FPS_CHOICES)[number];

export const METADATA_CATEGORIES = [
  'gps',
  'dates',
  'device',
  'descriptive',
  'software',
  'custom',
  'container',
  'streams',
  'embedded',
] as const;
export type MetadataCategory = (typeof METADATA_CATEGORIES)[number];

export const TEXT_POSITIONS = [
  'top',
  'center',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export const OVERLAY_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB)');
const seconds = z.number().finite().min(0).max(86_400);
const assetId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Identificador de arquivo inválido');
/** Texto livre exibido no vídeo: sem caracteres de controle (exceto quebra de linha). */
const overlayText = z
  .string()
  .min(1, 'Texto vazio')
  .max(500)
  .refine((v) => !/[\u0000-\u0009\u000B-\u001F\u007F]/.test(v), 'Texto contém caracteres de controle');

export const metadataSettingsSchema = z
  .object({
    remove: z
      .object({
        gps: z.boolean().default(true),
        dates: z.boolean().default(true),
        device: z.boolean().default(true),
        descriptive: z.boolean().default(true),
        software: z.boolean().default(true),
        custom: z.boolean().default(true),
        container: z.boolean().default(true),
        streams: z.boolean().default(true),
        /** SEI do H.264/HEVC (parâmetros do encoder gravados no próprio bitstream). Opt-in. */
        embedded: z.boolean().default(false),
      })
      .prefault({}),
    /** Mantém a orientação (EXIF Orientation / matriz de exibição) para a mídia não aparecer girada. */
    preserveOrientation: z.boolean().default(true),
    /** Mantém o perfil de cor ICC das imagens (remover pode alterar as cores exibidas). */
    preserveColorProfile: z.boolean().default(true),
  })
  .prefault({});

export const outputSettingsSchema = z
  .object({
    format: z.enum(OUTPUT_FORMATS).default('original'),
  })
  .prefault({});

export const videoSettingsSchema = z
  .object({
    codec: z.enum(VIDEO_CODECS).default('auto'),
    rateControl: z.enum(['quality', 'bitrate']).default('quality'),
    /** 0–100 (100 = melhor). Convertido para CRF de acordo com o codec. */
    quality: z.number().int().min(0).max(100).default(70),
    bitrateKbps: z.number().int().min(100).max(200_000).default(6000),
    speed: z.enum(ENCODER_SPEEDS).default('balanced'),
    fps: z.enum(FPS_CHOICES).default('original'),
  })
  .prefault({});

export const audioSettingsSchema = z
  .object({
    mode: z.enum(['keep', 'remove']).default('keep'),
    codec: z.enum(AUDIO_CODECS).default('auto'),
    bitrateKbps: z.number().int().min(32).max(512).default(160),
    /** Multiplicador linear de volume (1 = inalterado). */
    volume: z.number().min(0).max(4).default(1),
  })
  .prefault({});

export const cropRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.05).max(1),
    h: z.number().min(0.05).max(1),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, 'Área de corte ultrapassa a imagem');
export type CropRect = z.infer<typeof cropRectSchema>;

export const geometrySettingsSchema = z
  .object({
    aspect: z.enum(ASPECTS).default('original'),
    fit: z.enum(FITS).default('crop'),
    resolution: z.enum(RESOLUTIONS).default('original'),
    width: z.number().int().min(16).max(8192).default(1080),
    height: z.number().int().min(16).max(8192).default(1920),
    /** Com resolução personalizada: encaixa dentro de largura×altura sem distorcer. */
    keepAspect: z.boolean().default(true),
    /** Ponto de ancoragem do reenquadramento (0 = esquerda/topo, 1 = direita/base). */
    anchorX: z.number().min(0).max(1).default(0.5),
    anchorY: z.number().min(0).max(1).default(0.5),
    crop: cropRectSchema.nullable().default(null),
    padColor: hexColor.default('#000000'),
  })
  .prefault({});

export const trimSettingsSchema = z
  .object({
    start: seconds.nullable().default(null),
    end: seconds.nullable().default(null),
  })
  .prefault({})
  .refine((t) => t.start == null || t.end == null || t.end > t.start, 'O fim do corte deve ser maior que o início');

export const colorSettingsSchema = z
  .object({
    /** -100..100 → eq brightness -0.3..0.3 */
    brightness: z.number().min(-100).max(100).default(0),
    /** -100..100 → eq contrast 0..2 */
    contrast: z.number().min(-100).max(100).default(0),
    /** -100..100 → eq saturation 0..2 */
    saturation: z.number().min(-100).max(100).default(0),
  })
  .prefault({});

export const fadeSettingsSchema = z
  .object({
    in: z.number().min(0).max(10).default(0),
    out: z.number().min(0).max(10).default(0),
  })
  .prefault({});

export const segmentSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('asset'),
    assetId,
    /** Duração quando a fonte é uma imagem (segundos). */
    duration: z.number().min(0.5).max(30).default(3),
  }),
  z.object({
    type: z.literal('card'),
    text: overlayText,
    duration: z.number().min(0.5).max(30).default(3),
    background: hexColor.default('#0A1022'),
    color: hexColor.default('#FFFFFF'),
    /** Tamanho do texto em % da altura do quadro. */
    size: z.number().min(2).max(20).default(7),
  }),
]);
export type SegmentSource = z.infer<typeof segmentSourceSchema>;

export const sceneSchema = z
  .object({
    assetId,
    start: seconds.nullable().default(null),
    end: seconds.nullable().default(null),
    /** Duração quando a cena é uma imagem. */
    duration: z.number().min(0.5).max(30).default(3),
  })
  .refine((s) => s.start == null || s.end == null || s.end > s.start, 'Cena com fim antes do início');
export type Scene = z.infer<typeof sceneSchema>;

export const textOverlaySchema = z
  .object({
    text: overlayText,
    start: seconds.default(0),
    end: seconds.nullable().default(null),
    position: z.enum(TEXT_POSITIONS).default('bottom'),
    /** Tamanho em % da altura do quadro. */
    size: z.number().min(1).max(20).default(5),
    color: hexColor.default('#FFFFFF'),
    opacity: z.number().min(0.05).max(1).default(1),
    box: z.boolean().default(true),
    boxColor: hexColor.default('#000000'),
    boxOpacity: z.number().min(0).max(1).default(0.45),
  })
  .refine((t) => t.end == null || t.end > t.start, 'Texto com fim antes do início');
export type TextOverlay = z.infer<typeof textOverlaySchema>;

export const imageOverlaySchema = z
  .object({
    assetId,
    position: z.enum(OVERLAY_POSITIONS).default('top-right'),
    /** Largura do elemento como fração da largura do quadro. */
    scale: z.number().min(0.02).max(1).default(0.18),
    opacity: z.number().min(0.05).max(1).default(1),
    /** Margem como fração da menor dimensão do quadro. */
    margin: z.number().min(0).max(0.2).default(0.03),
    start: seconds.default(0),
    end: seconds.nullable().default(null),
  })
  .refine((o) => o.end == null || o.end > o.start, 'Elemento gráfico com fim antes do início');
export type ImageOverlay = z.infer<typeof imageOverlaySchema>;

export const subtitleSettingsSchema = z.object({
  assetId,
  /** Tamanho em % da altura do quadro. */
  size: z.number().min(2).max(12).default(4.5),
  color: hexColor.default('#FFFFFF'),
  outline: z.boolean().default(true),
  /** Distância da base em % da altura. */
  marginV: z.number().min(0).max(40).default(6),
});

export const audioTrackSchema = z.object({
  assetId,
  mode: z.enum(['replace', 'mix']).default('replace'),
  volume: z.number().min(0).max(4).default(1),
  /** Volume do áudio original quando mode = mix. */
  originalVolume: z.number().min(0).max(4).default(0.6),
  loop: z.boolean().default(true),
});

export const editorialSettingsSchema = z
  .object({
    intro: segmentSourceSchema.nullable().default(null),
    outro: segmentSourceSchema.nullable().default(null),
    scenes: z.array(sceneSchema).max(20).default([]),
    texts: z.array(textOverlaySchema).max(10).default([]),
    overlays: z.array(imageOverlaySchema).max(5).default([]),
    subtitles: subtitleSettingsSchema.nullable().default(null),
    audioTrack: audioTrackSchema.nullable().default(null),
  })
  .prefault({});

export const segmentationSchema = z
  .object({
    mode: z.enum(['none', 'count', 'duration']).default('none'),
    /** Quantidade de partes (count) ou duração de cada parte em segundos (duration). */
    value: z.number().min(1).max(3600).default(2),
  })
  .prefault({});

export const imageSettingsSchema = z
  .object({
    /** 0–100 para JPG/WEBP (100 = melhor). */
    quality: z.number().int().min(1).max(100).default(90),
  })
  .prefault({});

export const processingSettingsSchema = z.object({
  mode: z.enum(PROCESSING_MODES).default('quick'),
  output: outputSettingsSchema,
  metadata: metadataSettingsSchema,
  video: videoSettingsSchema,
  audio: audioSettingsSchema,
  image: imageSettingsSchema,
  geometry: geometrySettingsSchema,
  trim: trimSettingsSchema,
  color: colorSettingsSchema,
  speed: z.number().min(0.25).max(4).default(1),
  fade: fadeSettingsSchema,
  editorial: editorialSettingsSchema,
  segmentation: segmentationSchema,
});

export type ProcessingSettings = z.infer<typeof processingSettingsSchema>;
export type ProcessingSettingsInput = z.input<typeof processingSettingsSchema>;
export type MetadataSettings = ProcessingSettings['metadata'];
export type GeometrySettings = ProcessingSettings['geometry'];
export type EditorialSettings = ProcessingSettings['editorial'];

export function defaultSettings(mode: ProcessingMode = 'quick'): ProcessingSettings {
  return processingSettingsSchema.parse({ mode });
}

/**
 * Mantém só as seções que o modo realmente aplica. O modo rápido não aplica
 * geometria/cor/velocidade; o personalizado não aplica o módulo editorial.
 * Isto garante que nenhum ajuste "escondido" de outro modo chegue ao FFmpeg.
 */
export function effectiveSettings(input: ProcessingSettings): ProcessingSettings {
  const base = defaultSettings(input.mode);
  const s: ProcessingSettings = structuredClone(input);
  if (s.mode === 'quick') {
    s.geometry = base.geometry;
    s.trim = base.trim;
    s.color = base.color;
    s.speed = 1;
    s.fade = base.fade;
    s.editorial = base.editorial;
    s.segmentation = base.segmentation;
    s.video.fps = 'original';
    s.audio.volume = 1;
  } else if (s.mode === 'custom') {
    s.editorial = base.editorial;
    s.fade = base.fade;
  }
  return s;
}

/** Mescla profunda simples (objetos planos; arrays e valores são substituídos). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return structuredClone(patch) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

/** Ids de arquivos auxiliares referenciados pelas configurações editoriais. */
export function referencedAssetIds(s: ProcessingSettings): string[] {
  const ids = new Set<string>();
  const e = s.editorial;
  if (e.intro?.type === 'asset') ids.add(e.intro.assetId);
  if (e.outro?.type === 'asset') ids.add(e.outro.assetId);
  for (const sc of e.scenes) ids.add(sc.assetId);
  for (const o of e.overlays) ids.add(o.assetId);
  if (e.subtitles) ids.add(e.subtitles.assetId);
  if (e.audioTrack) ids.add(e.audioTrack.assetId);
  return [...ids];
}
