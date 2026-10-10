import type { AssetKind, AssetStatus, JobPhase, JobStatus, ProcessingMode, ValidationStatus } from '@mediaforge/shared';
import type { Database } from './database';

export interface SessionRow {
  id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
}

export interface AssetRow {
  id: string;
  session_id: string;
  kind: AssetKind;
  original_name: string;
  stored_name: string | null;
  ext: string;
  size: number;
  sha256: string;
  container: string | null;
  info_json: string | null;
  metadata_json: string | null;
  thumb_name: string | null;
  status: AssetStatus;
  error: string | null;
  created_at: number;
}

export interface BatchRow {
  id: string;
  session_id: string;
  label: string;
  mode: ProcessingMode;
  scope: 'common' | 'individual';
  created_at: number;
}

export interface JobRow {
  id: string;
  session_id: string;
  batch_id: string;
  asset_id: string;
  label: string;
  mode: ProcessingMode;
  profile_name: string | null;
  settings_json: string;
  status: JobStatus;
  phase: JobPhase | null;
  progress: number;
  attempts: number;
  max_attempts: number;
  seq: number;
  error: string | null;
  error_code: string | null;
  log_tail: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  output_name: string | null;
  output_file: string | null;
  output_kind: AssetKind | null;
  output_size: number | null;
  output_sha256: string | null;
  output_thumb: string | null;
  output_info_json: string | null;
  report_json: string | null;
  validation_status: ValidationStatus | null;
}

export interface ProfileRow {
  id: string;
  name: string;
  mode: ProcessingMode;
  settings_json: string;
  created_at: number;
  updated_at: number;
}

export interface HistoryRow {
  id: number;
  session_id: string;
  type: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  created_at: number;
}

export class Repositories {
  constructor(readonly db: Database) {}

