import { INSIGHT_RANGE_DAYS, type AccountInsightsDTO, type InsightRange, type MediaInsightDTO, type UnavailableMetric } from '@nexora/shared';
import { Types } from 'mongoose';
import { redis } from '../../infra/redis.js';
import { AppError } from '../../lib/errors.js';
import { DAY, HOUR, isoDate } from '../../lib/time.js';
import { isMetaError, metaGraph } from '../../integrations/meta/index.js';
import { ACCOUNT_TOTAL_METRICS, METRIC_LABELS, getAccountDailySeries, getAccountTotals } from '../../integrations/meta/insights.js';
import { enqueueSync } from '../../queue/queues.js';
import { getAccountOrThrow, loadAccountWithToken, setAccountStatus } from '../accounts/account.service.js';
import { AccountSnapshot, MediaInsight, type MediaInsightDoc } from './insight.models.js';

const INSIGHTS_SCOPE = 'instagram_business_manage_insights';
const cacheKey = (accountId: string, range: string) => `insights:account:${accountId}:${range}`;

function toMediaInsightDTO(m: MediaInsightDoc): MediaInsightDTO {
  return {
    igMediaId: m.igMediaId,
    accountId: m.accountId.toString(),
    mediaType: m.mediaType ?? null,
    productType: m.productType ?? null,
    caption: m.caption,
    permalink: m.permalink ?? null,
    thumbnailUrl: m.thumbnailUrl ?? null,
    timestamp: m.timestamp?.toISOString() ?? null,
    metrics: m.metrics,
    unavailable: m.unavailable,
    syncedAt: m.syncedAt.toISOString(),
  };
}

/**
 * Métricas da conta num período. Consulta a Meta sob demanda e guarda 1h em
 * cache — insights da Meta são atualizados com atraso, então consultar mais
 * que isso só gasta rate limit.
 */
export async function getAccountInsights(userId: Types.ObjectId, accountId: string, range: InsightRange): Promise<AccountInsightsDTO> {
  const account = await getAccountOrThrow(userId, accountId);
  const days = INSIGHT_RANGE_DAYS[range];
  const until = new Date();
  const since = new Date(until.getTime() - days * DAY);

  const snapshots = await AccountSnapshot.find({ userId, accountId: account._id, date: { $gte: isoDate(since) } }).sort({ date: 1 }).lean();
  const followersByDate = new Map(snapshots.map((s) => [s.date, s.followersCount ?? null]));

  const base = (unavailable: UnavailableMetric[]): AccountInsightsDTO => ({
    accountId,
    range,
    since: since.toISOString(),
    until: until.toISOString(),
    totals: ACCOUNT_TOTAL_METRICS.map((key) => ({ key, label: METRIC_LABELS[key] ?? key, value: null })),
    series: [...followersByDate].map(([date, followers]) => ({ date, reach: null, followers })),
    unavailable,
    fetchedAt: new Date().toISOString(),
  });

  if (account.status === 'DISCONNECTED' || account.status === 'EXPIRED') {
    return base([{ key: '*', reason: 'A conta precisa ser reconectada para consultar métricas.' }]);
  }
  if (account.permissions.length && !account.permissions.includes(INSIGHTS_SCOPE)) {
    return base([{ key: '*', reason: 'A permissão de insights não foi concedida. Reconecte a conta aceitando "Gerenciar insights".' }]);
  }

  const cached = await redis().get(cacheKey(accountId, range));
  if (cached) return JSON.parse(cached) as AccountInsightsDTO;

  const loaded = await loadAccountWithToken(userId, account._id);
  if (!loaded?.token) return base([{ key: '*', reason: 'A conta precisa ser reconectada.' }]);
  const graph = metaGraph();

  try {
    const totals = await getAccountTotals(graph, loaded.token, account.igUserId, since, until);
    const unavailable = [...totals.unavailable];
    const reachByDate = new Map<string, number>();
    try {
      for (const p of await getAccountDailySeries(graph, loaded.token, account.igUserId, 'reach', since, until)) reachByDate.set(p.date, p.value);
    } catch (err) {
      if (isMetaError(err) && (err.category === 'auth' || err.category === 'rate_limit')) throw err;
      unavailable.push({ key: 'reach_series', reason: 'Série diária de alcance indisponível para esta conta.' });
    }

    const dates = new Set<string>([...reachByDate.keys(), ...followersByDate.keys()]);
    const dto: AccountInsightsDTO = {
      accountId,
      range,
      since: since.toISOString(),
      until: until.toISOString(),
      totals: ACCOUNT_TOTAL_METRICS.map((key) => ({ key, label: METRIC_LABELS[key] ?? key, value: totals.values[key] ?? null })),
      series: [...dates].sort().map((date) => ({ date, reach: reachByDate.get(date) ?? null, followers: followersByDate.get(date) ?? null })),
      unavailable,
      fetchedAt: new Date().toISOString(),
    };
    await redis().set(cacheKey(accountId, range), JSON.stringify(dto), 'PX', HOUR);
    return dto;
  } catch (err) {
    if (isMetaError(err) && err.category === 'auth') {
      await setAccountStatus(userId, account._id, 'EXPIRED', err.userMessage);
      throw new AppError('ACCOUNT_UNAVAILABLE', err.userMessage, 409);
    }
    if (isMetaError(err) && err.category === 'rate_limit') {
      throw new AppError('RATE_LIMITED', 'A Meta limitou as consultas desta conta. Tente de novo em alguns minutos.', 429);
    }
    if (isMetaError(err)) throw new AppError('META_ERROR', err.userMessage, 502);
    throw err;
  }
}

export async function listMediaInsights(
  userId: Types.ObjectId,
  opts: { accountId?: string; sort: string; limit: number },
): Promise<MediaInsightDTO[]> {
  const filter: Record<string, unknown> = { userId };
  if (opts.accountId) filter.accountId = new Types.ObjectId(opts.accountId);
  const sort: Record<string, 1 | -1> = opts.sort === 'recent' ? { timestamp: -1 } : { [`metrics.${opts.sort}`]: -1, timestamp: -1 };
  const docs = await MediaInsight.find(filter).sort(sort).limit(opts.limit).lean();
  return docs.map(toMediaInsightDTO);
}

export async function refreshAccountInsights(userId: Types.ObjectId, accountId: string): Promise<void> {
  const account = await getAccountOrThrow(userId, accountId);
  await redis().del(...Object.keys(INSIGHT_RANGE_DAYS).map((r) => cacheKey(accountId, r)));
  await enqueueSync('account.media-insights', account._id);
  await enqueueSync('account.profile', account._id);
}
