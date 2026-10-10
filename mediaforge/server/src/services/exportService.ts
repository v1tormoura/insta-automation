import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { JobReport } from '@mediaforge/shared';
import { STRATEGY_LABELS } from '@mediaforge/shared';
import yazl from 'yazl';
import type { AppContext } from '../context';
import type { JobRow } from '../db/repositories';
import { hashAndScan } from '../media/hashing';
import { newId } from '../security/filenames';
import { parseJson } from './dto';

export class ExportError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

const MASK = '••• (valor omitido no relatório exportado)';

/**
 * Relatórios exportados não repetem valores sensíveis da entrada (GPS,
 * aparelho, datas…): compartilhar o ZIP não pode vazar o que foi removido.
 */
export function maskReport(r: JobReport): JobReport {
  const mask = <T extends { sensitive: boolean; value: string; note?: string }>(i: T): T =>
    i.sensitive ? { ...i, value: MASK, note: i.note?.startsWith('Agora:') ? undefined : i.note } : i;
  return {
    ...r,
    metadata: {
      ...r.metadata,
      removed: r.metadata.removed.map(mask),
      preserved: r.metadata.preserved.map(mask),
      unverified: r.metadata.unverified.map(mask),
      added: r.metadata.added.map(mask),
    },
    command: r.command.map((a, i, arr) => (arr[i - 1]?.startsWith('-metadata') ? a.replace(/=.*/, `=${MASK}`) : a)),
  };
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function summaryText(jobs: Array<{ job: JobRow; report: JobReport | null; path: string }>, createdAt: Date): string {
  const lines: string[] = [];
  lines.push('MEDIAFORGE — RELATÓRIO DE EXPORTAÇÃO');
  lines.push(`Gerado em: ${createdAt.toLocaleString('pt-BR')}`);
  lines.push(`Arquivos: ${jobs.length}`);
  lines.push('');
  lines.push('Integridade técnica × conteúdo: o SHA-256 confirma que cada arquivo chegou íntegro e corresponde ao');
  lines.push('resultado validado. Ele não mede semelhança de conteúdo nem originalidade editorial.');
  lines.push('');
  for (const { job, report, path } of jobs) {
    lines.push('─'.repeat(72));
    lines.push(`${path}`);
    if (!report) continue;
    lines.push(`  Origem: ${report.input.name} (SHA-256 ${report.input.sha256})`);
    lines.push(`  Saída:  ${report.output.width ?? '?'}×${report.output.height ?? '?'} · ${report.output.videoCodec ?? '-'} / ${report.output.audioCodec ?? 'sem áudio'} · ${report.output.durationSec ? report.output.durationSec.toFixed(2) + ' s' : 'imagem'} · ${fmtBytes(report.output.size)}`);
    lines.push(`  SHA-256: ${report.output.sha256}`);
    lines.push(`  Estratégia: ${STRATEGY_LABELS[report.strategy]}`);
    lines.push(`  Perfil/rótulo: ${job.label}`);
    lines.push(`  Validação: ${report.validation.status === 'passed' ? 'aprovada' : report.validation.status === 'warning' ? 'aprovada com avisos' : 'reprovada'}`);
    lines.push('  Transformações aplicadas:');
    for (const op of report.operations) lines.push(`    • ${op.label}: ${op.detail}`);
    if (report.skipped.length) {
      lines.push('  Não aplicadas:');
      for (const s of report.skipped) lines.push(`    • ${s.label}: ${s.reason}`);
    }
    const m = report.metadata;
    const verdict = {
      comprovado: 'remoção comprovada',
      parcial: 'remoção comprovada em parte — ver itens não comprovados',
      'nao-comprovado': 'remoção NÃO comprovada',
      'nada-a-remover': 'nenhum campo das categorias selecionadas foi encontrado na origem',
      'nao-solicitado': 'nenhuma categoria de metadados selecionada para remoção',
    }[m.verdict];
    lines.push(`  Metadados: ${verdict}`);
    lines.push(`    removidos: ${m.removed.filter((x) => x.requested).length} · preservados: ${m.preserved.length} · não comprovados: ${m.unverified.length} · adicionados pelo formato: ${m.added.length}`);
    for (const u of m.unverified) lines.push(`    ! ${u.location} / ${u.key}: ${u.reason}`);
    if (report.warnings.length) {
      lines.push('  Avisos:');
      for (const w of report.warnings) lines.push(`    • ${w}`);
    }
  }
  lines.push('─'.repeat(72));
  lines.push('Valores de metadados sensíveis da origem foram omitidos destes relatórios.');
  return lines.join('\r\n') + '\r\n';
}

export class ExportService {
  /** Verificações já feitas (jobId → tamanho+mtime) para downloads repetidos. */
  private verified = new Map<string, string>();

  constructor(private ctx: AppContext) {}

  /**
   * Confirma que a saída existe, é legível e corresponde à tarefa concluída
   * (tamanho e SHA-256 registrados). `full` recalcula o hash.
   */
  async verifyOutput(job: JobRow, full: boolean): Promise<{ path: string; size: number }> {
    if (job.status !== 'completed' || !job.output_file) throw new ExportError(`A tarefa "${job.label}" não está concluída.`);
    const p = this.ctx.storage.file(job.session_id, 'outputs', job.output_file);
    const st = await fsp.stat(p).catch(() => null);
    if (!st || !st.isFile()) throw new ExportError(`Arquivo de saída ausente: ${job.output_name}`);
    if (st.size !== job.output_size) throw new ExportError(`Arquivo de saída alterado (tamanho diferente): ${job.output_name}`);
    const key = `${st.size}:${st.mtimeMs}`;
    if (full && this.verified.get(job.id) !== key) {
      const { sha256 } = await hashAndScan(p);
      if (sha256 !== job.output_sha256) throw new ExportError(`Arquivo de saída alterado (SHA-256 diferente): ${job.output_name}`);
      this.verified.set(job.id, key);
    } else {
      const fh = await fsp.open(p, 'r');
      await fh.close();
    }
    return { path: p, size: st.size };
  }

  async prepare(sessionId: string, jobIds: string[] | null) {
    const { repos } = this.ctx;
    const jobs = (jobIds ? repos.jobsByIds(sessionId, jobIds) : repos.jobs(sessionId)).filter((j) => j.status === 'completed');
    if (jobIds && jobs.length !== new Set(jobIds).size) {
      throw new ExportError('Alguns itens selecionados não estão concluídos ou não pertencem a esta sessão.');
    }
    if (jobs.length === 0) throw new ExportError('Nenhum resultado concluído para exportar.');
    const problems: string[] = [];
    let total = 0;
    for (const j of jobs) {
      try {
        total += (await this.verifyOutput(j, true)).size;
      } catch (err) {
        problems.push((err as Error).message);
      }
    }
    if (problems.length) throw new ExportError('Verificação dos arquivos falhou; nada foi exportado.', problems);
    const id = newId();
    repos.insertExport({ id, session_id: sessionId, job_ids_json: JSON.stringify(jobs.map((j) => j.id)), created_at: Date.now() });
    this.ctx.history.add(sessionId, 'export', 'info', `Exportação ZIP preparada: ${jobs.length} arquivo(s), ${fmtBytes(total)}`);
    return { id, count: jobs.length, totalBytes: total, url: `/api/exports/${id}` };
  }

  /** Monta o ZIP em streaming (sem copiar os vídeos para outro lugar). */
  async stream(sessionId: string, exportId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const { repos } = this.ctx;
    const rec = repos.exportById(sessionId, exportId);
    if (!rec) throw new ExportError('Exportação não encontrada ou expirada.');
    const jobs = repos.jobsByIds(sessionId, JSON.parse(rec.job_ids_json) as string[]);
    const created = new Date();
    const stamp = created.toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const root = `mediaforge-${stamp}`;
    const zip = new yazl.ZipFile();
    const entries: Array<{ job: JobRow; report: JobReport | null; path: string }> = [];
    const used = new Set<string>();
    for (const job of jobs) {
      const { path: file } = await this.verifyOutput(job, false);
      const folder = job.output_kind === 'image' ? 'imagens' : 'videos';
      let name = job.output_name!;
      let n = 2;
      while (used.has(`${folder}/${name}`)) name = job.output_name!.replace(/(\.[^.]+)$/, `-${n++}$1`);
      used.add(`${folder}/${name}`);
      const zipPath = `${root}/${folder}/${name}`;
      zip.addReadStream(fs.createReadStream(file), zipPath, { compress: false, mtime: new Date(job.finished_at ?? Date.now()) });
      const report = parseJson<JobReport>(job.report_json);
      if (report) {
        zip.addBuffer(Buffer.from(JSON.stringify(maskReport(report), null, 2), 'utf8'), `${root}/relatorios/${name}.json`, { compress: true });
      }
      entries.push({ job, report, path: `${folder}/${name}` });
    }
    const manifest = entries.map((e) => ({
      arquivo: e.path,
      sha256: e.job.output_sha256,
      bytes: e.job.output_size,
      origem: e.report?.input.name ?? null,
      origemSha256: e.report?.input.sha256 ?? null,
      validacao: e.job.validation_status,
      metadados: e.report?.metadata.verdict ?? null,
      rotulo: e.job.label,
    }));
    zip.addBuffer(Buffer.from(JSON.stringify({ geradoEm: created.toISOString(), arquivos: manifest }, null, 2), 'utf8'), `${root}/relatorio.json`);
    zip.addBuffer(Buffer.from(summaryText(entries, created), 'utf8'), `${root}/RELATORIO.txt`);
    zip.addBuffer(
      Buffer.from(manifest.map((m) => `${m.sha256}  ${m.arquivo}`).join('\n') + '\n', 'utf8'),
      `${root}/SHA256SUMS.txt`,
    );
    zip.end();
    this.ctx.history.add(sessionId, 'export', 'success', `ZIP baixado: ${entries.length} arquivo(s)`);
    return { stream: zip.outputStream, filename: `${root}.zip` };
  }
}
