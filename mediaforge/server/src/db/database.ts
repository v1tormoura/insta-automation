import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Carregado sob demanda: assim o filtro de avisos (silenceSqliteWarning) já
// está ativo quando o Node emite o ExperimentalWarning do node:sqlite.
const loadSqlite = () => createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/**
 * Migrações aplicadas em ordem. `PRAGMA user_version` guarda a última aplicada.
 * Nunca altere uma migração já publicada: acrescente uma nova.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT,
    ext TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    container TEXT,
    info_json TEXT,
    metadata_json TEXT,
    thumb_name TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_assets_session ON assets(session_id, created_at);
  CREATE INDEX idx_assets_hash ON assets(session_id, sha256);

  CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    mode TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_batches_session ON batches(session_id, created_at);

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    label TEXT NOT NULL,
    mode TEXT NOT NULL,
    profile_name TEXT,
    settings_json TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT,
    progress REAL NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    error TEXT,
    error_code TEXT,
    log_tail TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    duration_ms INTEGER,
    output_name TEXT,
    output_file TEXT,
    output_kind TEXT,
    output_size INTEGER,
    output_sha256 TEXT,
    output_thumb TEXT,
    output_info_json TEXT,
    report_json TEXT,
    validation_status TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status, seq);
  CREATE INDEX idx_jobs_session ON jobs(session_id, created_at);
  CREATE INDEX idx_jobs_batch ON jobs(batch_id);

  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_history_session ON history(session_id, id);

  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE exports (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    job_ids_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

export class Database {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const { DatabaseSync: Sqlite } = loadSqlite();
    this.raw = new Sqlite(file, { enableForeignKeyConstraints: true });
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    let version = Number(row.user_version);
    while (version < MIGRATIONS.length) {
      const sql = MIGRATIONS[version]!;
      this.tx(() => {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${version + 1}`);
      });
      version += 1;
    }
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  get<T>(sql: string, params: Record<string, unknown> | unknown[] = {}): T | undefined {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.get(...(params as never[])) : s.get(params as never)) as T | undefined;
  }

  all<T>(sql: string, params: Record<string, unknown> | unknown[] = {}): T[] {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.all(...(params as never[])) : s.all(params as never)) as T[];
  }

  run(sql: string, params: Record<string, unknown> | unknown[] = {}): { changes: number } {
    const s = this.stmt(sql);
    const r = Array.isArray(params) ? s.run(...(params as never[])) : s.run(params as never);
    return { changes: Number(r.changes) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}
