import { METADATA_CATEGORIES, METADATA_CATEGORY_LABELS, METADATA_PRESETS, type AssetDTO } from '@mediaforge/shared';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Toggle } from '../../../components/ui/controls';
import { Badge } from '../../../components/ui/feedback';
import { SectionTitle } from '../../../components/ui/Panel';
import { useWorkspace } from '../../../state/workspace';

const PRESET_LABELS: Record<keyof typeof METADATA_PRESETS, string> = {
  privacidade: 'Privacidade (recomendado)',
  total: 'Total + SEI',
  localizacao: 'Só localização',
  nenhuma: 'Nenhuma (manter tudo)',
};

export function MetadataSection({ focus }: { focus: AssetDTO | undefined }) {
  const ws = useWorkspace();
  const m = ws.activeSettings.metadata;
  const current = JSON.stringify(m.remove);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle hint="A limpeza é verificada após o processamento: o relatório informa o que foi removido, o que foi preservado e o que não pôde ser comprovado.">
          Pré-configurações
        </SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(METADATA_PRESETS) as Array<keyof typeof METADATA_PRESETS>).map((k) => (
            <Button
              key={k}
              size="xs"
              variant={JSON.stringify(METADATA_PRESETS[k]) === current ? 'primary' : 'subtle'}
              icon={k === 'privacidade' ? ShieldCheck : undefined}
              data-testid={`meta-preset-${k}`}
              onClick={() => ws.update((d) => void (d.metadata.remove = { ...METADATA_PRESETS[k] }))}
            >
              {PRESET_LABELS[k]}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle hint="Marque o que deve ser removido. O que não estiver marcado é preservado e regravado na saída quando o formato permite.">Remover</SectionTitle>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {METADATA_CATEGORIES.map((c) => {
            const found = focus?.metadataSummary.byCategory[c] ?? 0;
            return (
              <Toggle
                key={c}
                testId={`meta-${c}`}
                checked={m.remove[c]}
                onChange={(v) => ws.update((d) => void (d.metadata.remove[c] = v))}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {METADATA_CATEGORY_LABELS[c].label}
                    {focus && found > 0 && <Badge tone="violet">{found} no arquivo</Badge>}
                  </span>
                }
                hint={METADATA_CATEGORY_LABELS[c].hint}
              />
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle>Preservar</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={m.preserveOrientation}
            onChange={(v) => ws.update((d) => void (d.metadata.preserveOrientation = v))}
            label="Orientação da mídia"
            hint="Mantém a orientação EXIF (ou aplica a rotação nos pixels ao recodificar) para a mídia não aparecer girada."
          />
          <Toggle
            checked={m.preserveColorProfile}
            onChange={(v) => ws.update((d) => void (d.metadata.preserveColorProfile = v))}
            label="Perfil de cor (ICC)"
            hint="Remover pode alterar as cores exibidas em imagens com perfil próprio."
          />
        </div>
      </section>
    </div>
  );
}
