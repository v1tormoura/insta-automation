import type { AccountDTO, AccountSettingsInput } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: () => api<{ items: AccountDTO[] }>('/accounts'), select: (d) => d.items });
}

function useAccountMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: qk.accounts }) });
}

/** Pede a URL de autorização ao backend e navega até o Instagram. */
export function useConnectInstagram() {
  return useMutation({
    mutationFn: () => api<{ url: string }>('/oauth/instagram/start', { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export const useSyncAccount = () => useAccountMutation((id: string) => api(`/accounts/${id}/sync`, { method: 'POST' }));

export const useDisconnectAccount = () =>
  useAccountMutation((id: string) => api<{ canceledJobs: number }>(`/accounts/${id}`, { method: 'DELETE' }));

export const useUpdateAccountSettings = () =>
  useAccountMutation(({ id, ...input }: AccountSettingsInput & { id: string }) =>
    api(`/accounts/${id}/settings`, { method: 'PATCH', body: input }),
  );
