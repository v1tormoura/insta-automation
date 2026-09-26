import { DEFAULT_PUBLISHING_QUOTA, PLANS, isTerminalJobStatus, type JobStatus } from '@nexora/shared';
import type { Redis } from 'ioredis';
import type { Types } from 'mongoose';
import { logger } from '../../lib/logger.js';
import { MINUTE, SECOND, jitter } from '../../lib/time.js';
import { MetaApiError, MetaNetworkError, classifyMetaError, isMetaError } from '../../integrations/meta/errors.js';
import type { GraphClient } from '../../integrations/meta/graphClient.js';
import * as ig from '../../integrations/meta/publishing.js';
import { acquireAccountLock, acquireTenantSlot, releaseAccountLock, releaseTenantSlot } from '../../queue/locks.js';
import { InstagramAccount, type InstagramAccountDoc } from '../accounts/account.model.js';
import { loadAccountWithToken, setAccountStatus } from '../accounts/account.service.js';
import { User } from '../auth/user.model.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Media, type MediaDoc } from '../media/media.model.js';
import { signedMediaUrl } from '../media/publicUrl.js';
import { notify } from '../notifications/notification.service.js';
import { PublishJob, type JobError, type PublishJobDoc } from '../posts/job.model.js';
import { Post, type PostDoc } from '../posts/post.model.js';
import { recomputePost } from './aggregate.js';
import { emitJobUpdate, historyPush } from './jobEvents.js';

/**
 * Execução de UM PublishJob (um post em uma conta).
 *
 * É uma máquina de estados retomável: cada passo grava o progresso no Mongo
 * (ids dos containers, status) antes do próximo. Se o worker cair no meio, o
 * job volta à fila e continua de onde parou — sem criar container à toa e,
 * principalmente, sem publicar duas vezes.
 *
 *   SCHEDULED → QUEUED → CREATING → PROCESSING → PUBLISHING → PUBLISHED
 *                  ↑ espera vaga       ↑ polling do status_code
 *
 * Esperas (vaga da conta, limite do plano, intervalo mínimo, cota da Meta,
 * processamento do vídeo) não ocupam o worker: o job volta para "delayed" no
 * BullMQ e o slot fica livre para jobs de outras contas.
 */

export const MAX_ATTEMPTS = 5;
const ACCOUNT_LOCK_TTL = 15 * MINUTE;
const TENANT_SLOT_STALE = 15 * MINUTE;
const CONTAINER_TIMEOUT = 45 * MINUTE;
const QUOTA_FRESHNESS = 10 * MINUTE;
const MAX_RATE_LIMIT_WAITS = 40;

export interface ExecutorDeps {
  redis: Redis;
  graph: GraphClient;
}

export type StepResult =
  | { kind: 'done' }
  | { kind: 'stop' }
  | { kind: 'wait'; ms: number; reason: string | null; keepLock: boolean };

/** Erro que não adianta tentar de novo (conta removida, mídia inválida…). */
export class PermanentJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** Erro transitório detectado por nós (não veio de uma chamada HTTP da Meta). */
export class RetryableJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterMs = MINUTE,
  ) {
    super(message);
    this.name = 'RetryableJobError';
  }
}

interface Loaded {
  post: PostDoc;
  account: InstagramAccountDoc;
  token: string;
  media: MediaDoc[];
  cover: MediaDoc | null;
}

export class PublishExecution {
  private locksHeld = false;
  private loaded: Loaded | undefined;
  private readonly owner: string;

  constructor(
    public job: PublishJobDoc,
    private readonly deps: ExecutorDeps,
  ) {
    this.owner = job._id.toString();
  }

  get userId(): Types.ObjectId {
    return this.job.userId;
  }

  /* ── Transições ─────────────────────────────────────────────────────── */

