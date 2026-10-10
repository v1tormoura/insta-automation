import { FolderInput, History, ListOrdered, PackageCheck, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/layout/Header';
import { Panel } from './components/ui/Panel';
import { HistoryPanel } from './features/history/HistoryPanel';
import { AssetDetail } from './features/import/AssetDetail';
import { AssetList, isPrimary } from './features/import/AssetList';
import { DropZone } from './features/import/DropZone';
import { ProcessBar } from './features/process/ProcessBar';
import { QueuePanel } from './features/queue/QueuePanel';
import { ResultsPanel } from './features/results/ResultsPanel';
import { ModeSelector } from './features/settings/ModeSelector';
import { ProfilesBar } from './features/settings/ProfilesBar';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { useServerEvents } from './lib/events';
import { useAssets, useJobs, useSession } from './lib/queries';
import { useWorkspace } from './state/workspace';

export function App() {
  const { data: session } = useSession();
  const connection = useServerEvents(session?.id);
  const { data: assets = [], isSuccess } = useAssets();
  const { data: jobs = [] } = useJobs();
  const ws = useWorkspace();
  const [details, setDetails] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  // Remove do estado local arquivos que não existem mais na sessão.
  useEffect(() => {
    if (isSuccess) ws.forgetAssets(new Set(assets.map((a) => a.id)));
  }, [assets, isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAssets = useMemo(() => assets.filter((a) => ws.selected.includes(a.id) && isPrimary(a)), [assets, ws.selected]);
  const focus = assets.find((a) => a.id === ws.focusAssetId);
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const completed = jobs.filter((j) => j.status === 'completed').length;

  return (
    <div className="min-h-screen">
      <Header connection={connection} />
      <main className="mx-auto grid max-w-[1800px] gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_minmax(340px,400px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="Importar e arquivos" icon={FolderInput} subtitle={`${assets.length} arquivo(s) na sessão`} testId="import-panel">
            <div className="flex flex-col gap-3">
              <DropZone
                onImported={(ids) => {
                  const fresh = ids.filter((id) => !ws.selected.includes(id));
                  ws.setSelected([...ws.selected, ...fresh]);
                  if (!ws.focusAssetId && ids[0]) ws.setFocus(ids[0]);
                }}
              />
              <AssetList assets={assets} onDetails={setDetails} />
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="Processamento" icon={Settings2} subtitle="Modo, perfis, quantidade e configurações detalhadas" testId="processing-panel">
            <div className="flex flex-col gap-4">
              <ModeSelector selectedAssets={selectedAssets} />
              <ProfilesBar selectedAssets={selectedAssets} />
              <SettingsPanel focus={focus} />
            </div>
          </Panel>
          <div className="sticky bottom-3 z-20 rounded-[var(--radius-panel)] border border-line-strong bg-surface/95 px-3.5 py-2.5 shadow-[0_-12px_32px_-16px_rgb(0_0_0/0.9)] backdrop-blur">
            <ProcessBar selectedAssets={selectedAssets} focus={focus} onProcessed={() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          </div>
        </div>

        <div ref={queueRef} className="flex min-w-0 flex-col gap-3 lg:col-span-2 2xl:col-span-1">
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-1">
            <Panel title="Fila de processamento" icon={ListOrdered} subtitle={active ? `${active} tarefa(s) ativa(s)` : 'Nenhuma tarefa ativa'}>
              <QueuePanel />
            </Panel>
            <Panel title="Histórico da sessão" icon={History}>
              <HistoryPanel />
            </Panel>
          </div>
        </div>

        <div className="lg:col-span-2 2xl:col-span-3">
          <Panel title="Resultados e downloads" icon={PackageCheck} subtitle={`${completed} arquivo(s) validado(s)`}>
            <ResultsPanel />
          </Panel>
        </div>
      </main>
      <AssetDetail assetId={details} onClose={() => setDetails(null)} />
    </div>
  );
}
