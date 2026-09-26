import type { CampaignDTO, CreateCampaignInput, Paginated } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useCampaigns() {
  return useQuery({ queryKey: qk.campaigns, queryFn: () => api<Paginated<CampaignDTO>>('/campaigns', { query: { pageSize: 50 } }) });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: qk.campaign(id ?? ''),
    queryFn: () => api<{ campaign: CampaignDTO }>(`/campaigns/${id}`).then((r) => r.campaign),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) =>
      api<{ campaign: CampaignDTO }>('/campaigns', { method: 'POST', body: input as unknown as Record<string, unknown> }).then((r) => r.campaign),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.campaigns });
      void qc.invalidateQueries({ queryKey: qk.jobsAll });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useCampaignAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'cancel' }) =>
      api<{ campaign: CampaignDTO }>(`/campaigns/${id}/${action}`, { method: 'POST' }).then((r) => r.campaign),
    onSuccess: (campaign) => {
      qc.setQueryData(qk.campaign(campaign.id), campaign);
      void qc.invalidateQueries({ queryKey: qk.campaigns });
      void qc.invalidateQueries({ queryKey: qk.jobsAll });
    },
  });
}
