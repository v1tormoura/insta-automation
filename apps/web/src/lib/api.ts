import type { ApiErrorBody, ErrorCode } from '@nexora/shared';

/**
 * Cliente HTTP do app. Mesma origem (cookie de sessão httpOnly), JSON por
 * padrão e o header `X-Nexora-Client` que a API exige nas escritas (CSRF).
 * O frontend nunca vê token da Meta: nenhuma resposta da API carrega um.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Mensagens por campo quando a API devolve erro de validação. */
  get fields(): { path: string; message: string }[] {
    const d = this.details as { fields?: { path: string; message: string }[] } | undefined;
    return d?.fields ?? [];
  }
}

type Json = Record<string, unknown> | unknown[];

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Json | FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

let onUnauthenticated: (() => void) | undefined;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { 'X-Nexora-Client': 'web', Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'INTERNAL_ERROR', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401 && onUnauthenticated && !path.startsWith('/auth/')) onUnauthenticated();
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? 'Erro inesperado.', err?.details);
  }
  return data as T;
}

/** Upload com progresso (fetch não expõe progresso de envio). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Nexora-Client', 'web');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText) as T & Partial<ApiErrorBody>;
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'INTERNAL_ERROR', data?.error?.message ?? 'Falha no upload.', data?.error?.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'INTERNAL_ERROR', 'Falha de rede no upload.'));
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Erro inesperado.';
}
