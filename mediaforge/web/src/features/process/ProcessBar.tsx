import type { AssetDTO, PlanResponse } from '@mediaforge/shared';
import { Eye, ListChecks, Play, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Slider } from '../../components/ui/controls';
import { Spinner } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/toast';
import { api, ApiError, supportsH264, type PreviewResult } from '../../lib/api';
import { formatDuration, formatResolution } from '../../lib/format';
import { applyBatch, applyJob, useSystem } from '../../lib/queries';
import { useWorkspace } from '../../state/workspace';
import { buildBatchRequest, countOutputs } from './batchRequest';
import { NoteList, OperationList, PlanJobCard } from './PlanView';

export function ProcessBar({ selectedAssets, focus, onProcessed }: { selectedAssets: AssetDTO[]; focus: AssetDTO | undefined; onProcessed: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const { data: system } = useSystem();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState<'plan' | 'process' | 'preview' | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string[] | null>(null);
  const [offset, setOffset] = useState(0);

  const ids = selectedAssets.map((a) => a.id);
  const count = countOutputs(selectedAssets, ws.settingsFor, ws.profiles);
  const request = () => buildBatchRequest(ids, ws.scope, ws.settings, ws.perAsset, ws.profiles);
  const ready = !!system?.ffmpeg.available && ids.length > 0;

  const validate = async () => {
    setBusy('plan');
    try {
      const r = await api.plan(request());
      setPlan(r);
      setPlanOpen(true);
    } catch (err) {
      toast.error(err, 'Falha ao validar');
    } finally {
      setBusy(null);
    }
  };

  const process = async () => {
    setBusy('process');
    try {
      const r = await api.createBatch(request());
      applyBatch(r.batch);
      r.jobs.forEach(applyJob);
      toast.push('success', `${r.jobs.length} tarefa(s) na fila`, [r.batch.label]);
      setPlanOpen(false);
      onProcessed();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid-batch') {
        setPlan({ ok: false, jobs: [], errors: (err.details as PlanResponse['errors']) ?? [] });
        setPlanOpen(true);
      } else toast.error(err, 'Não foi possível criar o lote');
    } finally {
      setBusy(null);
    }
  };

  const previewTarget = focus && (focus.kind === 'video' || focus.kind === 'image') && focus.status === 'ready' ? focus : selectedAssets[0];
  const runPreview = async (off = offset) => {
    if (!previewTarget) return;
    setBusy('preview');
    setPreviewOpen(true);
    setPreviewError(null);
    try {
      setPreview(await api.preview(previewTarget.id, ws.settingsFor(previewTarget.id), off, supportsH264() ? 'mp4' : 'webm'));
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof ApiError ? [err.message, ...err.detailLines] : [String(err)]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-testid="process-bar">
        <p className="mr-auto text-[12px] text-ink-3">
          {ids.length === 0 ? 'Selecione vídeos ou imagens na lista para processar.' : `${ids.length} arquivo(s) → ${count.total} saída(s)`}
          {!system?.ffmpeg.available && system ? ' · FFmpeg indisponível' : ''}
        </p>
        <Button icon={Eye} disabled={!previewTarget || busy !== null} loading={busy === 'preview'} onClick={() => runPreview()} data-testid="preview-btn" title="Renderiza um trecho curto em resolução reduzida com as configurações atuais">
          Pré-visualizar
        </Button>
        <Button icon={ListChecks} disabled={!ready || busy !== null} loading={busy === 'plan'} onClick={validate} data-testid="validate-btn">
          Validar plano
        </Button>
        <Button variant="primary" size="md" icon={Play} disabled={!ready || busy !== null} loading={busy === 'process'} onClick={process} data-testid="process-btn">
          Processar {count.total > 0 ? `${count.total} saída(s)` : ''}
        </Button>
      </div>

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Plano de processamento"
        subtitle={plan ? (plan.ok ? `${plan.jobs.length} saída(s) válidas — nada é aplicado sem estar listado aqui` : `${plan.errors.length} problema(s) encontrados; nenhuma tarefa foi criada`) : ''}
        width="max-w-3xl"
        testId="plan-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>
              Fechar
            </Button>
            <Button variant="primary" icon={Play} disabled={!plan?.ok || busy !== null} loading={busy === 'process'} onClick={process} data-testid="plan-process-btn">
              Processar {plan?.jobs.length ?? 0} saída(s)
            </Button>
          </>
        }
      >
        {plan && (
          <div className="flex flex-col gap-2.5">
            {plan.errors.length > 0 && (
              <div className="rounded-lg border border-bad/40 bg-bad/8 p-3" data-testid="plan-errors">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-bad">
                  <XCircle size={14} /> Corrija antes de processar
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-ink-2">
                  {plan.errors.map((e, i) => (
                    <li key={i}>
                      {e.assetName && <b className="font-medium">{e.assetName}: </b>}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.jobs.map((j, i) => (
              <PlanJobCard key={i} job={j} />
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Pré-visualização${previewTarget ? `: ${previewTarget.name}` : ''}`}
        subtitle={system ? `Trecho de até ${system.limits.previewMaxSeconds} s em resolução reduzida, gerado pelo FFmpeg com as configurações atuais` : undefined}
        width="max-w-3xl"
        testId="preview-dialog"
        footer={
          <Button icon={Eye} loading={busy === 'preview'} onClick={() => runPreview()}>
            Gerar novamente
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {previewTarget?.kind === 'video' && previewTarget.durationSec ? (
            <Slider
              label="Começar a prévia em"
              value={offset}
              min={0}
              max={Math.max(0, Math.floor(previewTarget.durationSec))}
              step={0.5}
              format={(v) => formatDuration(v)}
              onChange={setOffset}
              hint="Posição na linha do tempo final (inclui abertura, se houver)."
            />
          ) : null}
          <div className="grid min-h-48 place-items-center overflow-hidden rounded-lg border border-line bg-black">
            {busy === 'preview' ? (
              <span className="flex items-center gap-2 p-6 text-[12px] text-ink-3">
                <Spinner /> Renderizando prévia…
              </span>
            ) : previewError ? (
              <ul className="p-6 text-[12px] text-bad" data-testid="preview-error">
                {previewError.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : preview ? (
              preview.kind === 'video' ? (
                <video key={preview.url} src={preview.url} controls autoPlay muted loop className="max-h-[60vh] w-full" data-testid="preview-media" />
              ) : (
                <img key={preview.url} src={preview.url} alt="Prévia" className="max-h-[60vh] w-full object-contain" data-testid="preview-media" />
              )
            ) : null}
          </div>
          {preview && !busy && (
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="text-[11.5px] text-ink-3">
                <p>Prévia: {formatResolution(preview.width, preview.height)}</p>
                {preview.durationSec ? <p>Duração: {formatDuration(preview.durationSec)}</p> : null}
                <p className="mt-1">A saída final usa a resolução e a qualidade configuradas.</p>
              </div>
              <div>
                <OperationList operations={preview.operations} />
                <NoteList warnings={preview.warnings} skipped={preview.skipped} />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
