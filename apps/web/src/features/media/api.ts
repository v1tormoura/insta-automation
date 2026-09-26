import type { MediaDTO, MediaKind, Paginated } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadWithProgress } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useMediaLibrary(kind?: MediaKind, pageSize = 60) {
  return useQuery({
    queryKey: [...qk.media(kind), pageSize],
    queryFn: () => api<Paginated<MediaDTO>>('/media', { query: { kind, pageSize } }),
  });
}

export function useUploadMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress: (pct: number) => void }) => {
      const form = new FormData();
      form.append('file', file);
      return uploadWithProgress<{ media: MediaDTO }>('/media', form, onProgress).then((r) => r.media);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mediaAll }),
  });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/media/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mediaAll }),
  });
}
