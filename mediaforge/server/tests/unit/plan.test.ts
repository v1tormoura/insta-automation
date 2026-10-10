import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geometrySettingsSchema, type AssetKind, type GeometrySettings } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectMetadata } from '../../src/media/metadata/inspect';
import { assColor, atempoChain, drawtextFilter, enableExpr, eqFilter, ffColor, num } from '../../src/media/pipeline/filters';
import { computeGeometry, orientationFilters } from '../../src/media/pipeline/geometry';
import { buildPlan, PlanError, type PlanAsset, type PlanContext, type ProcessingPlan } from '../../src/media/pipeline/plan';
import { normalizeProbe, probeFile } from '../../src/media/probe';
import { MediaTools } from '../../src/media/tools';
import { fx, SENSITIVE } from '../helpers/fixtures';
import { ffprobe } from '../helpers/media';

const geo = (g: Partial<GeometrySettings> = {}) => geometrySettingsSchema.parse(g);
const NUM = /^-?\d+(\.\d+)?$/;

// ── Geometria ─────────────────────────────────────────────────────────────

describe('computeGeometry', () => {
  const filters = (r: ReturnType<typeof computeGeometry>) => r.steps.map((s) => (s.kind === 'simple' ? s.filter : s.build('[in]', '[out]', 'U')));

  it('16:9 → 9:16 por recorte em 1080 = 1080×1920', () => {
    const r = computeGeometry(1920, 1080, geo({ aspect: '9:16', fit: 'crop', resolution: '1080' }));
    expect([r.width, r.height]).toEqual([1080, 1920]);
    expect(filters(r)).toEqual([
      'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos',
      'crop=1080:1920:(iw-1080)*0.5:(ih-1920)*0.5',
      'setsar=1',
    ]);
    expect(r.changed).toBe(true);
    expect(r.operations.map((o) => o.id)).toEqual(['reframe']);
    expect(r.warnings.join(' ')).toMatch(/Ampliação de 78%/);
    // mesma saída a partir de uma fonte pequena 640×360
    const s = computeGeometry(640, 360, geo({ aspect: '9:16', fit: 'crop', resolution: '1080' }));
    expect([s.width, s.height]).toEqual([1080, 1920]);
  });

  it('âncora do recorte vira número formatado (sem notação científica)', () => {
    const r = computeGeometry(1920, 1080, geo({ aspect: '1:1', resolution: '720', anchorX: 1 / 3, anchorY: 0 }));
    expect(filters(r)[1]).toBe('crop=720:720:(iw-720)*0.3333:(ih-720)*0');
  });

  it('barras (pad) com cor validada', () => {
    const r = computeGeometry(1920, 1080, geo({ aspect: '9:16', fit: 'pad', resolution: '1080', padColor: '#ff8800' }));
    expect([r.width, r.height]).toEqual([1080, 1920]);
    expect(filters(r)).toEqual([
      'scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xFF8800',
      'setsar=1',
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('fundo desfocado (blur) gera subgrafo com rótulos próprios', () => {
    const r = computeGeometry(1920, 1080, geo({ aspect: '4:5', fit: 'blur', resolution: '1080' }));
    expect([r.width, r.height]).toEqual([1080, 1350]);
    const g = filters(r)[0]!;
    expect(g.startsWith('[in]split=2[bgU][fgU];')).toBe(true);
    expect(g).toContain('scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,boxblur=');
    expect(g).toContain('[fgU]scale=1080:1350:force_original_aspect_ratio=decrease');
    expect(g.endsWith('overlay=(W-w)/2:(H-h)/2[out]')).toBe(true);
    expect(r.operations[0]!.id).toBe('blur-pad');
  });

  it('esticar avisa que distorce', () => {
    const r = computeGeometry(1920, 1080, geo({ aspect: '1:1', fit: 'stretch', resolution: '720' }));
    expect(filters(r)).toEqual(['scale=720:720:flags=lanczos', 'setsar=1']);
    expect(r.warnings.join(' ')).toMatch(/distorce/);
  });

  it('resolução personalizada mantendo proporção cabe na caixa sem distorcer', () => {
    const r = computeGeometry(1920, 1080, geo({ resolution: 'custom', width: 1000, height: 1000, keepAspect: true }));
    expect([r.width, r.height]).toEqual([1000, 562]);
    expect(filters(r)).toEqual(['scale=1000:562:flags=lanczos', 'setsar=1']);
    const q = computeGeometry(1920, 1080, geo({ aspect: '1:1', resolution: 'custom', width: 1280, height: 720, keepAspect: true }));
    expect([q.width, q.height]).toEqual([720, 720]);
    const p = computeGeometry(1920, 1080, geo({ aspect: '9:16', resolution: 'custom', width: 2000, height: 1000, keepAspect: true }));
    expect([p.width, p.height]).toEqual([562, 1000]);
  });

  it('resolução personalizada sem manter proporção usa exatamente largura×altura', () => {
    const r = computeGeometry(1920, 1080, geo({ resolution: 'custom', width: 1000, height: 1000, keepAspect: false }));
    expect([r.width, r.height]).toEqual([1000, 1000]);
    expect(filters(r)[0]).toContain('scale=1000:1000:force_original_aspect_ratio=increase');
  });

  it('resolução original com dimensões ímpares vira par; já par não muda nada', () => {
    const r = computeGeometry(641, 361, geo());
    expect([r.width, r.height]).toEqual([642, 362]);
    expect(r.width % 2 + (r.height % 2)).toBe(0);
    expect(filters(r)).toEqual(['scale=642:362:flags=lanczos', 'setsar=1']);
    const e = computeGeometry(640, 360, geo());
    expect([e.width, e.height, e.changed, e.steps.length]).toEqual([640, 360, false, 0]);
  });

  it('resoluções predefinidas usam o lado menor (paisagem e retrato)', () => {
    expect(computeGeometry(1920, 1080, geo({ resolution: '720' }))).toMatchObject({ width: 1280, height: 720 });
    expect(computeGeometry(1080, 1920, geo({ resolution: '720' }))).toMatchObject({ width: 720, height: 1280 });
    expect(computeGeometry(640, 480, geo({ resolution: '1080' }))).toMatchObject({ width: 1440, height: 1080 });
  });

  it('corte manual: área em pixels pares, dentro da imagem', () => {
    const r = computeGeometry(640, 360, geo({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }));
    expect(filters(r)[0]).toBe('crop=320:180:160:90');
    expect([r.width, r.height]).toEqual([320, 180]);
    expect(r.operations[0]!.id).toBe('crop');
    // borda direita com fonte ímpar
    const e = computeGeometry(641, 361, geo({ crop: { x: 0.9, y: 0, w: 0.1, h: 1 } }));
    const m = filters(e)[0]!.match(/^crop=(\d+):(\d+):(\d+):(\d+)$/)!;
    const [cw, ch, cx, cy] = m.slice(1).map(Number) as [number, number, number, number];
    expect(cw % 2 + (ch % 2)).toBe(0);
    expect(cx + cw).toBeLessThanOrEqual(641);
    expect(cy + ch).toBeLessThanOrEqual(361);
    expect([e.width, e.height]).toEqual([cw, ch]);
  });

  it('fuzz: dimensões de saída sempre pares, finitas e filtros sem NaN/Infinity/undefined', () => {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(l: readonly T[]) => l[Math.floor(rnd() * l.length)]!;
    for (let i = 0; i < 2000; i++) {
      const srcW = 16 + Math.floor(rnd() * 4000);
      const srcH = 16 + Math.floor(rnd() * 4000);
      const x = rnd() * 0.9;
      const y = rnd() * 0.9;
      const g = geo({
        aspect: pick(['original', '9:16', '4:5', '1:1', '16:9'] as const),
        fit: pick(['crop', 'pad', 'blur', 'stretch'] as const),
        resolution: pick(['original', '2160', '1080', '720', '360', 'custom'] as const),
        width: 16 + Math.floor(rnd() * 3000),
        height: 16 + Math.floor(rnd() * 3000),
        keepAspect: rnd() > 0.5,
        anchorX: rnd(),
        anchorY: rnd(),
        crop: rnd() > 0.7 ? { x, y, w: Math.max(0.05, (1 - x) * rnd()), h: Math.max(0.05, (1 - y) * rnd()) } : null,
      });
      const r = computeGeometry(srcW, srcH, g);
      const ctx = JSON.stringify({ srcW, srcH, g });
      expect(Number.isInteger(r.width) && Number.isInteger(r.height), ctx).toBe(true);
      expect(r.width % 2 === 0 && r.height % 2 === 0, ctx).toBe(true);
      expect(r.width >= 2 && r.height >= 2, ctx).toBe(true);
      for (const f of filters(r)) expect(f, ctx).not.toMatch(/NaN|Infinity|undefined|null|\de[+-]?\d/);
      const crop = filters(r).find((f) => /^crop=\d+:\d+:\d+:\d+$/.test(f));
      if (crop) {
        const [cw, ch, cx, cy] = crop.slice(5).split(':').map(Number) as [number, number, number, number];
        expect(cx + cw <= srcW && cy + ch <= srcH, `${crop} ${ctx}`).toBe(true);
      }
    }
  });

  it('orientação EXIF → filtros de transposição', () => {
    expect(orientationFilters(1)).toEqual([]);
    expect(orientationFilters(3)).toEqual(['hflip', 'vflip']);
    expect(orientationFilters(6)).toEqual(['transpose=1']);
    expect(orientationFilters(8)).toEqual(['transpose=2']);
    expect(orientationFilters(null)).toEqual([]);
    expect(orientationFilters(42)).toEqual([]);
  });
});

describe('atempoChain', () => {
  it('valores de referência', () => {
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(0.5)).toEqual(['atempo=0.5']);
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(1.5)).toEqual(['atempo=1.5']);
    expect(atempoChain(3)).toEqual(['atempo=2', 'atempo=1.5']);
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
  });

  it('o produto dos estágios é a velocidade pedida e cada estágio fica em 0,5–2', () => {
    for (let s = 0.25; s <= 4.0001; s += 0.05) {
      const chain = atempoChain(s).map((x) => Number(x.split('=')[1]));
      for (const f of chain) expect(f >= 0.5 && f <= 2, `${s}: ${chain}`).toBe(true);
      const prod = chain.reduce((a, b) => a * b, 1);
      expect(Math.abs(prod - s)).toBeLessThan(1e-5);
    }
  });
});

describe('filtros de cor, texto e números', () => {
  it('eqFilter', () => {
    expect(eqFilter({ brightness: 0, contrast: 0, saturation: 0 })).toBeNull();
    expect(eqFilter({ brightness: 100, contrast: -100, saturation: 50 })).toBe('eq=brightness=0.3:contrast=0:saturation=1.5');
    expect(eqFilter({ brightness: -33, contrast: 17, saturation: -100 })).toBe('eq=brightness=-0.099:contrast=1.17:saturation=0');
  });

  it('ffColor aceita só #RRGGBB e limita a opacidade; qualquer outra coisa lança erro', () => {
    expect(ffColor('#ff8800', 0.5)).toBe('0xFF8800@0.5');
    expect(ffColor('#000000')).toBe('0x000000@1');
    expect(ffColor('#ABCDEF', 2)).toBe('0xABCDEF@1');
    expect(ffColor('#abcdef', -1)).toBe('0xABCDEF@0');
    for (const bad of ['#fff', 'red', '#GGGGGG', '#ffffff;', "#ffffff'", '#ffffff:x=1', '', 'ffffff', '#ffffff\n', '0xFFFFFF'])
      expect(() => ffColor(bad), JSON.stringify(bad)).toThrow(/Cor inválida/);
    expect(() => ffColor('#ffffff', Number.NaN)).toThrow();
    expect(assColor('#112233')).toBe('&H00332211');
    expect(assColor('#112233', 1)).toBe('&HFF332211');
    expect(() => assColor('#12345')).toThrow();
  });

  it('num recusa NaN/Infinity e nunca usa notação científica em valores do formulário', () => {
    expect(() => num(Number.NaN)).toThrow();
    expect(() => num(Number.POSITIVE_INFINITY)).toThrow();
    expect(num(1e-7)).toBe('0');
    expect(num(86_400, 3)).toBe('86400');
    expect(num(1e9, 3)).toBe('1000000000');
    expect(enableExpr(0, null)).toBe('');
    expect(enableExpr(1.23456, 2)).toBe(":enable='between(t,1.235,2)'");
  });

  it('drawtextFilter só referencia o arquivo de texto (expansion=none) e usa números calculados', () => {
    const f = drawtextFilter({
      textFile: 'text-0.txt',
      fontFile: 'font.ttf',
      frameHeight: 1920,
      frameWidth: 1080,
      textAlign: true,
      overlay: { position: 'top-left', size: 5, color: '#FFFFFF', opacity: 0.8, box: true, boxColor: '#000000', boxOpacity: 0.45, start: 1, end: 3.5 },
    });
    expect(f).toBe(
      "drawtext=fontfile=font.ttf:textfile=text-0.txt:expansion=none:fontsize=96:fontcolor=0xFFFFFF@0.8:line_spacing=24:x=54:y=54:text_align=L:box=1:boxcolor=0x000000@0.45:boxborderw=34:enable='between(t,1,3.5)'",
    );
    const g = drawtextFilter({
      textFile: 't.txt',
      fontFile: 'font.ttf',
      frameHeight: 100,
      frameWidth: 100,
      overlay: { position: 'bottom-right', size: 1, color: '#FFFFFF', opacity: 1, box: false, boxColor: '#000000', boxOpacity: 0, start: 0, end: null },
    });
    expect(g).toContain('fontsize=8'); // mínimo
    expect(g).toContain('x=w-text_w-5:y=h-text_h-5');
    expect(g).not.toContain('text_align');
    expect(g).not.toContain('enable');
  });
});

// ── Planos com arquivos reais ─────────────────────────────────────────────

let tools: MediaTools;
const assets = new Map<string, PlanAsset>();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-unit-plan-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

async function load(id: string, file: string, kind: AssetKind, ext: string, name = path.basename(file)): Promise<PlanAsset> {
  const probe = await probeFile(tools, file);
  // normalizeProbe é puro: o mesmo JSON precisa dar o mesmo resultado
  expect(normalizeProbe(probe.raw, probe.info.sizeBytes)).toEqual(probe.info);
  const metadata = kind === 'video' || kind === 'image' ? await inspectMetadata(file, kind, ext, probe) : null;
  const a: PlanAsset = { id, name, kind, ext, path: file, info: probe.info, metadata };
  assets.set(id, a);
  return a;
}
const ctx = (extra: Partial<PlanContext> = {}): PlanContext => ({
  tools,
  ffmpegThreads: 0,
  fontFileName: 'font.ttf',
  resolveAsset: (id) => assets.get(id),
  ...extra,
});
const A = (id: string) => assets.get(id)!;
const graphOf = (p: ProcessingPlan) => {
  const i = p.args!.indexOf('-filter_complex');
  return i >= 0 ? p.args![i + 1]! : '';
};
const argAfter = (p: ProcessingPlan, flag: string) => {
  const i = p.args!.indexOf(flag);
  return i >= 0 ? p.args![i + 1] : undefined;
};
function planError(fn: () => unknown): PlanError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PlanError);
    return err as PlanError;
  }
  throw new Error('esperava PlanError');
}

