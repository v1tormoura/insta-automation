import type { MetadataCategory, ProcessingMode, ProcessingSettings } from './settings';

export type AssetKind = 'video' | 'image' | 'audio' | 'subtitle';
export type AssetStatus = 'ready' | 'invalid';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
export type JobPhase = 'aguardando' | 'preparando' | 'processando' | 'validando' | 'finalizando';
export type ValidationStatus = 'passed' | 'warning' | 'failed';

/** Onde o campo de metadado foi encontrado. */
export type MetadataScope =
  | 'container'
  | 'stream'
  | 'side-data'
  | 'chapter'
  | 'extra-stream'
  | 'box'
  | 'bitstream'
  | 'exif'
  | 'xmp'
  | 'iptc'
  | 'icc'
  | 'png-chunk'
  | 'jpeg-segment'
  | 'webp-chunk';

export interface MetadataItem {
  /** Chave estável usada na comparação entrada × saída. */
  id: string;
  scope: MetadataScope;
  /** Ex.: "format", "stream 0 (vídeo)", "EXIF GPS". */
  location: string;
  key: string;
  value: string;
  category: MetadataCategory | 'technical';
  /** Contém dado potencialmente pessoal (localização, aparelho, datas…). */
  sensitive: boolean;
  /** Pode ser removido sem destruir a mídia. */
  removable: boolean;
  note?: string;
}

export interface MetadataInspection {
  items: MetadataItem[];
  /** Avisos de inspeção (estruturas que não puderam ser lidas etc.). */
  warnings: string[];
  orientation?: number | null;
}

export interface MediaStreamInfo {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'unknown';
  codec: string | null;
  codecLong: string | null;
  codecTag: string | null;
  width?: number;
  height?: number;
  pixFmt?: string | null;
  fps?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  bitrate?: number | null;
  durationSec?: number | null;
  rotation?: number;
  attachedPic?: boolean;
  colorTransfer?: string | null;
}

export interface MediaInfo {
  container: string;
  containerLong: string;
  durationSec: number | null;
  bitrate: number | null;
  sizeBytes: number;
  streams: MediaStreamInfo[];
  /** Índice do fluxo de vídeo principal (sem capas/anexos). */
  videoIndex: number | null;
  audioIndex: number | null;
  /** Dimensões de exibição já considerando rotação. */
  displayWidth: number | null;
  displayHeight: number | null;
  rotation: number;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAlpha: boolean;
  /** Número de quadros quando é imagem animada/vídeo curto (quando conhecido). */
  frames?: number | null;
  /**
   * Rotação que o próprio decodificador aplica ao quadro (ex.: orientação EXIF de
   * JPEG no FFmpeg 6+). Quando presente, o FFmpeg já gira a imagem sozinho.
   */
  decoderRotation?: number | null;
}

export interface AssetDTO {
  id: string;
  kind: AssetKind;
  name: string;
  ext: string;
  size: number;
  sha256: string;
  status: AssetStatus;
  error: string | null;
  createdAt: number;
  container: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  bitrate: number | null;
  thumbnailUrl: string | null;
  fileUrl: string;
  /** Outros arquivos da sessão com o mesmo SHA-256 (cópias idênticas). */
  duplicateOf: string[];
  metadataSummary: {
    total: number;
    sensitive: number;
    byCategory: Partial<Record<MetadataCategory | 'technical', number>>;
  };
}

export interface AssetDetailDTO extends AssetDTO {
  info: MediaInfo | null;
  metadata: MetadataInspection | null;
}

export interface JobOutputDTO {
  name: string;
  size: number;
  sha256: string;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  fps: number | null;
  hasAudio: boolean;
  kind: AssetKind;
  thumbnailUrl: string | null;
  previewUrl: string;
  downloadUrl: string;
  reportUrl: string;
}

export interface JobDTO {
  id: string;
  batchId: string;
  assetId: string;
  assetName: string;
  assetKind: AssetKind;
  label: string;
  mode: ProcessingMode;
  profileName: string | null;
  status: JobStatus;
  phase: JobPhase | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  errorCode: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  validationStatus: ValidationStatus | null;
  output: JobOutputDTO | null;
}

export interface BatchDTO {
  id: string;
  label: string;
  mode: ProcessingMode;
  scope: 'common' | 'individual';
  createdAt: number;
  counts: Record<JobStatus, number> & { total: number };
  progress: number;
}

export interface HistoryEntryDTO {
  id: number;
  type: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: number;
}

export interface OperationRecord {
  id: string;
  label: string;
  detail: string;
}

