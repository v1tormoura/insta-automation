/**
 * Vocabulário do domínio. Frontend e backend importam daqui para que um status
 * novo não exista em um lado e falte no outro.
 */

export const ACCOUNT_STATUSES = ['CONNECTED', 'SYNCING', 'EXPIRED', 'ERROR', 'DISCONNECTED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Tipos de publicação suportados pela Content Publishing API oficial
 * (Instagram API with Instagram Login). Cada um mapeia para um `media_type`
 * do container: IMAGE → (sem media_type), CAROUSEL → CAROUSEL, REEL → REELS,
 * STORY → STORIES.
 */
export const POST_TYPES = ['IMAGE', 'CAROUSEL', 'REEL', 'STORY'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIAL',
  'FAILED',
  'CANCELED',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Ciclo de vida de uma publicação em UMA conta. Cada post gera um job por
 * conta selecionada; cada job anda sozinho, então uma conta com problema não
 * segura as outras.
 */
export const JOB_STATUSES = [
  'SCHEDULED', // aguardando o horário
  'QUEUED', // horário chegou, aguardando vaga (lock da conta, cota, ritmo)
  'CREATING', // criando o(s) container(s) de mídia na Meta
  'PROCESSING', // Meta processando a mídia (vídeo) — status_code IN_PROGRESS
  'PUBLISHING', // chamando media_publish
  'PUBLISHED',
  'FAILED',
  'CANCELED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['QUEUED', 'CREATING', 'PROCESSING', 'PUBLISHING'];
export const PENDING_JOB_STATUSES: readonly JobStatus[] = ['SCHEDULED', ...ACTIVE_JOB_STATUSES];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['PUBLISHED', 'FAILED', 'CANCELED'];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Progresso aproximado (0–100) exibido na UI para cada etapa. */
export const JOB_PROGRESS: Record<JobStatus, number> = {
  SCHEDULED: 0,
  QUEUED: 10,
  CREATING: 30,
  PROCESSING: 60,
  PUBLISHING: 85,
  PUBLISHED: 100,
  FAILED: 100,
  CANCELED: 100,
};

export const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const NOTIFICATION_LEVELS = ['success', 'error', 'warning', 'info'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_KINDS = [
  'job.published',
  'job.failed',
  'post.completed',
  'campaign.completed',
  'account.connected',
  'account.expired',
  'account.error',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Códigos de erro estáveis que a API devolve e a UI traduz/usa. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PLAN_LIMIT_REACHED',
  'META_NOT_CONFIGURED',
  'META_ERROR',
  'ACCOUNT_UNAVAILABLE',
  'FEATURE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const INSIGHT_RANGES = ['7d', '14d', '30d'] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];

export const INSIGHT_RANGE_DAYS: Record<InsightRange, number> = { '7d': 7, '14d': 14, '30d': 30 };