beforeAll(async () => {
  tools = new MediaTools('ffmpeg', 'ffprobe');
  await tools.detect();
  expect(tools.ready).toBe(true);
  await load('iphoneMov01', fx('iphone.mov'), 'video', 'mov');
  await load('plainMp401', fx('plain.mp4'), 'video', 'mp4');
  await load('noAudio001', fx('noaudio.mp4'), 'video', 'mp4');
  await load('rotated001', fx('rotated.mp4'), 'video', 'mp4');
  await load('sceneMp401', fx('scene.mp4'), 'video', 'mp4');
  await load('photoJpg01', fx('photo.jpg'), 'image', 'jpg');
  await load('graphicPng', fx('graphic.png'), 'image', 'png');
  await load('imageWebp1', fx('image.webp'), 'image', 'webp');
  await load('logoPng001', fx('logo.png'), 'image', 'png');
  await load('trackMp301', fx('track.mp3'), 'audio', 'mp3');
  await load('subsSrt001', fx('legendas.srt'), 'subtitle', 'srt');
  // Mídias com dimensões ímpares (comuns em capturas de tela e vídeos 853×480)
  const oddJpg = path.join(tmpDir, 'odd.jpg');
  const oddMp4 = path.join(tmpDir, 'odd.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=400x300', '-vf', 'scale=401:301', '-frames:v', '1', oddJpg]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=1', '-vf', 'scale=321:241,format=yuv444p', '-c:v', 'libx264', '-preset', 'ultrafast', oddMp4]);
  expect([ffprobe(oddJpg).streams[0].width, ffprobe(oddJpg).streams[0].height]).toEqual([401, 301]);
  expect([ffprobe(oddMp4).streams[0].width, ffprobe(oddMp4).streams[0].height]).toEqual([321, 241]);
  await load('oddJpeg001', oddJpg, 'image', 'jpg');
  await load('oddMp40001', oddMp4, 'video', 'mp4');
});

