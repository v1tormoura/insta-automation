import type { DashboardDTO } from '@nexora/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<{ dashboard: DashboardDTO }>('/dashboard').then((r) => r.dashboard) });
}
