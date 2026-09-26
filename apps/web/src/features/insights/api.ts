import type { AccountInsightsDTO, InsightRange, MediaInsightDTO } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useAccountInsights(accountId: string | undefined, range: InsightRange) {
  return useQuery({
    queryKey: qk.accountInsights(accountId ?? '', range),
    queryFn: () => api<{ insights: AccountInsightsDTO }>(`/insights/accounts/${accountId}`, { query: { range } }).then((r) => r.insights),
    enabled: Boolean(accountId),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useMediaInsights(filters: { accountId?: string; sort: string; limit?: number }) {
  return useQuery({
    queryKey: qk.mediaInsights(filters),
    queryFn: () => api<{ items: MediaInsightDTO[] }>('/insights/media', { query: filters }).then((r) => r.items),
  });
}

export function useRefreshInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api(`/insights/accounts/${accountId}/refresh`, { method: 'POST' }),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['insights'] }), 4_000),
  });
}
