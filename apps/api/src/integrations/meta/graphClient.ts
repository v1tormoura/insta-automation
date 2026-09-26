import { logger } from '../../lib/logger.js';
import { MetaApiError, MetaNetworkError, type MetaErrorPayload } from './errors.js';

export type Params = Record<string, string | number | boolean | undefined | null>;

export interface GraphUsage {
  /** Maior percentual de uso informado nos headers (0–100). */
  maxPercent: number;
  /** Minutos até recuperar acesso, quando a Meta informa. */
  regainAccessMinutes?: number;
}

export interface GraphClientOptions {
  version: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onUsage?: (endpoint: string, usage: GraphUsage) => void;
}

/**
 * Cliente mínimo da Graph API do Instagram (graph.instagram.com).
 *
 * - GET leva o token na query, POST leva no corpo (form-urlencoded), como a
 *   documentação oficial; logs e erros passam por `redactText`.
 * - Erros HTTP viram MetaApiError já classificados; falhas de rede viram
 *   MetaNetworkError. Nenhum retry acontece aqui: quem decide é a fila.
 */
export class GraphClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GraphClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://graph.instagram.com').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  url(path: string, versioned = true): string {
    const clean = path.replace(/^\//, '');
    return versioned ? `${this.baseUrl}/${this.opts.version}/${clean}` : `${this.baseUrl}/${clean}`;
  }

  async get<T>(path: string, params: Params, token: string | null, opts: { versioned?: boolean } = {}): Promise<T> {
    const url = new URL(this.url(path, opts.versioned ?? true));
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (token) url.searchParams.set('access_token', token);
    return this.request<T>(url.toString(), { method: 'GET' }, path);
  }

  async post<T>(path: string, params: Params, token: string | null, opts: { versioned?: boolean } = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, String(v));
    if (token) body.set('access_token', token);
    return this.request<T>(this.url(path, opts.versioned ?? true), { method: 'POST', body }, path);
  }

  /** Requisição para um host absoluto (ex.: api.instagram.com na troca do code). */
  async rawPost(url: string, form: Params): Promise<string> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) body.set(k, String(v));
    const res = await this.fetchWithTimeout(url, { method: 'POST', body }, url);
    const text = await res.text();
    if (!res.ok) throw new MetaApiError(res.status, parseErrorPayload(text), new URL(url).pathname);
    return text;
  }

  private async request<T>(url: string, init: RequestInit, endpoint: string): Promise<T> {
    const res = await this.fetchWithTimeout(url, init, endpoint);
    const usage = parseUsage(res.headers);
    if (usage && this.opts.onUsage) this.opts.onUsage(endpoint, usage);
    const text = await res.text();
    if (!res.ok) {
      const retryAfter = usage?.regainAccessMinutes ? usage.regainAccessMinutes * 60_000 : retryAfterHeader(res.headers);
      throw new MetaApiError(res.status, parseErrorPayload(text), endpoint, retryAfter);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MetaApiError(502, { message: 'Resposta inválida da Meta' }, endpoint);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, endpoint: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      logger.warn({ endpoint, err }, 'meta: falha de rede');
      throw new MetaNetworkError(endpoint, err);
    }
  }
}

function parseErrorPayload(text: string): MetaErrorPayload | undefined {
  try {
    const json = JSON.parse(text) as { error?: MetaErrorPayload; error_message?: string; code?: number; error_type?: string };
    if (json.error) return json.error;
    // Endpoints de OAuth do Instagram às vezes respondem num formato plano.
    if (json.error_message) return { message: json.error_message, code: json.code, type: json.error_type };
  } catch {
    /* corpo não-JSON */
  }
  return text ? { message: text.slice(0, 300) } : undefined;
}

function retryAfterHeader(headers: Headers): number | undefined {
  const v = headers.get('retry-after');
  const s = v ? Number(v) : NaN;
  return Number.isFinite(s) ? s * 1000 : undefined;
}

export function parseUsage(headers: Headers): GraphUsage | undefined {
  let maxPercent = 0;
  let regain: number | undefined;
  let seen = false;
  const consider = (entry: Record<string, unknown>) => {
    seen = true;
    for (const key of ['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct']) {
      const n = Number(entry[key]);
      if (Number.isFinite(n)) maxPercent = Math.max(maxPercent, n);
    }
    const eta = Number(entry.estimated_time_to_regain_access);
    if (Number.isFinite(eta) && eta > 0) regain = Math.max(regain ?? 0, eta);
  };
  for (const name of ['x-app-usage', 'x-ad-account-usage']) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      consider(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      /* ignora header malformado */
    }
  }
  const buc = headers.get('x-business-use-case-usage');
  if (buc) {
    try {
      for (const entries of Object.values(JSON.parse(buc) as Record<string, Record<string, unknown>[]>)) {
        for (const e of entries) consider(e);
      }
    } catch {
      /* ignora */
    }
  }
  return seen ? { maxPercent, regainAccessMinutes: regain } : undefined;
}
