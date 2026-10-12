import fs from 'node:fs';
import path from 'node:path';
import type { ServerEvent } from '@mediaforge/shared';
import { sha256 } from './inspecaoMidia';

/**
 * Utilitários do teste de perfis, limpeza e eventos (cleanup-profiles.test.ts):
 * leitor do fluxo SSE real de /api/events (via fetch, com o cookie da sessão),
 * espera com prazo e instantâneo de uma árvore de arquivos com SHA-256.
 */

/** Repete `get` até `ok` aceitar o valor; falha com a última leitura quando o prazo vence. */
export async function waitFor<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, timeoutMs: number, what: string, stepMs = 40): Promise<T> {
  const start = Date.now();
  while (true) {
    const v = await get();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`prazo de ${timeoutMs} ms esgotado esperando ${what}; última leitura: ${JSON.stringify(v)?.slice(0, 800)}`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/**
 * Conexão SSE de verdade com /api/events. Guarda cada evento recebido na ordem
 * de chegada; `mark()` devolve a posição atual para filtrar só o que chegou
 * depois de uma ação.
 */
export class SseStream {
  readonly events: ServerEvent[] = [];
  /** Texto bruto recebido (inclui "retry:" e comentários de ping). */
  raw = '';
  status = 0;
  contentType = '';
  private ctrl = new AbortController();
  private done: Promise<void> = Promise.resolve();
  private ended = false;
  error: unknown = null;

  private constructor() {}

  static async open(base: string, cookie: string): Promise<SseStream> {
    if (!cookie) throw new Error('abra a sessão antes de conectar ao SSE (sem cookie, o servidor criaria outra sessão)');
    const s = new SseStream();
    const res = await fetch(`${base}/api/events`, { headers: { cookie, accept: 'text/event-stream' }, signal: s.ctrl.signal });
    s.status = res.status;
    s.contentType = res.headers.get('content-type') ?? '';
    if (!res.body) throw new Error('SSE sem corpo');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    s.done = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          s.raw += text;
          buf += text;
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = block
              .split('\n')
              .filter((l) => l.startsWith('data: '))
              .map((l) => l.slice(6))
              .join('\n');
            if (data) s.events.push(JSON.parse(data) as ServerEvent);
          }
        }
      } catch (err) {
        if (!s.ctrl.signal.aborted) s.error = err;
      } finally {
        s.ended = true;
      }
    })();
    return s;
  }

  get closed() {
    return this.ended;
  }

  mark(): number {
    return this.events.length;
  }

  since(mark: number): ServerEvent[] {
    return this.events.slice(mark);
  }

  /** Espera até `ok` aceitar os eventos chegados desde `mark`. */
  async until(mark: number, ok: (evs: ServerEvent[]) => boolean, timeoutMs: number, what: string): Promise<ServerEvent[]> {
    return waitFor(
      () => {
        if (this.error) throw this.error;
        return this.since(mark);
      },
      ok,
      timeoutMs,
      what,
      15,
    );
  }

  async close() {
    this.ctrl.abort();
    await this.done;
  }
}

/** Eventos sem o ruído de progresso (tarefas, fila e histórico). */
export const structural = (evs: ServerEvent[]) => evs.filter((e) => e.type === 'job-removed' || e.type === 'batch' || e.type === 'batch-removed');

/** Arquivos de uma árvore (caminho relativo → SHA-256 do conteúdo). */
export function treeHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join('/')] = sha256(fs.readFileSync(p));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
