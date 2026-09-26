import {
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  POST_TYPES,
  POST_TYPE_INFO,
  analyzeCaption,
  type MediaDTO,
  type PostType,
} from '@nexora/shared';
import { ArrowLeft, ArrowRight, Film, Images, Info, LayoutGrid, Library, Smartphone, SquareUser, Trash2, type LucideIcon } from 'lucide-react';
import { useCallback, useState, type Dispatch } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dropzone, UploadList } from '@/features/media/Dropzone';
import { LibraryPicker } from '@/features/media/LibraryPicker';
import { MediaTile } from '@/features/media/MediaTile';
import { useUploads } from '@/features/media/useUploads';
import { cn } from '@/lib/utils';
import type { ContentAction, ContentDraft } from './contentState';

const TYPE_ICON: Record<PostType, LucideIcon> = { IMAGE: Images, CAROUSEL: LayoutGrid, REEL: Film, STORY: Smartphone };

export function TypeSelector({ value, onChange }: { value: PostType; onChange: (t: PostType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de publicação">
      {POST_TYPES.map((t) => {
        const Icon = TYPE_ICON[t];
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
              active ? 'border-primary/60 bg-primary/8' : 'hover:bg-accent/50',
            )}
          >
            <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
            <span className="text-sm font-medium">{POST_TYPE_INFO[t].label}</span>
            <span className="text-xs leading-snug text-muted-foreground">{POST_TYPE_INFO[t].description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CaptionField({ value, onChange, id = 'caption' }: { value: string; onChange: (v: string) => void; id?: string }) {
  const a = analyzeCaption(value);
  const over = (n: number, max: number) => (n > max ? 'text-destructive font-medium' : '');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Legenda</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder="Escreva a legenda. Hashtags e @menções funcionam normalmente."
        aria-invalid={a.problems.length > 0}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular" aria-live="polite">
        <span className={over(a.length, CAPTION_MAX_LENGTH)}>
          {a.length}/{CAPTION_MAX_LENGTH} caracteres
        </span>
        <span className={over(a.hashtags, CAPTION_MAX_HASHTAGS)}>
          {a.hashtags}/{CAPTION_MAX_HASHTAGS} hashtags
        </span>
        <span className={over(a.mentions, CAPTION_MAX_MENTIONS)}>
          {a.mentions}/{CAPTION_MAX_MENTIONS} menções
        </span>
      </div>
    </div>
  );
}

function CoverPicker({ draft, dispatch }: { draft: ContentDraft; dispatch: Dispatch<ContentAction> }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const video = draft.media[0];
  const modes = [
    { id: 'auto', label: 'Automática', hint: 'O Instagram escolhe o quadro.' },
    { id: 'frame', label: 'Quadro do vídeo', hint: 'Escolha o segundo do vídeo.' },
    { id: 'image', label: 'Imagem própria', hint: 'Envie uma arte de capa (JPEG).' },
  ] as const;
  return (
    <div className="space-y-3">
      <Label>Capa do Reel</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Capa">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={draft.coverMode === m.id}
            onClick={() => dispatch({ type: 'setCoverMode', mode: m.id })}
            className={cn('rounded-lg border p-2.5 text-left text-sm', draft.coverMode === m.id ? 'border-primary/60 bg-primary/8' : 'hover:bg-accent/50')}
          >
            <p className="font-medium">{m.label}</p>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </button>
        ))}
      </div>
      {draft.coverMode === 'frame' && (
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            step={0.5}
            max={video?.durationSeconds ?? undefined}
            value={draft.coverFrameSeconds}
            onChange={(e) => dispatch({ type: 'setCoverFrame', seconds: Number(e.target.value) })}
            className="w-28"
            aria-label="Segundo do vídeo usado como capa"
          />
          <span className="text-sm text-muted-foreground">segundos{video?.durationSeconds ? ` (vídeo tem ${Math.floor(video.durationSeconds)}s)` : ''}</span>
        </div>
      )}
      {draft.coverMode === 'image' && (
        <div className="flex items-center gap-3">
          {draft.coverImage ? (
            <MediaTile media={draft.coverImage} className="w-20" />
          ) : (
            <div className="grid aspect-square w-20 place-items-center rounded-lg border border-dashed text-muted-foreground">
              <SquareUser className="size-5" aria-hidden />
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
            <Library /> Escolher imagem
          </Button>
          {draft.coverImage && (
            <Button type="button" variant="ghost" size="sm" onClick={() => dispatch({ type: 'setCoverImage', media: null })}>
              Remover
            </Button>
          )}
        </div>
      )}
      <LibraryPicker open={libraryOpen} onOpenChange={setLibraryOpen} accept={['image']} max={1} onPick={([m]) => m && dispatch({ type: 'setCoverImage', media: m })} />
    </div>
  );
}

/** Editor de um conteúdo: tipo, mídias, legenda e (em Reels) capa. */
export function ContentEditor({ draft, dispatch, compact }: { draft: ContentDraft; dispatch: Dispatch<ContentAction>; compact?: boolean }) {
  const info = POST_TYPE_INFO[draft.type];
  const [libraryOpen, setLibraryOpen] = useState(false);
  const onUploaded = useCallback((m: MediaDTO) => dispatch({ type: 'addMedia', media: [m] }), [dispatch]);
  const uploads = useUploads(onUploaded);
  const accepts = info.acceptsKinds.map((k) => (k === 'image' ? 'fotos (JPEG, PNG, WebP)' : 'vídeos (MP4, MOV)')).join(' ou ');

  return (
    <div className="space-y-5">
      <TypeSelector value={draft.type} onChange={(t) => dispatch({ type: 'setType', postType: t })} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>
            Mídia{info.maxItems > 1 ? 's' : ''}{' '}
            <span className="font-normal text-muted-foreground">
              ({draft.media.length}/{info.maxItems})
            </span>
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
            <Library /> Biblioteca
          </Button>
        </div>
        {draft.media.length > 0 && (
          <div className={cn('grid gap-2', compact ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-5')}>
            {draft.media.map((m, i) => (
              <MediaTile key={m.id} media={m}>
                <div className="absolute inset-x-1 top-1 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                  {info.maxItems > 1 ? (
                    <span className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">{i + 1}</span>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'removeMedia', id: m.id })}
                    className="rounded bg-black/65 p-1 text-white hover:bg-black/85"
                    aria-label={`Remover ${m.originalName}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                {info.maxItems > 1 && draft.media.length > 1 && (
                  <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button type="button" disabled={i === 0} onClick={() => dispatch({ type: 'moveMedia', id: m.id, delta: -1 })} className="rounded bg-black/65 p-1 text-white disabled:opacity-40" aria-label="Mover para a esquerda">
                      <ArrowLeft className="size-3" />
                    </button>
                    <button type="button" disabled={i === draft.media.length - 1} onClick={() => dispatch({ type: 'moveMedia', id: m.id, delta: 1 })} className="rounded bg-black/65 p-1 text-white disabled:opacity-40" aria-label="Mover para a direita">
                      <ArrowRight className="size-3" />
                    </button>
                  </div>
                )}
              </MediaTile>
            ))}
          </div>
        )}
        {draft.media.length < info.maxItems && (
          <Dropzone onFiles={(f) => void uploads.start(f)} multiple={info.maxItems > 1} hint={`Aceita ${accepts}. Até 300 MB por arquivo.`} className={compact ? 'py-5' : undefined} />
        )}
        <UploadList items={uploads.items} onDismiss={uploads.dismiss} />
      </div>

      {draft.type === 'REEL' && draft.media.length > 0 && <CoverPicker draft={draft} dispatch={dispatch} />}
      {draft.type === 'REEL' && (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Mostrar também no feed</p>
            <p className="text-xs text-muted-foreground">Desligado, o Reel aparece só na aba de Reels do perfil.</p>
          </div>
          <Switch checked={draft.shareToFeed} onCheckedChange={(v) => dispatch({ type: 'setShareToFeed', value: v })} aria-label="Mostrar no feed" />
        </div>
      )}

      {info.supportsCaption ? (
        <CaptionField value={draft.caption} onChange={(caption) => dispatch({ type: 'setCaption', caption })} />
      ) : (
        <Alert variant="info">
          <Info />
          <AlertDescription>
            Stories publicados pela API oficial não exibem legenda, stickers, links ou música — esses recursos não estão disponíveis na Content Publishing API.
          </AlertDescription>
        </Alert>
      )}

      <LibraryPicker
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        accept={info.acceptsKinds}
        max={info.maxItems - (info.maxItems > 1 ? draft.media.length : 0)}
        onPick={(media) => dispatch({ type: 'addMedia', media })}
      />
    </div>
  );
}
