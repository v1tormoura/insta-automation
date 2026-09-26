import type { MediaDTO, MediaKind } from '@nexora/shared';
import { Check, Images } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMediaLibrary } from './api';
import { MediaTile } from './MediaTile';

export function LibraryPicker({
  open,
  onOpenChange,
  accept,
  max,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accept: readonly MediaKind[];
  max: number;
  onPick: (media: MediaDTO[]) => void;
}) {
  const { data, isLoading } = useMediaLibrary(accept.length === 1 ? accept[0] : undefined, 120);
  const [selected, setSelected] = useState<MediaDTO[]>([]);
  const items = data?.items.filter((m) => accept.includes(m.kind)) ?? [];

  const toggle = (m: MediaDTO) =>
    setSelected((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : max === 1 ? [m] : s.length < max ? [...s, m] : s));

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setSelected([]))}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Biblioteca de mídia</DialogTitle>
          <DialogDescription>{max === 1 ? 'Escolha uma mídia.' : `Escolha até ${max} mídias, na ordem de publicação.`}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Images} title="Nada por aqui ainda" description="Envie arquivos pelo editor e eles ficam guardados na biblioteca." />
        ) : (
          <div className="scrollbar-thin grid max-h-[55dvh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
            {items.map((m) => {
              const index = selected.findIndex((s) => s.id === m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggle(m)} className="text-left focus-visible:outline-none" aria-pressed={index >= 0}>
                  <MediaTile media={m} className={cn('transition', index >= 0 ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : 'hover:opacity-85')}>
                    {index >= 0 && (
                      <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                        {max === 1 ? <Check className="size-3" /> : index + 1}
                      </span>
                    )}
                  </MediaTile>
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => {
              onPick(selected);
              setSelected([]);
              onOpenChange(false);
            }}
          >
            Adicionar {selected.length ? `(${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
