import { spawn } from 'node:child_process';
import os from 'node:os';

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Prioridade (nice) aplicada ao processo filho. 0 = normal. */
  nice?: number;
  /** Guarda o stdout completo até este limite de bytes (para JSON do ffprobe). */
  collectStdoutBytes?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Quantas linhas finais de stderr manter para diagnóstico. */
  stderrTailLines?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stdoutTruncated: boolean;
  stderrTail: string[];
  timedOut: boolean;
  aborted: boolean;
  spawnError: NodeJS.ErrnoException | null;
  durationMs: number;
}

/**
 * Executa um binário com argumentos em array — nunca via shell, então nenhum
 * valor vindo do usuário é interpretado como comando. Suporta timeout,
 * cancelamento (AbortSignal) e leitura linha a linha de stdout/stderr.
 */
export function runProcess(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tailMax = opts.stderrTailLines ?? 40;
    const stderrTail: string[] = [];
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    if (opts.signal?.aborted) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stdoutTruncated: false,
        stderrTail: [],
        timedOut: false,
        aborted: true,
        spawnError: null,
        durationMs: 0,
      });
      return;
    }

    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (opts.nice && child.pid) {
      try {
        os.setPriority(child.pid, opts.nice);
      } catch {
        /* sem permissão para alterar prioridade: segue normalmente */
      }
    }

    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : null;

    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const lineReader = (cb?: (line: string) => void, keepTail?: boolean) => {
      let buf = '';
      return (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx: number;
        while ((idx = buf.search(/\r?\n|\r/)) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + (buf[idx] === '\r' && buf[idx + 1] === '\n' ? 2 : 1));
          if (line.length === 0) continue;
          cb?.(line);
          if (keepTail) {
            stderrTail.push(line.length > 500 ? line.slice(0, 500) + '…' : line);
            if (stderrTail.length > tailMax) stderrTail.shift();
          }
        }
        if (buf.length > 64 * 1024) buf = buf.slice(-64 * 1024);
      };
    };

    const stdoutLines = opts.onStdoutLine ? lineReader(opts.onStdoutLine) : null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (opts.collectStdoutBytes) {
        if (stdoutBytes + chunk.length <= opts.collectStdoutBytes) {
          stdoutChunks.push(chunk);
          stdoutBytes += chunk.length;
        } else {
          stdoutTruncated = true;
        }
      }
      stdoutLines?.(chunk);
    });
    child.stderr.on('data', lineReader(opts.onStderrLine, true));

    const finish = (result: Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        code: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stdoutTruncated,
        stderrTail,
        timedOut,
        aborted,
        spawnError: null,
        durationMs: Date.now() - started,
        ...result,
      });
    };

    child.on('error', (err: NodeJS.ErrnoException) => finish({ spawnError: err }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

/** Resume o motivo de falha de um processo em português. */
export function describeFailure(tool: string, r: RunResult): string {
  if (r.spawnError) {
    if (r.spawnError.code === 'ENOENT') return `${tool} não encontrado. Verifique a instalação e a variável de caminho.`;
    return `Falha ao iniciar ${tool}: ${r.spawnError.message}`;
  }
  if (r.aborted) return 'Processo cancelado.';
  if (r.timedOut) return `${tool} excedeu o tempo limite e foi encerrado.`;
  const last = r.stderrTail.slice(-3).join(' | ');
  return `${tool} terminou com código ${r.code ?? r.signal}${last ? `: ${last}` : ''}`;
}
