import clsx from 'clsx';
import { CheckCircle2, FileWarning, UploadCloud, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ProgressBar } from '../../components/ui/feedback';
import { useToast } from '../../components/ui/toast';
import { ApiError, uploadFile } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { applyAsset, useSystem } from '../../lib/queries';

interface UploadItem {
  key: number;
  name: string;
  size: number;
  progress: number;
  status: 'waiting' | 'uploading' | 'checking' | 'done' | 'error';
  error?: string;
}

const ACCEPT = 'video/*,image/*,audio/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.mp3,.wav,.m4a,.aac,.ogg,.flac,.srt';
let seq = 0;

/**
 * Importação por clique ou arrastar-e-soltar. Cada arquivo é enviado
 * separadamente (progresso individual); o servidor valida o conteúdo real,
 * calcula o SHA-256 e testa a decodificação antes de aceitar.
 */
export function DropZone({ onImported }: { onImported?: (ids: string[]) => void }) {
  const { data: system } = useSystem();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const running = useRef(false);
  const queue = useRef<Array<{ key: number; file: File }>>([]);

  const patch = (key: number, p: Partial<UploadItem>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const imported: string[] = [];
    try {
      while (queue.current.length) {
        const { key, file } = queue.current.shift()!;
        patch(key, { status: 'uploading' });
        try {
          const r = await uploadFile(file, (f) => patch(key, { progress: f, status: f >= 1 ? 'checking' : 'uploading' }));
          if (r.asset) applyAsset(r.asset);
          if (r.ok && r.asset) {
            imported.push(r.asset.id);
            patch(key, { status: 'done', progress: 1 });
          } else {
            patch(key, { status: 'error', error: r.error ?? 'Arquivo recusado' });
          }
        } catch (err) {
          patch(key, { status: 'error', error: err instanceof ApiError ? err.message : String(err) });
        }
      }
    } finally {
      running.current = false;
    }
    if (imported.length) onImported?.(imported);
    // Remove da lista os envios bem-sucedidos depois de um instante.
    setTimeout(() => setItems((l) => l.filter((i) => i.status !== 'done')), 2500);
  }, [onImported]);

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const maxBytes = (system?.limits.maxUploadMb ?? Infinity) * 1024 * 1024;
    const maxFiles = system?.limits.maxFilesPerUpload ?? 500;
    if (list.length > maxFiles) toast.push('warning', `Máximo de ${maxFiles} arquivos por vez`, [`${list.length - maxFiles} arquivo(s) ignorado(s).`]);
    const accepted: UploadItem[] = [];
    for (const file of list.slice(0, maxFiles)) {
      const key = ++seq;
      if (file.size > maxBytes) {
        accepted.push({ key, name: file.name, size: file.size, progress: 0, status: 'error', error: `Excede ${system?.limits.maxUploadMb} MB` });
        continue;
      }
      accepted.push({ key, name: file.name, size: file.size, progress: 0, status: 'waiting' });
      queue.current.push({ key, file });
    }
    setItems((l) => [...l, ...accepted]);
    void pump();
  };

  const activeCount = items.filter((i) => i.status === 'waiting' || i.status === 'uploading' || i.status === 'checking').length;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        className={clsx(
          'group flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-5 text-center transition-all',
          drag ? 'border-accent bg-accent/10 glow-accent' : 'border-line-strong bg-surface-2/60 hover:border-accent/60 hover:bg-accent/5',
        )}
      >
        <span className={clsx('grid h-9 w-9 place-items-center rounded-xl border transition-colors', drag ? 'border-accent bg-accent/20 text-white' : 'border-line-strong bg-surface-3 text-accent-soft group-hover:text-white')}>
          <UploadCloud size={18} />
        </span>
        <span className="text-[13px] font-medium text-ink">Arraste arquivos ou clique para importar</span>
        <span className="text-[11.5px] text-ink-3">
          MP4, MOV, MKV, WebM · JPG, PNG, WEBP · áudio e legendas SRT
          {system ? ` · até ${formatBytes(system.limits.maxUploadMb * 1024 * 1024)} por arquivo` : ''}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Envios">
          {activeCount > 0 && <li className="text-[11px] text-ink-3">Enviando e validando {activeCount} arquivo(s)…</li>}
          {items.map((i) => (
            <li key={i.key} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {i.status === 'error' ? <FileWarning size={13} className="shrink-0 text-bad" /> : i.status === 'done' ? <CheckCircle2 size={13} className="shrink-0 text-ok" /> : null}
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={i.name}>
                  {i.name}
                </span>
                <span className="tabular text-[11px] text-ink-3">
                  {i.status === 'checking' ? 'validando…' : i.status === 'waiting' ? 'na fila' : i.status === 'uploading' ? `${Math.round(i.progress * 100)}%` : formatBytes(i.size)}
                </span>
                {(i.status === 'error' || i.status === 'done') && (
                  <button type="button" aria-label="Dispensar" className="text-ink-3 hover:text-ink" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>
                    <X size={12} />
                  </button>
                )}
              </div>
              {(i.status === 'uploading' || i.status === 'checking') && <ProgressBar className="mt-1.5" value={i.progress} active={i.status === 'checking'} label={`Envio de ${i.name}`} />}
              {i.error && <p className="mt-1 text-[11px] text-bad">{i.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