  // ── Sessões ──────────────────────────────────────────────────────────────
  sessionByTokenHash(hash: string) {
    return this.db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
  }
  sessionById(id: string) {
    return this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
  }
  insertSession(row: SessionRow) {
    this.db.run(
      'INSERT INTO sessions (id, token_hash, created_at, last_seen_at) VALUES (:id, :token_hash, :created_at, :last_seen_at)',
      { ...row },
    );
  }
  touchSession(id: string, now: number) {
    this.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, id]);
  }
  expiredSessions(before: number) {
    return this.db.all<SessionRow>('SELECT * FROM sessions WHERE last_seen_at < ?', [before]);
  }
  allSessions() {
    return this.db.all<SessionRow>('SELECT * FROM sessions');
  }
  deleteSession(id: string) {
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
  }

  // ── Arquivos importados ──────────────────────────────────────────────────
  insertAsset(row: AssetRow) {
    this.db.run(
      `INSERT INTO assets (id, session_id, kind, original_name, stored_name, ext, size, sha256, container,
        info_json, metadata_json, thumb_name, status, error, created_at)
       VALUES (:id, :session_id, :kind, :original_name, :stored_name, :ext, :size, :sha256, :container,
        :info_json, :metadata_json, :thumb_name, :status, :error, :created_at)`,
      { ...row },
    );
  }
  asset(sessionId: string, id: string) {
    return this.db.get<AssetRow>('SELECT * FROM assets WHERE id = ? AND session_id = ?', [id, sessionId]);
  }
  assetById(id: string) {
    return this.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
  }
  assets(sessionId: string) {
    return this.db.all<AssetRow>('SELECT * FROM assets WHERE session_id = ? ORDER BY created_at, id', [sessionId]);
  }
  countAssets(sessionId: string) {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE session_id = ?', [sessionId])?.n ?? 0);
  }
  assetsByHash(sessionId: string, sha256: string) {
    return this.db.all<AssetRow>(
      "SELECT * FROM assets WHERE session_id = ? AND sha256 = ? AND status = 'ready' ORDER BY created_at",
      [sessionId, sha256],
    );
  }
  deleteAsset(sessionId: string, id: string) {
    this.db.run('DELETE FROM assets WHERE id = ? AND session_id = ?', [id, sessionId]);
  }

  // ── Lotes ────────────────────────────────────────────────────────────────
  insertBatch(row: BatchRow) {
    this.db.run(
      'INSERT INTO batches (id, session_id, label, mode, scope, created_at) VALUES (:id, :session_id, :label, :mode, :scope, :created_at)',
      { ...row },
    );
  }
  batch(sessionId: string, id: string) {
    return this.db.get<BatchRow>('SELECT * FROM batches WHERE id = ? AND session_id = ?', [id, sessionId]);
  }
  batches(sessionId: string) {
    return this.db.all<BatchRow>('SELECT * FROM batches WHERE session_id = ? ORDER BY created_at DESC', [sessionId]);
  }
  batchCounts(batchId: string) {
    return this.db.all<{ status: JobStatus; n: number; p: number }>(
      'SELECT status, COUNT(*) AS n, SUM(progress) AS p FROM jobs WHERE batch_id = ? GROUP BY status',
      [batchId],
    );
  }
  deleteEmptyBatches(sessionId: string) {
    this.db.run('DELETE FROM batches WHERE session_id = ? AND id NOT IN (SELECT DISTINCT batch_id FROM jobs)', [sessionId]);
  }

  // ── Tarefas ──────────────────────────────────────────────────────────────
  nextSeq(): number {
    const r = this.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM jobs');
    return Number(r?.m ?? 0) + 1;
  }
  insertJob(row: JobRow) {
    const cols = Object.keys(row);
    this.db.run(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`, { ...row });
  }
  job(sessionId: string, id: string) {
    return this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ? AND session_id = ?', [id, sessionId]);
  }
  jobById(id: string) {
    return this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', [id]);
  }
  jobs(sessionId: string) {
    return this.db.all<JobRow>('SELECT * FROM jobs WHERE session_id = ? ORDER BY seq', [sessionId]);
  }
  jobsByBatch(batchId: string) {
    return this.db.all<JobRow>('SELECT * FROM jobs WHERE batch_id = ? ORDER BY seq', [batchId]);
  }
  jobsByIds(sessionId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const ph = ids.map(() => '?').join(',');
    return this.db.all<JobRow>(`SELECT * FROM jobs WHERE session_id = ? AND id IN (${ph}) ORDER BY seq`, [sessionId, ...ids]);
  }
  countJobs(sessionId: string) {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE session_id = ?', [sessionId])?.n ?? 0);
  }
  countJobsByStatus(status: JobStatus) {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE status = ?', [status])?.n ?? 0);
  }
  activeJobsForAsset(sessionId: string, assetId: string) {
    return this.db.all<JobRow>(
      "SELECT * FROM jobs WHERE session_id = ? AND status IN ('queued','running') AND (asset_id = ? OR settings_json LIKE ?)",
      [sessionId, assetId, `%"${assetId}"%`],
    );
  }
  completedJobsByOutputHash(sessionId: string, sha256: string) {
    return this.db.all<JobRow>(
      "SELECT * FROM jobs WHERE session_id = ? AND status = 'completed' AND output_sha256 = ?",
      [sessionId, sha256],
    );
  }
  /** Tenta mover a próxima tarefa da fila para "running" (atômico). */
  claimNextJob(now: number): JobRow | undefined {
    return this.db.tx(() => {
      const next = this.db.get<JobRow>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY seq LIMIT 1");
      if (!next) return undefined;
      const r = this.db.run(
        "UPDATE jobs SET status = 'running', phase = 'preparando', progress = 0, attempts = attempts + 1, started_at = ?, finished_at = NULL, duration_ms = NULL, error = NULL, error_code = NULL WHERE id = ? AND status = 'queued'",
        [now, next.id],
      );
      if (r.changes !== 1) return undefined;
      return this.jobById(next.id);
    });
  }
  updateJob(id: string, fields: Partial<JobRow>) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    this.db.run(`UPDATE jobs SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`, { ...fields, __id: id });
  }
  /** Atualiza só se o estado atual for um dos permitidos (evita corrida com cancelamento). */
  updateJobIfStatus(id: string, allowed: JobStatus[], fields: Partial<JobRow>): boolean {
    const keys = Object.keys(fields);
    const ph = allowed.map((_, i) => `:__s${i}`).join(',');
    const params: Record<string, unknown> = { ...fields, __id: id };
    allowed.forEach((s, i) => (params[`__s${i}`] = s));
    const r = this.db.run(
      `UPDATE jobs SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id AND status IN (${ph})`,
      params,
    );
    return r.changes === 1;
  }
  runningJobs() {
    return this.db.all<JobRow>("SELECT * FROM jobs WHERE status = 'running'");
  }
  deleteJob(sessionId: string, id: string) {
    this.db.run('DELETE FROM jobs WHERE id = ? AND session_id = ?', [id, sessionId]);
  }

  // ── Perfis salvos (globais da instalação) ────────────────────────────────
  profiles() {
    return this.db.all<ProfileRow>('SELECT * FROM profiles ORDER BY name COLLATE NOCASE');
  }
  profile(id: string) {
    return this.db.get<ProfileRow>('SELECT * FROM profiles WHERE id = ?', [id]);
  }
  profileByName(name: string) {
    return this.db.get<ProfileRow>('SELECT * FROM profiles WHERE name = ? COLLATE NOCASE', [name]);
  }
  upsertProfile(row: ProfileRow) {
    this.db.run(
      `INSERT INTO profiles (id, name, mode, settings_json, created_at, updated_at)
       VALUES (:id, :name, :mode, :settings_json, :created_at, :updated_at)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, mode = excluded.mode,
         settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
      { ...row },
    );
  }
  deleteProfile(id: string) {
    return this.db.run('DELETE FROM profiles WHERE id = ?', [id]).changes;
  }

  // ── Histórico ────────────────────────────────────────────────────────────
  insertHistory(row: Omit<HistoryRow, 'id'>): HistoryRow {
    this.db.run(
      'INSERT INTO history (session_id, type, level, message, created_at) VALUES (:session_id, :type, :level, :message, :created_at)',
      { ...row },
    );
    const id = Number(this.db.get<{ id: number }>('SELECT last_insert_rowid() AS id')?.id);
    return { ...row, id };
  }
  history(sessionId: string, limit = 300) {
    return this.db.all<HistoryRow>('SELECT * FROM history WHERE session_id = ? ORDER BY id DESC LIMIT ?', [sessionId, limit]);
  }

  // ── Configurações da aplicação ───────────────────────────────────────────
  setting(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key])?.value;
  }
  setSetting(key: string, value: string) {
    this.db.run(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // ── Exportações ZIP ──────────────────────────────────────────────────────
  insertExport(row: { id: string; session_id: string; job_ids_json: string; created_at: number }) {
    this.db.run(
      'INSERT INTO exports (id, session_id, job_ids_json, created_at) VALUES (:id, :session_id, :job_ids_json, :created_at)',
      { ...row },
    );
  }
  exportById(sessionId: string, id: string) {
    return this.db.get<{ id: string; session_id: string; job_ids_json: string; created_at: number }>(
      'SELECT * FROM exports WHERE id = ? AND session_id = ?',
      [id, sessionId],
    );
  }
  deleteOldExports(before: number) {
    this.db.run('DELETE FROM exports WHERE created_at < ?', [before]);
  }
}
