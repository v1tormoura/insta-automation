import { openAsBlob } from 'node:fs';
import path from 'node:path';
import type { AssetDTO, JobDTO, JobReport } from '@mediaforge/shared';

export interface UploadResult {
  results: Array<{ name: string; ok: boolean; asset?: AssetDTO; error?: string }>;
}

export type JobDetail = JobDTO & { report: JobReport | null; logTail: string | null };

const TERMINAL = new Set(['completed', 'failed', 'canceled']);

/**
 * Cliente HTTP de teste com "pote de cookies" próprio: cada instância é uma
 * sessão diferente do MediaForge (útil para testar isolamento).
 */
export class Client {
  cookie = '';

  constructor(readonly base: string) {}

  async raw(method: string, url: string, init: { body?: RequestInit['body']; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.base + url, { method, body: init.body, headers, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0]!;
      if (pair.startsWith('mf_session=')) this.cookie = pair;
    }
    return res;
  }

  async json<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const res = await this.raw(method, url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  get<T = any>(url: string) {
    return this.json<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.json<T>('POST', url, body ?? {});
  }

  /** Envia arquivos reais via multipart (como o navegador faz). */
  async upload(files: Array<{ path: string; name?: string }>): Promise<{ status: number; data: UploadResult }> {
    const form = new FormData();
    for (const f of files) form.append('files', await openAsBlob(f.path), f.name ?? path.basename(f.path));
    const res = await this.raw('POST', '/api/assets', { body: form });
    return { status: res.status, data: (await res.json()) as UploadResult };
  }

  /** Importa e devolve os DTOs na ordem enviada (falha o teste se algum for recusado). */
  async importOk(...files: Array<string | { path: string; name?: string }>): Promise<AssetDTO[]> {
    const list = files.map((f) => (typeof f === 'string' ? { path: f } : f));
    const { status, data } = await this.upload(list);
    if (status !== 200) throw new Error(`upload HTTP ${status}: ${JSON.stringify(data)}`);
    const bad = data.results.filter((r) => !r.ok);
    if (bad.length) throw new Error(`importação recusada: ${JSON.stringify(bad)}`);
    return data.results.map((r) => r.asset!);
  }

  /** Cria um lote e devolve os ids das tarefas. */
  async batch(assetIds: string[], settings: unknown, extra: Record<string, unknown> = {}): Promise<string[]> {
    const { status, data } = await this.post('/api/batches', { assetIds, scope: 'common', settings, ...extra });
    if (status !== 201) throw new Error(`batch HTTP ${status}: ${JSON.stringify(data)}`);
    return (data.jobs as JobDTO[]).map((j) => j.id);
  }

  async job(id: string): Promise<JobDetail> {
    return (await this.get<JobDetail>(`/api/jobs/${id}`)).data;
  }

  /** Aguarda as tarefas chegarem a um estado final. */
  async waitJobs(ids: string[], timeoutMs = 120_000): Promise<JobDetail[]> {
    const start = Date.now();
    while (true) {
      const jobs = await Promise.all(ids.map((id) => this.job(id)));
      if (jobs.every((j) => TERMINAL.has(j.status))) return jobs;
      if (Date.now() - start > timeoutMs) throw new Error(`tarefas não terminaram: ${jobs.map((j) => `${j.id}=${j.status}`).join(', ')}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** Processa e exige conclusão com validação aprovada; devolve o detalhe. */
  async processOk(assetId: string, settings: unknown, extra: Record<string, unknown> = {}): Promise<JobDetail[]> {
    const ids = await this.batch([assetId], settings, extra);
    const jobs = await this.waitJobs(ids);
    for (const j of jobs) {
      if (j.status !== 'completed') throw new Error(`tarefa ${j.label} terminou como ${j.status}: ${j.error}\n${j.logTail ?? ''}`);
    }
    return jobs;
  }

  async download(url: string): Promise<{ status: number; body: Buffer; headers: Headers }> {
    const res = await this.raw('GET', url);
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
}
