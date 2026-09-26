import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'precisa ser 32 bytes em base64 (openssl rand -base64 32)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  /** Onde o frontend roda. Destino dos redirects do OAuth e origem liberada no CORS. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** URL pública do backend. A Meta baixa as mídias daqui, então precisa ser alcançável pela internet em produção. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/nexora'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  /** Chave AES-256-GCM dos tokens da Meta. */
  TOKEN_ENCRYPTION_KEY: base64Key,
  /** Chave anterior, só para leitura durante a rotação. */
  TOKEN_ENCRYPTION_KEY_PREVIOUS: base64Key.optional(),
  /** Segredo HMAC das URLs públicas (assinadas) de mídia. */
  MEDIA_SIGNING_SECRET: z.string().min(32, 'use ao menos 32 caracteres'),

  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.string().url().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v25.0'),
  /**
   * Pede login no Instagram a cada autorização em vez de reaproveitar a sessão
   * do navegador — sem isso, conectar a 2ª conta no mesmo navegador autoriza a
   * 1ª de novo. É o parâmetro que o próprio painel da Meta gera no "embed URL".
   */
  INSTAGRAM_OAUTH_FORCE_REAUTH: bool(true),

  STORAGE_DIR: z.string().default('./storage'),
  MEDIA_URL_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  PUBLISH_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(20),
  SYNC_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),

  SIGNUP_ENABLED: bool(true),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    // Falhar no boot com a lista inteira é melhor que falhar na primeira requisição.
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';

export function instagramRedirectUri(): string {
  return env.INSTAGRAM_REDIRECT_URI ?? `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/oauth/instagram/callback`;
}

export function isMetaConfigured(): boolean {
  return Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
}
