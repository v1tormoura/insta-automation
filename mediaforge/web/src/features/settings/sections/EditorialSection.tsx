import {
  deepMerge,
  imageOverlaySchema,
  OVERLAY_POSITIONS,
  processingSettingsSchema,
  sceneSchema,
  TEXT_POSITIONS,
  textOverlaySchema,
  type EditorialSettings,
  type SegmentSource,
} from '@mediaforge/shared';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Sparkles, Trash2, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { ColorInput, Field, NumberInput, Segmented, Select, Slider, TextArea, Toggle } from '../../../components/ui/controls';
import { SectionTitle } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/toast';
import { usePresets } from '../../../lib/queries';
import { useWorkspace } from '../../../state/workspace';
import { AssetPicker } from '../AssetPicker';

/** Id válido no esquema que não corresponde a nenhum arquivo: o servidor recusa com mensagem clara. */
const PLACEHOLDER = 'selecione0000';

const POS_LABEL: Record<string, string> = {
  top: 'Topo',
  center: 'Centro',
  bottom: 'Base',
  'top-left': 'Topo à esquerda',
  'top-right': 'Topo à direita',
  'bottom-left': 'Base à esquerda',
  'bottom-right': 'Base à direita',
};

function Card({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/70 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-ink-2">{title}</span>
        <span className="ml-auto flex items-center gap-0.5">{actions}</span>
      </div>
      {children}
    </div>
  );
}

function TimeRange({ start, end, onStart, onEnd }: { start: number; end: number | null; onStart: (v: number) => void; onEnd: (v: number | null) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="De (s)">
        <NumberInput value={start} min={0} step={0.1} onChange={(v) => onStart(v ?? 0)} />
      </Field>
      <Field label="Até (s)">
        <NumberInput value={end} allowEmpty min={0} step={0.1} placeholder="fim" onChange={onEnd} />
      </Field>
    </div>
  );
}

