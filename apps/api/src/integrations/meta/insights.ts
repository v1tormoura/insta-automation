import type { UnavailableMetric } from '@nexora/shared';
import { MetaApiError } from './errors.js';
import type { GraphClient } from './graphClient.js';

/**
 * Insights da conta e das mídias.
 *
 * A Meta deprecia métricas com frequência (impressions/plays → views em 2025)
 * e uma métrica inválida derruba a chamada inteira. Por isso a busca é
 * resiliente: pede tudo de uma vez e, se a Meta recusar por parâmetro, refaz
 * métrica a métrica e devolve quais ficaram indisponíveis e por quê.
 */

export const ACCOUNT_TOTAL_METRICS = [
  'reach',
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'profile_links_taps',
  'follows_and_unfollows',
] as const;

export const METRIC_LABELS: Record<string, string> = {
  reach: 'Alcance',
  views: 'Visualizações',
  accounts_engaged: 'Contas engajadas',
  total_interactions: 'Interações',
  likes: 'Curtidas',
  comments: 'Comentários',
  shares: 'Compartilhamentos',
  saves: 'Salvamentos',
  saved: 'Salvamentos',
  replies: 'Respostas',
  profile_links_taps: 'Toques em links',
  follows_and_unfollows: 'Seguidores ganhos (líquido)',
  follows: 'Novos seguidores',
  profile_visits: 'Visitas ao perfil',
  ig_reels_avg_watch_time: 'Tempo médio assistido (ms)',
  ig_reels_video_view_total_time: 'Tempo total assistido (ms)',
  follower_count: 'Novos seguidores/dia',
};

export const MEDIA_METRICS: Record<'FEED' | 'REELS' | 'STORY', readonly string[]> = {
  FEED: ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'],
  REELS: [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saved',
    'total_interactions',
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
  ],
  STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions'],
};

type InsightEntry = {
  name: string;
  values?: { value: number | Record<string, number>; end_time?: string }[];
  total_value?: { value: number; breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] };
};

export interface MetricsResult {
  values: Record<string, number | null>;
  unavailable: UnavailableMetric[];
}

function reasonFor(err: MetaApiError): string {
  if (err.category === 'permission') return 'Permissão de insights não concedida (instagram_business_manage_insights).';
  const msg = err.message.toLowerCase();
  if (msg.includes('100 followers')) return 'A Meta só libera esta métrica para contas com 100+ seguidores.';
  if (msg.includes('not supported') || msg.includes('does not support')) return 'Não suportada para este tipo de conta/mídia.';
  return 'Métrica indisponível pela API oficial para esta conta ou mídia.';
}

function entryValue(entry: InsightEntry): number | null {
  if (entry.name === 'follows_and_unfollows' && entry.total_value?.breakdowns?.length) {
    // breakdown follow_type: FOLLOWER / NON_FOLLOWER → saldo líquido.
    let net = 0;
    for (const r of entry.total_value.breakdowns[0]?.results ?? []) {
      net += r.dimension_values.includes('FOLLOWER') ? r.value : -r.value;
    }
    return net;
  }
  if (entry.total_value && typeof entry.total_value.value === 'number') return entry.total_value.value;
  const v = entry.values?.[entry.values.length - 1]?.value;
  return typeof v === 'number' ? v : null;
}

async function fetchResilient(
  metrics: readonly string[],
  call: (metrics: readonly string[]) => Promise<InsightEntry[]>,
): Promise<MetricsResult> {
  const values: Record<string, number | null> = {};
  const unavailable: UnavailableMetric[] = [];
  const absorb = (entries: InsightEntry[]) => {
    for (const e of entries) values[e.name] = entryValue(e);
  };
  try {
    absorb(await call(metrics));
  } catch (err) {
    if (!(err instanceof MetaApiError) || !['invalid_request', 'permission', 'not_found', 'unknown'].includes(err.category)) throw err;
    if (metrics.length === 1) {
      unavailable.push({ key: metrics[0]!, reason: reasonFor(err) });
      return { values, unavailable };
    }
    for (const metric of metrics) {
      try {
        absorb(await call([metric]));
      } catch (single) {
        if (!(single instanceof MetaApiError) || single.category === 'auth' || single.category === 'rate_limit') throw single;
        unavailable.push({ key: metric, reason: reasonFor(single) });
      }
    }
  }
  for (const m of metrics) {
    if (!(m in values) && !unavailable.some((u) => u.key === m)) {
      unavailable.push({ key: m, reason: 'A Meta não retornou dados para o período.' });
    }
  }
  return { values, unavailable };
}

export async function getAccountTotals(
  graph: GraphClient,
  token: string,
  igUserId: string,
  since: Date,
  until: Date,
): Promise<MetricsResult> {
  return fetchResilient(ACCOUNT_TOTAL_METRICS, async (metrics) => {
    const res = await graph.get<{ data: InsightEntry[] }>(
      `${igUserId}/insights`,
      {
        metric: metrics.join(','),
        period: 'day',
        metric_type: 'total_value',
        since: Math.floor(since.getTime() / 1000),
        until: Math.floor(until.getTime() / 1000),
        ...(metrics.includes('follows_and_unfollows') ? { breakdown: 'follow_type' } : {}),
      },
      token,
    );
    return res.data;
  });
}

export interface DailyPoint {
  date: string;
  value: number;
}

/** Série diária de uma métrica que suporta time_series (reach, follower_count). */
export async function getAccountDailySeries(
  graph: GraphClient,
  token: string,
  igUserId: string,
  metric: 'reach' | 'follower_count',
  since: Date,
  until: Date,
): Promise<DailyPoint[]> {
  const res = await graph.get<{ data: InsightEntry[] }>(
    `${igUserId}/insights`,
    {
      metric,
      period: 'day',
      since: Math.floor(since.getTime() / 1000),
      until: Math.floor(until.getTime() / 1000),
    },
    token,
  );
  const values = res.data.find((d) => d.name === metric)?.values ?? [];
  return values
    .filter((v): v is { value: number; end_time: string } => typeof v.value === 'number' && Boolean(v.end_time))
    .map((v) => ({
      // end_time marca o fim do dia (meia-noite seguinte, horário do Pacífico) — o dia medido é o anterior.
      date: new Date(new Date(v.end_time).getTime() - 12 * 3600_000).toISOString().slice(0, 10),
      value: v.value,
    }));
}

export function mediaMetricGroup(productType: string | null, mediaType: string | null): keyof typeof MEDIA_METRICS {
  if (productType === 'REELS') return 'REELS';
  if (productType === 'STORY') return 'STORY';
  if (mediaType === 'VIDEO' && productType !== 'FEED') return 'REELS';
  return 'FEED';
}

export async function getMediaInsights(
  graph: GraphClient,
  token: string,
  mediaId: string,
  group: keyof typeof MEDIA_METRICS,
): Promise<MetricsResult> {
  return fetchResilient(MEDIA_METRICS[group], async (metrics) => {
    const res = await graph.get<{ data: InsightEntry[] }>(`${mediaId}/insights`, { metric: metrics.join(',') }, token);
    return res.data;
  });
}
