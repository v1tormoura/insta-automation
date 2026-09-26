import { MAX_UPLOAD_BYTES, UPLOAD_MIME_TYPES, type MediaDTO } from '@nexora/shared';
import { useCallback, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useUploadMedia } from './api';

export interface UploadItem {
  key: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const ACCEPTED = [...UPLOAD_MIME_TYPES.image, ...UPLOAD_MIME_TYPES.video];
export const ACCEPT_ATTR = ACCEPTED.join(',');

/** Validação rápida no navegador; o servidor refaz tudo pelo conteúdo do arquivo. */
export function precheckFile(file: File): string | null {
  if (file.type && !ACCEPTED.includes(file.type)) return 'Formato não suportado (use JPEG, PNG, WebP, MP4 ou MOV).';
  if (file.size > MAX_UPLOAD_BYTES) return `Arquivo maior que ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB.`;
  return null;
}

/** Fila de uploads com progresso individual (dois em paralelo). */
export function useUploads(onUploaded: (media: MediaDTO) => void) {
  const upload = useUploadMedia();
  const [items, setItems] = useState<UploadItem[]>([]);

  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const start = useCallback(
    async (files: File[]) => {
      const jobs = files.map((file) => ({ file, key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}` }));
      setItems((list) => [...list, ...jobs.map(({ file, key }) => ({ key, name: file.name, progress: 0, status: 'uploading' as const }))]);
      const queue = [...jobs];
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const invalid = precheckFile(job.file);
          if (invalid) {
            patch(job.key, { status: 'error', error: invalid });
            continue;
          }
          try {
            const media = await upload.mutateAsync({ file: job.file, onProgress: (progress) => patch(job.key, { progress }) });
            patch(job.key, { status: 'done', progress: 100 });
            onUploaded(media);
          } catch (err) {
            patch(job.key, { status: 'error', error: errorMessage(err) });
          }
        }
      };
      await Promise.all([worker(), worker()]);
      // Concluídos somem depois de um instante; erros ficam até o usuário ver.
      setTimeout(() => setItems((list) => list.filter((i) => i.status !== 'done')), 1500);
    },
    [onUploaded, upload],
  );

  const dismiss = (key: string) => setItems((list) => list.filter((i) => i.key !== key));
  return { items, start, dismiss, busy: items.some((i) => i.status === 'uploading') };
}
