import fsp from 'node:fs/promises';
import type { ValidationCheck, ValidationStatus } from '@mediaforge/shared';
import type { ExpectedOutput } from './pipeline/plan';
import { probeFile, type ProbeResult } from './probe';
import { describeFailure, runProcess } from './process';
import { isRejection, sniffFile } from './signature';
import type { MediaTools } from './tools';

export interface DecodeResult {
  ok: boolean;
  errors: string[];
  mode: 'full' | 'quick' | 'off';
}

export interface ValidationOutcome {
  status: ValidationStatus;
  checks: ValidationCheck[];
  decode: DecodeResult;
  probe: ProbeResult | null;
}

const SNIFF_FOR: Record<string, string> = { mp4: 'mp4', mov: 'mov', webm: 'webm', mkv: 'mkv', jpg: 'jpeg', png: 'png', webp: 'webp' };

/**
 * Decodifica o arquivo inteiro (ou início e fim, no modo rápido) descartando
 * os quadros: prova que o arquivo é reproduzível, não só que existe.
 */
export async function decodeCheck(
  tools: MediaTools,
  file: string,
  kind: 'video' | 'image',
  mode: 'full' | 'quick' | 'off',
  durationSec: number | null,
  signal?: AbortSignal,
): Promise<DecodeResult> {
  if (mode === 'off') return { ok: true, errors: [], mode };
  const base = ['-hide_banner', '-nostdin', '-v', 'error'];
  const runs: string[][] =
    kind === 'image'
      ? [[...base, '-i', file, '-frames:v', '1', '-f', 'null', '-']]
      : mode === 'quick' && (durationSec ?? 0) > 8
        ? [
            [...base, '-t', '3', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-'],
            [...base, '-sseof', '-3', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-'],
          ]
        : [[...base, '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-']];
  const errors: string[] = [];
  const timeoutMs = Math.max(60_000, (durationSec ?? 0) * 3000);
  for (const args of runs) {
    const r = await runProcess(tools.ffmpeg.path, args, { timeoutMs, signal, stderrTailLines: 20 });
    if (r.code !== 0) errors.push(describeFailure('ffmpeg (decodificação)', r));
    errors.push(...r.stderrTail.filter((l) => !/deprecated pixel format/i.test(l)));
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 20), mode };
}

export async function validateOutput(
  tools: MediaTools,
  file: string,
  expected: ExpectedOutput,
  decodeMode: 'full' | 'quick' | 'off',
  signal?: AbortSignal,
): Promise<ValidationOutcome> {
  const checks: ValidationCheck[] = [];
  const add = (name: string, exp: string, act: string, status: ValidationCheck['status']) => checks.push({ name, expected: exp, actual: act, status });

  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || stat.size === 0) {
    add('Arquivo gerado', 'arquivo não vazio', stat ? '0 bytes' : 'ausente', 'failed');
    return { status: 'failed', checks, decode: { ok: false, errors: ['Arquivo ausente ou vazio'], mode: decodeMode }, probe: null };
  }
  add('Arquivo gerado', 'arquivo não vazio', `${stat.size} bytes`, 'ok');

  let probe: ProbeResult;
  try {
    probe = await probeFile(tools, file);
    add('Leitura técnica (FFprobe)', 'legível', 'legível', 'ok');
  } catch (err) {
    add('Leitura técnica (FFprobe)', 'legível', (err as Error).message, 'failed');
    return { status: 'failed', checks, decode: { ok: false, errors: [(err as Error).message], mode: decodeMode }, probe: null };
  }
  const info = probe.info;
  const sniff = await sniffFile(file);
  const actualFormat = sniff && !isRejection(sniff) ? sniff.format : info.container;
  const wantFormat = SNIFF_FOR[expected.container] ?? expected.container;
  add('Formato do arquivo', wantFormat.toUpperCase(), actualFormat.toUpperCase(), actualFormat === wantFormat ? 'ok' : 'failed');

  if (expected.videoCodec) {
    add('Codec de vídeo', expected.videoCodec, info.videoCodec ?? 'nenhum', info.videoCodec === expected.videoCodec ? 'ok' : 'failed');
  }
  const v = info.streams.find((s) => s.index === info.videoIndex);
  if (expected.width && expected.height) {
    const act = v ? `${v.width}×${v.height}` : 'sem vídeo';
    add('Resolução', `${expected.width}×${expected.height}`, act, v?.width === expected.width && v?.height === expected.height ? 'ok' : 'failed');
  }
  if (expected.kind === 'video' && expected.durationSec) {
    const d = info.durationSec ?? 0;
    const diff = Math.abs(d - expected.durationSec);
    const tolOk = Math.max(0.3, expected.durationSec * 0.03);
    const tolFail = Math.max(1.0, expected.durationSec * 0.1);
    const status: ValidationCheck['status'] =
      diff <= tolOk ? 'ok' : expected.keyframeAligned || diff <= tolFail ? 'warning' : 'failed';
    add('Duração', `${expected.durationSec.toFixed(2)} s`, `${d.toFixed(2)} s`, status);
  }
  if (expected.fps) {
    const fps = v?.fps ?? null;
    add('Taxa de quadros', `${expected.fps} fps`, fps ? `${fps} fps` : 'desconhecida', fps && Math.abs(fps - expected.fps) <= 0.1 ? 'ok' : 'warning');
  }
  if (expected.kind === 'video') {
    const hasAudio = info.audioIndex !== null;
    if (expected.audioCodec) {
      add('Áudio', `presente (${expected.audioCodec})`, hasAudio ? `presente (${info.audioCodec})` : 'ausente', hasAudio && info.audioCodec === expected.audioCodec ? 'ok' : 'failed');
    } else {
      add('Áudio', 'ausente', hasAudio ? `presente (${info.audioCodec})` : 'ausente', hasAudio ? 'failed' : 'ok');
    }
  }
  if (expected.bitrateKbps) {
    const a = info.streams.find((s) => s.index === info.audioIndex);
    const vb = v?.bitrate ?? (info.bitrate ? info.bitrate - (a?.bitrate ?? 0) : null);
    const kb = vb ? Math.round(vb / 1000) : null;
    const ratio = kb ? kb / expected.bitrateKbps : 0;
    add('Taxa de bits do vídeo', `${expected.bitrateKbps} kb/s (±40%)`, kb ? `${kb} kb/s` : 'desconhecida', kb && ratio > 0.6 && ratio < 1.4 ? 'ok' : 'warning');
  }

  const decode = await decodeCheck(tools, file, expected.kind, decodeMode, info.durationSec, signal);
  add(
    'Decodificação',
    decodeMode === 'off' ? 'não verificada' : decodeMode === 'quick' ? 'início e fim sem erros' : 'arquivo inteiro sem erros',
    decode.ok ? 'sem erros' : `${decode.errors.length} erro(s)`,
    decode.ok ? 'ok' : 'failed',
  );

  const status: ValidationStatus = checks.some((c) => c.status === 'failed') ? 'failed' : checks.some((c) => c.status === 'warning') ? 'warning' : 'passed';
  return { status, checks, decode, probe };
}
