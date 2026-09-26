import type {
  AccountStatus,
  CampaignStatus,
  ErrorCode,
  JobStatus,
  MediaKind,
  NotificationKind,
  NotificationLevel,
  PostStatus,
  PostType,
} from './domain.js';
import type { PlanId, PlanLimits } from './limits.js';

/* Formatos de resposta da API. Datas trafegam como string ISO. Nenhum DTO
   carrega token de acesso — o token nunca sai do backend. */

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  limits: PlanLimits;
  timezone: string;
  createdAt: string;
}

export interface AccountDTO {
  id: string;
  igUserId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  status: AccountStatus;
  statusReason: string | null;
  permissions: string[];
  missingPermissions: string[];
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string;
  settings: { paused: boolean; minIntervalSeconds: number };
  publishing: { quotaUsage: number | null; quotaTotal: number | null; checkedAt: string | null };
}

export interface MediaDTO {
  id: string;
  kind: MediaKind;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  previewUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface JobErrorDTO {
  code: string;
  message: string;
  retryable: boolean;
  metaCode?: number | null;
  metaSubcode?: number | null;
}

export interface JobDTO {
  id: string;
  postId: string;
  campaignId: string | null;
  accountId: string;
  account: Pick<AccountDTO, 'id' | 'username' | 'profilePictureUrl'> | null;
  postType: PostType;
  captionPreview: string;
  thumbnailUrl: string | null;
  status: JobStatus;
  progress: number;
  runAt: string;
  attempts: number;
  waitReason: string | null;
  startedAt: string | null;
  publishedAt: string | null;
  igMediaId: string | null;
  permalink: string | null;
  error: JobErrorDTO | null;
  updatedAt: string;
}

export interface PostDTO {
  id: string;
  type: PostType;
  caption: string;
  media: MediaDTO[];
  cover: { media: MediaDTO | null; thumbOffsetMs: number | null } | null;
  shareToFeed: boolean;
  status: PostStatus;
  scheduledAt: string | null;
  campaignId: string | null;
  accountIds: string[];
  counts: { total: number; published: number; failed: number; pending: number; canceled: number };
  jobs?: JobDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignDTO {
  id: string;
  name: string;
  status: CampaignStatus;
  accountIds: string[];
  startAt: string;
  endsAt: string;
  intervalMinutes: number;
  accountStaggerMinutes: number;
  counts: { total: number; published: number; failed: number; pending: number; canceled: number };
  postIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDTO {
  id: string;
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | null;
}

export interface UnavailableMetric {
  key: string;
  reason: string;
}

export interface AccountInsightsDTO {
  accountId: string;
  range: string;
  since: string;
  until: string;
  totals: MetricValue[];
  series: { date: string; reach: number | null; followers: number | null }[];
  unavailable: UnavailableMetric[];
  fetchedAt: string;
}

export interface MediaInsightDTO {
  igMediaId: string;
  accountId: string;
  mediaType: string | null;
  productType: string | null;
  caption: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
  metrics: Record<string, number | null>;
  unavailable: UnavailableMetric[];
  syncedAt: string;
}

export interface DashboardDTO {
  accounts: { total: number; byStatus: Record<AccountStatus, number>; followers: number };
  jobs: {
    scheduled: number;
    active: number;
    publishedToday: number;
    published7d: number;
    failed7d: number;
    successRate7d: number | null;
  };
  daily: { date: string; published: number; failed: number }[];
  upcoming: JobDTO[];
  recent: JobDTO[];
  quotas: { accountId: string; username: string; usage: number | null; total: number | null }[];
}

/* ── Eventos em tempo real (SSE) ──────────────────────────────────────── */

export type RealtimeEvent =
  | { type: 'job.updated'; job: JobDTO }
  | { type: 'post.updated'; postId: string; status: PostStatus; counts: PostDTO['counts'] }
  | { type: 'campaign.updated'; campaignId: string; status: CampaignStatus; counts: CampaignDTO['counts'] }
  | { type: 'account.updated'; account: AccountDTO }
  | { type: 'notification.created'; notification: NotificationDTO };

export type RealtimeEventType = RealtimeEvent['type'];
