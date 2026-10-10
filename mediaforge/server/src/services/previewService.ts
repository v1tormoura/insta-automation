import fsp from 'node:fs/promises';
import path from 'node:path';
import type { OperationRecord } from '@mediaforge/shared';
import { z } from 'zod';
import type { AppContext } from '../context';
import { buildPlan, PlanError } from '../media/pipeline/plan';
import { probeFile } from '../media/probe';
import { describeFailure, runProcess } from '../media/process';
import { FONT_FILE, toPlanAsset } from '../queue/jobRunner';
import { newId } from '../security/filenames';
import { resolveInside } from '../security/paths';

export const previewRequestSchema = z.object({
  assetId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  settings: z.unknown(),
  offset: z.number().min(0).max(86_400).default(0),
  /** Contêiner da prévia de vídeo: WebM/VP9 para navegadores sem H.264. */
  container: z.enum(['mp4', 'webm']).default('mp4'),
});

export class PreviewBusyError extends Error {}

export interface PreviewResult {
  url: string;
  kind: 'video' | 'image';
  width: number | null;
  height: number | null;
  durationSec: number | null;
  operations: OperationRecord[];
  warnings: string[];
  skipped: Array<{ label: string; reason: string }>;
}

const KEEP_PREVIEWS = 8;

/**
 * Prévia real: o mesmo planejador das tarefas, em resolução reduzida e
 * duração curta, para conferir enquadramento, textos, cor e cortes antes de
 * processar. Limitada a 1 por sessão e 2 no total.
 */
export class PreviewService {
  private active = new Set<string>();
  private globalCount = 0;

  constructor(private ctx: AppContext) {}

  async render(sessionId: string, body: unknown): Promise<PreviewResult> {
    const req = previewRequestSchema.parse(body);
    if (this.active.has(sessionId) || this.globalCount >= 2) throw new PreviewBusyError('Já existe uma prévia sendo gerada. Aguarde.');
    const { repos, storage, tools, config } = this.ctx;
    const row = repos.asset(sessionId, req.assetId);
    const asset = row ? toPlanAsset(this.ctx, row) : undefined;
    if (!asset) throw new PlanError(['Arquivo não encontrado ou inválido.']);

    this.active.add(sessionId);
    this.globalCount++;
    const id = newId();
    const dir = resolveInside(storage.area(sessionId, 'tmp'), `preview-${id}`);
    try {
      const plan = buildPlan(asset, req.settings, {
        tools,
        ffmpegThreads: config.queue.ffmpegThreads,
        fontFileName: 'font.ttf',
        resolveAsset: (aid) => {
          const r = repos.asset(sessionId, aid);
          return r ? toPlanAsset(this.ctx, r) : undefined;
        },
        preview: { maxSeconds: config.limits.previewMaxSeconds, offset: req.offset, container: req.container },
      });
      if (!plan.args) throw new PlanError(['Prévia indisponível para esta configuração.']);
      await fsp.mkdir(dir, { recursive: true });
      for (const f of plan.textFiles) await fsp.writeFile(path.join(dir, f.name), f.content, 'utf8');
      for (const f of plan.copyFiles) await fsp.copyFile(f.from, path.join(dir, f.to));
      if (plan.needsFont) {
        const font = path.join(config.fontsDir, FONT_FILE);
        await fsp.copyFile(font, path.join(dir, 'font.ttf'));
        await fsp.mkdir(path.join(dir, 'fonts'));
        await fsp.copyFile(font, path.join(dir, 'fonts', FONT_FILE));
      }
      const r = await runProcess(tools.ffmpeg.path, plan.args, { cwd: dir, timeoutMs: 120_000, nice: config.queue.nice });
      if (r.code !== 0) throw new Error(describeFailure('FFmpeg (prévia)', r));
      const out = path.join(dir, plan.outputFile);
      const probe = await probeFile(tools, out);
      const name = `${id}.${plan.outputExt}`;
      await fsp.rename(out, storage.file(sessionId, 'previews', name));
      await this.prune(sessionId);
      const v = probe.info.streams.find((s) => s.index === probe.info.videoIndex);
      return {
        url: `/api/previews/${name}`,
        kind: plan.expected.kind,
        width: v?.width ?? null,
        height: v?.height ?? null,
        durationSec: probe.info.durationSec,
        operations: plan.operations,
        warnings: plan.warnings,
        skipped: plan.skipped,
      };
    } finally {
      this.active.delete(sessionId);
      this.globalCount--;
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async prune(sessionId: string) {
    const dir = this.ctx.storage.area(sessionId, 'previews');
    const files = await fsp.readdir(dir).catch(() => []);
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(dir, f)).catch(() => null))?.mtimeMs ?? 0 })));
    stats.sort((a, b) => b.t - a.t);
    for (const old of stats.slice(KEEP_PREVIEWS)) await fsp.rm(path.join(dir, old.f), { force: true });
  }
}
