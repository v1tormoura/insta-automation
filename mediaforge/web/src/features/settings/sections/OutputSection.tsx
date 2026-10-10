import type { OutputFormat, ProcessingSettings } from '@mediaforge/shared';
import { Field, NumberInput, Segmented, Select, Slider, Toggle } from '../../../components/ui/controls';
import { SectionTitle } from '../../../components/ui/Panel';
import { useSystem } from '../../../lib/queries';
import { useWorkspace } from '../../../state/workspace';

const FORMATS: Array<{ value: OutputFormat; label: string }> = [
  { value: 'original', label: 'Mesmo formato da origem' },
  { value: 'mp4', label: 'MP4 (vídeo)' },
  { value: 'mov', label: 'MOV (vídeo)' },
  { value: 'webm', label: 'WebM (vídeo)' },
  { value: 'mkv', label: 'MKV (vídeo)' },
  { value: 'jpg', label: 'JPG (imagem)' },
  { value: 'png', label: 'PNG (imagem)' },
  { value: 'webp', label: 'WEBP (imagem)' },
];

/** Mesmo mapeamento do servidor (qualidade → CRF), só para exibição. */
function crfFor(codec: string, q: number) {
  if (codec === 'hevc') return Math.round(51 - q * 0.37);
  if (codec === 'vp9') return Math.round(63 - q * 0.45);
  if (codec === 'av1') return Math.round(63 - q * 0.42);
  return Math.round(51 - q * 0.4);
}

export function OutputSection() {
  const ws = useWorkspace();
  const s: ProcessingSettings = ws.activeSettings;
  const { data: system } = useSystem();
  const caps = system?.capabilities;
  const quick = s.mode === 'quick';
  const codecForCrf = s.video.codec === 'auto' || s.video.codec === 'copy' ? (s.output.format === 'webm' ? 'vp9' : 'h264') : s.video.codec;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle hint="Em “mesmo formato”, vídeos mantêm o contêiner e imagens mantêm JPG/PNG/WEBP. Formatos de vídeo não se aplicam a imagens (e vice-versa).">Formato de saída</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contêiner / formato">
            <Select testId="output-format" value={s.output.format} onChange={(v) => ws.update((d) => void (d.output.format = v))} options={FORMATS.map((f) => ({ ...f, disabled: f.value === 'webp' && caps && !caps.webp }))} />
          </Field>
          <Field label="Qualidade de imagem (JPG/WEBP)" hint="Usada quando a imagem precisa ser recodificada.">
            <Slider label="" value={s.image.quality} min={1} max={100} defaultValue={90} onChange={(v) => ws.update((d) => void (d.image.quality = v))} />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle hint={quick ? 'Automático copia os fluxos sem recodificar quando o contêiner aceita o codec original.' : 'Com transformações o vídeo é sempre recodificado; automático escolhe H.264 (ou VP9 no WebM).'}>
          Vídeo
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Codec de vídeo">
            <Select
              testId="video-codec"
              value={s.video.codec}
              onChange={(v) => ws.update((d) => void (d.video.codec = v))}
              options={[
                { value: 'auto', label: 'Automático (copiar quando possível)' },
                { value: 'copy', label: 'Copiar fluxo (sem recodificar)' },
                { value: 'h264', label: 'H.264 (libx264)', disabled: caps && !caps.h264 },
                { value: 'hevc', label: 'H.265/HEVC (libx265)', disabled: caps && !caps.hevc },
                { value: 'vp9', label: 'VP9 (libvpx)', disabled: caps && !caps.vp9 },
                { value: 'av1', label: 'AV1', disabled: caps && !caps.av1 },
              ]}
            />
          </Field>
          <Field label="Velocidade de codificação">
            <Segmented
              value={s.video.speed}
              onChange={(v) => ws.update((d) => void (d.video.speed = v))}
              options={[
                { value: 'fast', label: 'Rápida' },
                { value: 'balanced', label: 'Equilibrada' },
                { value: 'quality', label: 'Qualidade' },
              ]}
            />
          </Field>
          <Field label="Controle de taxa">
            <Segmented
              value={s.video.rateControl}
              onChange={(v) => ws.update((d) => void (d.video.rateControl = v))}
              options={[
                { value: 'quality', label: 'Nível de qualidade' },
                { value: 'bitrate', label: 'Taxa de bits' },
              ]}
            />
          </Field>
          {s.video.rateControl === 'quality' ? (
            <Slider
              label="Nível de qualidade"
              testId="video-quality"
              value={s.video.quality}
              min={0}
              max={100}
              defaultValue={70}
              format={(v) => `${v} · CRF ${crfFor(codecForCrf, v)}`}
              onChange={(v) => ws.update((d) => void (d.video.quality = v))}
              hint="100 = melhor qualidade, arquivo maior."
            />
          ) : (
            <Field label="Taxa de bits alvo">
              <NumberInput value={s.video.bitrateKbps} min={100} max={200000} step={100} suffix="kb/s" onChange={(v) => ws.update((d) => void (d.video.bitrateKbps = v ?? 6000))} />
            </Field>
          )}
          {!quick && (
            <Field label="Taxa de quadros">
              <Select
                testId="fps"
                value={s.video.fps}
                onChange={(v) => ws.update((d) => void (d.video.fps = v))}
                options={[
                  { value: 'original', label: 'Original' },
                  { value: '24', label: '24 fps' },
                  { value: '25', label: '25 fps' },
                  { value: '30', label: '30 fps' },
                  { value: '50', label: '50 fps' },
                  { value: '60', label: '60 fps' },
                ]}
              />
            </Field>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>Áudio</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {!quick && (
            <div className="sm:col-span-2">
              <Toggle
                testId="remove-audio"
                checked={s.audio.mode === 'remove'}
                onChange={(v) => ws.update((d) => void (d.audio.mode = v ? 'remove' : 'keep'))}
                label="Remover o áudio"
                hint="A saída não terá faixa de áudio (a menos que uma trilha seja adicionada no modo editorial)."
              />
            </div>
          )}
          <Field label="Codec de áudio">
            <Select
              testId="audio-codec"
              value={s.audio.codec}
              onChange={(v) => ws.update((d) => void (d.audio.codec = v))}
              options={[
                { value: 'auto', label: 'Automático (copiar quando possível)' },
                { value: 'copy', label: 'Copiar fluxo' },
                { value: 'aac', label: 'AAC', disabled: caps && !caps.aac },
                { value: 'opus', label: 'Opus', disabled: caps && !caps.opus },
                { value: 'mp3', label: 'MP3', disabled: caps && !caps.mp3 },
              ]}
            />
          </Field>
          <Field label="Taxa de bits do áudio">
            <NumberInput value={s.audio.bitrateKbps} min={32} max={512} step={16} suffix="kb/s" onChange={(v) => ws.update((d) => void (d.audio.bitrateKbps = v ?? 160))} />
          </Field>
        </div>
      </section>
    </div>
  );
}