describe('buildPlan — vídeo', () => {
  it('modo rápido em MOV H.264 → cópia de fluxos, sem filtros e sem metadados', () => {
    const p = buildPlan(A('iphoneMov01'), { mode: 'quick' }, ctx());
    expect(p.strategy).toBe('stream-copy');
    expect(p.args).not.toContain('-filter_complex');
    expect(argAfter(p, '-c:v')).toBe('copy');
    expect(argAfter(p, '-c:a')).toBe('copy');
    expect(argAfter(p, '-map_metadata')).toBe('-1');
    expect(argAfter(p, '-map_chapters')).toBe('-1');
    expect(argAfter(p, '-f')).toBe('mov');
    expect(p.args!.at(-1)).toBe('output.mov');
    expect(p.args).toContain('+bitexact');
    expect(p.args).not.toContain('-metadata');
    for (const s of [SENSITIVE.videoModel, SENSITIVE.videoComment, SENSITIVE.videoIso6709, 'Apple', '17.1.2'])
      expect(p.args!.some((a) => a.includes(s)), s).toBe(false);
    expect(p.expected).toMatchObject({ kind: 'video', container: 'mov', videoCodec: 'h264', audioCodec: 'aac', width: 640, height: 360, durationSec: 3, fps: null, keyframeAligned: false });
    expect(p.textFiles).toEqual([]);
  });

  it('modo rápido ignora ajustes "escondidos" de geometria/velocidade/corte', () => {
    const p = buildPlan(A('plainMp401'), { mode: 'quick', geometry: { aspect: '9:16' }, speed: 2, trim: { start: 0.5 }, color: { brightness: 50 } }, ctx());
    expect(p.strategy).toBe('stream-copy');
    expect(p.expected).toMatchObject({ width: 320, height: 240, durationSec: 2 });
    expect(p.args).not.toContain('-ss');
  });

  it('nenhuma categoria marcada: metadados preservados são regravados explicitamente', () => {
    const none = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false };
    const p = buildPlan(A('iphoneMov01'), { mode: 'quick', metadata: { remove: none } }, ctx());
    const meta = p.args!.filter((_, i) => p.args![i - 1]?.startsWith('-metadata'));
    expect(meta).toContain(`com.apple.quicktime.model=${SENSITIVE.videoModel}`);
    expect(meta).toContain(`comment=${SENSITIVE.videoComment}`);
    expect(meta).toContain('handler_name=Core Media Video');
    expect(argAfter(p, '-movflags')).toBe('+faststart+use_metadata_tags');
    expect(p.args).not.toContain('+bitexact');
  });

  it('cópia explícita + transformações → PlanError', () => {
    const e = planError(() => buildPlan(A('iphoneMov01'), { mode: 'custom', video: { codec: 'copy' }, geometry: { aspect: '9:16' } }, ctx()));
    expect(e.messages.join(' ')).toMatch(/Cópia do fluxo de vídeo é impossível/);
    const a = planError(() => buildPlan(A('iphoneMov01'), { mode: 'custom', audio: { codec: 'copy', volume: 2 } }, ctx()));
    expect(a.messages.join(' ')).toMatch(/Cópia do fluxo de áudio é impossível/);
  });

  it('WebM + H.264 → PlanError (codec incompatível com o contêiner)', () => {
    const e = planError(() => buildPlan(A('plainMp401'), { mode: 'custom', output: { format: 'webm' }, video: { codec: 'h264' } }, ctx()));
    expect(e.messages.join(' ')).toMatch(/H\.264 não é compatível com WebM/);
    const c = planError(() => buildPlan(A('plainMp401'), { mode: 'custom', output: { format: 'webm' }, video: { codec: 'copy' } }, ctx()));
    expect(c.messages.join(' ')).toMatch(/não pode ser copiado para WebM/);
  });

  it('WebM automático usa VP9 + Opus; MKV usa o muxer matroska', () => {
    const w = buildPlan(A('plainMp401'), { mode: 'custom', output: { format: 'webm' } }, ctx());
    expect(w.expected).toMatchObject({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' });
    expect(argAfter(w, '-c:v')).toBe('libvpx-vp9');
    expect(argAfter(w, '-c:a')).toBe('libopus');
    expect(argAfter(w, '-f')).toBe('webm');
    const k = buildPlan(A('plainMp401'), { mode: 'quick', output: { format: 'mkv' } }, ctx());
    expect(k.strategy).toBe('stream-copy');
    expect(argAfter(k, '-f')).toBe('matroska');
    expect(k.args!.at(-1)).toBe('output.mkv');
  });

  it('corte com início depois da duração, trecho curto demais e fim depois da duração', () => {
    const e = planError(() => buildPlan(A('iphoneMov01'), { mode: 'custom', trim: { start: 10 } }, ctx()));
    expect(e.messages.join(' ')).toMatch(/posterior à duração/);
    const s = planError(() => buildPlan(A('iphoneMov01'), { mode: 'custom', trim: { start: 2.95, end: 3 } }, ctx()));
    expect(s.messages.join(' ')).toMatch(/curto demais/);
    const w = buildPlan(A('iphoneMov01'), { mode: 'custom', trim: { start: 1, end: 99 } }, ctx());
    expect(w.warnings.join(' ')).toMatch(/excede a duração/);
    expect(w.expected.durationSec).toBeCloseTo(2, 5);
  });

  it('áudio e legenda não são processáveis como arquivo principal; configuração inválida vira PlanError legível', () => {
    expect(planError(() => buildPlan(A('trackMp301'), { mode: 'quick' }, ctx())).messages[0]).toMatch(/arquivo de áudio/);
    expect(planError(() => buildPlan(A('subsSrt001'), { mode: 'quick' }, ctx())).messages[0]).toMatch(/legenda/);
    expect(planError(() => buildPlan(A('plainMp401'), { mode: 'custom', speed: 10 }, ctx())).messages.join(' ')).toMatch(/^speed:/);
    expect(planError(() => buildPlan(A('plainMp401'), { mode: 'custom', geometry: { padColor: "#fff';x" } }, ctx())).messages.join(' ')).toMatch(/geometry\.padColor/);
    expect(planError(() => buildPlan(A('plainMp401'), { mode: 'custom', trim: { start: 2, end: 1 } }, ctx())).messages.join(' ')).toMatch(/fim do corte/);
    expect(
      planError(() => buildPlan(A('plainMp401'), { mode: 'editorial', editorial: { texts: [{ text: 'a\u0000b' }] } }, ctx())).messages.join(' '),
    ).toMatch(/controle/);
    expect(planError(() => buildPlan(A('plainMp401'), { mode: 'turbo' }, ctx())).messages.join(' ')).toMatch(/^mode:/);
  });

  it('resultado esperado coerente: 9:16 + corte 0,5–2,5 s + velocidade 2× em 1080', () => {
    const p = buildPlan(A('iphoneMov01'), { mode: 'custom', geometry: { aspect: '9:16', resolution: '1080' }, trim: { start: 0.5, end: 2.5 }, speed: 2 }, ctx());
    expect(p.strategy).toBe('re-encode');
    expect(p.expected).toMatchObject({ container: 'mov', videoCodec: 'h264', audioCodec: 'aac', width: 1080, height: 1920, fps: null, keyframeAligned: false });
    expect(p.expected.durationSec).toBeCloseTo(1, 6);
    expect(p.progressDuration).toBeCloseTo(1, 6);
    const i = p.args!.indexOf('-i');
    expect(p.args!.slice(i - 4, i)).toEqual(['-ss', '0.5', '-t', '2']);
    const g = graphOf(p);
    expect(g).toContain('setpts=PTS/2');
    expect(g).toContain('atempo=2');
    expect(g).toContain('crop=1080:1920:');
    expect(p.operations.map((o) => o.id)).toEqual(expect.arrayContaining(['trim', 'reframe', 'speed', 'video-codec', 'audio-codec', 'metadata']));
  });

  it('remover áudio → -an e sem codec de áudio no esperado; sem faixa de áudio → item ignorado com motivo', () => {
    const p = buildPlan(A('plainMp401'), { mode: 'custom', audio: { mode: 'remove' } }, ctx());
    expect(p.args).toContain('-an');
    expect(p.args).not.toContain('-c:a');
    expect(p.expected.audioCodec).toBeNull();
    expect(p.operations.map((o) => o.id)).toContain('audio-remove');
    const n = buildPlan(A('noAudio001'), { mode: 'quick' }, ctx());
    expect(n.args).toContain('-an');
    expect(n.expected.audioCodec).toBeNull();
    expect(n.skipped.map((s) => s.label)).toContain('Áudio');
  });

  it('cópia explícita com corte: aviso de quadros-chave e tolerância maior no esperado', () => {
    const p = buildPlan(A('iphoneMov01'), { mode: 'custom', video: { codec: 'copy' }, audio: { codec: 'copy' }, trim: { start: 1, end: 2 } }, ctx());
    expect(p.strategy).toBe('stream-copy');
    expect(p.expected.keyframeAligned).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/quadros-chave/);
    // automático com corte recodifica (corte exato)
    expect(buildPlan(A('iphoneMov01'), { mode: 'custom', trim: { start: 1, end: 2 } }, ctx()).strategy).toBe('re-encode');
  });

  it('vídeo com matriz de rotação usa dimensões de exibição na geometria', () => {
    const p = buildPlan(A('rotated001'), { mode: 'custom', geometry: { aspect: '1:1' } }, ctx());
    expect(p.expected).toMatchObject({ width: 240, height: 240 });
    const q = buildPlan(A('rotated001'), { mode: 'quick' }, ctx());
    expect(q.strategy).toBe('stream-copy');
    expect(q.expected).toMatchObject({ width: 320, height: 240 }); // cópia: dimensões codificadas
  });

  it('taxa de quadros pedida e remoção de SEI sem recodificar', () => {
    const p = buildPlan(A('plainMp401'), { mode: 'custom', video: { fps: '60' } }, ctx());
    expect(graphOf(p)).toContain('fps=60');
    expect(p.expected.fps).toBe(60);
    const s = buildPlan(A('iphoneMov01'), { mode: 'quick', metadata: { remove: { embedded: true } } }, ctx());
    expect(s.strategy).toBe('stream-copy');
    expect(argAfter(s, '-bsf:v')).toBe('filter_units=remove_types=6');
  });

  it('modo rápido em vídeo de dimensões ímpares (321×241) continua sendo cópia, sem redimensionar', () => {
    const p = buildPlan(A('oddMp40001'), { mode: 'quick' }, ctx());
    expect({ strategy: p.strategy, width: p.expected.width, height: p.expected.height, graph: graphOf(p) }).toEqual({
      strategy: 'stream-copy',
      width: 321,
      height: 241,
      graph: '',
    });
  });
});