  /**
   * Muda o status só se o job ainda estiver num dos estados esperados. Se o
   * usuário cancelou no meio, a condição falha e a execução para sem
   * sobrescrever o cancelamento.
   */
  async transition(from: readonly JobStatus[], to: JobStatus, set: Record<string, unknown> = {}, message?: string): Promise<boolean> {
    const updated = await PublishJob.findOneAndUpdate(
      { userId: this.userId, _id: this.job._id, status: { $in: from } },
      { $set: { status: to, ...set }, $push: historyPush(to, message) },
      { returnDocument: 'after', lean: true },
    );
    if (!updated) return false;
    const statusChanged = updated.status !== this.job.status;
    this.job = updated;
    await emitJobUpdate(updated);
    if (statusChanged && ['QUEUED', 'PUBLISHED', 'FAILED'].includes(to)) await recomputePost(this.userId, updated.postId);
    return true;
  }

  private async patch(set: Record<string, unknown>): Promise<void> {
    const updated = await PublishJob.findOneAndUpdate({ userId: this.userId, _id: this.job._id }, { $set: set }, { returnDocument: 'after', lean: true });
    if (updated) this.job = updated;
  }

  async setWaitReason(reason: string | null): Promise<void> {
    if (this.job.waitReason === reason) return;
    await this.patch({ waitReason: reason });
    await emitJobUpdate(this.job);
  }

  /* ── Carga de contexto ──────────────────────────────────────────────── */

  private async load(): Promise<Loaded> {
    if (this.loaded) return this.loaded;
    const [post, withToken] = await Promise.all([
      Post.findOne({ userId: this.userId, _id: this.job.postId }).lean(),
      loadAccountWithToken(this.userId, this.job.accountId),
    ]);
    if (!post) throw new PermanentJobError('POST_NOT_FOUND', 'A publicação foi removida.');
    if (!withToken) throw new PermanentJobError('ACCOUNT_UNAVAILABLE', 'A conta foi removida.');
    const { account, token } = withToken;
    if (account.status === 'DISCONNECTED' || !token) {
      throw new PermanentJobError('ACCOUNT_UNAVAILABLE', 'A conta foi desconectada. Reconecte e tente de novo.');
    }
    if (account.status === 'EXPIRED' || (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now())) {
      if (account.status !== 'EXPIRED') await setAccountStatus(this.userId, account._id, 'EXPIRED', 'O token de acesso expirou.');
      throw new PermanentJobError('ACCOUNT_EXPIRED', 'O acesso à conta expirou. Reconecte a conta e tente de novo.');
    }
    const ids = [...post.mediaIds, ...(post.cover?.mediaId ? [post.cover.mediaId] : [])];
    const docs = await Media.find({ userId: this.userId, _id: { $in: ids } }).lean();
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
    const media = post.mediaIds.map((id) => byId.get(id.toString()));
    if (media.some((m) => !m || m.deletedAt)) throw new PermanentJobError('MEDIA_MISSING', 'Uma das mídias foi removida da biblioteca.');
    const cover = post.cover?.mediaId ? byId.get(post.cover.mediaId.toString()) ?? null : null;
    this.loaded = { post, account, token, media: media as MediaDoc[], cover };
    return this.loaded;
  }

  /* ── Portões: conta, plano, ritmo, cota ─────────────────────────────── */

  private async acquireLocks(plan: keyof typeof PLANS): Promise<string | null> {
    const accountId = this.job.accountId.toString();
    if (!(await acquireAccountLock(this.deps.redis, accountId, this.owner, ACCOUNT_LOCK_TTL))) {
      return 'Aguardando outra publicação desta conta terminar.';
    }
    const slotOk = await acquireTenantSlot(
      this.deps.redis,
      this.userId.toString(),
      this.owner,
      PLANS[plan].maxConcurrentPublishes,
      TENANT_SLOT_STALE,
    );
    if (!slotOk) {
      await releaseAccountLock(this.deps.redis, accountId, this.owner);
      return `Aguardando vaga: seu plano publica até ${PLANS[plan].maxConcurrentPublishes} contas ao mesmo tempo.`;
    }
    this.locksHeld = true;
    return null;
  }

  async releaseLocks(): Promise<void> {
    if (!this.locksHeld) return;
    this.locksHeld = false;
    await Promise.allSettled([
      releaseAccountLock(this.deps.redis, this.job.accountId.toString(), this.owner),
      releaseTenantSlot(this.deps.redis, this.userId.toString(), this.owner),
    ]);
  }

