import type { MediaKind, PostType } from './domain.js';

/* ── Planos ────────────────────────────────────────────────────────────────
   Hoje todo usuário nasce no `free`. A estrutura existe para que cobrança e
   upgrade entrem depois sem espalhar números mágicos pelo código: toda regra
   de limite lê daqui (backend) e a UI mostra os mesmos valores. */

export const PLAN_IDS = ['free', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  label: string;
  /** Contas do Instagram conectadas ao mesmo tempo. */
  maxAccounts: number;
  /** Jobs pendentes (agendados + em fila) somados de todas as contas. */
  maxPendingJobs: number;
  /** Publicações deste usuário rodando em paralelo (entre contas diferentes). */
  maxConcurrentPublishes: number;
  /** Armazenamento total da biblioteca de mídia, em MB. */
  storageMb: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: { label: 'Free', maxAccounts: 3, maxPendingJobs: 100, maxConcurrentPublishes: 2, storageMb: 2_048 },
  pro: { label: 'Pro', maxAccounts: 15, maxPendingJobs: 2_000, maxConcurrentPublishes: 5, storageMb: 20_480 },
  business: {
    label: 'Business',
    maxAccounts: 60,
    maxPendingJobs: 20_000,
    maxConcurrentPublishes: 15,
    storageMb: 102_400,
  },
};

/* ── Regras de conteúdo da Content Publishing API ──────────────────────────
   Valores da documentação oficial da Meta (Instagram Platform → Content
   Publishing). A Meta é a autoridade final: estes limites existem para o
   usuário descobrir o problema no editor, não depois de esperar a fila. */

export const CAPTION_MAX_LENGTH = 2_200;
export const CAPTION_MAX_HASHTAGS = 30;
export const CAPTION_MAX_MENTIONS = 20;
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;

/** Publicações via API por conta numa janela deslizante de 24h (fallback se a consulta de cota falhar). */
export const DEFAULT_PUBLISHING_QUOTA = 100;

export const UPLOAD_MIME_TYPES: Record<MediaKind, readonly string[]> = {
  // O Instagram só aceita JPEG; PNG/WebP são convertidos no servidor.
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime'],
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export interface VideoRule {
  minSeconds: number;
  maxSeconds: number;
  maxBytes: number;
}

export const VIDEO_RULES: Record<'REEL' | 'STORY' | 'CAROUSEL', VideoRule> = {
  REEL: { minSeconds: 3, maxSeconds: 15 * 60, maxBytes: 300 * 1024 * 1024 },
  STORY: { minSeconds: 3, maxSeconds: 60, maxBytes: 100 * 1024 * 1024 },
  CAROUSEL: { minSeconds: 3, maxSeconds: 60, maxBytes: 100 * 1024 * 1024 },
};

/** Proporção largura/altura aceita no feed (4:5 até 1.91:1). */
export const FEED_IMAGE_ASPECT = { min: 4 / 5, max: 1.91 } as const;

export interface PostTypeInfo {
  label: string;
  description: string;
  acceptsKinds: readonly MediaKind[];
  minItems: number;
  maxItems: number;
  supportsCover: boolean;
  supportsCaption: boolean;
}

export const POST_TYPE_INFO: Record<PostType, PostTypeInfo> = {
  IMAGE: {
    label: 'Foto',
    description: 'Uma imagem no feed.',
    acceptsKinds: ['image'],
    minItems: 1,
    maxItems: 1,
    supportsCover: false,
    supportsCaption: true,
  },
  CAROUSEL: {
    label: 'Carrossel',
    description: `De ${CAROUSEL_MIN_ITEMS} a ${CAROUSEL_MAX_ITEMS} fotos e/ou vídeos.`,
    acceptsKinds: ['image', 'video'],
    minItems: CAROUSEL_MIN_ITEMS,
    maxItems: CAROUSEL_MAX_ITEMS,
    supportsCover: false,
    supportsCaption: true,
  },
  REEL: {
    label: 'Reel',
    description: 'Vídeo vertical de 3s a 15min. Aceita capa.',
    acceptsKinds: ['video'],
    minItems: 1,
    maxItems: 1,
    supportsCover: true,
    supportsCaption: true,
  },
  STORY: {
    label: 'Story',
    description: 'Foto ou vídeo (até 60s). Some em 24h.',
    acceptsKinds: ['image', 'video'],
    minItems: 1,
    maxItems: 1,
    supportsCover: false,
    // A API aceita criar STORIES sem legenda; o campo `caption` não é exibido.
    supportsCaption: false,
  },
};

/* ── Intervalos ────────────────────────────────────────────────────────── */

export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_SCHEDULE_AHEAD_DAYS = 180;
/** Espaçamento mínimo padrão entre duas publicações da MESMA conta. */
export const DEFAULT_ACCOUNT_MIN_INTERVAL_SECONDS = 60;