function SourceEditor({ label, value, onChange, testId }: { label: string; value: SegmentSource | null; onChange: (v: SegmentSource | null) => void; testId: string }) {
  const kind = value?.type ?? 'none';
  return (
    <Card title={label}>
      <div className="flex flex-col gap-2.5">
        <Segmented
          testId={testId}
          value={kind}
          onChange={(k) =>
            onChange(
              k === 'none'
                ? null
                : k === 'card'
                  ? { type: 'card', text: label === 'Abertura' ? 'Título' : 'Obrigado por assistir', duration: 2.5, background: '#0A1022', color: '#FFFFFF', size: 7 }
                  : { type: 'asset', assetId: PLACEHOLDER, duration: 3 },
            )
          }
          options={[
            { value: 'none', label: 'Nenhum' },
            { value: 'card', label: 'Cartela de texto' },
            { value: 'asset', label: 'Vídeo ou imagem' },
          ]}
        />
        {value?.type === 'card' && (
          <>
            <Field label="Texto">
              <TextArea value={value.text} maxLength={200} onChange={(text) => onChange({ ...value, text })} ariaLabel={`Texto da ${label.toLowerCase()}`} />
            </Field>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Duração (s)">
                <NumberInput value={value.duration} min={0.5} max={30} step={0.5} onChange={(v) => onChange({ ...value, duration: v ?? 2.5 })} />
              </Field>
              <Field label="Tamanho (%)">
                <NumberInput value={value.size} min={2} max={20} step={0.5} onChange={(v) => onChange({ ...value, size: v ?? 7 })} />
              </Field>
              <Field label="Fundo">
                <ColorInput value={value.background} onChange={(background) => onChange({ ...value, background })} />
              </Field>
              <Field label="Texto">
                <ColorInput value={value.color} onChange={(color) => onChange({ ...value, color })} />
              </Field>
            </div>
          </>
        )}
        {value?.type === 'asset' && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="Arquivo">
              <AssetPicker kinds={['video', 'image']} value={value.assetId === PLACEHOLDER ? null : value.assetId} onChange={(id) => onChange({ ...value, assetId: id ?? PLACEHOLDER })} />
            </Field>
            <Field label="Duração se imagem (s)">
              <NumberInput value={value.duration} min={0.5} max={30} step={0.5} onChange={(v) => onChange({ ...value, duration: v ?? 3 })} />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );
}

export function EditorialSection() {
  const ws = useWorkspace();
  const toast = useToast();
  const { data: presets } = usePresets();
  const e = ws.activeSettings.editorial;
  const set = (fn: (d: EditorialSettings) => void) => ws.update((d) => fn(d.editorial));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle hint="Pontos de partida explícitos: preenchem os campos abaixo para você revisar antes de processar.">Perfis editoriais predefinidos</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {presets?.editorialPresets.map((p) => (
            <Button
              key={p.id}
              size="xs"
              variant="subtle"
              icon={Sparkles}
              title={p.description}
              onClick={() => {
                ws.replaceSettings(processingSettingsSchema.parse(deepMerge(ws.activeSettings, p.patch)));
                toast.push('info', `"${p.name}" aplicado`, [p.description]);
              }}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <SourceEditor label="Abertura" testId="intro-kind" value={e.intro} onChange={(v) => set((d) => void (d.intro = v))} />
        <SourceEditor label="Encerramento" testId="outro-kind" value={e.outro} onChange={(v) => set((d) => void (d.outro = v))} />
      </section>

      <section>
        <SectionTitle
          hint="Cenas autorizadas adicionadas depois do vídeo principal, na ordem da lista. Todas são ajustadas ao mesmo enquadramento."
          right={
            <Button size="xs" variant="subtle" icon={Plus} disabled={e.scenes.length >= 20} onClick={() => set((d) => void d.scenes.push(sceneSchema.parse({ assetId: PLACEHOLDER })))}>
              Adicionar cena
            </Button>
          }
        >
          Combinação de cenas ({e.scenes.length})
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {e.scenes.map((sc, i) => (
            <Card
              key={i}
              title={`Cena ${i + 1}`}
              actions={
                <>
                  <IconButton icon={ArrowUp} size="xs" label="Mover para cima" disabled={i === 0} onClick={() => set((d) => void d.scenes.splice(i - 1, 0, d.scenes.splice(i, 1)[0]!))} />
                  <IconButton icon={ArrowDown} size="xs" label="Mover para baixo" disabled={i === e.scenes.length - 1} onClick={() => set((d) => void d.scenes.splice(i + 1, 0, d.scenes.splice(i, 1)[0]!))} />
                  <IconButton icon={Trash2} size="xs" label="Remover cena" onClick={() => set((d) => void d.scenes.splice(i, 1))} />
                </>
              }
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_90px_100px]">
                <Field label="Arquivo">
                  <AssetPicker kinds={['video', 'image']} value={sc.assetId === PLACEHOLDER ? null : sc.assetId} onChange={(id) => set((d) => void (d.scenes[i]!.assetId = id ?? PLACEHOLDER))} />
                </Field>
                <Field label="De (s)">
                  <NumberInput value={sc.start} allowEmpty min={0} step={0.1} placeholder="0" onChange={(v) => set((d) => void (d.scenes[i]!.start = v))} />
                </Field>
                <Field label="Até (s)">
                  <NumberInput value={sc.end} allowEmpty min={0} step={0.1} placeholder="fim" onChange={(v) => set((d) => void (d.scenes[i]!.end = v))} />
                </Field>
                <Field label="Imagem (s)">
                  <NumberInput value={sc.duration} min={0.5} max={30} step={0.5} onChange={(v) => set((d) => void (d.scenes[i]!.duration = v ?? 3))} />
                </Field>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          hint="Textos próprios gravados sobre o vídeo final. Os tempos são da linha do tempo final (incluindo a abertura)."
          right={
            <Button size="xs" variant="subtle" icon={Type} data-testid="add-text" disabled={e.texts.length >= 10} onClick={() => set((d) => void d.texts.push(textOverlaySchema.parse({ text: 'Seu texto aqui' })))}>
              Adicionar texto
            </Button>
          }
        >
          Textos ({e.texts.length})
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {e.texts.map((t, i) => (
            <Card key={i} title={`Texto ${i + 1}`} actions={<IconButton icon={Trash2} size="xs" label="Remover texto" onClick={() => set((d) => void d.texts.splice(i, 1))} />}>
              <div className="flex flex-col gap-2">
                <TextArea testId={`text-${i}`} value={t.text} maxLength={500} onChange={(v) => set((d) => void (d.texts[i]!.text = v))} ariaLabel={`Texto ${i + 1}`} />
                <div className="grid gap-2 sm:grid-cols-4">
                  <Field label="Posição">
                    <Select value={t.position} onChange={(v) => set((d) => void (d.texts[i]!.position = v))} options={TEXT_POSITIONS.map((p) => ({ value: p, label: POS_LABEL[p]! }))} />
                  </Field>
                  <Field label="Tamanho (% altura)">
                    <NumberInput value={t.size} min={1} max={20} step={0.5} onChange={(v) => set((d) => void (d.texts[i]!.size = v ?? 5))} />
                  </Field>
                  <Field label="Cor">
                    <ColorInput value={t.color} onChange={(v) => set((d) => void (d.texts[i]!.color = v))} />
                  </Field>
                  <Slider label="Opacidade" value={t.opacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.texts[i]!.opacity = v))} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="flex items-end pb-1">
                    <Toggle checked={t.box} onChange={(v) => set((d) => void (d.texts[i]!.box = v))} label="Faixa de fundo" />
                  </div>
                  {t.box ? (
                    <>
                      <Field label="Cor da faixa">
                        <ColorInput value={t.boxColor} onChange={(v) => set((d) => void (d.texts[i]!.boxColor = v))} />
                      </Field>
                      <Slider label="Opacidade da faixa" value={t.boxOpacity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.texts[i]!.boxOpacity = v))} />
                    </>
                  ) : (
                    <span />
                  )}
                </div>
                <TimeRange start={t.start} end={t.end} onStart={(v) => set((d) => void (d.texts[i]!.start = v))} onEnd={(v) => set((d) => void (d.texts[i]!.end = v))} />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          hint="Logotipos e marcas próprias (imagens PNG com transparência funcionam melhor)."
          right={
            <Button size="xs" variant="subtle" icon={ImagePlus} disabled={e.overlays.length >= 5} onClick={() => set((d) => void d.overlays.push(imageOverlaySchema.parse({ assetId: PLACEHOLDER })))}>
              Adicionar elemento
            </Button>
          }
        >
          Elementos gráficos ({e.overlays.length})
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {e.overlays.map((o, i) => (
            <Card key={i} title={`Elemento ${i + 1}`} actions={<IconButton icon={Trash2} size="xs" label="Remover elemento" onClick={() => set((d) => void d.overlays.splice(i, 1))} />}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Imagem">
                  <AssetPicker kinds={['image']} value={o.assetId === PLACEHOLDER ? null : o.assetId} onChange={(id) => set((d) => void (d.overlays[i]!.assetId = id ?? PLACEHOLDER))} />
                </Field>
                <Field label="Posição">
                  <Select value={o.position} onChange={(v) => set((d) => void (d.overlays[i]!.position = v))} options={OVERLAY_POSITIONS.map((p) => ({ value: p, label: POS_LABEL[p]! }))} />
                </Field>
                <Slider label="Largura" value={o.scale} min={0.02} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}% do quadro`} onChange={(v) => set((d) => void (d.overlays[i]!.scale = v))} />
                <Slider label="Opacidade" value={o.opacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.overlays[i]!.opacity = v))} />
                <Slider label="Margem" value={o.margin} min={0} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => set((d) => void (d.overlays[i]!.margin = v))} />
                <TimeRange start={o.start} end={o.end} onStart={(v) => set((d) => void (d.overlays[i]!.start = v))} onEnd={(v) => set((d) => void (d.overlays[i]!.end = v))} />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card title="Legendas próprias (SRT)">
          <div className="flex flex-col gap-2">
            <Field label="Arquivo de legenda" hint="Gravadas na imagem, sincronizadas com a linha do tempo final.">
              <AssetPicker
                kinds={['subtitle']}
                value={e.subtitles?.assetId ?? null}
                placeholder="Sem legendas"
                onChange={(id) => set((d) => void (d.subtitles = id ? { assetId: id, size: d.subtitles?.size ?? 4.5, color: d.subtitles?.color ?? '#FFFFFF', outline: d.subtitles?.outline ?? true, marginV: d.subtitles?.marginV ?? 6 } : null))}
              />
            </Field>
            {e.subtitles && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tamanho (% altura)">
                  <NumberInput value={e.subtitles.size} min={2} max={12} step={0.5} onChange={(v) => set((d) => void (d.subtitles!.size = v ?? 4.5))} />
                </Field>
                <Field label="Distância da base (%)">
                  <NumberInput value={e.subtitles.marginV} min={0} max={40} step={1} onChange={(v) => set((d) => void (d.subtitles!.marginV = v ?? 6))} />
                </Field>
                <Field label="Cor">
                  <ColorInput value={e.subtitles.color} onChange={(v) => set((d) => void (d.subtitles!.color = v))} />
                </Field>
                <div className="flex items-end pb-1">
                  <Toggle checked={e.subtitles.outline} onChange={(v) => set((d) => void (d.subtitles!.outline = v))} label="Contorno" />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Trilha de áudio autorizada">
          <div className="flex flex-col gap-2">
            <Field label="Arquivo de áudio" hint="Substitui ou mixa com o áudio original. Use apenas trilhas que você tem direito de usar.">
              <AssetPicker
                kinds={['audio', 'video']}
                requireAudio
                value={e.audioTrack?.assetId ?? null}
                placeholder="Sem trilha"
                testId="audio-track"
                onChange={(id) => set((d) => void (d.audioTrack = id ? { assetId: id, mode: d.audioTrack?.mode ?? 'replace', volume: d.audioTrack?.volume ?? 1, originalVolume: d.audioTrack?.originalVolume ?? 0.6, loop: d.audioTrack?.loop ?? true } : null))}
              />
            </Field>
            {e.audioTrack && (
              <>
                <Segmented
                  value={e.audioTrack.mode}
                  onChange={(v) => set((d) => void (d.audioTrack!.mode = v))}
                  options={[
                    { value: 'replace', label: 'Substituir' },
                    { value: 'mix', label: 'Mixar com o original' },
                  ]}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Slider label="Volume da trilha" value={e.audioTrack.volume} min={0} max={4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.audioTrack!.volume = v))} />
                  {e.audioTrack.mode === 'mix' && (
                    <Slider label="Volume original" value={e.audioTrack.originalVolume} min={0} max={4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.audioTrack!.originalVolume = v))} />
                  )}
                </div>
                <Toggle checked={e.audioTrack.loop} onChange={(v) => set((d) => void (d.audioTrack!.loop = v))} label="Repetir a trilha até o fim do vídeo" />
              </>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
