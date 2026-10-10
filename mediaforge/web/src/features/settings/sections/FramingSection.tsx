import type { AssetDTO, CropRect, GeometrySettings } from '@mediaforge/shared';
import { Crop } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '../../../components/ui/Button';
import { ColorInput, Field, NumberInput, Segmented, Select, Slider, Toggle } from '../../../components/ui/controls';
import { SectionTitle } from '../../../components/ui/Panel';
import { useWorkspace } from '../../../state/workspace';

const ASPECT_VALUE: Record<string, number | null> = { original: null, '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 };
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Região mantida pelo reenquadramento (coordenadas normalizadas da fonte). */
export function keptRegion(g: GeometrySettings, srcW: number, srcH: number): CropRect {
  const c = g.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const target = ASPECT_VALUE[g.aspect] ?? null;
  if (!target || g.fit !== 'crop') return c;
  const cropAspect = (c.w * srcW) / (c.h * srcH);
  if (cropAspect > target) {
    const kw = (c.h * srcH * target) / srcW;
    return { x: c.x + (c.w - kw) * g.anchorX, y: c.y, w: kw, h: c.h };
  }
  const kh = (c.w * srcW) / target / srcH;
  return { x: c.x, y: c.y + (c.h - kh) * g.anchorY, w: c.w, h: kh };
}

function FramePreview({ asset, g, onMoveCrop }: { asset: AssetDTO; g: GeometrySettings; onMoveCrop: (x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const W = asset.width ?? 16;
  const H = asset.height ?? 9;
  const kept = keptRegion(g, W, H);
  const crop = g.crop;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={box}
        className="relative w-full max-w-[320px] overflow-hidden rounded-lg border border-line bg-black select-none"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerMove={(e) => {
          if (!drag.current || !crop || !box.current) return;
          const r = box.current.getBoundingClientRect();
          const dx = (e.clientX - drag.current.startX) / r.width;
          const dy = (e.clientY - drag.current.startY) / r.height;
          onMoveCrop(Math.min(1 - crop.w, Math.max(0, drag.current.x + dx)), Math.min(1 - crop.h, Math.max(0, drag.current.y + dy)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {asset.thumbnailUrl && <img src={asset.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />}
        {/* escurece o que fica de fora */}
        <div
          className="pointer-events-none absolute border-2 border-accent shadow-[0_0_0_9999px_rgb(2_6_18/0.62)]"
          style={{ left: pct(kept.x), top: pct(kept.y), width: pct(kept.w), height: pct(kept.h) }}
        />
        {crop && (
          <div
            className="absolute cursor-move border border-dashed border-white/80"
            style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { startX: e.clientX, startY: e.clientY, x: crop.x, y: crop.y };
            }}
            title="Arraste para mover a área de corte"
          />
        )}
      </div>
      <p className="text-center text-[11px] text-ink-3">
        Área azul = enquadramento final aproximado{g.fit !== 'crop' && g.aspect !== 'original' ? ` (o restante vira ${g.fit === 'pad' ? 'barras' : g.fit === 'blur' ? 'fundo desfocado' : 'esticado'})` : ''}. Confira com a prévia real.
      </p>
    </div>
  );
}

export function FramingSection({ focus }: { focus: AssetDTO | undefined }) {
  const ws = useWorkspace();
  const g = ws.activeSettings.geometry;
  const set = (fn: (d: GeometrySettings) => void) => ws.update((d) => fn(d.geometry));
  const aspectChanges = g.aspect !== 'original' || (g.resolution === 'custom' && !g.keepAspect);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <section className="flex flex-col gap-3">
          <SectionTitle>Proporção e resolução</SectionTitle>
          <Field label="Proporção">
            <Segmented
              testId="aspect"
              value={g.aspect}
              onChange={(v) => set((d) => void (d.aspect = v))}
              options={[
                { value: 'original', label: 'Original' },
                { value: '9:16', label: '9:16' },
                { value: '4:5', label: '4:5' },
                { value: '1:1', label: '1:1' },
                { value: '16:9', label: '16:9' },
              ]}
            />
          </Field>
          <Field label="Como ajustar à nova proporção" hint={aspectChanges ? undefined : 'Aplica-se quando a proporção muda.'}>
            <Segmented
              testId="fit"
              value={g.fit}
              onChange={(v) => set((d) => void (d.fit = v))}
              options={[
                { value: 'crop', label: 'Reenquadrar', title: 'Preenche o quadro recortando as sobras' },
                { value: 'pad', label: 'Barras', title: 'Mantém o quadro inteiro com barras' },
                { value: 'blur', label: 'Fundo desfocado', title: 'Mantém o quadro inteiro sobre uma cópia desfocada' },
                { value: 'stretch', label: 'Esticar', title: 'Distorce a imagem' },
              ]}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Resolução" hint="Valores referem-se ao lado menor (ex.: 1080 em 9:16 = 1080×1920).">
              <Select
                testId="resolution"
                value={g.resolution}
                onChange={(v) => set((d) => void (d.resolution = v))}
                options={[
                  { value: 'original', label: 'Original' },
                  { value: '2160', label: '2160 (4K)' },
                  { value: '1440', label: '1440' },
                  { value: '1080', label: '1080 (Full HD)' },
                  { value: '720', label: '720 (HD)' },
                  { value: '540', label: '540' },
                  { value: '480', label: '480' },
                  { value: '360', label: '360' },
                  { value: 'custom', label: 'Personalizada…' },
                ]}
              />
            </Field>
            {g.fit === 'pad' && (
              <Field label="Cor das barras">
                <ColorInput value={g.padColor} onChange={(v) => set((d) => void (d.padColor = v))} ariaLabel="Cor das barras" />
              </Field>
            )}
          </div>
          {g.resolution === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Largura">
                <NumberInput value={g.width} min={16} max={8192} suffix="px" onChange={(v) => set((d) => void (d.width = v ?? 1080))} testId="custom-width" />
              </Field>
              <Field label="Altura">
                <NumberInput value={g.height} min={16} max={8192} suffix="px" onChange={(v) => set((d) => void (d.height = v ?? 1920))} testId="custom-height" />
              </Field>
              <div className="flex items-end pb-1">
                <Toggle checked={g.keepAspect} onChange={(v) => set((d) => void (d.keepAspect = v))} label="Preservar proporção" hint="Encaixa sem distorcer." />
              </div>
            </div>
          )}
          {g.fit === 'crop' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider label="Âncora horizontal" value={g.anchorX} min={0} max={1} step={0.01} defaultValue={0.5} format={pct} onChange={(v) => set((d) => void (d.anchorX = v))} hint="0% = esquerda, 100% = direita" />
              <Slider label="Âncora vertical" value={g.anchorY} min={0} max={1} step={0.01} defaultValue={0.5} format={pct} onChange={(v) => set((d) => void (d.anchorY = v))} hint="0% = topo, 100% = base" />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle>Visualização do enquadramento</SectionTitle>
          {focus && (focus.kind === 'video' || focus.kind === 'image') ? (
            <FramePreview asset={focus} g={g} onMoveCrop={(x, y) => set((d) => void (d.crop = d.crop ? { ...d.crop, x, y } : d.crop))} />
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] text-ink-3">Clique num vídeo ou imagem da lista para ver o enquadramento.</p>
          )}
        </section>
      </div>

      <section>
        <SectionTitle
          hint="Recorta uma área da imagem antes do ajuste de proporção. Valores relativos ao quadro original."
          right={
            g.crop ? (
              <Button size="xs" variant="ghost" onClick={() => set((d) => void (d.crop = null))}>
                Remover corte
              </Button>
            ) : (
              <Button size="xs" variant="subtle" icon={Crop} data-testid="enable-crop" onClick={() => set((d) => void (d.crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }))}>
                Definir área de corte
              </Button>
            )
          }
        >
          Corte de área
        </SectionTitle>
        {g.crop && (
          <div className="grid gap-3 sm:grid-cols-4">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <Slider
                key={k}
                label={{ x: 'Esquerda', y: 'Topo', w: 'Largura', h: 'Altura' }[k]}
                value={g.crop![k]}
                min={k === 'w' || k === 'h' ? 0.05 : 0}
                max={k === 'x' ? 1 - g.crop!.w : k === 'y' ? 1 - g.crop!.h : k === 'w' ? 1 - g.crop!.x : 1 - g.crop!.y}
                step={0.01}
                format={pct}
                onChange={(v) => set((d) => void (d.crop = { ...d.crop!, [k]: Math.round(v * 1000) / 1000 }))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
