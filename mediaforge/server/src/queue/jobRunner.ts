import fsp from 'node:fs/promises';
import path from 'node:path';
import type { JobPhase, JobReport, MediaInfo, MetadataInspection, ProcessingSettings } from '@mediaforge/shared';
import type { AppContext } from '../context';
import type { AssetRow, JobRow } from '../db/repositories';
import { hashAndScan } from '../media/hashing';
import { compareMetadata, residualPatterns } from '../media/metadata/compare';
import { cleanImage, imageContainerOf, injectImageMetadata, readImageBlocks, rebuildExif } from '../media/metadata/imageMeta';
import { inspectMetadata } from '../media/metadata/inspect';
import { buildTiff, parseTiff, TAG_MAKERNOTE } from '../media/metadata/tiff';
import { buildPlan, PlanError, type PlanAsset, type PlanSegment, type ProcessingPlan } from '../media/pipeline/plan';
import { describeFailure, runProcess } from '../media/process';
import { makeThumbnail } from '../media/thumbnails';
import { validateOutput } from '../media/validation';
import { outputStem, slug } from '../security/filenames';
import { jobToDTO, parseJson } from '../services/dto';

export interface JobPayload {
  settings: ProcessingSettings;
  segment: PlanSegment | null;
}

export class JobFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly report: JobReport | null = null,
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}

export const FONT_FILE = 'DejaVuSans-Bold.ttf';

/** Converte uma linha de arquivo em PlanAsset (com caminho absoluto validado). */
export function toPlanAsset(ctx: AppContext, row: AssetRow): PlanAsset | undefined {
  if (row.status !== 'ready' || !row.stored_name) return undefined;
  const info = parseJson<MediaInfo>(row.info_json);
  if (!info) return undefined;
  return {
    id: row.id,
    name: row.original_name,
    kind: row.kind,
    ext: row.ext,
    path: ctx.storage.file(row.session_id, 'uploads', row.stored_name),
    info,
    metadata: parseJson<MetadataInspection>(row.metadata_json),
  };
}

const PHASE_RANGE: Record<JobPhase, [number, number]> = {
  aguardando: [0, 0],
  preparando: [0, 0.05],
  processando: [0.05, 0.85],
  validando: [0.85, 0.98],
  finalizando: [0.98, 1],
};

/**
 * Executa uma tarefa de ponta a ponta. Todo processamento pesado roda em
 * processos FFmpeg separados; este código só orquestra, verifica e registra.
 */
export class JobRunner {
  constructor(private ctx: AppContext) {}

