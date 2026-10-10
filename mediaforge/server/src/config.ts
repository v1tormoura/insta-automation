import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Raiz do projeto MediaForge (pasta que contém server/, web/ e shared/). */
export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SERVER_ROOT = path.join(PROJECT_ROOT, 'server');

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'sim', 'on'].includes(v.toLowerCase())));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const cpuCount = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: int(1, 65535).default(5310),
  DATA_DIR: z.string().default('./data'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  MAX_UPLOAD_MB: int(1, 1_048_576).default(4096),
  MAX_FILES_PER_UPLOAD: int(1, 500).default(50),
  MAX_DURATION_SEC: int(1, 86_400).default(3 * 3600),
  MAX_RESOLUTION: int(64, 16_384).default(8192),
  MAX_ASSETS_PER_SESSION: int(1, 100_000).default(500),
  MAX_JOBS_PER_SESSION: int(1, 100_000).default(2000),
  MAX_JOBS_PER_BATCH: int(1, 10_000).default(400),

  DEFAULT_CONCURRENCY: int(1, 64).default(Math.min(2, cpuCount)),
  MAX_CONCURRENCY: int(1, 64).default(Math.max(1, Math.min(8, cpuCount))),
  /** Threads por processo FFmpeg (0 = automático do FFmpeg). */
  FFMPEG_THREADS: int(0, 64).default(0),
  /** Prioridade dos processos FFmpeg (0 = normal, 19 = mais baixa). */
  PROCESS_NICE: int(0, 19).default(10),
  JOB_TIMEOUT_SEC: int(10, 172_800).default(4 * 3600),
  JOB_MAX_ATTEMPTS: int(1, 10).default(2),
  /** Não inicia novas tarefas se a memória livre estiver abaixo deste valor. */
  MIN_FREE_MEMORY_MB: int(0, 1_048_576).default(256),
  VALIDATION_DECODE: z.enum(['full', 'quick', 'off']).default('full'),

  SESSION_TTL_HOURS: z.coerce.number().min(0.01).max(24 * 365).default(72),
  CLEANUP_INTERVAL_MIN: z.coerce.number().min(0.05).max(24 * 60).default(30),
  PREVIEW_MAX_SECONDS: int(1, 60).default(8),

  ACCESS_KEY: z.string().optional(),
  COOKIE_SECURE: bool.default(false),
  SERVE_WEB: bool.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

/** Carrega `.env` da raiz do projeto (se existir) e valida as variáveis. */
export function loadConfig(overrides: Record<string, string | number | boolean | undefined> = {}) {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile) && !process.env.MEDIAFORGE_SKIP_ENV_FILE) {
    process.loadEnvFile(envFile);
  }
  const raw: Record<string, unknown> = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) raw[k] = v;
  for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${msg}`);
  }
  const env = parsed.data;
  const dataDir = path.resolve(PROJECT_ROOT, env.DATA_DIR);
  return {
    host: env.HOST,
    port: env.PORT,
    dataDir,
    dbFile: path.join(dataDir, 'mediaforge.db'),
    sessionsDir: path.join(dataDir, 'sessions'),
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    fontsDir: path.join(SERVER_ROOT, 'assets', 'fonts'),
    webDist: path.join(PROJECT_ROOT, 'web', 'dist'),
    limits: {
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      maxUploadMb: env.MAX_UPLOAD_MB,
      maxFilesPerUpload: env.MAX_FILES_PER_UPLOAD,
      maxDurationSec: env.MAX_DURATION_SEC,
      maxResolution: env.MAX_RESOLUTION,
      maxAssetsPerSession: env.MAX_ASSETS_PER_SESSION,
      maxJobsPerSession: env.MAX_JOBS_PER_SESSION,
      maxJobsPerBatch: env.MAX_JOBS_PER_BATCH,
      previewMaxSeconds: env.PREVIEW_MAX_SECONDS,
    },
    queue: {
      defaultConcurrency: Math.min(env.DEFAULT_CONCURRENCY, env.MAX_CONCURRENCY),
      maxConcurrency: env.MAX_CONCURRENCY,
      ffmpegThreads: env.FFMPEG_THREADS,
      nice: env.PROCESS_NICE,
      jobTimeoutMs: env.JOB_TIMEOUT_SEC * 1000,
      maxAttempts: env.JOB_MAX_ATTEMPTS,
      minFreeMemoryBytes: env.MIN_FREE_MEMORY_MB * 1024 * 1024,
      validationDecode: env.VALIDATION_DECODE,
    },
    sessionTtlMs: env.SESSION_TTL_HOURS * 3600 * 1000,
    cleanupIntervalMs: env.CLEANUP_INTERVAL_MIN * 60 * 1000,
    accessKey: env.ACCESS_KEY ?? null,
    cookieSecure: env.COOKIE_SECURE,
    serveWeb: env.SERVE_WEB,
    logLevel: env.LOG_LEVEL,
  };
}