export interface MetadataComparison {
  removed: Array<MetadataItem & { how: 'ausente' | 'substituido'; requested: boolean }>;
  preserved: Array<MetadataItem & { reason: string }>;
  /** Pedido para remover, mas ainda presente ou não comprovado. */
  unverified: Array<MetadataItem & { reason: string }>;
  /** Campos novos na saída (gerados pelo contêiner/encoder). */
  added: MetadataItem[];
  verdict: 'comprovado' | 'parcial' | 'nao-comprovado' | 'nada-a-remover' | 'nao-solicitado';
  notes: string[];
}

export interface ValidationCheck {
  name: string;
  expected: string;
  actual: string;
  status: 'ok' | 'warning' | 'failed';
}

export interface JobReport {
  version: 1;
  generatedAt: string;
  job: {
    id: string;
    batchId: string;
    label: string;
    mode: ProcessingMode;
    profileName: string | null;
    attempts: number;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  };
  strategy: 'stream-copy' | 're-encode' | 'image-lossless' | 'image-encode';
  strategyDescription: string;
  input: {
    name: string;
    sha256: string;
    size: number;
    container: string | null;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    durationSec: number | null;
    fps: number | null;
  };
  output: {
    name: string;
    sha256: string;
    size: number;
    container: string | null;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    durationSec: number | null;
    fps: number | null;
    bitrate: number | null;
    hasAudio: boolean;
  };
  operations: OperationRecord[];
  skipped: Array<{ label: string; reason: string }>;
  warnings: string[];
  /** Argumentos usados, com caminhos substituídos por marcadores. */
  command: string[];
  metadata: MetadataComparison;
  validation: {
    status: ValidationStatus;
    checks: ValidationCheck[];
    decode: { ok: boolean; errors: string[]; mode: 'full' | 'quick' | 'off' };
  };
  integrity: {
    algorithm: 'SHA-256';
    inputSha256AtImport: string;
    inputSha256BeforeProcessing: string;
    inputUnchangedAfterProcessing: boolean;
    outputSha256: string;
    outputIdenticalToInput: boolean;
    identicalOutputs: string[];
    note: string;
  };
  settings: ProcessingSettings;
}

export interface EncoderAvailability {
  h264: boolean;
  hevc: boolean;
  vp9: boolean;
  av1: boolean;
  aac: boolean;
  opus: boolean;
  mp3: boolean;
  webp: boolean;
  drawtext: boolean;
  /** drawtext com text_align (alinhamento de várias linhas; FFmpeg 6.1+). */
  textAlign: boolean;
  subtitles: boolean;
  filterUnits: boolean;
}

export interface SystemInfoDTO {
  app: { name: string; version: string };
  ffmpeg: { available: boolean; path: string; version: string | null; error: string | null };
  ffprobe: { available: boolean; path: string; version: string | null; error: string | null };
  capabilities: EncoderAvailability;
  limits: {
    maxUploadMb: number;
    maxFilesPerUpload: number;
    maxDurationSec: number;
    maxResolution: number;
    maxJobsPerSession: number;
    jobTimeoutSec: number;
    sessionTtlHours: number;
    previewMaxSeconds: number;
  };
  queue: { concurrency: number; maxConcurrency: number; running: number; queued: number };
  platform: string;
}

export interface SessionDTO {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  storageBytes: number;
  counts: { assets: number; jobs: number; completed: number };
  requiresAccessKey: boolean;
}

export interface SavedProfileDTO {
  id: string;
  name: string;
  mode: ProcessingMode;
  settings: ProcessingSettings;
  createdAt: number;
  updatedAt: number;
}

export interface PlanJobPreview {
  assetId: string;
  assetName: string;
  label: string;
  profileName: string | null;
  strategy: JobReport['strategy'];
  outputFormat: string;
  expected: { width: number | null; height: number | null; durationSec: number | null; hasAudio: boolean };
  operations: OperationRecord[];
  skipped: Array<{ label: string; reason: string }>;
  warnings: string[];
}

export interface PlanResponse {
  ok: boolean;
  jobs: PlanJobPreview[];
  errors: Array<{ assetId: string | null; assetName: string | null; message: string }>;
}

export interface BatchRequest {
  assetIds: string[];
  scope: 'common' | 'individual';
  settings: unknown;
  /** Configurações individuais por arquivo (scope = individual). */
  perAsset?: Record<string, unknown>;
  /** Perfis de exportação embutidos (ids) ou salvos ("saved:<id>"). Vazio = configuração atual. */
  profiles?: string[];
  label?: string;
}

export type ServerEvent =
  | { type: 'job'; job: JobDTO }
  | { type: 'job-removed'; jobId: string }
  | { type: 'asset'; asset: AssetDTO }
  | { type: 'asset-removed'; assetId: string }
  | { type: 'batch'; batch: BatchDTO }
  | { type: 'history'; entry: HistoryEntryDTO }
  | { type: 'queue'; queue: SystemInfoDTO['queue'] }
  | { type: 'session-reset' };
