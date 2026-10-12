import {
  applyExportProfile,
  computeSegments,
  EXPORT_PROFILES,
  frameGridFps,
  SegmentationError,
  processingSettingsSchema,
  type BatchRequest,
  type PlanJobPreview,
  type PlanResponse,
  type ProcessingSettings,
} from '@mediaforge/shared';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { AssetRow, JobRow } from '../db/repositories';
import { buildPlan, PlanError, type PlanAsset, type PlanSegment } from '../media/pipeline/plan';
import { toPlanAsset, type JobPayload } from '../queue/jobRunner';
import { newId } from '../security/filenames';
import { batchToDTO, jobToDTO } from './dto';

export const MODE_LABEL = { quick: 'Rápido', custom: 'Personalizado', editorial: 'Editorial' } as const;

const idRe = /^[A-Za-z0-9_-]{8,64}$/;
export const batchRequestSchema = z.object({
  assetIds: z.array(z.string().regex(idRe)).min(1, 'Selecione ao menos um arquivo').max(1000),
  scope: z.enum(['common', 'individual']).default('common'),
  settings: z.unknown(),
  perAsset: z.record(z.string().regex(idRe), z.unknown()).optional(),
  profiles: z.array(z.string().max(80)).max(20).optional(),
  label: z.string().max(120).optional(),
});

interface Expanded {
  asset: AssetRow;
  planAsset: PlanAsset;
  settings: ProcessingSettings;
  profileName: string | null;
  segment: PlanSegment | null;
  label: string;
  preview: PlanJobPreview;
}

export class BatchError extends Error {
  constructor(readonly errors: PlanResponse['errors']) {
    super(errors.map((e) => e.message).join(' '));
    this.name = 'BatchError';
  }
}

const MAX_REPORTED_ERRORS = 50;

export class BatchService {
  constructor(private ctx: AppContext) {}

  /** Resolve perfis (embutidos ou salvos) em pares nome + configurações. */
  private resolveProfiles(
    base: ProcessingSettings,
    ids: string[] | undefined,
  ): Array<{ name: string | null; settings: unknown; note?: string }> {
    if (!ids || ids.length === 0) return [{ name: null, settings: base }];
    return ids.map((id) => {
      if (id.startsWith('saved:')) {
        const row = this.ctx.repos.profile(id.slice(6));
        if (!row) throw new BatchError([{ assetId: null, assetName: null, message: `Perfil salvo não encontrado (${id.slice(6)}).` }]);
        return { name: row.name, settings: JSON.parse(row.settings_json) };
      }
      const p = EXPORT_PROFILES.find((x) => x.id === id);
      if (!p) throw new BatchError([{ assetId: null, assetName: null, message: `Perfil de exportação desconhecido: ${id}.` }]);
      const { settings, promoted } = applyExportProfile(base, p.patch);
      return promoted
        ? {
            name: p.name,
            settings,
            note: `Perfil "${p.name}": o modo Rápido não altera proporção, resolução nem taxa de quadros; este perfil foi processado no modo Personalizado.`,
          }
        : { name: p.name, settings };
    });
  }

