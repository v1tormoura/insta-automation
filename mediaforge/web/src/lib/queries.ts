import type { AssetDTO, BatchDTO, HistoryEntryDTO, JobDTO } from '@mediaforge/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export const keys = {
  session: ['session'] as const,
  system: ['system'] as const,
  presets: ['presets'] as const,
  assets: ['assets'] as const,
  asset: (id: string) => ['asset', id] as const,
  jobs: ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
  batches: ['batches'] as const,
  history: ['history'] as const,
  profiles: ['profiles'] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: api.session, refetchInterval: 60_000 });
export const useSystem = () => useQuery({ queryKey: keys.system, queryFn: api.system });
export const usePresets = () => useQuery({ queryKey: keys.presets, queryFn: api.presets, staleTime: Infinity });
export const useAssets = () => useQuery({ queryKey: keys.assets, queryFn: api.assets });
export const useAssetDetail = (id: string | null) =>
  useQuery({ queryKey: keys.asset(id ?? ''), queryFn: () => api.asset(id!), enabled: !!id });
export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: api.jobs });
export const useJobDetail = (id: string | null) =>
  useQuery({ queryKey: keys.job(id ?? ''), queryFn: () => api.job(id!), enabled: !!id });
export const useBatches = () => useQuery({ queryKey: keys.batches, queryFn: api.batches });
export const useHistory = () => useQuery({ queryKey: keys.history, queryFn: api.history });
export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: api.profiles });

// ── Atualização do cache a partir dos eventos em tempo real ────────────────

function upsert<T extends { id: string | number }>(list: T[] | undefined, item: T, prepend = false): T[] {
  const arr = list ? [...list] : [];
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item;
  else if (prepend) arr.unshift(item);
  else arr.push(item);
  return arr;
}

export function applyJob(job: JobDTO) {
  queryClient.setQueryData<JobDTO[]>(keys.jobs, (l) => upsert(l, job));
  const prev = queryClient.getQueryData<{ status: string }>(keys.job(job.id));
  if (prev && prev.status !== job.status) void queryClient.invalidateQueries({ queryKey: keys.job(job.id) });
}
export function removeJob(id: string) {
  queryClient.setQueryData<JobDTO[]>(keys.jobs, (l) => (l ?? []).filter((j) => j.id !== id));
}
export function applyAsset(asset: AssetDTO) {
  queryClient.setQueryData<AssetDTO[]>(keys.assets, (l) => upsert(l, asset));
}
export function removeAsset(id: string) {
  queryClient.setQueryData<AssetDTO[]>(keys.assets, (l) => (l ?? []).filter((a) => a.id !== id));
}
export function applyBatch(batch: BatchDTO) {
  queryClient.setQueryData<BatchDTO[]>(keys.batches, (l) => upsert(l, batch, true));
}
export function applyHistory(entry: HistoryEntryDTO) {
  queryClient.setQueryData<HistoryEntryDTO[]>(keys.history, (l) => upsert(l, entry, true).slice(0, 300));
}
