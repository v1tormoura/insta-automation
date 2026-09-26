import { GraphClient } from '../../src/integrations/meta/graphClient.js';

export interface FakeCall {
  method: string;
  path: string;
  params: Record<string, string>;
}

type Handler = (call: FakeCall) => { status?: number; body: unknown } | undefined;

/**
 * Servidor falso da Graph API: responde por (método, caminho). Cada handler
 * pode devolver `undefined` para cair no próximo. Guarda todas as chamadas
 * para as asserções (sem nunca tocar a rede).
 */
export class FakeMeta {
  readonly calls: FakeCall[] = [];
  private handlers: { method: string; match: RegExp; fn: Handler }[] = [];

  on(method: string, match: RegExp, fn: Handler): this {
    this.handlers.unshift({ method, match, fn });
    return this;
  }

  reply(method: string, match: RegExp, body: unknown, status = 200): this {
    return this.on(method, match, () => ({ status, body }));
  }

  count(method: string, match: RegExp): number {
    return this.calls.filter((c) => c.method === method && match.test(c.path)).length;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const params: Record<string, string> = Object.fromEntries(url.searchParams);
    if (init?.body instanceof URLSearchParams) Object.assign(params, Object.fromEntries(init.body));
    const call = { method, path: `${url.host}${url.pathname}`, params };
    this.calls.push(call);
    for (const h of this.handlers) {
      if (h.method !== method || !h.match.test(call.path)) continue;
      const res = h.fn(call);
      if (res) return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { message: `sem handler para ${method} ${call.path}`, code: 100 } }), { status: 400 });
  };

  client(): GraphClient {
    return new GraphClient({ version: 'v25.0', fetchImpl: this.fetch, timeoutMs: 2_000 });
  }
}

export const metaError = (code: number, subcode?: number, message = 'erro') => ({
  error: { message, type: 'OAuthException', code, error_subcode: subcode, fbtrace_id: 'trace' },
});