  /**
   * Expande arquivos × perfis × partes em tarefas. Para assim que o total passa
   * do permitido (por lote e por sessão), sem montar os planos restantes:
   * 1000 arquivos × 20 perfis × 100 partes não pode virar 2 milhões de planos.
   */
  private expand(
    sessionId: string,
    req: z.infer<typeof batchRequestSchema>,
  ): { items: Expanded[]; errors: PlanResponse['errors']; overflow: boolean } {
    const { repos, tools, config } = this.ctx;
    const errors: PlanResponse['errors'] = [];
    const items: Expanded[] = [];
    const cap = Math.max(0, Math.min(config.limits.maxJobsPerBatch, config.limits.maxJobsPerSession - repos.countJobs(sessionId)));
    let overflow = false;
    // Conta TENTATIVAS (planos válidos ou com erro): configurações inválidas em
    // 1000 arquivos × 20 perfis × 100 partes também não podem virar milhões de planos.
    let attempted = 0;
    const ids = [...new Set(req.assetIds)];
    const profileIds = req.profiles ? [...new Set(req.profiles)] : undefined;
    const resolveAsset = (id: string) => {
      const row = repos.asset(sessionId, id);
      return row ? toPlanAsset(this.ctx, row) : undefined;
    };
    for (const id of ids) {
      if (overflow) break;
      const asset = repos.asset(sessionId, id);
      if (!asset) {
        errors.push({ assetId: id, assetName: null, message: 'Arquivo não encontrado nesta sessão.' });
        continue;
      }
      const planAsset = toPlanAsset(this.ctx, asset);
      if (!planAsset) {
        errors.push({ assetId: id, assetName: asset.original_name, message: `Arquivo inválido: ${asset.error ?? 'indisponível'}` });
        continue;
      }
      const rawSettings = req.scope === 'individual' && req.perAsset?.[id] !== undefined ? req.perAsset[id] : req.settings;
      const parsed = processingSettingsSchema.safeParse(rawSettings);
      if (!parsed.success) {
        errors.push({
          assetId: id,
          assetName: asset.original_name,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }
      let profiles: Array<{ name: string | null; settings: unknown; note?: string }>;
      try {
        profiles = this.resolveProfiles(parsed.data, profileIds);
      } catch (err) {
        if (err instanceof BatchError) {
          errors.push(...err.errors);
          continue;
        }
        throw err;
      }
      for (const prof of profiles) {
        if (overflow) break;
        const ps = processingSettingsSchema.safeParse(prof.settings);
        if (!ps.success) {
          errors.push({ assetId: id, assetName: asset.original_name, message: `Perfil ${prof.name}: configuração inválida.` });
          continue;
        }
        let segments: Array<PlanSegment | null>;
        try {
          segments = (asset.kind === 'video' ? computeSegments(planAsset.info.durationSec, frameGridFps(planAsset.info), ps.data) : null) ?? [null];
        } catch (err) {
          if (!(err instanceof SegmentationError)) throw err;
          errors.push({ assetId: id, assetName: asset.original_name, message: err.message });
          continue;
        }
        for (const segment of segments) {
          if (attempted >= cap) {
            overflow = true;
            break;
          }
          attempted++;
          try {
            const plan = buildPlan(planAsset, ps.data, {
              tools,
              ffmpegThreads: config.queue.ffmpegThreads,
              fontFileName: 'font.ttf',
              resolveAsset,
              segment,
            });
            const label = [prof.name ?? MODE_LABEL[ps.data.mode], segment ? `parte ${segment.index}/${segment.count}` : null].filter(Boolean).join(' · ');
            items.push({
              asset,
              planAsset,
              settings: plan.settings,
              profileName: prof.name,
              segment,
              label,
              preview: {
                assetId: id,
                assetName: asset.original_name,
                label,
                profileName: prof.name,
                strategy: plan.strategy,
                outputFormat: plan.outputExt,
                expected: {
                  width: plan.expected.width,
                  height: plan.expected.height,
                  durationSec: plan.expected.durationSec,
                  hasAudio: !!plan.expected.audioCodec,
                },
                operations: plan.operations,
                skipped: plan.skipped,
                warnings: prof.note ? [prof.note, ...plan.warnings] : plan.warnings,
              },
            });
          } catch (err) {
            if (err instanceof PlanError) {
              for (const m of err.messages) errors.push({ assetId: id, assetName: asset.original_name, message: m });
            } else throw err;
          }
        }
      }
    }
    // Resposta enxuta: os primeiros erros e um resumo do restante.
    if (errors.length > MAX_REPORTED_ERRORS) {
      const extra = errors.length - MAX_REPORTED_ERRORS;
      errors.splice(MAX_REPORTED_ERRORS);
      errors.push({ assetId: null, assetName: null, message: `…e mais ${extra} erro(s) semelhante(s).` });
    }
    return { items, errors, overflow };
  }

  plan(sessionId: string, body: unknown): PlanResponse {
    const req = batchRequestSchema.parse(body);
    const { items, errors, overflow } = this.expand(sessionId, req);
    const limitErr = this.limitError(sessionId, items.length, overflow);
    if (limitErr) errors.push({ assetId: null, assetName: null, message: limitErr });
    return { ok: errors.length === 0 && items.length > 0, jobs: items.map((i) => i.preview), errors };
  }

  private limitError(sessionId: string, _count: number, overflow: boolean): string | null {
    const l = this.ctx.config.limits;
    if (!overflow) return null;
    const used = this.ctx.repos.countJobs(sessionId);
    if (l.maxJobsPerSession - used >= l.maxJobsPerBatch) {
      return `O lote geraria mais de ${l.maxJobsPerBatch} tarefas (máximo por lote). Selecione menos arquivos, perfis ou partes.`;
    }
    return `Limite de ${l.maxJobsPerSession} tarefas por sessão atingido (${used} já existem). Remova tarefas concluídas.`;
  }

  create(sessionId: string, body: unknown) {
    const { repos } = this.ctx;
    const req = batchRequestSchema.parse(body);
    const { items, errors, overflow } = this.expand(sessionId, req);
    const limitErr = this.limitError(sessionId, items.length, overflow);
    if (limitErr) errors.push({ assetId: null, assetName: null, message: limitErr });
    if (errors.length || items.length === 0) {
      throw new BatchError(errors.length ? errors : [{ assetId: null, assetName: null, message: 'Nenhuma tarefa a criar.' }]);
    }
    const now = Date.now();
    const batchId = newId();
    const mode = items[0]!.settings.mode;
    const label =
      req.label?.trim() ||
      `${MODE_LABEL[mode]} · ${new Set(items.map((i) => i.asset.id)).size} arquivo(s) · ${items.length} saída(s)`;
    const rows: JobRow[] = [];
    repos.db.tx(() => {
      repos.insertBatch({ id: batchId, session_id: sessionId, label, mode, scope: req.scope, created_at: now });
      let seq = repos.nextSeq();
      for (const it of items) {
        const payload: JobPayload = { settings: it.settings, segment: it.segment };
        const row: JobRow = {
          id: newId(),
          session_id: sessionId,
          batch_id: batchId,
          asset_id: it.asset.id,
          label: it.label,
          mode: it.settings.mode,
          profile_name: it.profileName,
          settings_json: JSON.stringify(payload),
          status: 'queued',
          phase: 'aguardando',
          progress: 0,
          attempts: 0,
          max_attempts: this.ctx.config.queue.maxAttempts,
          seq: seq++,
          error: null,
          error_code: null,
          log_tail: null,
          created_at: now,
          started_at: null,
          finished_at: null,
          duration_ms: null,
          output_name: null,
          output_file: null,
          output_kind: null,
          output_size: null,
          output_sha256: null,
          output_thumb: null,
          output_info_json: null,
          report_json: null,
          validation_status: null,
        };
        repos.insertJob(row);
        rows.push(row);
      }
    });
    const batch = repos.batch(sessionId, batchId)!;
    for (const r of rows) this.ctx.events.publish(sessionId, { type: 'job', job: jobToDTO(r, repos) });
    this.ctx.events.publish(sessionId, { type: 'batch', batch: batchToDTO(batch, repos) });
    this.ctx.history.add(sessionId, 'batch', 'info', `Lote criado: ${label}`);
    this.ctx.log.info({ batchId, jobs: rows.length }, 'lote criado');
    this.ctx.queue.tick();
    this.ctx.queue.publishQueue();
    return { batch: batchToDTO(batch, repos), jobs: rows.map((r) => jobToDTO(r, repos)) };
  }
}
