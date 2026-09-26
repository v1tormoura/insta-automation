import type { CreatePostInput, JobDTO, ListJobsQuery, ListPostsQuery, Paginated, PostDTO } from '@nexora/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

type PostFilters = Partial<ListPostsQuery>;
type JobFilters = Partial<Omit<ListJobsQuery, 'status'>> & { status?: string };

export function usePosts(filters: PostFilters) {
  return useQuery({
    queryKey: qk.posts(filters),
    queryFn: () => api<Paginated<PostDTO>>('/posts', { query: filters }),
    placeholderData: keepPreviousData,
  });
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: qk.post(id ?? ''),
    queryFn: () => api<{ post: PostDTO }>(`/posts/${id}`).then((r) => r.post),
    enabled: Boolean(id),
  });
}

export function useJobs(filters: JobFilters, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: qk.jobs(filters),
    queryFn: () => api<Paginated<JobDTO>>('/jobs', { query: filters }),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });
}

function useInvalidatePublishing() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.jobsAll }),
      qc.invalidateQueries({ queryKey: qk.postsAll }),
      qc.invalidateQueries({ queryKey: qk.dashboard }),
      qc.invalidateQueries({ queryKey: ['post'] }),
      qc.invalidateQueries({ queryKey: qk.campaigns }),
    ]);
}

export function useCreatePost() {
  const invalidate = useInvalidatePublishing();
  return useMutation({
    mutationFn: (input: CreatePostInput) => api<{ post: PostDTO }>('/posts', { method: 'POST', body: input }).then((r) => r.post),
    onSuccess: invalidate,
  });
}

export function usePostAction() {
  const invalidate = useInvalidatePublishing();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'delete' }) =>
      action === 'delete' ? api<void>(`/posts/${id}`, { method: 'DELETE' }) : api(`/posts/${id}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useJobAction() {
  const invalidate = useInvalidatePublishing();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' | 'run-now' }) =>
      api<{ job: JobDTO }>(`/jobs/${id}/${action}`, { method: 'POST' }).then((r) => r.job),
    onSuccess: invalidate,
  });
}

export function useSubmitDraft() {
  const invalidate = useInvalidatePublishing();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Pick<CreatePostInput, 'accountIds' | 'schedule' | 'accountStaggerMinutes'>) =>
      api<{ post: PostDTO }>(`/posts/${id}/submit`, { method: 'POST', body: body as unknown as Record<string, unknown> }).then((r) => r.post),
    onSuccess: invalidate,
  });
}
