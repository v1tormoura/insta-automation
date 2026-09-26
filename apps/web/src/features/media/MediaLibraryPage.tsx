import type { MediaKind } from '@nexora/shared';
import { Images, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useDeleteMedia, useMediaLibrary } from './api';
import { Dropzone, UploadList } from './Dropzone';
import { MediaTile } from './MediaTile';
import { useUploads } from './useUploads';

export function MediaLibraryPage() {
  const [kind, setKind] = useState<MediaKind | 'all'>('all');
  const { data, isLoading, error, refetch } = useMediaLibrary(kind === 'all' ? undefined : kind, 120);
  const del = useDeleteMedia();
  const [toDelete, setToDelete] = useState<string | null>(null);
  const uploads = useUploads(useCallback(() => undefined, []));

  return (
    <div className="space-y-6">
      <PageHeader title="Biblioteca de mídia" description="Arquivos enviados ficam aqui para reutilizar. Imagens são convertidas para JPEG, o formato exigido pelo Instagram." />
      <Dropzone onFiles={(f) => void uploads.start(f)} multiple hint="Fotos (JPEG, PNG, WebP) e vídeos (MP4, MOV) até 300 MB." />
      <UploadList items={uploads.items} onDismiss={uploads.dismiss} />

      <Tabs value={kind} onValueChange={(v) => setKind(v as MediaKind | 'all')}>
        <TabsList>
          <TabsTrigger value="all">Tudo</TabsTrigger>
          <TabsTrigger value="image">Fotos</TabsTrigger>
          <TabsTrigger value="video">Vídeos</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
      ) : data?.items.length ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {data.items.map((m) => (
            <figure key={m.id} className="space-y-1">
              <MediaTile media={m}>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-1.5 right-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={() => setToDelete(m.id)}
                  aria-label={`Excluir ${m.originalName}`}
                >
                  <Trash2 />
                </Button>
              </MediaTile>
              <figcaption className="truncate text-xs text-muted-foreground" title={m.originalName}>
                {m.originalName} · {formatBytes(m.sizeBytes)}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <EmptyState icon={Images} title="Biblioteca vazia" description="Envie arquivos acima ou pelo editor de publicação." />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title="Excluir esta mídia?"
        description="O arquivo é apagado do servidor. Publicações já feitas no Instagram não são afetadas."
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete, {
            onSuccess: () => (toast.success('Mídia excluída.'), setToDelete(null)),
            onError: (e) => (toast.error(errorMessage(e)), setToDelete(null)),
          })
        }
      />
    </div>
  );
}
