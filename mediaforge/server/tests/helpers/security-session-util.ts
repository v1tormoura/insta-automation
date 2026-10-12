import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

/**
 * Utilitários do teste de segurança e sessões. As requisições usam `node:http`
 * diretamente (e não `fetch`) para controlar exatamente o que vai na linha de
 * requisição e nos cabeçalhos: Host arbitrário, Origin, Sec-Fetch-Site, caminhos
 * sem normalização ("/api/assets/..") e endereço de origem (outro IP de loopback).
 */

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  /** Corpo como JSON (null quando não é JSON). */
  json: any;
  /** Par "mf_session=…" recebido em Set-Cookie (ou null). */
  sessionCookie: string | null;
  setCookie: string[];
}

export interface RawOptions {
  headers?: Record<string, string>;
  body?: Buffer | string;
  cookie?: string | null;
  /** Endereço local da conexão (ex.: 127.0.0.2 para simular outro IP). */
  localAddress?: string;
}

/** Requisição HTTP/1.1 "crua": o caminho é enviado sem normalização. */
export function rawRequest(base: string, method: string, pathAndQuery: string, opts: RawOptions = {}): Promise<RawResponse> {
  const u = new URL(base);
  const headers: Record<string, string> = { host: u.host, ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined && headers['content-length'] === undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: Number(u.port), method, path: pathAndQuery, headers, localAddress: opts.localAddress, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const text = body.toString('utf8');
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          const setCookie = res.headers['set-cookie'] ?? [];
          const pair = setCookie.map((c) => c.split(';')[0]!).find((p) => p.startsWith('mf_session=')) ?? null;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json, sessionCookie: pair, setCookie });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`tempo esgotado: ${method} ${pathAndQuery}`)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** Requisição HTTP/1.0 sem cabeçalho Host, escrita direto no socket. */
export function http10WithoutHost(base: string, pathAndQuery: string): Promise<{ status: number; text: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(u.port), u.hostname);
    const chunks: Buffer[] = [];
    sock.on('connect', () => sock.write(`GET ${pathAndQuery} HTTP/1.0\r\n\r\n`));
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', reject);
    sock.setTimeout(30_000, () => sock.destroy(new Error('tempo esgotado (HTTP/1.0)')));
    sock.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const m = text.match(/^HTTP\/1\.[01] (\d{3})/);
      resolve({ status: m ? Number(m[1]) : 0, text });
    });
  });
}

/**
 * Corpo multipart montado byte a byte: permite nomes de arquivo com bytes de
 * controle (no `filename="…"` cru) e com `filename*=UTF-8''…` (RFC 5987), que o
 * FormData do Node não gera.
 */
export function multipartBody(parts: Array<{ disposition: Buffer | string; data: Buffer }>): { body: Buffer; contentType: string } {
  const boundary = `----mf-seguranca-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disp = typeof p.disposition === 'string' ? Buffer.from(p.disposition, 'utf8') : p.disposition;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; `, 'latin1'));
    chunks.push(disp);
    chunks.push(Buffer.from('\r\nContent-Type: application/octet-stream\r\n\r\n', 'latin1'));
    chunks.push(p.data);
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Todos os arquivos (caminhos relativos, com "/") e diretórios de uma árvore. */
export function tree(dir: string): { files: Map<string, number>; dirs: Set<string> } {
  const files = new Map<string, number>();
  const dirs = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        dirs.add(rel);
        walk(p);
      } else files.set(rel, fs.lstatSync(p).size);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, dirs };
}

/** Indícios de vazamento de detalhes internos numa resposta de erro. */
export function leakProblems(text: string, secrets: string[]): string[] {
  const problems: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\n\s+at\s+\S+/, 'linha de stack trace'],
    [/\bat\s+(async\s+)?[\w.<>]+\s+\(/, 'quadro de stack trace'],
    [/\.(ts|js|mjs|cjs):\d+(:\d+)?/, 'arquivo-fonte com linha'],
    [/node_modules/, 'node_modules'],
    [/\/(home|tmp|root|Users|var)\//, 'caminho absoluto Unix'],
    [/[A-Za-z]:\\/, 'caminho absoluto Windows'],
    [/\bsessions[\\/]/, 'diretório de sessões'],
    [/SQLITE|sqlite/i, 'erro do banco'],
    [/\bE(NOENT|ACCES|PERM|ISDIR|NOTDIR)\b/, 'código de erro do sistema de arquivos'],
  ];
  for (const [re, what] of patterns) if (re.test(text)) problems.push(`${what}: ${text.match(re)![0]}`);
  for (const s of secrets) if (s && text.includes(s)) problems.push(`contém "${s}"`);
  return problems;
}
