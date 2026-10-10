import { METADATA_CATEGORY_LABELS, STRATEGY_LABELS, type JobReport, type MetadataItem } from '@mediaforge/shared';
import clsx from 'clsx';
import { CheckCircle2, Download, Eye, EyeOff, FileJson, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/controls';
import { Badge, KeyValue, Spinner, type Tone } from '../../components/ui/feedback';
import { Modal } from '../../components/ui/Modal';
import { SectionTitle } from '../../components/ui/Panel';
import { triggerDownload } from '../../lib/api';
import { formatBytes, formatDuration, formatFps, formatMs, formatResolution } from '../../lib/format';
import { useJobDetail } from '../../lib/queries';
import { NoteList, OperationList } from '../process/PlanView';

type Tab = 'resumo' | 'operacoes' | 'metadados' | 'validacao' | 'integridade' | 'comando';

export const VERDICT: Record<JobReport['metadata']['verdict'], { label: string; tone: Tone; icon: typeof ShieldCheck }> = {
  comprovado: { label: 'Remoção comprovada', tone: 'ok', icon: ShieldCheck },
  parcial: { label: 'Remoção comprovada em parte', tone: 'warn', icon: ShieldAlert },
  'nao-comprovado': { label: 'Remoção não comprovada', tone: 'bad', icon: ShieldAlert },
  'nada-a-remover': { label: 'Nada a remover', tone: 'neutral', icon: ShieldQuestion },
  'nao-solicitado': { label: 'Metadados mantidos', tone: 'neutral', icon: ShieldQuestion },
};

function ItemTable({ items, reveal, extra }: { items: Array<MetadataItem & Record<string, unknown>>; reveal: boolean; extra?: (i: MetadataItem & Record<string, unknown>) => ReactNode }) {
  if (!items.length) return <p className="text-[11.5px] text-ink-3">Nenhum.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-[11.5px]">
        <tbody>
          {items.map((i, idx) => (
            <tr key={`${i.id}-${idx}`} className="border-t border-line align-top first:border-t-0">
              <td className="w-[26%] px-2 py-1.5 text-ink-3">{METADATA_CATEGORY_LABELS[i.category].label}</td>
              <td className="w-[30%] px-2 py-1.5 break-words text-ink-2">
                {i.key}
                <span className="block text-[10.5px] text-ink-3">{i.location}</span>
              </td>
              <td className="px-2 py-1.5 font-mono break-words text-ink">
                {i.sensitive && !reveal ? <span className="text-ink-3">oculto</span> : i.value}
                {extra && <span className="mt-0.5 block font-sans text-[10.5px] text-ink-3">{extra(i)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareTable({ r }: { r: JobReport }) {
  const rows: Array<[string, string, string]> = [
    ['Arquivo', r.input.name, r.output.name],
    ['Formato', r.input.container ?? '—', r.output.container ?? '—'],
    ['Vídeo', r.input.videoCodec ?? '—', r.output.videoCodec ?? '—'],
    ['Áudio', r.input.audioCodec ?? 'sem áudio', r.output.hasAudio ? r.output.audioCodec ?? '—' : 'sem áudio'],
    ['Resolução', formatResolution(r.input.width, r.input.height), formatResolution(r.output.width, r.output.height)],
    ['Duração', formatDuration(r.input.durationSec), formatDuration(r.output.durationSec)],
    ['Quadros/s', formatFps(r.input.fps), formatFps(r.output.fps)],
    ['Tamanho', formatBytes(r.input.size), formatBytes(r.output.size)],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-[12px]">
        <thead className="bg-surface-2 text-left text-[11px] text-ink-3">
          <tr>
            <th className="w-[22%] px-2.5 py-1.5 font-medium" />
            <th className="px-2 py-1.5 font-medium">Entrada</th>
            <th className="px-2 py-1.5 font-medium">Saída</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-t border-line">
              <td className="px-2.5 py-1.5 text-ink-3">{k}</td>
              <td className="px-2 py-1.5 break-words text-ink-2">{a}</td>
              <td className={clsx('px-2 py-1.5 break-words', a !== b ? 'text-accent-soft' : 'text-ink-2')}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportDrawer({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { data: job, isLoading } = useJobDetail(jobId);
  const [tab, setTab] = useState<Tab>('resumo');
  const [reveal, setReveal] = useState(false);
  const r = job?.report ?? null;
  const verdict = r ? VERDICT[r.metadata.verdict] : null;
  return (
    <Modal
      open={!!jobId}
      onClose={onClose}
      side
      title={job ? `Relatório: ${job.output?.name ?? job.assetName}` : 'Relatório'}
      subtitle={job ? `${job.label} · ${job.status === 'completed' ? 'concluída' : job.status}` : undefined}
      testId="report-drawer"
      footer={
        job && (
          <>
            <Button size="sm" variant="ghost" icon={FileJson} onClick={() => triggerDownload(`/api/jobs/${job.id}/report`)}>
              Baixar relatório (JSON)
            </Button>
            {job.output && (
              <Button size="sm" variant="primary" icon={Download} onClick={() => triggerDownload(job.output!.downloadUrl)}>
                Baixar arquivo
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading || !job ? (
        <Spinner />
      ) : !r ? (
        <div className="text-[12.5px] text-ink-2">
          <p>Esta tarefa ainda não tem relatório.</p>
          {job.error && <p className="mt-2 text-bad">{job.error}</p>}
          {job.logTail && <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-ink-3">{job.logTail}</pre>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={r.validation.status === 'passed' ? 'ok' : r.validation.status === 'warning' ? 'warn' : 'bad'} icon={r.validation.status === 'failed' ? XCircle : CheckCircle2}>
              {r.validation.status === 'passed' ? 'Validação aprovada' : r.validation.status === 'warning' ? 'Validação com avisos' : 'Validação reprovada'}
            </Badge>
            {verdict && (
              <Badge tone={verdict.tone} icon={verdict.icon}>
                {verdict.label}
              </Badge>
            )}
            <Badge tone="info">{STRATEGY_LABELS[r.strategy]}</Badge>
            {job.status !== 'completed' && <Badge tone="bad">Tarefa {job.status}</Badge>}
          </div>
          <Segmented
            value={tab}
            onChange={setTab}
            className="w-full overflow-x-auto"
            options={[
              { value: 'resumo', label: 'Resumo' },
              { value: 'operacoes', label: 'Transformações' },
              { value: 'metadados', label: 'Metadados' },
              { value: 'validacao', label: 'Validação' },
              { value: 'integridade', label: 'Integridade' },
              { value: 'comando', label: 'Comando' },
            ]}
          />

          {tab === 'resumo' && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] text-ink-2">{r.strategyDescription}</p>
              <CompareTable r={r} />
              <KeyValue
                items={[
                  ['Tentativas', String(r.job.attempts)],
                  ['Início', r.job.startedAt ? new Date(r.job.startedAt).toLocaleString('pt-BR') : '—'],
                  ['Término', r.job.finishedAt ? new Date(r.job.finishedAt).toLocaleString('pt-BR') : '—'],
                  ['Duração do processamento', formatMs(r.job.durationMs)],
                ]}
              />
              <NoteList warnings={r.warnings} skipped={[]} />
            </div>
          )}

          {tab === 'operacoes' && (
            <div className="flex flex-col gap-3">
              <SectionTitle hint="Todas as operações aplicadas estão listadas. Nada é aplicado de forma oculta.">Transformações aplicadas</SectionTitle>
              <OperationList operations={r.operations} />
              <NoteList warnings={[]} skipped={r.skipped} />
            </div>
          )}

          {tab === 'metadados' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] text-ink-2">
                  {r.metadata.removed.filter((x) => x.requested).length} removido(s) · {r.metadata.preserved.length} preservado(s) · {r.metadata.unverified.length} não comprovado(s) ·{' '}
                  {r.metadata.added.length} gerado(s) pelo formato
                </p>
                <Button size="xs" variant="subtle" icon={reveal ? EyeOff : Eye} onClick={() => setReveal((v) => !v)}>
                  {reveal ? 'Ocultar' : 'Revelar'} valores
                </Button>
              </div>
              {r.metadata.unverified.length > 0 && (
                <section>
                  <SectionTitle>Não comprovados</SectionTitle>
                  <ItemTable items={r.metadata.unverified as never} reveal={reveal} extra={(i) => String(i.reason)} />
                </section>
              )}
              <section>
                <SectionTitle>Removidos</SectionTitle>
                <ItemTable
                  items={r.metadata.removed as never}
                  reveal={reveal}
                  extra={(i) => `${i.how === 'substituido' ? 'substituído por valor técnico padrão' : 'ausente na saída'}${i.requested ? '' : ' (não solicitado: o formato de saída não comporta)'}${i.note && String(i.note).startsWith('Agora:') ? ` · ${i.note}` : ''}`}
                />
              </section>
              <section>
                <SectionTitle>Preservados</SectionTitle>
                <ItemTable items={r.metadata.preserved as never} reveal={reveal} extra={(i) => String(i.reason)} />
              </section>
              <section>
                <SectionTitle>Gerados pelo formato de saída</SectionTitle>
                <ItemTable items={r.metadata.added as never} reveal />
              </section>
              <ul className="list-disc pl-4 text-[11.5px] text-ink-3">
                {r.metadata.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'validacao' && (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-2 text-left text-[11px] text-ink-3">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">Verificação</th>
                      <th className="px-2 py-1.5 font-medium">Esperado</th>
                      <th className="px-2 py-1.5 font-medium">Obtido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.validation.checks.map((c) => (
                      <tr key={c.name} className="border-t border-line">
                        <td className="px-2.5 py-1.5">
                          <span className={clsx('mr-1.5 inline-block h-1.5 w-1.5 rounded-full', c.status === 'ok' ? 'bg-ok' : c.status === 'warning' ? 'bg-warn' : 'bg-bad')} />
                          {c.name}
                        </td>
                        <td className="px-2 py-1.5 text-ink-2">{c.expected}</td>
                        <td className={clsx('px-2 py-1.5', c.status === 'ok' ? 'text-ink-2' : c.status === 'warning' ? 'text-warn' : 'text-bad')}>{c.actual}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.validation.decode.errors.length > 0 && (
                <pre className="overflow-x-auto rounded-lg border border-bad/30 bg-bad/5 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-bad">{r.validation.decode.errors.join('\n')}</pre>
              )}
            </div>
          )}

          {tab === 'integridade' && (
            <div className="flex flex-col gap-3">
              <KeyValue
                items={[
                  ['Algoritmo', r.integrity.algorithm],
                  ['Entrada (importação)', <span className="font-mono text-[11px] break-all">{r.integrity.inputSha256AtImport}</span>],
                  ['Entrada (antes de processar)', <span className="font-mono text-[11px] break-all">{r.integrity.inputSha256BeforeProcessing}</span>],
                  ['Entrada intacta após processar', r.integrity.inputUnchangedAfterProcessing ? 'sim' : 'NÃO'],
                  ['Saída', <span className="font-mono text-[11px] break-all">{r.integrity.outputSha256}</span>],
                  ['Saída idêntica à entrada', r.integrity.outputIdenticalToInput ? 'sim (bytes iguais)' : 'não'],
                  ['Saídas idênticas nesta sessão', r.integrity.identicalOutputs.length ? r.integrity.identicalOutputs.join(', ') : 'nenhuma'],
                ]}
              />
              <p className="rounded-lg border border-info/30 bg-info/5 p-2.5 text-[11.5px] leading-relaxed text-ink-2">
                <b className="text-info">Integridade técnica ≠ similaridade de conteúdo.</b> {r.integrity.note}
              </p>
            </div>
          )}

          {tab === 'comando' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11.5px] text-ink-3">Argumentos passados ao FFmpeg (sem shell; caminhos substituídos por marcadores).</p>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-ink-2">
                {r.command.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
