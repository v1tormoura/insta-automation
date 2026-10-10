import type { AssetDTO } from '@mediaforge/shared';
import clsx from 'clsx';
import { AlertOctagon, Copy, FileAudio, FileText, Film, Image as ImageIcon, Info, MapPin, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { IconButton } from '../../components/ui/Button';
import { Checkbox, Segmented } from '../../components/ui/controls';
import { Badge, EmptyState } from '../../components/ui/feedback';
import { useToast } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { formatBytes, formatDuration, formatResolution } from '../../lib/format';
import { removeAsset } from '../../lib/queries';
import { useWorkspace } from '../../state/workspace';

type Filter = 'all' | 'media' | 'resources' | 'invalid';

export const isPrimary = (a: AssetDTO) => a.status === 'ready' && (a.kind === 'video' || a.kind === 'image');

const KIND_ICON = { video: Film, image: ImageIcon, audio: FileAudio, subtitle: FileText };
const KIND_LABEL = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', subtitle: 'Legenda' };

export function AssetList({ assets, onDetails }: { assets: AssetDTO[]; onDetails: (id: string) => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [removing, setRemoving] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: assets.length,
      media: assets.filter(isPrimary).length,
      resources: assets.filter((a) => a.status === 'ready' && (a.kind === 'audio' || a.kind === 'subtitle')).length,
      invalid: assets.filter((a) => a.status === 'invalid').length,
    }),
    [assets],
  );
  const visible = assets.filter((a) =>
    filter === 'all' ? true : filter === 'media' ? isPrimary(a) : filter === 'resources' ? a.status === 'ready' && (a.kind === 'audio' || a.kind === 'subtitle') : a.status === 'invalid',
  );
  const selectable = visible.filter(isPrimary);
  const selectedVisible = selectable.filter((a) => ws.selected.includes(a.id));

  const remove = async (a: AssetDTO) => {
    setRemoving(a.id);
    try {
      await api.deleteAsset(a.id);
      removeAsset(a.id);
      ws.setSelected(ws.selected.filter((x) => x !== a.id));
    } catch (err) {
      toast.error(err, 'Não foi possível remover');
    } finally {
      setRemoving(null);
    }
  };

  if (assets.length === 0) {
    return (
      <EmptyState icon={Film} title="Nenhum arquivo importado">
        Importe vídeos e imagens para inspecionar metadados e criar versões. Áudios e legendas SRT ficam disponíveis como recursos do modo editorial.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Todos ${counts.all}` },
            { value: 'media', label: `Mídia ${counts.media}` },
            { value: 'resources', label: `Recursos ${counts.resources}` },
            { value: 'invalid', label: `Inválidos ${counts.invalid}`, disabled: counts.invalid === 0 },
          ]}
        />
        {selectable.length > 0 && (
          <span className="ml-auto">
            <Checkbox
              testId="select-all"
              label={`${ws.selected.filter((id) => assets.some((a) => a.id === id && isPrimary(a))).length} selec.`}
              checked={selectedVisible.length === selectable.length}
              indeterminate={selectedVisible.length > 0 && selectedVisible.length < selectable.length}
              onChange={(v) =>
                ws.setSelected(
                  v ? [...new Set([...ws.selected, ...selectable.map((a) => a.id)])] : ws.selected.filter((id) => !selectable.some((a) => a.id === id)),
                )
              }
              ariaLabel="Selecionar todos"
            />
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5" data-testid="asset-list">
        {visible.map((a) => {
          const Icon = KIND_ICON[a.kind];
          const selected = ws.selected.includes(a.id);
          const focused = ws.focusAssetId === a.id;
          const gps = a.metadataSummary.byCategory.gps ?? 0;
          return (
            <li
              key={a.id}
              data-testid="asset-item"
              data-asset-name={a.name}
              onClick={() => ws.setFocus(a.id)}
              className={clsx(
                'group relative flex cursor-pointer gap-2.5 rounded-lg border p-1.5 transition-colors',
                focused ? 'border-accent/70 bg-accent/8 glow-accent' : selected ? 'border-accent/35 bg-surface-2' : 'border-line bg-surface-2/70 hover:border-line-strong',
              )}
            >
              <div className="flex items-center pl-0.5" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected}
                  disabled={!isPrimary(a)}
                  onChange={() => ws.toggleSelected(a.id)}
                  ariaLabel={`Selecionar ${a.name}`}
                  testId="asset-select"
                />
              </div>
              <div className="relative h-12 w-[72px] shrink-0 overflow-hidden rounded-md border border-line bg-surface-3">
                {a.thumbnailUrl ? (
                  <img src={a.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-ink-3">{a.status === 'invalid' ? <AlertOctagon size={18} className="text-bad" /> : <Icon size={18} />}</span>
                )}
                {a.kind === 'video' && a.durationSec ? (
                  <span className="tabular absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px] text-white">{formatDuration(a.durationSec)}</span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink" title={a.name}>
                  {a.name}
                </p>
                <p className="tabular mt-0.5 truncate text-[11px] text-ink-3">
                  {a.status === 'invalid' ? 'Recusado' : KIND_LABEL[a.kind]} · {a.ext.toUpperCase() || '?'} · {formatBytes(a.size)}
                  {a.width ? ` · ${formatResolution(a.width, a.height)}` : ''}
                  {a.videoCodec ? ` · ${a.videoCodec}` : ''}
                  {a.kind === 'video' && a.status === 'ready' ? (a.hasAudio ? ` / ${a.audioCodec}` : ' / sem áudio') : ''}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.status === 'invalid' ? (
                    <Badge tone="bad" title={a.error ?? ''}>
                      Inválido
                    </Badge>
                  ) : (
                    <Badge tone="ok">Pronto</Badge>
                  )}
                  {gps > 0 && (
                    <Badge tone="warn" icon={MapPin} title="Contém localização">
                      GPS
                    </Badge>
                  )}
                  {a.metadataSummary.sensitive > 0 && (
                    <Badge tone="violet" title="Campos de metadados potencialmente pessoais">
                      {a.metadataSummary.sensitive} sensíveis
                    </Badge>
                  )}
                  {a.duplicateOf.length > 0 && (
                    <Badge tone="info" icon={Copy} title="Mesmo SHA-256 de outro arquivo importado">
                      Duplicado
                    </Badge>
                  )}
                  {focused && ws.editingIndividual && <Badge tone="accent">Editando individual</Badge>}
                  {ws.scope === 'individual' && ws.perAsset[a.id] && !focused && <Badge tone="accent">Config. própria</Badge>}
                </div>
                {a.status === 'invalid' && a.error && <p className="mt-1 text-[11px] leading-snug text-bad/90">{a.error}</p>}
              </div>
              <div className="flex flex-col items-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                {a.status === 'ready' && <IconButton icon={Info} size="xs" label="Detalhes e metadados" onClick={() => onDetails(a.id)} />}
                <IconButton icon={Trash2} size="xs" label="Remover da sessão" loading={removing === a.id} onClick={() => remove(a)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
