import { METADATA_CATEGORY_LABELS, type MetadataItem } from '@mediaforge/shared';
import clsx from 'clsx';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge, KeyValue, Spinner } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { SectionTitle } from '../../components/ui/Panel';
import { formatBytes, formatDuration, formatFps, formatResolution } from '../../lib/format';
import { useAssetDetail } from '../../lib/queries';

const ORDER: Array<MetadataItem['category']> = ['gps', 'dates', 'device', 'descriptive', 'software', 'custom', 'container', 'streams', 'embedded', 'technical'];

export function MetadataTable({ items, reveal }: { items: MetadataItem[]; reveal: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, MetadataItem[]>();
    for (const i of items) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return ORDER.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [items]);
  if (!items.length) return <p className="text-[12px] text-ink-3">Nenhum metadado encontrado.</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map(([cat, list]) => (
        <div key={cat} className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2 bg-surface-2 px-2.5 py-1.5">
            <span className="text-[12px] font-semibold text-ink">{METADATA_CATEGORY_LABELS[cat].label}</span>
            <Badge tone={cat === 'technical' ? 'neutral' : 'violet'}>{list.length}</Badge>
            <span className="ml-auto hidden truncate text-[11px] text-ink-3 sm:block">{METADATA_CATEGORY_LABELS[cat].hint}</span>
          </div>
          <table className="w-full table-fixed text-[11.5px]">
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="border-t border-line align-top">
                  <td className="w-[34%] px-2.5 py-1.5 text-ink-3">
                    <span className="block truncate" title={i.location}>
                      {i.location}
                    </span>
                  </td>
                  <td className="w-[30%] px-2 py-1.5 font-medium break-words text-ink-2">{i.key}</td>
                  <td className="px-2 py-1.5 font-mono break-words text-ink">
                    {i.sensitive && !reveal ? (
                      <span className="inline-flex items-center gap-1 text-ink-3">
                        <Lock size={10} /> oculto
                      </span>
                    ) : (
                      i.value
                    )}
                    {i.note && <span className="mt-0.5 block font-sans text-[10.5px] text-ink-3">{i.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function AssetDetail({ assetId, onClose }: { assetId: string | null; onClose: () => void }) {
  const { data: a, isLoading } = useAssetDetail(assetId);
  const [reveal, setReveal] = useState(false);
  return (
    <Modal open={!!assetId} onClose={onClose} side title={a?.name ?? 'Arquivo'} subtitle={a ? `${a.container ?? a.ext.toUpperCase()} · ${formatBytes(a.size)}` : undefined} testId="asset-detail">
      {isLoading || !a ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            {a.kind === 'video' ? (
              <video src={a.fileUrl} controls preload="metadata" className="max-h-72 w-full" />
            ) : a.kind === 'image' ? (
              <img src={a.fileUrl} alt={a.name} className="max-h-72 w-full object-contain" />
            ) : a.kind === 'audio' ? (
              <audio src={a.fileUrl} controls className="w-full" />
            ) : (
              <p className="p-3 text-[12px] text-ink-3">Arquivo de legenda (SRT).</p>
            )}
          </div>

          <section>
            <SectionTitle>Informações técnicas</SectionTitle>
            <KeyValue
              items={[
                ['Contêiner', a.info?.containerLong ?? a.container ?? '—'],
                ['Duração', formatDuration(a.durationSec)],
                ['Resolução de exibição', formatResolution(a.width, a.height)],
                ['Rotação', a.info?.rotation ? `${a.info.rotation}°` : 'nenhuma'],
                ['Taxa de quadros', formatFps(a.fps)],
                ['Vídeo', a.videoCodec ?? '—'],
                ['Áudio', a.audioCodec ?? 'sem áudio'],
                ['Taxa de bits', a.bitrate ? `${Math.round(a.bitrate / 1000)} kb/s` : '—'],
                ['SHA-256', <span className="font-mono text-[11px] break-all">{a.sha256}</span>],
              ]}
            />
            {a.duplicateOf.length > 0 && <p className="mt-2 text-[11.5px] text-info">Este arquivo é idêntico (mesmo SHA-256) a {a.duplicateOf.length} outro(s) arquivo(s) da sessão.</p>}
          </section>

          {a.info && a.info.streams.length > 0 && (
            <section>
              <SectionTitle>Fluxos</SectionTitle>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-surface-2 text-left text-ink-3">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">Tipo</th>
                      <th className="px-2 py-1.5 font-medium">Codec</th>
                      <th className="px-2 py-1.5 font-medium">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.info.streams.map((s) => (
                      <tr key={s.index} className={clsx('border-t border-line', s.index === a.info!.videoIndex || s.index === a.info!.audioIndex ? 'text-ink' : 'text-ink-3')}>
                        <td className="px-2.5 py-1.5 tabular">{s.index}</td>
                        <td className="px-2 py-1.5">{s.type}</td>
                        <td className="px-2 py-1.5 font-mono">{s.codec ?? '?'}</td>
                        <td className="px-2 py-1.5">
                          {s.type === 'video' ? `${s.width}×${s.height} ${s.pixFmt ?? ''} ${s.fps ? `${s.fps} fps` : ''}${s.attachedPic ? ' (capa)' : ''}` : s.type === 'audio' ? `${s.sampleRate ?? '?'} Hz · ${s.channels ?? '?'} canais` : s.codecTag ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <SectionTitle
              hint="Valores sensíveis ficam ocultos até você revelar. Eles nunca são gravados nos logs do servidor."
              right={
                <Button size="xs" variant="subtle" icon={reveal ? EyeOff : Eye} onClick={() => setReveal((v) => !v)}>
                  {reveal ? 'Ocultar valores' : 'Revelar valores'}
                </Button>
              }
            >
              Metadados encontrados ({a.metadata?.items.length ?? 0})
            </SectionTitle>
            <MetadataTable items={a.metadata?.items ?? []} reveal={reveal} />
            {(a.metadata?.warnings.length ?? 0) > 0 && (
              <ul className="mt-2 list-disc pl-4 text-[11.5px] text-warn">
                {a.metadata!.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
