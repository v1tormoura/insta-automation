import { AlertTriangle, Loader2, UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ACCEPT_ATTR, type UploadItem } from './useUploads';

export function Dropzone({
  onFiles,
  multiple,
  hint,
  className,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  hint: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        over && 'border-primary bg-accent/60',
        className,
      )}
    >
      <UploadCloud className="size-6 text-primary" aria-hidden />
      <p className="text-sm font-medium">Arraste arquivos ou clique para enviar</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={ACCEPT_ATTR}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function UploadList({ items, onDismiss }: { items: UploadItem[]; onDismiss: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          {i.status === 'error' ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <Loader2 className={cn('size-4 shrink-0 text-primary', i.status === 'uploading' && 'animate-spin')} aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate">{i.name}</p>
            {i.status === 'error' ? <p className="text-xs text-destructive">{i.error}</p> : <Progress value={i.progress} className="h-1" />}
          </div>
          {i.status === 'error' && (
            <button type="button" onClick={() => onDismiss(i.key)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Dispensar">
              <X className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