// ── Injeção pelo texto do usuário ─────────────────────────────────────────

const EVIL = `x'; [0:v]drawtext=text='%{localtime}':x=0 [pwn]; movie=/etc/passwd\n\\:'"; ,=@INJ3CT %{pts} $(id) \`id\``;
const EVIL2 = `fim]:'[out]\n;;%{eif:1:d}\nmovie=/x [a]`;
const MARKERS = ['%{', 'localtime', '[pwn]', 'movie=', '/etc/passwd', 'INJ3CT', '$(id)', '`id`', 'eif:', '[out]\n', 'fim]'];

/** Palavras que o construtor de grafos pode legitimamente gerar. */
const GRAPH_WORDS = new Set(
  (
    'drawtext fontfile font ttf textfile card intro outro text txt expansion none fontsize fontcolor line_spacing x y w h text_w text_h text_align C L R ' +
    'box boxcolor boxborderw enable between t fps format yuv420p rgba setsar scale crop pad color c s r d anullsrc cl stereo atrim asetpts PTS STARTPTS ' +
    'split boxblur luma_radius luma_power min force_original_aspect_ratio increase decrease force_divisible_by flags lanczos overlay W H iw ih ow oh ' +
    'eq brightness contrast saturation setpts volume atempo aresample aformat sample_fmts fltp channel_layouts transpose hflip vflip concat n v a ' +
    'subtitles filename subs srt fontsdir fonts force_style FontName DejaVu Sans Bold FontSize PrimaryColour OutlineColour BorderStyle Outline Shadow MarginV ' +
    'fade in out st afade amix inputs duration first dropout_transition normalize auto colorchannelmixer aa apad drawbox replace fill white'
  ).split(/\s+/),
);