  private async quotaWait(account: InstagramAccountDoc, token: string): Promise<number | null> {
    let usage = account.publishing?.quotaUsage ?? null;
    let total = account.publishing?.quotaTotal ?? null;
    const checkedAt = account.publishing?.checkedAt?.getTime() ?? 0;
    if (Date.now() - checkedAt > QUOTA_FRESHNESS) {
      try {
        const limit = await ig.getPublishingLimit(this.deps.graph, token, account.igUserId);
        usage = limit.quotaUsage;
        total = limit.quotaTotal;
        await InstagramAccount.updateOne(
          { userId: this.userId, _id: account._id },
          { $set: { 'publishing.quotaUsage': usage, 'publishing.quotaTotal': total, 'publishing.checkedAt': new Date() } },
        );
      } catch (err) {
        if (isMetaError(err) && err.category === 'auth') throw err;
        // Sem a consulta de cota a publicação segue: a própria Meta recusa com 2207042 se estourar.
        logger.warn({ err, accountId: account._id.toString() }, 'publish: não consegui consultar a cota');
        return null;
      }
    }
    if (usage !== null && usage >= (total ?? DEFAULT_PUBLISHING_QUOTA)) return 30 * MINUTE;
    return null;
  }

  /* ── Passos ─────────────────────────────────────────────────────────── */

  async advance(): Promise<StepResult> {
    if (isTerminalJobStatus(this.job.status)) return { kind: 'stop' };

    if (this.job.status === 'SCHEDULED' && this.job.campaignId) {
      const campaign = await Campaign.findOne({ userId: this.userId, _id: this.job.campaignId }).select('pausedAt').lean();
      // Fila pausada: o job não anda. "Retomar" o recoloca na fila.
      if (campaign?.pausedAt) return { kind: 'stop' };
    }

    const user = await User.findById(this.userId).select('plan status').lean();
    if (!user || user.status !== 'active') throw new PermanentJobError('USER_INACTIVE', 'A conta do SaaS está inativa.');
    const { account, token } = await this.load();

    if (this.job.status === 'SCHEDULED' || this.job.status === 'QUEUED') {
      if (this.job.status === 'SCHEDULED' && !(await this.transition(['SCHEDULED'], 'QUEUED', { startedAt: new Date() }))) {
        return { kind: 'stop' };
      }
      if (account.settings.paused) {
        return { kind: 'wait', ms: 5 * MINUTE, reason: 'Conta pausada: a publicação sai quando a conta for retomada.', keepLock: false };
      }
      const lockReason = await this.acquireLocks(user.plan);
      if (lockReason) return { kind: 'wait', ms: jitter(15 * SECOND, 0.5), reason: lockReason, keepLock: false };

      const minInterval = account.settings.minIntervalSeconds * SECOND;
      const sinceLast = account.lastPublishedAt ? Date.now() - account.lastPublishedAt.getTime() : Infinity;
      if (sinceLast < minInterval) {
        return {
          kind: 'wait',
          ms: minInterval - sinceLast + SECOND,
          reason: `Respeitando o intervalo mínimo de ${account.settings.minIntervalSeconds}s entre publicações da conta.`,
          keepLock: false,
        };
      }
      const quota = await this.quotaWait(account, token);
      if (quota) {
        return {
          kind: 'wait',
          ms: quota,
          reason: 'A conta atingiu o limite de publicações da Meta nas últimas 24h. Retomaremos automaticamente.',
          keepLock: false,
        };
      }
      if (!(await this.transition(['QUEUED'], 'CREATING', { waitReason: null }))) {
        return { kind: 'stop' };
      }
    } else {
      // Retomando um job que já tinha começado: recupera a vaga (lock re-entrante).
      const lockReason = await this.acquireLocks(user.plan);
      if (lockReason) return { kind: 'wait', ms: jitter(15 * SECOND, 0.5), reason: lockReason, keepLock: false };
    }

    if (this.job.status === 'CREATING') {
      const ok = await this.createContainers();
      if (!ok) return { kind: 'stop' };
    }
    if (this.job.status === 'PROCESSING') {
      const result = await this.pollProcessing();
      if (result) return result;
    }
    if (this.job.status === 'PUBLISHING') return this.publish();
    return { kind: 'stop' };
  }

