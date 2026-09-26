import type { MediaDTO } from '@nexora/shared';
import { Film } from 'lucide-react';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function MediaTile({ media, className, children }: { media: MediaDTO; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('group relative aspect-square overflow-hidden rounded-lg border bg-muted', className)}>
      {media.thumbnailUrl ? (
        <img src={media.thumbnailUrl} alt={media.originalName} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Film className="size-6" aria-hidden />
        </div>
      )}
      {media.kind === 'video' && (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Film className="size-3" aria-hidden />
          {formatDuration(media.durationSeconds) || 'vídeo'}
        </span>
      )}
      {children}
    </div>
  );
}