function assertSafeGraph(p: ProcessingPlan, extraForbidden: string[] = []) {
  for (const a of p.args!) {
    for (const m of [...MARKERS, ...extraForbidden]) expect(a.includes(m), `arg contém ${JSON.stringify(m)}: ${a.slice(0, 200)}`).toBe(false);
    expect(a, 'arg com quebra de linha').not.toMatch(/[\r\n]/);
  }
  const g = graphOf(p);
  const stripped = g
    .replace(/\[[A-Za-z0-9_:]+\]/g, ' ')
    .replace(/0x[0-9A-F]{6}/g, ' ')
    .replace(/&H[0-9A-F]{8}/g, ' ')
    .replace(/\d+x\d+/g, ' ');
  const words = new Set(stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const unknown = [...words].filter((w) => !GRAPH_WORDS.has(w));
  expect(unknown, 'palavras inesperadas no filtergraph').toEqual([]);
  // Só caracteres estruturais/numéricos fora das palavras conhecidas
  expect(stripped.replace(/[A-Za-z_][A-Za-z0-9_]*/g, '')).toMatch(/^[\d\s.:=,;()*/+\-\\'@&]*$/);
  // Parâmetros numéricos são números
  const numeric: Array<[RegExp, string]> = [
    [/(?:fontsize|line_spacing|boxborderw|FontSize|MarginV|Outline)=([^:,'\[;]+)/g, 'inteiro'],
    [/(?:setpts=PTS\/|atempo=|volume=|fps=|brightness=|contrast=|saturation=|luma_power=|:d=|:st=|atrim=0:|aa=)([^:,'\[;)]+)/g, 'decimal'],
    [/between\(t,([^,]+),([^)]+)\)/g, 'janela'],
  ];
  for (const [re] of numeric) for (const m of g.matchAll(re)) for (const v of m.slice(1)) expect(v, `${m[0]}`).toMatch(NUM);
}

describe('buildPlan — injeção: texto do usuário nunca entra nos argumentos/filtergraph', () => {
  it('textos, cartela e nomes de arquivos hostis só aparecem em textFiles', async () => {
    const main = { ...A('iphoneMov01'), name: EVIL + '.mov' };
    assets.set('evilLogo01', { ...A('logoPng001'), id: 'evilLogo01', name: EVIL2 + '.png' });
    const settings = {
      mode: 'editorial',
      geometry: { aspect: '9:16', fit: 'blur', resolution: '720', anchorX: 1 / 3 },
      color: { brightness: 33, contrast: -17, saturation: 50 },
      speed: 1.5,
      fade: { in: 0.5, out: 0.5 },
      audio: { volume: 0.7 },
      editorial: {
        intro: { type: 'card', text: EVIL, duration: 1 },
        outro: { type: 'card', text: EVIL2, duration: 1, background: '#102030', color: '#FFEE00' },
        scenes: [{ assetId: 'sceneMp401', start: 0.2, end: 1.2 }, { assetId: 'photoJpg01', duration: 1 }],
        texts: [
          { text: EVIL, start: 0.3, end: 2.1, position: 'top-left' },
          { text: EVIL2, position: 'center', box: false },
        ],
        overlays: [{ assetId: 'evilLogo01', start: 0, end: 1.7, opacity: 0.5 }],
        subtitles: { assetId: 'subsSrt001' },
        audioTrack: { assetId: 'trackMp301', mode: 'mix', volume: 0.8 },
      },
    };
    const p = buildPlan(main, settings, ctx());
    assertSafeGraph(p);
    const byName = Object.fromEntries(p.textFiles.map((t) => [t.name, t.content]));
    expect(byName).toEqual({ 'card-intro.txt': EVIL, 'card-outro.txt': EVIL2, 'text-0.txt': EVIL, 'text-1.txt': EVIL2 });
    const g = graphOf(p);
    for (const n of Object.keys(byName)) expect(g).toContain(`textfile=${n}:expansion=none`);
    expect(p.copyFiles).toEqual([{ from: fx('legendas.srt'), to: 'subs.srt' }]);
    expect(p.needsFont).toBe(true);
    // Resultado esperado: 1 (abertura) + 3/1,5 (principal) + 1/1,5 (cena) + 1 (foto) + 1 (encerramento)
    expect(p.expected.durationSec).toBeCloseTo(1 + 2 + 2 / 3 + 1 + 1, 2);
    expect(p.expected).toMatchObject({ width: 720, height: 1280, fps: 25, audioCodec: 'aac' });
    expect(p.auxiliaryAssetIds.sort()).toEqual(['evilLogo01', 'photoJpg01', 'sceneMp401', 'subsSrt001', 'trackMp301'].sort());
  });

  it('fuzz: configurações aleatórias válidas geram grafos só com números e palavras conhecidas', () => {
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(l: readonly T[]) => l[Math.floor(rnd() * l.length)]!;
    const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
    let built = 0;
    for (let i = 0; i < 120; i++) {
      const settings = {
        mode: pick(['custom', 'editorial'] as const),
        geometry: {
          aspect: pick(['original', '9:16', '4:5', '1:1', '16:9'] as const),
          fit: pick(['crop', 'pad', 'blur', 'stretch'] as const),
          resolution: pick(['original', '1080', '720', '360', 'custom'] as const),
          width: 16 + Math.floor(rnd() * 2000),
          height: 16 + Math.floor(rnd() * 2000),
          anchorX: rnd(),
          anchorY: rnd(),
          padColor: hex(),
        },
        color: { brightness: Math.round(rnd() * 200 - 100) / 3, contrast: Math.round(rnd() * 200 - 100), saturation: rnd() * 200 - 100 },
        speed: 0.25 + rnd() * 3.75,
        fade: { in: rnd() * 0.5, out: rnd() * 0.5 },
        audio: { volume: rnd() * 4 },
        video: { fps: pick(['original', '24', '30', '60'] as const) },
        trim: rnd() > 0.5 ? { start: rnd(), end: 1.5 + rnd() } : {},
        editorial: {
          texts: rnd() > 0.5 ? [{ text: EVIL, start: rnd(), end: 2 + rnd(), position: pick(['top', 'center', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const), size: 1 + rnd() * 19, color: hex(), opacity: 0.05 + rnd() * 0.95, boxColor: hex(), boxOpacity: rnd() }] : [],
          overlays: rnd() > 0.5 ? [{ assetId: 'logoPng001', scale: 0.02 + rnd() * 0.98, opacity: 0.05 + rnd() * 0.95, margin: rnd() * 0.2, position: pick(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const) }] : [],
          intro: rnd() > 0.7 ? { type: 'card', text: EVIL2, duration: 0.5 + rnd() * 2, size: 2 + rnd() * 18 } : null,
        },
      };
      let p: ProcessingPlan;
      try {
        p = buildPlan(A(pick(['iphoneMov01', 'plainMp401', 'rotated001', 'noAudio001'])), settings, ctx());
      } catch (err) {
        expect(err, JSON.stringify(settings)).toBeInstanceOf(PlanError);
        continue;
      }
      built++;
      assertSafeGraph(p);
      expect(p.args!.join(' ')).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
      expect(p.expected.width! % 2 + (p.expected.height! % 2)).toBe(0);
    }
    expect(built).toBeGreaterThan(60);
  });
});

describe('buildPlan — imagens', () => {
  it('imagem sem transformação no mesmo formato → limpeza sem perdas (sem FFmpeg)', () => {
    for (const [id, fmt, codec, w, h] of [
      ['photoJpg01', 'jpg', 'mjpeg', 400, 300],
      ['graphicPng', 'png', 'png', 200, 100],
      ['imageWebp1', 'webp', 'webp', 300, 200],
    ] as const) {
      const p = buildPlan(A(id), { mode: 'quick' }, ctx());
      expect(p.strategy, id).toBe('image-lossless');
      expect(p.args).toBeNull();
      expect(p.outputFile).toBe(`output.${fmt}`);
      expect(p.expected).toMatchObject({ kind: 'image', container: fmt, videoCodec: codec, width: w, height: h, durationSec: null });
      expect(p.reinjectImageMetadata).toBe(false);
    }
  });

  it('imagem de dimensões ímpares (401×301) no modo rápido continua sem perdas, sem redimensionar', () => {
    const p = buildPlan(A('oddJpeg001'), { mode: 'quick' }, ctx());
    expect({ strategy: p.strategy, width: p.expected.width, height: p.expected.height }).toEqual({ strategy: 'image-lossless', width: 401, height: 301 });
  });

  it('imagem com transformação → recodificação com orientação EXIF aplicada primeiro', () => {
    const p = buildPlan(A('photoJpg01'), { mode: 'custom', color: { brightness: 20 } }, ctx());
    expect(p.strategy).toBe('image-encode');
    expect(graphOf(p).startsWith('[0:v]transpose=1,eq=brightness=0.06:contrast=1:saturation=1')).toBe(true);
    expect(p.expected).toMatchObject({ container: 'jpg', videoCodec: 'mjpeg', width: 300, height: 400 });
    expect(argAfter(p, '-map_metadata')).toBe('-1');
    expect(argAfter(p, '-frames:v')).toBe('1');
    expect(p.reinjectImageMetadata).toBe(true);
    expect(p.operations.map((o) => o.id)).toEqual(expect.arrayContaining(['orientation', 'color', 'metadata', 'image-codec']));
    const sq = buildPlan(A('photoJpg01'), { mode: 'custom', geometry: { aspect: '1:1' } }, ctx());
    expect(sq.expected).toMatchObject({ width: 300, height: 300 });
    expect(graphOf(sq).startsWith('[0:v]transpose=1,')).toBe(true);
  });

  it('PNG com transparência → JPG: fundo branco, conversão registrada', () => {
    const p = buildPlan(A('graphicPng'), { mode: 'quick', output: { format: 'jpg' } }, ctx());
    expect(p.strategy).toBe('image-encode');
    expect(p.expected).toMatchObject({ container: 'jpg', videoCodec: 'mjpeg', width: 200, height: 100 });
    expect(graphOf(p)).toContain('drawbox=c=white@1:replace=1:t=fill');
    expect(p.operations.map((o) => o.id)).toEqual(expect.arrayContaining(['flatten', 'format']));
    expect(p.args!.at(-1)).toBe('output.jpg');
  });

  it('ajustes de vídeo em imagem entram em "ignorados" com motivo; texto vai para arquivo', () => {
    const p = buildPlan(
      A('photoJpg01'),
      { mode: 'editorial', trim: { start: 1 }, speed: 2, editorial: { texts: [{ text: EVIL }], audioTrack: { assetId: 'trackMp301' } } },
      ctx(),
    );
    const labels = p.skipped.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Corte temporal', 'Velocidade', 'Trilha de áudio']));
    expect(p.textFiles).toEqual([{ name: 'text-0.txt', content: EVIL }]);
    assertSafeGraph(p);
    expect(p.needsFont).toBe(true);
  });
});