  private mediaItem(m: MediaDoc): ig.MediaItem {
    const ext = m.kind === 'image' ? 'jpg' : m.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    return { kind: m.kind, url: signedMediaUrl(m._id.toString(), 'original', `${m._id.toString()}.${ext}`) } as ig.MediaItem;
  }

  private async createContainers(): Promise<boolean> {
    const { post, account, token, media, cover } = await this.load();
    const igUserId = account.igUserId;
    const graph = this.deps.graph;

    if (post.type === 'CAROUSEL') {
      const children = [...this.job.childContainerIds];
      for (let i = children.length; i < media.length; i++) {
        children.push(await ig.createCarouselItem(graph, token, igUserId, this.mediaItem(media[i]!)));
        await this.patch({ childContainerIds: children });
      }
      // O container do carrossel só é criado quando todos os itens terminarem de processar.
      return this.transition(['CREATING'], 'PROCESSING', { containerId: null, containerCreatedAt: new Date() });
    }

    let containerId: string;
    const item = this.mediaItem(media[0]!);
    if (post.type === 'IMAGE') {
      containerId = await ig.createSingleContainer(graph, token, igUserId, { type: 'IMAGE', item: item as ig.ImageItem, caption: post.caption });
    } else if (post.type === 'REEL') {
      containerId = await ig.createSingleContainer(graph, token, igUserId, {
        type: 'REEL',
        item: item as ig.VideoItem,
        caption: post.caption,
        coverUrl: cover ? signedMediaUrl(cover._id.toString(), 'original', 'cover.jpg') : undefined,
        thumbOffsetMs: post.cover?.thumbOffsetMs ?? undefined,
        shareToFeed: post.shareToFeed,
      });
    } else {
      containerId = await ig.createSingleContainer(graph, token, igUserId, { type: 'STORY', item });
    }
    return this.transition(['CREATING'], 'PROCESSING', { containerId, containerCreatedAt: new Date() });
  }

  private pollDelay(): number {
    const age = Date.now() - (this.job.containerCreatedAt?.getTime() ?? Date.now());
    const hasVideo = this.loaded?.media.some((m) => m.kind === 'video');
    if (!hasVideo) return 3 * SECOND;
    return age < MINUTE ? 8 * SECOND : age < 5 * MINUTE ? 15 * SECOND : 30 * SECOND;
  }

  private async containerFailed(status: ig.ContainerStatus, where: string): Promise<never> {
    // O campo `status` vem como "Error: ... error code 2207026" quando há subcódigo.
    const sub = Number(status.status?.match(/(2207\d{3})/)?.[1]);
    await this.patch({ containerId: null, childContainerIds: [], containerCreatedAt: null });
    if (status.statusCode === 'EXPIRED') {
      throw new RetryableJobError('CONTAINER_EXPIRED', 'O container de mídia expirou; um novo será criado.');
    }
    throw new MetaApiError(400, { message: `${where}: ${status.status ?? 'ERROR'}`, code: 9, error_subcode: Number.isFinite(sub) ? sub : undefined }, where);
  }

  private async pollProcessing(): Promise<StepResult | null> {
    const { post, account, token } = await this.load();
    const graph = this.deps.graph;
    const age = Date.now() - (this.job.containerCreatedAt?.getTime() ?? Date.now());

    if (post.type === 'CAROUSEL' && !this.job.containerId) {
      for (const child of this.job.childContainerIds) {
        const st = await ig.getContainerStatus(graph, token, child);
        if (st.statusCode === 'ERROR' || st.statusCode === 'EXPIRED') await this.containerFailed(st, 'item do carrossel');
        if (st.statusCode === 'IN_PROGRESS') {
          if (age > CONTAINER_TIMEOUT) await this.timeout();
          return { kind: 'wait', ms: this.pollDelay(), reason: null, keepLock: true };
        }
      }
      const parent = await ig.createCarouselContainer(graph, token, account.igUserId, this.job.childContainerIds, post.caption);
      await this.patch({ containerId: parent });
    }

    const st = await ig.getContainerStatus(graph, token, this.job.containerId!);
    switch (st.statusCode) {
      case 'FINISHED':
        return (await this.transition(['PROCESSING'], 'PUBLISHING')) ? null : { kind: 'stop' };
      case 'IN_PROGRESS':
        if (age > CONTAINER_TIMEOUT) await this.timeout();
        return { kind: 'wait', ms: this.pollDelay(), reason: null, keepLock: true };
      case 'PUBLISHED':
        return this.finalize(await this.findPublishedMedia());
      default:
        return this.containerFailed(st, 'container');
    }
  }

