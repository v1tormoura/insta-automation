import type { JobDTO } from '@mediaforge/shared';
import clsx from 'clsx';
import { Archive, Download, FileText, Image as ImageIcon, PackageOpen, Play, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Checkbox, Select } from '../../components/ui/controls';
import { Badge, EmptyState } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/toast';
import { api, triggerDownload } from '../../lib/api';
import { formatBytes, formatDuration, formatFps, formatResolution } from '../../lib/format';
import { removeJob, useBatches, useJobs } from '../../lib/queries';
import { ReportDrawer } from './ReportDrawer';

function ResultCard({ job, selected, onToggle, onOpen, onReport }: { job: JobDTO; selected: boolean; onToggle: () => void; onOpen: () => void; onReport: () => void }) {
  const toast = useToast();
  const o = job.output!;
  const [busy, setBusy] = useState(false);
  return (
    <li className={clsx('flex flex-col overflow-hidden rounded-xl border bg-surface-2/70 transition-colors', selected ? 'border-accent/60' : 'border-line')} data-testid="result-card" data-name={o.name}>
      <button type="button" onClick={onOpen} className="group relative aspect-video w-full overflow-hidden bg-black" aria-label={`Visualizar ${o.name}`}>
        {o.thumbnailUrl ? (
          <img src={o.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid h-full place-items-center text-ink-3">
            <ImageIcon size={20} />
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/35">
          <span className="grid h-9 w-9 scale-90 place-items-center rounded-full bg-accent/90 text-white opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play size={16} />
          </span>
        </span>
        {o.kind === 'video' && o.durationSec ? <span className="tabular absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1 text-[10.5px] text-white">{formatDuration(o.durationSec)}</span> : null}
        <span className="absolute top-1.5 left-1.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onChange={onToggle} ariaLabel={`Selecionar ${o.name}`} testId="result-select" />
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="truncate text-[12px] font-semibold text-ink" title={o.name}>
          {o.name}
        </p>
        <p className="truncate text-[11px] text-ink-3" title={job.assetName}>
          de {job.assetName} · {job.label}
        </p>
        <p className="tabular text-[11px] text-ink-2">
          {o.name.split('.').pop()?.toUpperCase()} · {o.videoCodec ?? '—'}
          {o.kind === 'video' ? ` / ${o.hasAudio ? o.audioCodec : 'sem áudio'}` : ''} · {formatResolution(o.width, o.height)}
          {o.fps && o.kind === 'video' ? ` · ${formatFps(o.fps)}` : ''} · {formatBytes(o.size)}
        </p>
        <div className="flex flex-wrap gap-1">
          <Badge tone={job.validationStatus === 'passed' ? 'ok' : 'warn'}>{job.validationStatus === 'passed' ? 'Validado' : 'Validado c/ avisos'}</Badge>
          <Badge tone="neutral" title={`SHA-256 ${o.sha256}`}>
            <span className="font-mono">{o.sha256.slice(0, 8)}</span>
          </Badge>
        </div>
        <div className="mt-auto flex items-center gap-1 pt-1">
          <Button size="xs" variant="primary" icon={Download} onClick={() => triggerDownload(o.downloadUrl)} data-testid="download-btn">
            Baixar
          </Button>
          <Button size="xs" variant="subtle" icon={FileText} onClick={onReport} data-testid="report-btn">
            Relatório
          </Button>
          <IconButton
            icon={Trash2}
            size="xs"
            className="ml-auto"
            label="Excluir resultado"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.deleteJob(job.id);
                removeJob(job.id);
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      </div>
    </li>
  );
}

export function ResultsPanel() {
  const { data: jobs = [] } = useJobs();
  const { data: batches = [] } = useBatches();
  const toast = useToast();
  const [batch, setBatch] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<JobDTO | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const done = useMemo(
    () => jobs.filter((j) => j.status === 'completed' && j.output && (batch === 'all' || j.batchId === batch)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [jobs, batch],
  );
  const selectedDone = done.filter((j) => selected.has(j.id));
  const totalBytes = (list: JobDTO[]) => list.reduce((s, j) => s + (j.output?.size ?? 0), 0);

  const exportZip = async (list: JobDTO[]) => {
    setExporting(true);
    try {
      const r = await api.prepareExport(list.map((j) => j.id));
      triggerDownload(r.url);
      toast.push('success', `ZIP com ${r.count} arquivo(s) (${formatBytes(r.totalBytes)})`, ['Arquivos verificados por SHA-256 antes do download. Inclui relatórios.']);
    } catch (err) {
      toast.error(err, 'Exportação recusada');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="results-panel">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select
            ariaLabel="Filtrar por lote"
            value={batch}
            onChange={setBatch}
            options={[{ value: 'all', label: 'Todos os lotes' }, ...batches.map((b) => ({ value: b.id, label: b.label }))]}
          />
        </div>
        {done.length > 0 && (
          <Checkbox
            label={`${selectedDone.length} de ${done.length} selecionado(s)`}
            checked={selectedDone.length === done.length}
            indeterminate={selectedDone.length > 0 && selectedDone.length < done.length}
            onChange={(v) => setSelected(v ? new Set(done.map((j) => j.id)) : new Set())}
            ariaLabel="Selecionar todos os resultados"
          />
        )}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" icon={Archive} disabled={!selectedDone.length} loading={exporting} onClick={() => exportZip(selectedDone)} data-testid="export-selected">
            ZIP dos selecionados{selectedDone.length ? ` (${formatBytes(totalBytes(selectedDone))})` : ''}
          </Button>
          <Button size="sm" variant="primary" icon={PackageOpen} disabled={!done.length} loading={exporting} onClick={() => exportZip(done)} data-testid="export-all">
            Exportar tudo (ZIP)
          </Button>
        </span>
      </div>

      {done.length === 0 ? (
        <EmptyState icon={PackageOpen} title="Nenhum resultado ainda">
          Os arquivos gerados aparecem aqui depois de validados: pré-visualização, download, relatório de metadados e transformações.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
          {done.map((j) => (
            <ResultCard
              key={j.id}
              job={j}
              selected={selected.has(j.id)}
              onToggle={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(j.id)) n.delete(j.id);
                  else n.add(j.id);
                  return n;
                })
              }
              onOpen={() => setViewing(j)}
              onReport={() => setReport(j.id)}
            />
          ))}
        </ul>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.output?.name ?? ''} subtitle={viewing ? `${formatResolution(viewing.output?.width, viewing.output?.height)} · ${formatBytes(viewing.output?.size)}` : ''} width="max-w-4xl" testId="media-viewer">
        {viewing?.output && (
          <div className="grid place-items-center overflow-hidden rounded-lg bg-black">
            {viewing.output.kind === 'video' ? (
              <video src={viewing.output.previewUrl} controls autoPlay className="max-h-[70vh] w-full" />
            ) : (
              <img src={viewing.output.previewUrl} alt={viewing.output.name} className="max-h-[70vh] w-full object-contain" />
            )}
          </div>
        )}
      </Modal>
      <ReportDrawer jobId={report} onClose={() => setReport(null)} />
    </div>
  );
}
