import type { AssetDTO } from '@mediaforge/shared';
import { Field, NumberInput, Segmented, Slider } from '../../../components/ui/controls';
import { SectionTitle } from '../../../components/ui/Panel';
import { formatDuration } from '../../../lib/format';
import { useWorkspace } from '../../../state/workspace';

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export function TimeColorSection({ focus }: { focus: AssetDTO | undefined }) {
  const ws = useWorkspace();
  const s = ws.activeSettings;
  const dur = focus?.kind === 'video' ? focus.durationSec : null;
  const editorial = s.mode === 'editorial';
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle hint={dur ? `Duração de "${focus!.name}": ${formatDuration(dur)}. Deixe em branco para usar o início/fim do vídeo.` : 'Deixe em branco para usar o início/fim do vídeo. Não se aplica a imagens.'}>
          Trecho (início e fim)
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Início">
            <NumberInput testId="trim-start" value={s.trim.start} allowEmpty min={0} max={dur ?? 86400} step={0.1} suffix="s" placeholder="0" onChange={(v) => ws.update((d) => void (d.trim.start = v))} />
          </Field>
          <Field label="Fim">
            <NumberInput testId="trim-end" value={s.trim.end} allowEmpty min={0} max={dur ?? 86400} step={0.1} suffix="s" placeholder={dur ? dur.toFixed(1) : 'fim'} onChange={(v) => ws.update((d) => void (d.trim.end = v))} />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle hint="Gera várias saídas a partir de um vídeo: cada parte vira uma tarefa e um arquivo.">Divisão em partes</SectionTitle>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            testId="segmentation"
            value={s.segmentation.mode}
            onChange={(v) => ws.update((d) => void (d.segmentation.mode = v))}
            options={[
              { value: 'none', label: 'Não dividir' },
              { value: 'count', label: 'Em N partes' },
              { value: 'duration', label: 'A cada X segundos' },
            ]}
          />
          {s.segmentation.mode !== 'none' && (
            <div className="w-32">
              <NumberInput
                value={s.segmentation.value}
                min={1}
                max={s.segmentation.mode === 'count' ? 100 : 3600}
                step={s.segmentation.mode === 'count' ? 1 : 0.5}
                suffix={s.segmentation.mode === 'count' ? 'partes' : 's'}
                onChange={(v) => ws.update((d) => void (d.segmentation.value = v ?? 2))}
              />
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>Cor</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Slider label="Brilho" testId="brightness" value={s.color.brightness} min={-100} max={100} defaultValue={0} format={signed} onChange={(v) => ws.update((d) => void (d.color.brightness = v))} />
          <Slider label="Contraste" value={s.color.contrast} min={-100} max={100} defaultValue={0} format={signed} onChange={(v) => ws.update((d) => void (d.color.contrast = v))} />
          <Slider label="Saturação" value={s.color.saturation} min={-100} max={100} defaultValue={0} format={signed} onChange={(v) => ws.update((d) => void (d.color.saturation = v))} />
        </div>
      </section>

      <section>
        <SectionTitle>Velocidade e áudio</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider
            label="Velocidade de reprodução"
            testId="speed"
            value={s.speed}
            min={0.25}
            max={4}
            step={0.05}
            defaultValue={1}
            format={(v) => `${v.toLocaleString('pt-BR')}×`}
            onChange={(v) => ws.update((d) => void (d.speed = Math.round(v * 100) / 100))}
            hint="O áudio acompanha sem alterar o tom."
          />
          <Slider
            label="Volume do áudio"
            value={s.audio.volume}
            min={0}
            max={4}
            step={0.05}
            defaultValue={1}
            disabled={s.audio.mode === 'remove'}
            format={(v) => (v === 0 ? 'mudo' : `${Math.round(v * 100)}% (${(20 * Math.log10(v)).toFixed(1)} dB)`)}
            onChange={(v) => ws.update((d) => void (d.audio.volume = Math.round(v * 100) / 100))}
          />
        </div>
      </section>

      {editorial && (
        <section>
          <SectionTitle hint="Entrada e saída suaves de imagem e som no resultado final.">Transições</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="Entrada (fade in)" value={s.fade.in} min={0} max={5} step={0.1} defaultValue={0} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => ws.update((d) => void (d.fade.in = v))} />
            <Slider label="Saída (fade out)" value={s.fade.out} min={0} max={5} step={0.1} defaultValue={0} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => ws.update((d) => void (d.fade.out = v))} />
          </div>
        </section>
      )}
    </div>
  );
}