  private async timeout(): Promise<never> {
    await this.patch({ containerId: null, childContainerIds: [], containerCreatedAt: null });
    throw new RetryableJobError('PROCESSING_TIMEOUT', 'O Instagram não terminou de processar a mídia a tempo.', 2 * MINUTE);
  }

  private async publish(): Promise<StepResult> {
    const { account, token } = await this.load();
    const graph = this.deps.graph;
    const containerId = this.job.containerId!;

    // Se uma tentativa anterior pode ter chamado media_publish, confere antes
    // de chamar de novo: publicar duas vezes é o pior erro possível aqui.
    if (this.job.history.some((h) => h.status === 'PUBLISHING' && h.message === 'media_publish chamado')) {
      const st = await ig.getContainerStatus(graph, token, containerId);
      if (st.statusCode === 'PUBLISHED') return this.finalize(await this.findPublishedMedia());
    }
    await PublishJob.updateOne(
      { userId: this.userId, _id: this.job._id },
      { $push: historyPush('PUBLISHING', 'media_publish chamado') },
    );

    let mediaId: string;
    try {
      mediaId = await ig.publishContainer(graph, token, account.igUserId, containerId);
    } catch (err) {
      if (isMetaError(err) && err.category === 'not_ready') {
        await this.transition(['PUBLISHING'], 'PROCESSING');
        return { kind: 'wait', ms: 20 * SECOND, reason: null, keepLock: true };
      }
      if (err instanceof MetaNetworkError || (err instanceof MetaApiError && err.category === 'transient')) {
        // Resposta perdida: a publicação pode ter acontecido.
        const st = await ig.getContainerStatus(graph, token, containerId).catch(() => null);
        if (st?.statusCode === 'PUBLISHED') return this.finalize(await this.findPublishedMedia());
      }
      throw err;
    }
    return this.finalize(mediaId);
  }