  async run(job: JobRow, signal: AbortSignal): Promise<void> {
    const { repos, storage, tools, config } = this.ctx;
    const log = this.ctx.log.child({ jobId: job.id });
    const sid = job.session_id;
    let lastEmit = 0;
    let phase: JobPhase = 'preparando';

    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 350) return;
      lastEmit = now;
      const row = repos.jobById(job.id);
      if (row) this.ctx.events.publish(sid, { type: 'job', job: jobToDTO(row, repos) });
    };
    const setPhase = (p: JobPhase, fraction = 0) => {
      phase = p;
      const [a, b] = PHASE_RANGE[p];
      repos.updateJob(job.id, { phase: p, progress: Math.min(0.999, a + (b - a) * fraction) });
      emit(true);
    };
    const setFraction = (fraction: number) => {
      const [a, b] = PHASE_RANGE[phase];
      repos.updateJob(job.id, { progress: Math.min(0.999, a + (b - a) * Math.max(0, Math.min(1, fraction))) });
      emit();
    };
    const checkAbort = () => {
      if (signal.aborted) throw signal.reason ?? new Error('abort');
    };

    setPhase('preparando');
    const asset = repos.asset(sid, job.asset_id);
    if (!asset) throw new JobFailure('O arquivo de origem foi removido da sessão.', 'asset-missing', false);
    const planAsset = toPlanAsset(this.ctx, asset);
    if (!planAsset) throw new JobFailure('O arquivo de origem é inválido ou não está disponível.', 'asset-invalid', false);
    const inputPath = planAsset.path;
    const statBefore = await fsp.stat(inputPath).catch(() => null);
    if (!statBefore) throw new JobFailure('O arquivo de origem não existe mais no armazenamento.', 'input-missing', false);

    // Integridade da entrada: precisa ser exatamente o arquivo importado.
    const inputHash = await hashAndScan(inputPath);
    checkAbort();
    if (inputHash.sha256 !== asset.sha256) {
      throw new JobFailure('O arquivo de origem foi alterado desde a importação (SHA-256 diferente). Importe-o novamente.', 'input-changed', false);
    }
    setFraction(0.5);

    const payload = parseJson<JobPayload>(job.settings_json);
    if (!payload) throw new JobFailure('Configuração da tarefa ilegível.', 'invalid-settings', false);
    let plan: ProcessingPlan;
    try {
      plan = buildPlan(planAsset, payload.settings, {
        tools,
        ffmpegThreads: config.queue.ffmpegThreads,
        fontFileName: 'font.ttf',
        segment: payload.segment,
        resolveAsset: (id) => {
          const row = repos.asset(sid, id);
          return row ? toPlanAsset(this.ctx, row) : undefined;
        },
      });
    } catch (err) {
      if (err instanceof PlanError) throw new JobFailure(err.message, 'invalid-settings', false);
      throw err;
    }
    for (const auxId of plan.auxiliaryAssetIds) {
      const row = repos.asset(sid, auxId);
      const p = row ? toPlanAsset(this.ctx, row) : undefined;
      if (!p || !(await fsp.stat(p.path).catch(() => null))) {
        throw new JobFailure('Um arquivo auxiliar (abertura, cena, logotipo, legenda ou trilha) não está mais disponível.', 'aux-missing', false);
      }
    }

    const dir = await storage.jobTmp(sid, job.id);
    try {
      for (const f of plan.textFiles) await fsp.writeFile(path.join(dir, f.name), f.content, 'utf8');
      for (const f of plan.copyFiles) await fsp.copyFile(f.from, path.join(dir, f.to));
      if (plan.needsFont) {
        const font = path.join(config.fontsDir, FONT_FILE);
        await fsp.copyFile(font, path.join(dir, 'font.ttf'));
        await fsp.mkdir(path.join(dir, 'fonts'));
        await fsp.copyFile(font, path.join(dir, 'fonts', FONT_FILE));
      }
      const outPath = path.join(dir, plan.outputFile);
      const actions: string[] = [];
      const warnings = [...plan.warnings];

      // ── Processamento ──
      setPhase('processando');
      if (plan.args) {
        const r = await runProcess(tools.ffmpeg.path, plan.args, {
          cwd: dir,
          signal,
          nice: config.queue.nice,
          timeoutMs: config.queue.jobTimeoutMs,
          stderrTailLines: 30,
          onStdoutLine: (line) => {
            if (!plan.progressDuration) return;
            const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
            if (m) setFraction(Number(m[1]) / 1e6 / plan.progressDuration);
          },
        });
        checkAbort();
        const logTail = r.stderrTail.filter((l) => !/deprecated pixel format/i.test(l)).slice(-15).join('\n');
        repos.updateJob(job.id, { log_tail: logTail || null });
        if (r.code !== 0) {
          throw new JobFailure(describeFailure('FFmpeg', r), r.timedOut ? 'timeout' : 'ffmpeg-failed', true);
        }
      } else {
        const container = imageContainerOf(asset.ext)!;
        const cleaned = cleanImage(await fsp.readFile(inputPath), container, plan.settings.metadata);
        actions.push(...cleaned.actions);
        warnings.push(...cleaned.warnings);
        await fsp.writeFile(outPath, cleaned.buffer, { flag: 'wx' });
      }
      if (plan.reinjectImageMetadata) {
        const injected = await this.reinject(inputPath, asset.ext, outPath, plan);
        actions.push(...injected.actions);
        warnings.push(...injected.warnings);
      }
      checkAbort();

      // ── Validação ──
      setPhase('validando');
      const validation = await validateOutput(tools, outPath, plan.expected, config.queue.validationDecode, signal);
      checkAbort();
      setFraction(0.5);
      const outInspection = validation.probe
        ? await inspectMetadata(outPath, plan.expected.kind, plan.outputExt, validation.probe)
        : { items: [], warnings: [], orientation: null };
      const beforeItems = planAsset.metadata?.items ?? [];
      const patterns = residualPatterns(beforeItems, plan.settings.metadata);
      const scan = await hashAndScan(
        outPath,
        patterns.map((p) => p.pattern),
      );
      checkAbort();
      const residual = new Set([...scan.found].map((i) => patterns[i]!.itemId));
      const comparison = compareMetadata(beforeItems, outInspection.items, plan.settings.metadata, residual, actions);

      // Entrada intacta depois do processamento?
      const statAfter = await fsp.stat(inputPath).catch(() => null);
      let inputUnchanged = !!statAfter && statAfter.size === statBefore.size && statAfter.mtimeMs === statBefore.mtimeMs;
      if (statAfter && !inputUnchanged) inputUnchanged = (await hashAndScan(inputPath)).sha256 === asset.sha256;

      const identical = repos.completedJobsByOutputHash(sid, scan.sha256).filter((j) => j.id !== job.id);
      const outInfo = validation.probe?.info ?? null;
      const outKind = plan.expected.kind;
      const desiredName = `${outputStem(asset.original_name)}_${slug(job.label)}.${plan.outputExt}`;

      const report: JobReport = {
        version: 1,
        generatedAt: new Date().toISOString(),
        job: {
          id: job.id,
          batchId: job.batch_id,
          label: job.label,
          mode: job.mode,
          profileName: job.profile_name,
          attempts: job.attempts,
          startedAt: job.started_at ? new Date(job.started_at).toISOString() : null,
          finishedAt: null,
          durationMs: null,
        },
        strategy: plan.strategy,
        strategyDescription: plan.strategyDescription,
        input: {
          name: asset.original_name,
          sha256: asset.sha256,
          size: asset.size,
          container: asset.container,
          videoCodec: planAsset.info.videoCodec,
          audioCodec: planAsset.info.audioCodec,
          width: planAsset.info.displayWidth,
          height: planAsset.info.displayHeight,
          durationSec: planAsset.info.durationSec,
          fps: planAsset.info.fps,
        },
        output: {
          name: desiredName,
          sha256: scan.sha256,
          size: scan.size,
          container: outInfo?.containerLong ?? null,
          videoCodec: outInfo?.videoCodec ?? null,
          audioCodec: outInfo?.audioCodec ?? null,
          width: outInfo?.streams.find((s) => s.index === outInfo.videoIndex)?.width ?? null,
          height: outInfo?.streams.find((s) => s.index === outInfo.videoIndex)?.height ?? null,
          durationSec: outInfo?.durationSec ?? null,
          fps: outInfo?.fps ?? null,
          bitrate: outInfo?.bitrate ?? null,
          hasAudio: outInfo?.audioIndex !== null && outInfo?.audioIndex !== undefined,
        },
        operations: [
          ...plan.operations,
          { id: 'validate', label: 'Validação do resultado', detail: validation.checks.map((c) => `${c.name}: ${c.status === 'ok' ? 'ok' : c.status === 'warning' ? 'aviso' : 'falhou'}`).join('; ') },
        ],
        skipped: plan.skipped,
        warnings: [...warnings, ...outInspection.warnings],
        command: plan.args ? this.sanitizeArgs(plan.args, sid) : ['(limpeza sem perdas em JavaScript — sem FFmpeg)'],
        metadata: comparison,
        validation: { status: validation.status, checks: validation.checks, decode: validation.decode },
        integrity: {
          algorithm: 'SHA-256',
          inputSha256AtImport: asset.sha256,
          inputSha256BeforeProcessing: inputHash.sha256,
          inputUnchangedAfterProcessing: inputUnchanged,
          outputSha256: scan.sha256,
          outputIdenticalToInput: scan.sha256 === asset.sha256,
          identicalOutputs: identical.map((j) => j.output_name ?? j.id),
          note:
            'SHA-256 comprova integridade técnica: que o arquivo não foi corrompido nem alterado depois de gerado. ' +
            'Ele não mede semelhança de conteúdo, não indica originalidade editorial e não diz nada sobre como plataformas ' +
            'de publicação reconhecem o conteúdo.',
        },
        settings: plan.settings,
      };

      if (!inputUnchanged) {
        throw new JobFailure('O arquivo de origem mudou durante o processamento.', 'input-changed', false, report);
      }
      if (validation.status === 'failed') {
        const failed = validation.checks.filter((c) => c.status === 'failed').map((c) => `${c.name} (esperado ${c.expected}, obtido ${c.actual})`);
        throw new JobFailure(`Validação do resultado falhou: ${failed.join('; ')}`, 'validation-failed', false, report);
      }

      // ── Finalização ──
      setPhase('finalizando');
      const finalName = await storage.moveNoOverwrite(outPath, storage.area(sid, 'outputs'), desiredName);
      report.output.name = finalName;
      let thumb: string | null = null;
      if (outInfo && (outKind === 'video' || outKind === 'image')) {
        try {
          await makeThumbnail(tools, storage.file(sid, 'outputs', finalName), storage.file(sid, 'thumbs', `job-${job.id}.jpg`), outInfo);
          thumb = `job-${job.id}.jpg`;
        } catch (err) {
          log.warn({ err: (err as Error).message }, 'miniatura da saída falhou');
        }
      }
      const finishedAt = Date.now();
      report.job.finishedAt = new Date(finishedAt).toISOString();
      report.job.durationMs = finishedAt - (job.started_at ?? finishedAt);
      const ok = repos.updateJobIfStatus(job.id, ['running'], {
        status: 'completed',
        phase: null,
        progress: 1,
        finished_at: finishedAt,
        duration_ms: report.job.durationMs,
        output_name: finalName,
        output_file: finalName,
        output_kind: outKind,
        output_size: scan.size,
        output_sha256: scan.sha256,
        output_thumb: thumb,
        output_info_json: outInfo ? JSON.stringify(outInfo) : null,
        report_json: JSON.stringify(report),
        validation_status: validation.status,
        error: null,
        error_code: null,
      });
      if (!ok) {
        // Cancelada no último instante: descarta a saída.
        await fsp.rm(storage.file(sid, 'outputs', finalName), { force: true });
        if (thumb) await fsp.rm(storage.file(sid, 'thumbs', thumb), { force: true });
        return;
      }
      const verdict = comparison.verdict === 'comprovado' ? 'metadados: remoção comprovada' : comparison.verdict === 'parcial' || comparison.verdict === 'nao-comprovado' ? 'metadados: remoção NÃO comprovada em parte' : '';
      this.ctx.history.add(
        sid,
        'job',
        validation.status === 'passed' && comparison.unverified.length === 0 ? 'success' : 'warning',
        `Concluída: ${asset.original_name} → ${finalName} (${validation.status === 'passed' ? 'validação ok' : 'validação com avisos'}${verdict ? '; ' + verdict : ''})`,
      );
      log.info({ strategy: plan.strategy, ms: report.job.durationMs, validation: validation.status }, 'tarefa concluída');
    } finally {
      await storage.removeJobTmp(sid, job.id).catch((err) => log.warn({ err: (err as Error).message }, 'falha ao limpar temporários'));
    }
  }

  /** Reinsere EXIF/ICC preservados por escolha numa imagem recodificada. */
  private async reinject(inputPath: string, inputExt: string, outPath: string, plan: ProcessingPlan) {
    const srcContainer = imageContainerOf(inputExt);
    const outContainer = imageContainerOf(plan.outputExt);
    if (!srcContainer || !outContainer) return { actions: [] as string[], warnings: [] as string[] };
    const blocks = readImageBlocks(await fsp.readFile(inputPath), srcContainer);
    let exif: Buffer | null = null;
    if (blocks.exif) {
      const r = rebuildExif(blocks.exif, plan.settings.metadata, { keepOrientation: false });
      if (r.tiff === 'unchanged') {
        const t = blocks.exif;
        exif = buildTiff({ order: t.order, ifd0: t.ifd0, exif: t.exif.filter((e) => e.tag !== TAG_MAKERNOTE), gps: t.gps, interop: t.interop });
      } else exif = r.tiff;
      if (exif) {
        // Só reinsere se sobrou algo além de campos técnicos.
        try {
          const parsed = parseTiff(exif);
          if (parsed.ifd0.length + parsed.exif.length + parsed.gps.length === 0) exif = null;
        } catch {
          exif = null;
        }
      }
    }
    const icc = plan.settings.metadata.preserveColorProfile ? blocks.icc : null;
    const result = injectImageMetadata(await fsp.readFile(outPath), outContainer, { exif, icc });
    if (result.actions.length) await fsp.writeFile(outPath, result.buffer);
    return result;
  }

  /** Substitui caminhos absolutos por marcadores (o relatório não expõe a estrutura do disco). */
  private sanitizeArgs(args: string[], sid: string): string[] {
    const uploads = this.ctx.storage.area(sid, 'uploads');
    return args.map((a) => {
      if (a.startsWith(uploads)) {
        const id = path.basename(a).replace(/\.[^.]+$/, '');
        const row = this.ctx.repos.asset(sid, id);
        return `<entrada:${row?.original_name ?? id}>`;
      }
      return a;
    });
  }
}
