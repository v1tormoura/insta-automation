/** Chaves do cache do TanStack Query, num lugar só — eventos em tempo real invalidam por elas. */
export const qk = {
  me: ['me'] as const,
  accounts: ['accounts'] as const,
  dashboard: ['dashboard'] as const,
  media: (kind?: string) => ['media', kind ?? 'all'] as const,
  mediaAll: ['media'] as const,
  posts: (filters: Record<string, unknown>) => ['posts', filters] as const,
  postsAll: ['posts'] as const,
  post: (id: string) => ['post', id] as const,
  jobs: (filters: Record<string, unknown>) => ['jobs', filters] as const,
  jobsAll: ['jobs'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaign', id] as const,
  notifications: ['notifications'] as const,
  accountInsights: (id: string, range: string) => ['insights', 'account', id, range] as const,
  mediaInsights: (filters: Record<string, unknown>) => ['insights', 'media', filters] as const,
};