  /** Quando o media_publish respondeu mas a resposta se perdeu, localiza a mídia pela data e legenda. */
  private async findPublishedMedia(): Promise<string | null> {
    const { post, account, token } = await this.load();
    try {
      const since = (this.job.startedAt?.getTime() ?? Date.now()) - MINUTE;
      const recent = await ig.listRecentMedia(this.deps.graph, token, account.igUserId, 10);
      const match = recent.find(
        (m) => m.timestamp && new Date(m.timestamp).getTime() >= since && (post.type === 'STORY' || (m.caption ?? '') === post.caption),
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
  }

  private async finalize(mediaId: string | null): Promise<StepResult> {
    const { account, token, post } = await this.load();
    let permalink: string | null = null;
    if (mediaId) {
      try {
        permalink = (await ig.getMedia(this.deps.graph, token, mediaId)).permalink;
      } catch {
        /* permalink é opcional; stories às vezes não têm */
      }
    }
    const now = new Date();
    const ok = await this.transition(
      ['PROCESSING', 'PUBLISHING'],
      'PUBLISHED',
      { igMediaId: mediaId, permalink, publishedAt: now, finishedAt: now, waitReason: null, error: null },
      mediaId ? undefined : 'Publicado (ID da mídia não confirmado pela Meta)',
    );
    if (!ok) return { kind: 'stop' };
    await InstagramAccount.updateOne(
      { userId: this.userId, _id: account._id },
      { $set: { lastPublishedAt: now }, $inc: { 'publishing.quotaUsage': 1 } },
    );
    if (!post.campaignId && post.accountIds.length === 1) {
      await notify(this.userId, {
        kind: 'job.published',
        level: 'success',
        title: `Publicado em @${account.username}`,
        body: post.caption.slice(0, 120),
        link: permalink ?? `/posts/${post._id.toString()}`,
        dedupeKey: `job:${this.job._id.toString()}:published`,
      });
    }
    logger.info({ jobId: this.owner, accountId: account._id.toString(), mediaId }, 'publish: publicado');
    return { kind: 'done' };
  }

  /* ── Falhas ─────────────────────────────────────────────────────────── */

  async fail(error: JobError): Promise<void> {
    const ok = await this.transition(
      ['SCHEDULED', 'QUEUED', 'CREATING', 'PROCESSING', 'PUBLISHING'],
      'FAILED',
      { error, finishedAt: new Date(), waitReason: null },
      error.message,
    );
    if (!ok) return;
    const username = this.loaded?.account.username ?? (await InstagramAccount.findOne({ userId: this.userId, _id: this.job.accountId }).select('username').lean())?.username;
    await notify(this.userId, {
      kind: 'job.failed',
      level: 'error',
      title: `Falha ao publicar${username ? ` em @${username}` : ''}`,
      body: error.message,
      link: `/posts/${this.job.postId.toString()}`,
      dedupeKey: `job:${this.job._id.toString()}:failed:${this.job.history.length}`,
    });
  }
}

/* ── Política de erro ──────────────────────────────────────────────────── */

export type FailureDecision =
  | { action: 'fail'; error: JobError; accountStatus?: { status: 'EXPIRED' | 'ERROR'; reason: string } }
  | { action: 'retry'; delayMs: number; error: JobError }
  | { action: 'wait'; delayMs: number; reason: string; markQuotaExhausted: boolean };

/**
 * Decide o que fazer com um erro.
 *
 * @param attempts tentativas JÁ contando esta que falhou
 * @param rateLimitWaits quantas esperas por rate limit o job já fez
 */
export function decideFailure(err: unknown, attempts: number, rateLimitWaits: number): FailureDecision {
  const backoff = (base: number) => Math.min(30 * MINUTE, base * 2 ** Math.max(0, attempts - 1));
  const exhausted = attempts >= MAX_ATTEMPTS;

  if (err instanceof PermanentJobError) {
    return { action: 'fail', error: { code: err.code, message: err.message, retryable: false } };
  }
  if (err instanceof RetryableJobError) {
    const error = { code: err.code, message: err.message, retryable: true };
    return exhausted ? { action: 'fail', error } : { action: 'retry', delayMs: backoff(err.retryAfterMs), error };
  }
  if (isMetaError(err)) {
    const meta = err instanceof MetaApiError ? err : undefined;
    const error: JobError = {
      code: `META_${err.category.toUpperCase()}`,
      message: err.userMessage,
      retryable: err.retryable,
      metaCode: meta?.code ?? null,
      metaSubcode: meta?.subcode ?? null,
      fbtraceId: meta?.fbtraceId ?? null,
    };
    if (err.category === 'auth') return { action: 'fail', error, accountStatus: { status: 'EXPIRED', reason: err.userMessage } };
    if (err.category === 'permission' || err.category === 'account') {
      return { action: 'fail', error, accountStatus: { status: 'ERROR', reason: err.userMessage } };
    }
    if (err.category === 'rate_limit' || err.category === 'publish_limit') {
      if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS) return { action: 'fail', error };
      return {
        action: 'wait',
        delayMs: jitter(meta?.retryAfterMs ?? classifyMetaError(429, undefined).retryAfterMs!, 0.1),
        reason: err.userMessage,
        markQuotaExhausted: err.category === 'publish_limit',
      };
    }
    if (!err.retryable || exhausted) return { action: 'fail', error };
    return { action: 'retry', delayMs: backoff(meta?.retryAfterMs ?? MINUTE), error };
  }
  const error = { code: 'INTERNAL_ERROR', message: 'Erro interno ao publicar.', retryable: true };
  return exhausted ? { action: 'fail', error } : { action: 'retry', delayMs: backoff(MINUTE), error };
}

/**
 * Depois de um erro retentável, o job precisa voltar para QUEUED quando não
 * há container válido para retomar (falhou criando, ou o container foi
 * descartado por erro/expiração).
 */
export function needsRequeue(job: Pick<PublishJobDoc, 'status' | 'containerId' | 'childContainerIds'>): boolean {
  if (job.status === 'CREATING') return true;
  if (job.status === 'PROCESSING') return !job.containerId && job.childContainerIds.length === 0;
  return false;
}
