import type { AssetDTO, ProcessingMode } from '@mediaforge/shared';
import clsx from 'clsx';
import { Layers, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/controls';
import { useWorkspace } from '../../state/workspace';

const MODES: Array<{ value: ProcessingMode; label: string; icon: typeof Zap; text: string }> = [
  { value: 'quick', label: 'Rápido', icon: Zap, text: 'Inspeção, limpeza de metadados, conversão de formato e codec. Copia os fluxos quando possível (sem recodificar).' },
  { value: 'custom', label: 'Personalizado', icon: SlidersHorizontal, text: 'Proporção, resolução, corte e reenquadramento, trecho, cor, velocidade, áudio, codecs, fps e taxa de bits.' },
  { value: 'editorial', label: 'Editorial', icon: Sparkles, text: 'Tudo do personalizado + abertura/encerramento, textos, legendas, elementos gráficos, trilha e combinação de cenas.' },
];

export function ModeSelector({ selectedAssets }: { selectedAssets: AssetDTO[] }) {
  const ws = useWorkspace();
  const mode = ws.activeSettings.mode;
  const focus = selectedAssets.find((a) => a.id === ws.focusAssetId);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Modo de processamento" className="grid grid-cols-3 gap-2" data-testid="mode-selector">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            data-testid={`mode-${m.value}`}
            onClick={() => ws.setMode(m.value)}
            className={clsx(
              'flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all',
              mode === m.value ? 'border-accent bg-accent/10 glow-accent' : 'border-line bg-surface-2 hover:border-line-strong',
            )}
          >
            <span className="flex items-center gap-1.5">
              <m.icon size={14} className={mode === m.value ? 'text-accent-soft' : 'text-ink-3'} />
              <span className={clsx('text-[13px] font-semibold', mode === m.value ? 'text-white' : 'text-ink-2')}>{m.label}</span>
            </span>
            <span className="hidden text-[11px] leading-snug text-ink-3 md:block">{m.text}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/70 px-2.5 py-2">
        <Layers size={14} className="text-ink-3" />
        <span className="text-[12px] text-ink-2">Lote:</span>
        <Segmented
          value={ws.scope}
          onChange={ws.setScope}
          testId="scope"
          options={[
            { value: 'common', label: 'Perfil comum' },
            { value: 'individual', label: 'Individual por arquivo', disabled: selectedAssets.length < 2 },
          ]}
        />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">
          {ws.scope === 'common'
            ? `As mesmas configurações para ${selectedAssets.length} arquivo(s) selecionado(s).`
            : focus
              ? ws.editingIndividual
                ? `Editando a configuração própria de "${focus.name}". Clique em outro arquivo para editá-lo.`
                : 'Clique num arquivo selecionado para editar a configuração dele.'
              : 'Clique num arquivo selecionado para editar a configuração dele; os demais usam o perfil comum.'}
        </span>
        {ws.scope === 'individual' && focus && ws.perAsset[focus.id] && (
          <Button size="xs" variant="ghost" onClick={() => ws.resetIndividual(focus.id)}>
            Usar o comum neste arquivo
          </Button>
        )}
      </div>
    </div>
  );
}
