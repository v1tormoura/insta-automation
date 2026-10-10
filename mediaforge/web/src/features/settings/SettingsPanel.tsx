import type { AssetDTO } from '@mediaforge/shared';
import clsx from 'clsx';
import { Clapperboard, Crop, FileOutput, Palette, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/workspace';
import { EditorialSection } from './sections/EditorialSection';
import { FramingSection } from './sections/FramingSection';
import { MetadataSection } from './sections/MetadataSection';
import { OutputSection } from './sections/OutputSection';
import { TimeColorSection } from './sections/TimeColorSection';

type Tab = 'saida' | 'metadados' | 'enquadramento' | 'tempo' | 'editorial';

const TABS: Array<{ id: Tab; label: string; icon: typeof FileOutput; modes: string[] }> = [
  { id: 'metadados', label: 'Metadados', icon: ShieldCheck, modes: ['quick', 'custom', 'editorial'] },
  { id: 'saida', label: 'Saída e codecs', icon: FileOutput, modes: ['quick', 'custom', 'editorial'] },
  { id: 'enquadramento', label: 'Enquadramento', icon: Crop, modes: ['custom', 'editorial'] },
  { id: 'tempo', label: 'Tempo, cor e áudio', icon: Palette, modes: ['custom', 'editorial'] },
  { id: 'editorial', label: 'Editorial', icon: Clapperboard, modes: ['editorial'] },
];

export function SettingsPanel({ focus }: { focus: AssetDTO | undefined }) {
  const ws = useWorkspace();
  const mode = ws.activeSettings.mode;
  const visible = TABS.filter((t) => t.modes.includes(mode));
  const [tab, setTab] = useState<Tab>('metadados');
  useEffect(() => {
    if (!visible.some((t) => t.id === tab)) setTab('metadados');
  }, [mode, tab, visible]);

  return (
    <div className="flex flex-col gap-3" data-testid="settings-panel">
      <div role="tablist" aria-label="Configurações" className="flex gap-1 overflow-x-auto border-b border-line">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={clsx(
              '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors',
              tab === t.id ? 'border-accent text-white' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-[200px]">
        {tab === 'saida' && <OutputSection />}
        {tab === 'metadados' && <MetadataSection focus={focus} />}
        {tab === 'enquadramento' && <FramingSection focus={focus} />}
        {tab === 'tempo' && <TimeColorSection focus={focus} />}
        {tab === 'editorial' && <EditorialSection />}
      </div>
    </div>
  );
}
