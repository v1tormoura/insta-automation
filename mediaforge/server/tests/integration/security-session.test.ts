import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetDetailDTO, AssetDTO, JobDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostAllowed } from '../../src/app';
import { loadConfig } from '../../src/config';
import { Client, type JobDetail } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { listFiles, sessionArea, sessionId, sha256 } from '../helpers/inspecaoMidia';
import { ffprobe, tmpFile } from '../helpers/media';
import { http10WithoutHost, leakProblems, multipartBody, rawRequest, tree, type RawOptions } from '../helpers/security-session-util';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Segurança e sessões contra uma instância real (Fastify + SQLite + FFmpeg):
 * cabeçalho Host, CSRF, chave de acesso, isolamento entre sessões, nomes de
 * arquivo hostis, limites de envio e de lote e identificadores inválidos.
 */

const fileSha = (p: string) => sha256(fs.readFileSync(p));
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Um id bem formado que nunca existiu (mesmo formato dos gerados pelo servidor). */
const FAKE_ID = 'zzzzzzzzzzzzzzzz';
const RESERVED_HEAD = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

let srv: TestServer;
let port: string;

const sessionsOf = (s: TestServer) => fs.readdirSync(path.join(s.dataDir, 'sessions')).sort();
const req = (method: string, p: string, opts: RawOptions = {}) => rawRequest(srv.base, method, p, opts);

beforeAll(async () => {
  srv = await startServer({ ALLOWED_HOSTS: ' mediaforge.lan , Estudio.Local ,, ' });
  port = new URL(srv.base).port;
});
afterAll(async () => srv?.close());

/** Confere o Content-Disposition (RFC 6266/5987): reserva ASCII inofensiva e nome UTF-8 exato. */
function expectSafeDisposition(header: string | null | undefined, type: 'inline' | 'attachment', expectedName: string) {
  expect(header, 'Content-Disposition ausente').toBeTruthy();
  const m = header!.match(/^(inline|attachment); filename="([^"]*)"; filename\*=UTF-8''([^;\s"]+)$/);
  expect(m, `Content-Disposition fora do formato: ${JSON.stringify(header)}`).not.toBeNull();
  expect(m![1]).toBe(type);
  const ascii = m![2]!;
  expect(ascii, 'reserva ASCII').toMatch(/^[\x20-\x7e]+$/);
  expect(ascii).not.toMatch(/["\\;/]/);
  expect(ascii).not.toMatch(/^\.|\.\./);
  // Somente attr-char e %XX (RFC 5987): nada de aspas, espaço, controle ou separador cru.
  expect(m![3]).toMatch(/^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/);
  expect(decodeURIComponent(m![3]!)).toBe(expectedName);
  expect(header).not.toMatch(CONTROL);
  expect(header).not.toMatch(BIDI);
}

/** Nome de exibição seguro: sem controles, bidi, separadores, ponto inicial ou nome reservado. */
function expectSafeName(name: string, label: string) {
  expect(name, label).toBeTruthy();
  expect(name, label).not.toMatch(CONTROL);
  expect(name, label).not.toMatch(BIDI);
  expect(name, label).not.toMatch(/[<>:"/\\|?*]/);
  expect(name.startsWith('.'), `${label}: começa com ponto`).toBe(false);
  expect(name, label).not.toMatch(/[. ]$/);
  expect(name.length, label).toBeLessThanOrEqual(180);
  expect(Buffer.byteLength(name, 'utf8'), label).toBeLessThanOrEqual(255);
  expect(() => encodeURIComponent(name), `${label}: substituto UTF-16 isolado`).not.toThrow();
  expect(name.split('.')[0]!.trim(), `${label}: nome reservado do Windows`).not.toMatch(RESERVED_HEAD);
}

// ─────────────────────────────────────────────────────────────────────────
describe('cabeçalho Host (proteção contra DNS rebinding)', () => {
  it('Host estranho → 403 "bad-host" em GET /api/health, GET /api/session e POST, sem criar sessão', async () => {
    const before = sessionsOf(srv);
    const png = fs.readFileSync(fx('logo.png'));
    const mp = multipartBody([{ disposition: 'filename="logo.png"', data: png }]);
    const hosts = [
      'evil.example',
      `evil.example:${port}`,
      'evil.example.',
      `localhost.evil.example:${port}`,
      `127.0.0.1.nip.io:${port}`,
      'mediaforge.lan.evil.example',
      `user@127.0.0.1:${port}`,
    ];
    for (const host of hosts) {
      const rs = [
        await req('GET', '/api/health', { headers: { host } }),
        await req('GET', '/api/session', { headers: { host } }),
        await req('POST', '/api/session', { headers: { host, 'content-type': 'application/json' }, body: '{}' }),
        await req('DELETE', '/api/session', { headers: { host } }),
        await req('POST', '/api/assets', { headers: { host, 'content-type': mp.contentType }, body: mp.body }),
      ];
      for (const r of rs) {
        expect(r.status, `Host ${host}`).toBe(403);
        expect(r.json?.error?.code, `Host ${host}: ${r.text}`).toBe('bad-host');
        expect(r.setCookie, `Host ${host} recebeu cookie`).toEqual([]);
      }
    }
    // Nenhuma sessão (nem diretório) foi criada pelas requisições recusadas.
    expect(sessionsOf(srv)).toEqual(before);
  });

  it('um cookie de sessão válido não contorna a verificação de Host', async () => {
    const ok = await req('GET', '/api/session');
    expect(ok.status).toBe(200);
    const cookie = ok.sessionCookie!;
    const r = await req('GET', '/api/assets', { cookie, headers: { host: `evil.example:${port}` } });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('bad-host');
  });

  it('requisição HTTP/1.0 sem cabeçalho Host → 403', async () => {
    const r = await http10WithoutHost(srv.base, '/api/health');
    expect(r.status).toBe(403);
    expect(r.text).toContain('"bad-host"');
  });

  it("'localhost:PORT', '127.0.0.1:PORT', '[::1]:PORT' e IPs literais de rede são aceitos", async () => {
    const hosts = [
      `localhost:${port}`,
      `LOCALHOST:${port}`,
      'localhost',
      `localhost.:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      `192.168.0.10:${port}`,
      '10.20.30.40',
      `[fd12:3456::7]:${port}`,
    ];
    for (const host of hosts) {
      const h = await req('GET', '/api/health', { headers: { host } });
      expect(h.status, `Host ${host}: ${h.text}`).toBe(200);
      expect(h.json).toEqual({ ok: true, ffmpeg: true, ffprobe: true });
      const s = await req('GET', '/api/session', { headers: { host } });
      expect(s.status, `Host ${host}`).toBe(200);
      expect(s.json.id).toMatch(ID_RE);
      expect(s.sessionCookie, `Host ${host}: sem cookie`).toBeTruthy();
      // POST no mesmo Host (sem Origin) também passa e reconhece a sessão do cookie.
      const p = await req('POST', '/api/session', { cookie: s.sessionCookie, headers: { host, 'content-type': 'application/json' }, body: '{}' });
      expect(p.status, `POST com Host ${host}: ${p.text}`).toBe(200);
      expect(p.json.id).toBe(s.json.id);
    }
  });

  it('nomes de ALLOWED_HOSTS são aceitos (maiúsculas, porta, ponto final); variações parecidas não', async () => {
    for (const host of [`mediaforge.lan:${port}`, 'MEDIAFORGE.LAN', 'mediaforge.lan.', `estudio.local:${port}`, 'Estudio.Local:8080']) {
      const r = await req('GET', '/api/health', { headers: { host } });
      expect(r.status, `Host ${host}: ${r.text}`).toBe(200);
      const p = await req('POST', '/api/session', { headers: { host, 'content-type': 'application/json' }, body: '{}' });
      expect(p.status, `POST com Host ${host}`).toBe(200);
    }
    for (const host of ['sub.mediaforge.lan', 'evilmediaforge.lan', 'mediaforge.lan.evil.example', 'estudio.local.evil.example', 'mediaforge', 'outro.lan']) {
      const r = await req('GET', '/api/health', { headers: { host } });
      expect(r.status, `Host ${host}`).toBe(403);
      expect(r.json.error.code).toBe('bad-host');
    }
  });

  it('hostAllowed(): userinfo, caminho, consulta, vazio, ponto final, tamanho e porta inválida', () => {
    const cfg = { host: '127.0.0.1', allowedHosts: ['mediaforge.lan'] };
    const allowed = [
      'localhost',
      'localhost:5310',
      'LocalHost',
      'localhost.',
      'LocalHost.:5310',
      '127.0.0.1:5310',
      '[::1]:5310',
      '[::1]',
      '192.168.1.50:5310',
      '10.0.0.7',
      'mediaforge.lan',
      'MEDIAFORGE.LAN:8443',
      'mediaforge.lan.:5310',
    ];
    const refused: Array<string | undefined> = [
      undefined,
      '',
      'evil.example',
      'evil.example.',
      'evil.example:5310',
      'user@localhost',
      'user:senha@localhost:5310',
      'evil.example@127.0.0.1',
      'localhost@evil.example',
      'localhost/admin',
      'localhost:5310/x',
      '127.0.0.1/../../etc',
      'localhost?x=1',
      'localhost#frag',
      'localhost\\x',
      'localhost.evil.example',
      '127.0.0.1.evil.example',
      'sub.mediaforge.lan',
      '[::1',
      'localhost:99999',
      ' localhost',
      // Seria um IP de loopback válido, mas o cabeçalho passa de 300 caracteres.
      `127.0.0.1:${'0'.repeat(300)}1`,
      'x'.repeat(301),
    ];
    for (const h of allowed) expect(hostAllowed(cfg, h), `deveria aceitar ${JSON.stringify(h)}`).toBe(true);
    for (const h of refused) expect(hostAllowed(cfg, h), `deveria recusar ${JSON.stringify(h)}`).toBe(false);
    // O HOST configurado também vale (com porta, maiúsculas e ponto final), mas só ele.
    const named = { host: 'Meu-PC', allowedHosts: [] };
    for (const h of ['meu-pc', 'MEU-PC:5310', 'meu-pc.']) expect(hostAllowed(named, h), h).toBe(true);
    for (const h of ['outro-pc', 'meu-pc.evil.example', 'meu-pcx']) expect(hostAllowed(named, h), h).toBe(false);
  });

  it('ALLOWED_HOSTS é normalizado pelo loadConfig (espaços, maiúsculas, colchetes e itens vazios)', () => {
    const cfg = loadConfig({ DATA_DIR: srv.dataDir, HOST: '127.0.0.1', ALLOWED_HOSTS: ' Estudio.LAN , [fd00::1] ,, midia.casa ' });
    expect(cfg.allowedHosts).toEqual(['estudio.lan', 'fd00::1', 'midia.casa']);
    expect(hostAllowed(cfg, 'ESTUDIO.lan:8080')).toBe(true);
    expect(hostAllowed(cfg, 'midia.casa')).toBe(true);
    expect(hostAllowed(cfg, 'casa')).toBe(false);
    expect(loadConfig({ DATA_DIR: srv.dataDir, HOST: '127.0.0.1', ALLOWED_HOSTS: '' }).allowedHosts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('requisições de outros sites (CSRF)', () => {
  let c: Client;
  let sid: string;
  let asset: AssetDTO;
  const origin = () => `http://127.0.0.1:${port}`;
  const concurrency = async () => (await c.get('/api/system')).data.queue.concurrency as number;
  const webp = () => multipartBody([{ disposition: 'filename="outra.webp"', data: fs.readFileSync(fx('image.webp')) }]);

  /** Estado observável da sessão: id, arquivos listados, tarefas e bytes no disco. */
  async function state() {
    const s = (await c.get('/api/session')).data;
    const assets = (await c.get<AssetDTO[]>('/api/assets')).data.map((a) => a.id).sort();
    const jobs = (await c.get<JobDTO[]>('/api/jobs')).data.length;
    const disk = [...tree(path.join(srv.dataDir, 'sessions', sid)).files.entries()].sort();
    return { id: s.id, assets, jobs, disk, sessions: sessionsOf(srv), concurrency: await concurrency() };
  }

  /** Requisições que mudam estado, todas com o cookie da sessão. */
  const mutations = (extra: Record<string, string>) => {
    const mp = webp();
    return [
      () => req('POST', '/api/session', { cookie: c.cookie, headers: { ...extra, 'content-type': 'application/json' }, body: '{}' }),
      () => req('DELETE', '/api/session', { cookie: c.cookie, headers: extra }),
      () => req('PUT', '/api/system/concurrency', { cookie: c.cookie, headers: { ...extra, 'content-type': 'application/json' }, body: '{"value":1}' }),
      () => req('POST', '/api/assets', { cookie: c.cookie, headers: { ...extra, 'content-type': mp.contentType }, body: mp.body }),
      () => req('DELETE', `/api/assets/${asset.id}`, { cookie: c.cookie, headers: extra }),
      () =>
        req('POST', '/api/batches', {
          cookie: c.cookie,
          headers: { ...extra, 'content-type': 'application/json' },
          body: JSON.stringify({ assetIds: [asset.id], scope: 'common', settings: { mode: 'quick' } }),
        }),
    ];
  };

  beforeAll(async () => {
    c = new Client(srv.base);
    [asset] = (await c.importOk({ path: fx('logo.png'), name: 'logo-csrf.png' })) as [AssetDTO];
    sid = await sessionId(c);
  });

  it('POST/PUT/DELETE com Origin de outro host → 403 "bad-origin" e nada muda', async () => {
    const before = await state();
    expect(before.assets).toEqual([asset.id]);
    expect(before.concurrency).toBe(2);
    const origins = ['http://evil.example', 'https://evil.example', `http://127.0.0.1:${Number(port) + 1}`, `http://localhost:${port}`, 'null'];
    for (const o of origins) {
      for (const call of mutations({ origin: o })) {
        const r = await call();
        expect(r.status, `Origin ${o}: ${r.text}`).toBe(403);
        expect(r.json.error.code).toBe('bad-origin');
        expect(r.setCookie).toEqual([]);
        if (o === 'null') expect(r.json.error.message).toBe('Origem da requisição inválida.');
      }
    }
    expect(await state()).toEqual(before);
  });

  it('Sec-Fetch-Site: cross-site → 403 mesmo sem Origin; same-origin, same-site e none passam', async () => {
    const before = await state();
    for (const call of mutations({ 'sec-fetch-site': 'cross-site' })) {
      const r = await call();
      expect(r.status, r.text).toBe(403);
      expect(r.json.error.code).toBe('bad-origin');
    }
    // Cross-site com um Origin "correto" também é recusado (o cabeçalho do navegador manda).
    const both = await req('POST', '/api/session', {
      cookie: c.cookie,
      headers: { origin: origin(), 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(both.status).toBe(403);
    expect(await state()).toEqual(before);
    for (const site of ['same-origin', 'same-site', 'none']) {
      const r = await req('POST', '/api/session', { cookie: c.cookie, headers: { 'sec-fetch-site': site, 'content-type': 'application/json' }, body: '{}' });
      expect(r.status, `${site}: ${r.text}`).toBe(200);
      expect(r.json.id).toBe(sid);
    }
  });

  it('mesma origem → aceita (sessão, envio, plano, ajuste) e nenhuma resposta traz cabeçalhos CORS', async () => {
    const same = { origin: origin(), 'sec-fetch-site': 'same-origin' };
    const s = await req('POST', '/api/session', { cookie: c.cookie, headers: { ...same, 'content-type': 'application/json' }, body: '{}' });
    expect(s.status).toBe(200);
    expect(s.json.id).toBe(sid);

    const put = await req('PUT', '/api/system/concurrency', { cookie: c.cookie, headers: { ...same, 'content-type': 'application/json' }, body: '{"value":3}' });
    expect(put.status, put.text).toBe(200);
    expect(put.json.concurrency).toBe(3);
    expect(await concurrency()).toBe(3);
    const back = await req('PUT', '/api/system/concurrency', { cookie: c.cookie, headers: { ...same, 'content-type': 'application/json' }, body: '{"value":2}' });
    expect(back.json.concurrency).toBe(2);

    const mp = webp();
    const up = await req('POST', '/api/assets', { cookie: c.cookie, headers: { ...same, 'content-type': mp.contentType }, body: mp.body });
    expect(up.status, up.text).toBe(200);
    const added = up.json.results[0];
    expect(added.ok).toBe(true);
    expect(added.asset.sha256).toBe(fileSha(fx('image.webp')));
    expect(fileSha(path.join(sessionArea(srv.dataDir, sid, 'uploads'), `${added.asset.id}.webp`))).toBe(fileSha(fx('image.webp')));

    const plan = await req('POST', '/api/plan', {
      cookie: c.cookie,
      headers: { ...same, 'content-type': 'application/json' },
      body: JSON.stringify({ assetIds: [asset.id], scope: 'common', settings: { mode: 'quick' } }),
    });
    expect(plan.status).toBe(200);
    expect(plan.json.ok).toBe(true);

    // Leitura com Origin de outro site: a resposta não autoriza o outro site a lê-la.
    const read = await req('GET', '/api/assets', { cookie: c.cookie, headers: { origin: 'http://evil.example' } });
    expect(read.status).toBe(200);
    const pre = await req('OPTIONS', '/api/assets', {
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    for (const r of [s, put, up, plan, read, pre]) {
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    }
    expect(pre.status).toBeGreaterThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('chave de acesso (ACCESS_KEY)', () => {
  const KEY = 'chave-de-teste-0123456789-abcdef';
  const login = (s: TestServer, accessKey: unknown, opts: RawOptions = {}) =>
    rawRequest(s.base, 'POST', '/api/session', {
      ...opts,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(accessKey === undefined ? {} : { accessKey }),
    });

  it('loadConfig recusa chave com menos de 16 caracteres', () => {
    for (const k of ['curta', '123456789012345', 'a'.repeat(15)]) {
      expect(() => loadConfig({ DATA_DIR: srv.dataDir, ACCESS_KEY: k }), k).toThrow(/Configuração inválida: ACCESS_KEY: use pelo menos 16 caracteres/);
    }
    expect(loadConfig({ DATA_DIR: srv.dataDir, ACCESS_KEY: 'a'.repeat(16) }).accessKey).toBe('a'.repeat(16));
    expect(loadConfig({ DATA_DIR: srv.dataDir, ACCESS_KEY: KEY }).accessKey).toBe(KEY);
    expect(() => loadConfig({ DATA_DIR: srv.dataDir, ACCESS_KEY: 'k'.repeat(501) })).toThrow(/ACCESS_KEY/);
  });

  describe('com chave configurada', () => {
    let keyed: TestServer;
    beforeAll(async () => {
      keyed = await startServer({ ACCESS_KEY: KEY });
    });
    afterAll(async () => keyed?.close());
    const k = (method: string, p: string, opts: RawOptions = {}) => rawRequest(keyed.base, method, p, opts);

    it('sem sessão: rotas protegidas → 401 "auth-required", sem cookie e sem diretório de sessão', async () => {
      const mp = multipartBody([{ disposition: 'filename="logo.png"', data: fs.readFileSync(fx('logo.png')) }]);
      const json = { 'content-type': 'application/json' };
      const calls: Array<[string, string, RawOptions]> = [
        ['GET', '/api/session', {}],
        ['GET', '/api/assets', {}],
        ['GET', '/api/jobs', {}],
        ['GET', '/api/batches', {}],
        ['GET', '/api/history', {}],
        ['GET', '/api/system', {}],
        ['GET', '/api/events', {}],
        ['GET', `/api/assets/${FAKE_ID}/file`, {}],
        ['GET', `/api/jobs/${FAKE_ID}/download`, {}],
        ['POST', '/api/assets', { headers: { 'content-type': mp.contentType }, body: mp.body }],
        ['POST', '/api/plan', { headers: json, body: JSON.stringify({ assetIds: [FAKE_ID], settings: { mode: 'quick' } }) }],
        ['POST', '/api/batches', { headers: json, body: JSON.stringify({ assetIds: [FAKE_ID], settings: { mode: 'quick' } }) }],
        ['POST', '/api/exports', { headers: json, body: '{}' }],
        ['PUT', '/api/system/concurrency', { headers: json, body: '{"value":1}' }],
        // Cookie inventado não é sessão.
        ['GET', '/api/assets', { cookie: `mf_session=${'x'.repeat(43)}` }],
      ];
      for (const [m, p, o] of calls) {
        const r = await k(m, p, o);
        expect(r.status, `${m} ${p}: ${r.text}`).toBe(401);
        expect(r.json.error.code).toBe('auth-required');
        expect(r.setCookie, `${m} ${p}`).toEqual([]);
      }
      expect(sessionsOf(keyed)).toEqual([]);
      expect(listFiles(path.join(keyed.dataDir, 'sessions'))).toEqual([]);
      // Rotas sem dados de sessão continuam públicas.
      const h = await k('GET', '/api/health');
      expect(h.status).toBe(200);
      expect(h.json.ok).toBe(true);
      expect((await k('GET', '/api/presets')).status).toBe(200);
    });

    it('chave errada → 401 "auth-failed" sem cookie; chave certa → cookie HttpOnly + SameSite=Strict que abre as rotas', async () => {
      for (const wrong of [KEY.slice(0, -1) + 'X', KEY.toUpperCase(), KEY + ' ', '', undefined]) {
        const r = await login(keyed, wrong);
        expect(r.status, `chave ${JSON.stringify(wrong)}`).toBe(401);
        expect(r.json.error.code).toBe('auth-failed');
        expect(r.setCookie).toEqual([]);
      }
      expect(sessionsOf(keyed)).toEqual([]);

      const ok = await login(keyed, KEY);
      expect(ok.status, ok.text).toBe(200);
      expect(ok.json.requiresAccessKey).toBe(true);
      expect(ok.json.id).toMatch(ID_RE);
      expect(ok.setCookie).toHaveLength(1);
      const [pair, ...attrs] = ok.setCookie[0]!.split(';').map((s) => s.trim());
      const token = pair!.match(/^mf_session=([A-Za-z0-9_-]{43})$/)?.[1];
      expect(token, `cookie: ${ok.setCookie[0]}`).toBeTruthy();
      const lower = attrs.map((a) => a.toLowerCase());
      expect(lower).toContain('httponly');
      expect(lower).toContain('samesite=strict');
      expect(lower).toContain('path=/');
      expect(lower).toContain(`max-age=${72 * 3600 * 4}`);
      expect(lower).not.toContain('secure'); // COOKIE_SECURE=false (http em localhost)
      expect(lower.some((a) => a.startsWith('domain='))).toBe(false);

      const cookie = ok.sessionCookie!;
      const s = await k('GET', '/api/session', { cookie });
      expect(s.status).toBe(200);
      expect(s.json.id).toBe(ok.json.id);
      expect(sessionsOf(keyed)).toEqual([ok.json.id]);
      const c = new Client(keyed.base);
      c.cookie = cookie;
      const [a] = await c.importOk(fx('logo.png'));
      expect(a!.sha256).toBe(fileSha(fx('logo.png')));
      expect(fileSha(path.join(sessionArea(keyed.dataDir, ok.json.id, 'uploads'), `${a!.id}.png`))).toBe(fileSha(fx('logo.png')));

      // O banco guarda só o hash do token, nunca o token.
      const dbBytes = Buffer.concat(
        ['mediaforge.db', 'mediaforge.db-wal'].map((f) => path.join(keyed.dataDir, f)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f)),
      );
      expect(dbBytes.includes(Buffer.from(token!, 'latin1')), 'token em texto puro no banco').toBe(false);
      expect(dbBytes.includes(Buffer.from(sha256(Buffer.from(token!, 'utf8')), 'latin1')), 'hash do token no banco').toBe(true);
    });
  });

  describe('limite de tentativas por IP', () => {
    let lk: TestServer;
    beforeAll(async () => {
      lk = await startServer({ ACCESS_KEY: KEY });
    });
    afterAll(async () => lk?.close());

    it('chave certa antes do bloqueio funciona e zera a contagem; após 10 erros → 429 com Retry-After, inclusive com a chave certa', async () => {
      for (let i = 1; i <= 9; i++) {
        const r = await login(lk, `errada-${i}-0123456789abcdef`);
        expect(r.status, `tentativa ${i}`).toBe(401);
        expect(r.json.error.code).toBe('auth-failed');
      }
      const ok = await login(lk, KEY);
      expect(ok.status, 'chave certa após 9 erros').toBe(200);
      expect(ok.sessionCookie).toBeTruthy();

      // A contagem recomeçou: mais 10 erros ainda são 401 (sem a zeragem, o 2º já seria 429).
      for (let i = 1; i <= 10; i++) {
        const r = await login(lk, `errada-b${i}-0123456789abcdef`);
        expect(r.status, `tentativa ${i} depois da zeragem: ${r.text}`).toBe(401);
      }
      const t0 = Date.now();
      for (const attempt of ['mais-uma-errada-0123456789', KEY]) {
        const r = await login(lk, attempt);
        expect(r.status, `${attempt === KEY ? 'chave certa' : 'chave errada'} após 10 erros: ${r.text}`).toBe(429);
        expect(r.json.error.code).toBe('auth-locked');
        expect(r.json.error.message).toMatch(/Tente novamente em 15 min/);
        const ra = r.headers['retry-after'];
        expect(ra, 'Retry-After').toMatch(/^\d+$/);
        const elapsed = Math.ceil((Date.now() - t0) / 1000);
        expect(Number(ra)).toBeLessThanOrEqual(900);
        expect(Number(ra)).toBeGreaterThanOrEqual(900 - elapsed - 5);
        expect(r.setCookie).toEqual([]);
      }
      // Só a sessão do login bem-sucedido existe.
      expect(sessionsOf(lk)).toEqual([ok.json.id]);
    });

    it('o bloqueio é por IP: outro endereço de loopback ainda entra com a chave certa', async (ctx) => {
      const supported = await rawRequest(lk.base, 'GET', '/api/health', { localAddress: '127.0.0.2' }).then(
        (r) => r.status === 200,
        () => false,
      );
      if (!supported) ctx.skip(); // sistema sem 127.0.0.2 (ex.: macOS sem alias)
      const other = await login(lk, KEY, { localAddress: '127.0.0.2' });
      expect(other.status, other.text).toBe(200);
      expect(other.sessionCookie).toBeTruthy();
      // E o IP bloqueado continua bloqueado.
      const again = await login(lk, KEY);
      expect(again.status).toBe(429);
    });
  });

  describe('atrás de proxy reverso (TRUST_PROXY)', () => {
    const wrong = (i: number) => `errada-proxy-${i}-0123456789abcdef`;
    const viaProxy = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });

    it('com TRUST_PROXY=true o bloqueio vale por cliente real (X-Forwarded-For), não para o proxy inteiro', async () => {
      const px = await startServer({ ACCESS_KEY: KEY, TRUST_PROXY: 'true' });
      try {
        for (let i = 1; i <= 10; i++) expect((await login(px, wrong(i), viaProxy('203.0.113.7'))).status).toBe(401);
        expect((await login(px, KEY, viaProxy('203.0.113.7'))).status).toBe(429);
        // Outro cliente atrás do mesmo proxy entra normalmente.
        const other = await login(px, KEY, viaProxy('198.51.100.20'));
        expect(other.status, other.text).toBe(200);
      } finally {
        await px.close();
      }
    });

    it('sem TRUST_PROXY o cabeçalho X-Forwarded-For é ignorado (não serve para escapar do bloqueio)', async () => {
      const np = await startServer({ ACCESS_KEY: KEY });
      try {
        for (let i = 1; i <= 10; i++) expect((await login(np, wrong(i), viaProxy(`192.0.2.${i}`))).status).toBe(401);
        const spoof = await login(np, KEY, viaProxy('192.0.2.200'));
        expect(spoof.status, 'trocar o X-Forwarded-For não pode zerar o bloqueio').toBe(429);
      } finally {
        await np.close();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('isolamento entre sessões', () => {
  let a: Client;
  let b: Client;
  let sidA: string;
  let sidB: string;
  let assetA: AssetDTO;
  let photoA: AssetDTO;
  let assetB: AssetDTO;
  let jobA: JobDetail;
  let exportA: { id: string; url: string };
  let previewA: string;
  let diskA: Array<[string, number]>;

  beforeAll(async () => {
    a = new Client(srv.base);
    b = new Client(srv.base);
    [assetA, photoA] = (await a.importOk(
      { path: fx('plain.mp4'), name: 'segredo-da-sessao-A.mp4' },
      { path: fx('photo.jpg'), name: 'foto-privada-A.jpg' },
    )) as [AssetDTO, AssetDTO];
    [jobA] = (await a.processOk(assetA.id, { mode: 'quick' })) as [JobDetail];
    const ex = await a.post('/api/exports', { jobIds: [jobA.id] });
    expect(ex.status, JSON.stringify(ex.data)).toBe(200);
    exportA = ex.data;
    const pv = await a.post('/api/preview', { assetId: assetA.id, settings: { mode: 'quick' } });
    expect(pv.status, JSON.stringify(pv.data)).toBe(200);
    previewA = pv.data.url;
    [assetB] = (await b.importOk(fx('noaudio.mp4'))) as [AssetDTO];
    sidA = await sessionId(a);
    sidB = await sessionId(b);
    expect(sidA).not.toBe(sidB);
    diskA = [...tree(path.join(srv.dataDir, 'sessions', sidA)).files.entries()].sort();
  });

  it('B recebe 404 "not-found" para asset/job/download/relatório/miniatura/prévia/lote de A — idêntico a um id inexistente e sem caminhos', async () => {
    const previewName = previewA.split('/').pop()!;
    const fakePreview = previewName.replace(/^[^.]+/, FAKE_ID);
    const probes: Array<[string, (id: string) => string, string]> = [
      ['GET', (id) => `/api/assets/${id}`, assetA.id],
      ['GET', (id) => `/api/assets/${id}/file`, assetA.id],
      ['GET', (id) => `/api/assets/${id}/thumbnail`, assetA.id],
      ['GET', (id) => `/api/assets/${id}/thumbnail`, photoA.id],
      ['DELETE', (id) => `/api/assets/${id}`, assetA.id],
      ['GET', (id) => `/api/jobs/${id}`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/download`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/output`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/verify`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/report`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/report?raw=1`, jobA.id],
      ['GET', (id) => `/api/jobs/${id}/thumbnail`, jobA.id],
      ['POST', (id) => `/api/jobs/${id}/cancel`, jobA.id],
      ['POST', (id) => `/api/jobs/${id}/retry`, jobA.id],
      ['DELETE', (id) => `/api/jobs/${id}`, jobA.id],
      ['POST', (id) => `/api/batches/${id}/cancel`, jobA.batchId],
      ['POST', (id) => `/api/batches/${id}/retry`, jobA.batchId],
      ['GET', (name) => `/api/previews/${name}`, previewName],
    ];
    const secrets = [srv.dataDir, sidA, assetA.name, photoA.name, jobA.output!.name, jobA.output!.sha256, assetA.sha256];
    for (const [m, url, id] of probes) {
      const fakeId = id === previewName ? fakePreview : FAKE_ID;
      const r = await req(m, url(id), { cookie: b.cookie });
      const fake = await req(m, url(fakeId), { cookie: b.cookie });
      const label = `${m} ${url(id)}`;
      expect(r.status, `${label}: ${r.text}`).toBe(404);
      expect(r.json?.error?.code, label).toBe('not-found');
      expect(r.text, `${label}: difere da resposta para id inexistente`).toBe(fake.text);
      expect(r.headers['content-disposition'], label).toBeUndefined();
      expect(r.headers['x-content-sha256'], label).toBeUndefined();
      expect(leakProblems(r.text, secrets), label).toEqual([]);
    }
  });

  it('B não exporta, não processa e não pré-visualiza arquivos de A; listas e histórico de B não mostram nada de A', async () => {
    const secrets = [srv.dataDir, sidA, assetA.name, photoA.name, jobA.output!.name];
    const pairs: Array<[string, unknown, unknown, number]> = [
      ['/api/exports', { jobIds: [jobA.id] }, { jobIds: [FAKE_ID] }, 409],
      ['/api/batches', { assetIds: [assetA.id], scope: 'common', settings: { mode: 'quick' } }, { assetIds: [FAKE_ID], scope: 'common', settings: { mode: 'quick' } }, 422],
      ['/api/preview', { assetId: assetA.id, settings: { mode: 'quick' } }, { assetId: FAKE_ID, settings: { mode: 'quick' } }, 422],
    ];
    for (const [url, body, fakeBody, status] of pairs) {
      const r = await b.post(url, body);
      const fake = await b.post(url, fakeBody);
      expect(r.status, `${url}: ${JSON.stringify(r.data)}`).toBe(status);
      expect(JSON.stringify(r.data).replaceAll(assetA.id, FAKE_ID)).toBe(JSON.stringify(fake.data));
      expect(leakProblems(JSON.stringify(r.data), secrets), url).toEqual([]);
    }
    const plan = await b.post('/api/plan', { assetIds: [assetA.id], scope: 'common', settings: { mode: 'quick' } });
    expect(plan.status).toBe(200);
    expect(plan.data.ok).toBe(false);
    expect(plan.data.jobs).toEqual([]);
    expect(plan.data.errors).toEqual([{ assetId: assetA.id, assetName: null, message: 'Arquivo não encontrado nesta sessão.' }]);

    expect((await b.get<AssetDTO[]>('/api/assets')).data.map((x) => x.id)).toEqual([assetB.id]);
    expect((await b.get<JobDTO[]>('/api/jobs')).data).toEqual([]);
    expect((await b.get('/api/batches')).data).toEqual([]);
    const hist = JSON.stringify((await b.get('/api/history')).data);
    expect(hist).not.toContain('segredo-da-sessao-A');
    expect(hist).not.toContain('foto-privada-A');
    expect((await b.get('/api/session')).data.id).toBe(sidB);
    // Nada foi gravado na área de B por causa dessas tentativas.
    expect(listFiles(sessionArea(srv.dataDir, sidB, 'outputs'))).toEqual([]);
    expect(listFiles(sessionArea(srv.dataDir, sidB, 'previews'))).toEqual([]);
  });

  it('a exportação ZIP de A não é entregue a B (nenhum byte do ZIP, resposta idêntica à de um id inexistente)', async () => {
    const r = await req('GET', exportA.url, { cookie: b.cookie });
    const fake = await req('GET', `/api/exports/${FAKE_ID}`, { cookie: b.cookie });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.body.subarray(0, 2).toString('latin1')).not.toBe('PK');
    expect(String(r.headers['content-type'])).not.toMatch(/zip/);
    expect(r.headers['content-disposition']).toBeUndefined();
    expect(r.text).toBe(fake.text);
    expect(r.status).toBe(fake.status);
    expect(leakProblems(r.text, [srv.dataDir, sidA, jobA.output!.name])).toEqual([]);
  });

  it('exportação de outra sessão responde 404 "not-found", como os demais recursos', async () => {
    const r = await req('GET', exportA.url, { cookie: b.cookie });
    expect(r.status, `GET ${exportA.url} pela sessão B → ${r.status} ${r.text}`).toBe(404);
    expect(r.json?.error?.code).toBe('not-found');
  });

  it('o id da sessão (no lugar do token) não dá acesso: vira uma sessão nova', async () => {
    for (const forged of [`mf_session=${sidA}`, `mf_session=${'A'.repeat(201)}`, `mf_session=${sha256(Buffer.from(sidA))}`]) {
      const s = await req('GET', '/api/session', { cookie: forged });
      expect(s.status).toBe(200);
      expect(s.json.id).not.toBe(sidA);
      expect(s.sessionCookie).toBeTruthy();
      expect(s.sessionCookie).not.toBe(forged);
      const r = await req('GET', `/api/assets/${assetA.id}/file`, { cookie: forged });
      expect(r.status).toBe(404);
    }
  });

  it('depois das tentativas de B, A continua com tudo intacto (bytes conferidos)', async () => {
    expect([...tree(path.join(srv.dataDir, 'sessions', sidA)).files.entries()].sort()).toEqual(diskA);
    const file = await a.download(assetA.fileUrl);
    expect(file.status).toBe(200);
    expect(sha256(file.body)).toBe(fileSha(fx('plain.mp4')));
    const out = await a.download(jobA.output!.downloadUrl);
    expect(out.status).toBe(200);
    expect(sha256(out.body)).toBe(jobA.output!.sha256);
    expect(out.headers.get('x-content-sha256')).toBe(jobA.output!.sha256);
    const zip = await a.download(exportA.url);
    expect(zip.status).toBe(200);
    expect([...zip.body.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // O vídeo entra sem compressão: os bytes exatos da saída estão dentro do ZIP.
    expect(zip.body.indexOf(out.body)).toBeGreaterThan(0);
    const pv = await a.download(previewA);
    expect(pv.status).toBe(200);
    const probe = ffprobe(tmpFile(pv.body, 'mp4'));
    expect(probe.streams.some((s: any) => s.codec_type === 'video')).toBe(true);
    expect((await a.get(`/api/jobs/${jobA.id}`)).data.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('nomes de arquivo maliciosos no envio', () => {
  let c: Client;
  let sid: string;
  let before: ReturnType<typeof tree>;
  const vid = () => fs.readFileSync(fx('noaudio.mp4'));
  const cases: Array<{ label: string; disposition: Buffer; src: string; ext: string; expected?: string }> = [
    { label: 'travessia de diretório', disposition: Buffer.from('filename="../../etc/passwd.mp4"'), src: 'noaudio.mp4', ext: 'mp4', expected: 'passwd.mp4' },
    { label: 'con.mp4', disposition: Buffer.from('filename="con.mp4"'), src: 'noaudio.mp4', ext: 'mp4' },
    { label: 'nul.tar.gz', disposition: Buffer.from('filename="nul.tar.gz"'), src: 'logo.png', ext: 'png' },
    { label: 'CON escondido por NUL (filename*)', disposition: Buffer.from("filename*=UTF-8''CON%00.mp4"), src: 'noaudio.mp4', ext: 'mp4' },
    { label: 'inversão \\u202E', disposition: Buffer.from('filename="relatorio\u202Efdp.mp4"', 'utf8'), src: 'noaudio.mp4', ext: 'mp4', expected: 'relatoriofdp.mp4' },
    { label: '300 emojis', disposition: Buffer.from(`filename="${'😀'.repeat(300)}.mp4"`, 'utf8'), src: 'noaudio.mp4', ext: 'mp4' },
    {
      label: 'bytes de controle crus',
      disposition: Buffer.from('filename="ctl\x00\x01\x02\x07\x1b[2J\x7f\tfim.mp4"', 'latin1'),
      src: 'noaudio.mp4',
      ext: 'mp4',
      expected: 'ctl[2Jfim.mp4',
    },
    {
      label: 'controles C0/C1 e isolador bidi (filename*)',
      disposition: Buffer.from("filename*=UTF-8''x%01y%1Bz%7F%C2%85%C2%9Bw%E2%81%A6.mp4"),
      src: 'noaudio.mp4',
      ext: 'mp4',
      expected: 'xyzw.mp4',
    },
  ];
  let assets: AssetDTO[];

  beforeAll(async () => {
    c = new Client(srv.base);
    sid = await sessionId(c);
    before = tree(srv.dataDir);
    const mp = multipartBody(cases.map((k) => ({ disposition: k.disposition, data: k.src === 'noaudio.mp4' ? vid() : fs.readFileSync(fx(k.src)) })));
    const r = await req('POST', '/api/assets', { cookie: c.cookie, headers: { 'content-type': mp.contentType }, body: mp.body });
    expect(r.status, r.text).toBe(200);
    expect(r.json.results).toHaveLength(cases.length);
    assets = r.json.results.map((x: { ok: boolean; error?: string; asset: AssetDTO }, i: number) => {
      expect(x.ok, `${cases[i]!.label}: ${x.error}`).toBe(true);
      return x.asset;
    });
  });

  it('nome de exibição saneado (sem controles, bidi, separadores, reservados; ≤ 255 bytes)', () => {
    assets.forEach((a, i) => {
      const k = cases[i]!;
      expectSafeName(a.name, k.label);
      if (k.expected) expect(a.name, k.label).toBe(k.expected);
      expect(a.ext, k.label).toBe(k.ext);
      expect(a.sha256, k.label).toBe(fileSha(fx(k.src)));
    });
    const emoji = assets[5]!.name;
    expect(emoji).toMatch(/^(😀)+\.mp4$/u);
    expect([...emoji.replace(/\.mp4$/, '')].length).toBeGreaterThanOrEqual(20);
    // Os nomes reservados não sobrevivem nem disfarçados (con.mp4, nul.tar.gz, CON\0.mp4).
    for (const i of [1, 2, 3]) expect(assets[i]!.name.split('.')[0], cases[i]!.label).not.toMatch(RESERVED_HEAD);
  });

  it('nada é criado fora do diretório da sessão: só uploads/<id>.<ext> e thumbs/<id>.jpg', () => {
    const after = tree(srv.dataDir);
    const added = [...after.files.keys()].filter((f) => !before.files.has(f)).sort();
    const expected = assets.flatMap((a) => [`sessions/${sid}/uploads/${a.id}.${a.ext}`, `sessions/${sid}/thumbs/${a.id}.jpg`]).sort();
    expect(added).toEqual(expected);
    expect([...after.dirs].filter((d) => !before.dirs.has(d))).toEqual([]);
    for (const a of assets) {
      const stored = path.join(sessionArea(srv.dataDir, sid, 'uploads'), `${a.id}.${a.ext}`);
      expect(fileSha(stored)).toBe(a.sha256);
    }
    expect(listFiles(sessionArea(srv.dataDir, sid, 'tmp'))).toEqual([]);
    // Fora do DATA_DIR: nem o alvo da travessia nem nada com os nomes enviados.
    expect(fs.existsSync(path.resolve(sessionArea(srv.dataDir, sid, 'uploads'), '../../etc/passwd.mp4'))).toBe(false);
    expect(fs.existsSync(path.resolve(sessionArea(srv.dataDir, sid, 'tmp'), '../../etc/passwd.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(srv.dataDir, '..', 'etc', 'passwd.mp4'))).toBe(false);
    expect(fs.existsSync('/etc/passwd.mp4')).toBe(false);
    const siblings = fs
      .readdirSync(path.dirname(srv.dataDir))
      .filter((n) => n === 'passwd.mp4' || /^(con\.mp4|nul\.tar\.gz)$/i.test(n) || n.includes('😀') || CONTROL.test(n) || BIDI.test(n));
    expect(siblings).toEqual([]);
  });

  it('download do original: bytes idênticos e Content-Disposition seguro com o nome saneado', async () => {
    for (const [i, a] of assets.entries()) {
      const r = await c.download(a.fileUrl);
      expect(r.status, cases[i]!.label).toBe(200);
      expect(sha256(r.body), cases[i]!.label).toBe(a.sha256);
      expectSafeDisposition(r.headers.get('content-disposition'), 'inline', a.name);
    }
  });

  it('saídas processadas a partir desses nomes ficam em outputs/ com nome e Content-Disposition seguros', async () => {
    const picked = [assets[0]!, assets[4]!, assets[5]!, assets[6]!, assets[7]!];
    const ids = await c.batch(picked.map((a) => a.id), { mode: 'quick' });
    const jobs = await c.waitJobs(ids);
    const outputsDir = sessionArea(srv.dataDir, sid, 'outputs');
    const stored = new Map(listFiles(outputsDir).map((f) => [fileSha(f), f]));
    for (const j of jobs) {
      expect(j.status, `${j.assetName}: ${j.error}`).toBe('completed');
      const out = j.output!;
      expectSafeName(out.name, `saída de ${j.assetName}`);
      expect(out.name).toMatch(/^[\p{L}\p{N}_\-.]+\.mp4$/u);
      const r = await c.download(out.downloadUrl);
      expect(r.status).toBe(200);
      expect(sha256(r.body)).toBe(out.sha256);
      expectSafeDisposition(r.headers.get('content-disposition'), 'attachment', out.name);
      const v = ffprobe(tmpFile(r.body, 'mp4')).streams.find((s: any) => s.codec_type === 'video');
      expect([v.codec_name, v.width, v.height]).toEqual(['h264', 320, 240]);
      // O arquivo no disco está dentro de outputs/ da sessão.
      const onDisk = stored.get(out.sha256);
      expect(onDisk, `saída ${out.name} não encontrada em outputs/`).toBeTruthy();
      expect(path.relative(outputsDir, onDisk!)).not.toMatch(/^\.\.|[\\/]/);
      const rep = await c.download(out.reportUrl);
      expect(rep.status).toBe(200);
      expectSafeDisposition(rep.headers.get('content-disposition'), 'attachment', `${out.name}.relatorio.json`);
    }
    // Ainda nada fora da sessão.
    const after = tree(srv.dataDir);
    const outside = [...after.files.keys()].filter((f) => !before.files.has(f) && !f.startsWith(`sessions/${sid}/`));
    expect(outside).toEqual([]);
    expect(listFiles(sessionArea(srv.dataDir, sid, 'tmp'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('limites de envio', () => {
  let lim: TestServer;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-seguranca-limites-'));
  const MiB = 1024 * 1024;
  beforeAll(async () => {
    lim = await startServer({ MAX_UPLOAD_MB: 1, MAX_FILES_PER_UPLOAD: 3 });
  });
  afterAll(async () => {
    await lim?.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('exatamente MAX_FILES_PER_UPLOAD arquivos passam; um a mais → 413 "too-many-files" e o excedente não é importado', async () => {
    const ok = new Client(lim.base);
    const r3 = await ok.upload([{ path: fx('logo.png') }, { path: fx('graphic.png') }, { path: fx('image.webp') }]);
    expect(r3.status).toBe(200);
    expect(r3.data.results.map((x) => x.ok)).toEqual([true, true, true]);

    const c = new Client(lim.base);
    const sid = await sessionId(c);
    const r = await c.upload([{ path: fx('logo.png') }, { path: fx('graphic.png') }, { path: fx('image.webp') }, { path: fx('photo.jpg') }]);
    expect(r.status).toBe(413);
    expect((r.data as any).error.code).toBe('too-many-files');
    expect((r.data as any).error.message).toBe('Máximo de 3 arquivos por envio.');
    const list = (await c.get<AssetDTO[]>('/api/assets')).data;
    expect(list.some((a) => a.sha256 === fileSha(fx('photo.jpg')))).toBe(false);
    expect(list.length).toBeLessThanOrEqual(3);
    // Nenhum byte órfão: tudo em uploads/ pertence a um asset listado, e tmp/ está vazio.
    const uploads = fs.readdirSync(sessionArea(lim.dataDir, sid, 'uploads')).sort();
    expect(uploads).toEqual(list.filter((a) => a.status === 'ready').map((a) => `${a.id}.${a.ext}`).sort());
    expect(listFiles(sessionArea(lim.dataDir, sid, 'tmp'))).toEqual([]);
  });

  it('arquivo acima de MAX_UPLOAD_MB → recusado com mensagem, sem arquivo parcial em disco; o seguinte do envio é aceito', async () => {
    const long = fs.readFileSync(fx('long.mp4'));
    expect(long.length).toBeGreaterThan(2 * MiB);
    const oneMoreByte = path.join(work, 'um-byte-a-mais.mp4');
    fs.writeFileSync(oneMoreByte, long.subarray(0, MiB + 1));
    const exact = path.join(work, 'exato.mp4');
    fs.writeFileSync(exact, long.subarray(0, MiB));

    const c = new Client(lim.base);
    const sid = await sessionId(c);
    const { status, data } = await c.upload([{ path: oneMoreByte }, { path: fx('long.mp4') }, { path: fx('logo.png') }]);
    expect(status).toBe(200);
    const [big1, big2, small] = data.results;
    for (const big of [big1!, big2!]) {
      expect(big.ok).toBe(false);
      expect(big.error).toBe('Excede o limite de 1 MB por arquivo.');
      expect(big.asset!.status).toBe('invalid');
      expect(big.asset!.fileUrl).toBe(`/api/assets/${big.asset!.id}/file`);
      expect((await c.download(big.asset!.fileUrl)).status).toBe(404);
    }
    expect(small!.ok, small!.error).toBe(true);
    expect(small!.asset!.sha256).toBe(fileSha(fx('logo.png')));
    // Em disco: só o arquivo pequeno (e sua miniatura); nada parcial em tmp/ ou uploads/.
    const files = listFiles(path.join(lim.dataDir, 'sessions', sid)).map((f) => path.relative(path.join(lim.dataDir, 'sessions', sid), f).split(path.sep).join('/'));
    expect(files.sort()).toEqual([`thumbs/${small!.asset!.id}.jpg`, `uploads/${small!.asset!.id}.png`].sort());
    for (const big of [big1!, big2!]) expect(files.some((f) => f.includes(big.asset!.id))).toBe(false);

    // Exatamente 1 MiB não é barrado pelo limite (pode ser recusado por outro motivo: está truncado).
    const { data: d2 } = await c.upload([{ path: exact }]);
    expect(d2.results[0]!.error ?? '').not.toMatch(/Excede o limite/);
    expect(listFiles(sessionArea(lim.dataDir, sid, 'tmp'))).toEqual([]);
  });

  it('conteúdo falso (texto com extensão .mp4) → "invalid", nada armazenado, não processável', async () => {
    const c = new Client(lim.base);
    const sid = await sessionId(c);
    const { data } = await c.upload([{ path: fx('fake.mp4'), name: 'video-de-verdade.mp4' }]);
    const r = data.results[0]!;
    expect(r.ok).toBe(false);
    expect(r.asset!.status).toBe('invalid');
    expect(r.error).toBe('Conteúdo não reconhecido como vídeo, imagem, áudio ou legenda suportados.');
    expect(r.asset!.sha256).toBe(fileSha(fx('fake.mp4')));
    expect(listFiles(path.join(lim.dataDir, 'sessions', sid))).toEqual([]);
    expect((await c.download(r.asset!.fileUrl)).status).toBe(404);
    const batch = await c.post('/api/batches', { assetIds: [r.asset!.id], scope: 'common', settings: { mode: 'quick' } });
    expect(batch.status).toBe(422);
    expect((await c.get('/api/jobs')).data).toEqual([]);
  });

  it('PNG com extensão .jpg → aceito como PNG, com aviso', async () => {
    const c = new Client(lim.base);
    const sid = await sessionId(c);
    const [a] = await c.importOk({ path: fx('graphic.png'), name: 'imagem.jpg' });
    expect(a!.kind).toBe('image');
    expect(a!.ext).toBe('png');
    expect(a!.container).toBe('PNG');
    expect(a!.name).toBe('imagem.jpg');
    const stored = path.join(sessionArea(lim.dataDir, sid, 'uploads'), `${a!.id}.png`);
    expect(fileSha(stored)).toBe(fileSha(fx('graphic.png')));
    expect(ffprobe(stored).streams[0].codec_name).toBe('png');
    const detail = (await c.get<AssetDetailDTO>(`/api/assets/${a!.id}`)).data;
    expect(detail.metadata!.warnings).toContain('A extensão .jpg não corresponde ao conteúdo real (PNG); o arquivo foi tratado como PNG.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('lote limitado (regressão)', () => {
  let bl: TestServer;
  let c: Client;
  let sid: string;
  let videos: AssetDTO[];
  const PROFILES = ['original-limpo', 'web-720p'];
  const body = (ids: string[], profiles?: string[]) => ({ assetIds: ids, scope: 'common', settings: { mode: 'quick' }, ...(profiles ? { profiles } : {}) });
  const jobCount = async () => (await c.get<JobDTO[]>('/api/jobs')).data.length;

  beforeAll(async () => {
    bl = await startServer({ MAX_JOBS_PER_BATCH: 4, MAX_JOBS_PER_SESSION: 6 });
    c = new Client(bl.base);
    videos = await c.importOk(fx('noaudio.mp4'), fx('plain.mp4'), fx('scene.mp4'));
    sid = await sessionId(c);
  });
  afterAll(async () => bl?.close());

  it('3 arquivos × 2 perfis = 6 > 4: /api/plan ok:false "mais de 4 tarefas", /api/batches 422 e nenhuma tarefa criada', async () => {
    const msg = 'O lote geraria mais de 4 tarefas (máximo por lote). Selecione menos arquivos, perfis ou partes.';
    const plan = await c.post('/api/plan', body(videos.map((v) => v.id), PROFILES));
    expect(plan.status).toBe(200);
    expect(plan.data.ok).toBe(false);
    expect(plan.data.errors).toEqual([{ assetId: null, assetName: null, message: msg }]);
    expect(plan.data.jobs.length).toBeLessThanOrEqual(4);

    const r = await c.post('/api/batches', body(videos.map((v) => v.id), PROFILES));
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe('invalid-batch');
    expect(r.data.error.details.map((e: any) => e.message)).toEqual([msg]);

    expect(await jobCount()).toBe(0);
    expect((await c.get('/api/batches')).data).toEqual([]);
    expect((await c.get('/api/system')).data.queue.queued).toBe(0);
    expect(listFiles(sessionArea(bl.dataDir, sid, 'outputs'))).toEqual([]);
    expect(listFiles(sessionArea(bl.dataDir, sid, 'tmp'))).toEqual([]);
    const hist = (await c.get<Array<{ message: string }>>('/api/history')).data;
    expect(hist.some((h) => /Lote criado/.test(h.message))).toBe(false);
  });

  it('planos que FALHAM também contam para o limite: a expansão para cedo e a resposta não cresce sem limite', async () => {
    // Transições de 5 s em partes de ~0,2 s: todo plano falha. 3 arquivos × 2 perfis × 10 partes
    // seriam 60 tentativas; com o limite 4, o servidor para na 5ª.
    const failing = {
      assetIds: videos.map((v) => v.id),
      scope: 'common',
      settings: { mode: 'editorial', fade: { in: 5, out: 5 }, segmentation: { mode: 'count', value: 10 } },
      profiles: PROFILES,
    };
    const plan = await c.post('/api/plan', failing);
    expect(plan.status).toBe(200);
    expect(plan.data.ok).toBe(false);
    expect(plan.data.jobs).toEqual([]);
    const msgs: string[] = plan.data.errors.map((e: any) => e.message);
    expect(msgs.filter((m) => /transições/i.test(m)).length).toBe(4);
    expect(msgs.at(-1)).toBe('O lote geraria mais de 4 tarefas (máximo por lote). Selecione menos arquivos, perfis ou partes.');
    expect(msgs).toHaveLength(5);
    expect(await jobCount()).toBe(0);
  });

  it('exatamente 4 tarefas (2 arquivos × 2 perfis) cabem no lote e são processadas de verdade', async () => {
    const ids = [videos[0]!.id, videos[1]!.id];
    const plan = await c.post('/api/plan', body(ids, PROFILES));
    expect(plan.data.ok, JSON.stringify(plan.data.errors)).toBe(true);
    expect(plan.data.jobs).toHaveLength(4);
    const jobIds = await c.batch(ids, { mode: 'quick' }, { profiles: PROFILES });
    expect(jobIds).toHaveLength(4);
    const jobs = await c.waitJobs(jobIds);
    for (const j of jobs) expect(j.status, `${j.label}: ${j.error}`).toBe('completed');
    expect(jobs.map((j) => j.profileName).sort()).toEqual(['Original limpo', 'Original limpo', 'Web leve 720p', 'Web leve 720p']);
    const web = jobs.find((j) => j.profileName === 'Web leve 720p')!;
    const r = await c.download(web.output!.downloadUrl);
    expect(sha256(r.body)).toBe(web.output!.sha256);
    const v = ffprobe(tmpFile(r.body, 'mp4')).streams.find((s: any) => s.codec_type === 'video');
    expect(Math.min(v.width, v.height)).toBe(720);
    expect(listFiles(sessionArea(bl.dataDir, sid, 'outputs'))).toHaveLength(4);
  });

  it('MAX_JOBS_PER_SESSION (6): com 4 tarefas, lote de 3 é recusado, 2 cabem, depois nenhuma; outra sessão não é afetada', async () => {
    expect(await jobCount()).toBe(4);
    const three = videos.map((v) => v.id);
    const plan = await c.post('/api/plan', body(three));
    expect(plan.data.ok).toBe(false);
    expect(plan.data.errors).toEqual([
      { assetId: null, assetName: null, message: 'Limite de 6 tarefas por sessão atingido (4 já existem). Remova tarefas concluídas.' },
    ]);
    const r = await c.post('/api/batches', body(three));
    expect(r.status).toBe(422);
    expect(await jobCount()).toBe(4);

    const two = await c.batch([videos[0]!.id, videos[2]!.id], { mode: 'quick' });
    expect(two).toHaveLength(2);
    expect(await jobCount()).toBe(6);

    const one = await c.post('/api/batches', body([videos[1]!.id]));
    expect(one.status).toBe(422);
    expect(one.data.error.details.map((e: any) => e.message)).toEqual([
      'Limite de 6 tarefas por sessão atingido (6 já existem). Remova tarefas concluídas.',
    ]);
    const p1 = await c.post('/api/plan', body([videos[1]!.id]));
    expect(p1.data.ok).toBe(false);
    expect(await jobCount()).toBe(6);

    // O limite é por sessão: outra sessão no mesmo servidor processa normalmente.
    const other = new Client(bl.base);
    const [img] = await other.importOk(fx('logo.png'));
    const done = await other.processOk(img!.id, { mode: 'quick' });
    expect(done).toHaveLength(1);
    expect(sha256((await other.download(done[0]!.output!.downloadUrl)).body)).toBe(done[0]!.output!.sha256);

    const finished = await c.waitJobs(two);
    for (const j of finished) expect(j.status, j.error ?? '').toBe('completed');
    expect(await jobCount()).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('identificadores inválidos nas rotas', () => {
  let c: Client;
  let sid: string;
  let real: AssetDTO;
  beforeAll(async () => {
    c = new Client(srv.base);
    [real] = (await c.importOk(fx('logo.png'))) as [AssetDTO];
    sid = await sessionId(c);
  });

  it("ids malformados ('..%2f..', 'a', …) → 400/404 sem stack trace nem caminho absoluto", async () => {
    const bad = [
      'a',
      '..%2f..',
      '..%2F..%2Fmediaforge.db',
      '..',
      '.',
      '%2e%2e',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      'aaaaaaaa%00',
      `${real.id}%2f..`,
      `${real.id}%00.png`,
      'x'.repeat(65),
      '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      '%E2%80%AEaaaaaaaaaa',
      'aaaaaaaa.mp4',
      '%C0%AE%C0%AE',
      '%',
      '%E0%A4%A',
    ];
    const routes: Array<[string, (id: string) => string]> = [
      ['GET', (id) => `/api/assets/${id}`],
      ['GET', (id) => `/api/assets/${id}/file`],
      ['GET', (id) => `/api/assets/${id}/thumbnail`],
      ['DELETE', (id) => `/api/assets/${id}`],
      ['GET', (id) => `/api/jobs/${id}`],
      ['GET', (id) => `/api/jobs/${id}/download`],
      ['GET', (id) => `/api/jobs/${id}/output`],
      ['GET', (id) => `/api/jobs/${id}/verify`],
      ['GET', (id) => `/api/jobs/${id}/report`],
      ['GET', (id) => `/api/jobs/${id}/thumbnail`],
      ['POST', (id) => `/api/jobs/${id}/cancel`],
      ['DELETE', (id) => `/api/jobs/${id}`],
      ['POST', (id) => `/api/batches/${id}/cancel`],
      ['GET', (id) => `/api/exports/${id}`],
      ['GET', (id) => `/api/previews/${id}`],
    ];
    const secrets = [srv.dataDir, sid, path.dirname(srv.dataDir) + path.sep, process.cwd()];
    const statuses = new Map<number, number>();
    for (const [m, url] of routes) {
      for (const id of bad) {
        const r = await req(m, url(id), { cookie: c.cookie });
        const label = `${m} ${url(id)} → ${r.status} ${r.text}`;
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
        expect([400, 404], label).toContain(r.status);
        // Erro em JSON com código legível: o formato do app ({error:{code}}) ou, para URL
        // malformada (recusada pelo roteador antes do app), o padrão do Fastify ({code}).
        expect(r.headers['content-type'], label).toMatch(/^application\/json/);
        expect(typeof (r.json?.error?.code ?? r.json?.code), label).toBe('string');
        expect(leakProblems(r.text, secrets), label).toEqual([]);
        expect(r.headers['content-disposition'], label).toBeUndefined();
      }
    }
    // Os casos do enunciado: validados antes de qualquer consulta.
    for (const id of ['a', '..%2f..']) {
      const r = await req('GET', `/api/assets/${id}`, { cookie: c.cookie });
      expect(r.status).toBe(400);
      expect(r.json.error).toEqual({ code: 'invalid-id', message: 'Identificador inválido.' });
    }
    expect(statuses.get(400)).toBeGreaterThan(0);
    // O arquivo real da sessão continua lá (DELETE com ids inválidos não afetou nada).
    expect((await c.get<AssetDTO[]>('/api/assets')).data.map((a) => a.id)).toEqual([real.id]);
    expect(fileSha(path.join(sessionArea(srv.dataDir, sid, 'uploads'), `${real.id}.png`))).toBe(fileSha(fx('logo.png')));
  });

  it('arquivos do DATA_DIR (banco, uploads, trava) não são servidos por caminho direto', async () => {
    const paths = [
      '/mediaforge.db',
      '/mediaforge.db-wal',
      '/instance.lock',
      `/sessions/${sid}/uploads/${real.id}.png`,
      `/sessions/${sid}/thumbs/${real.id}.jpg`,
      '/api/../mediaforge.db',
      '/api/assets/../../mediaforge.db',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/api/assets/..%2f..%2fmediaforge.db/file',
    ];
    for (const p of paths) {
      const r = await req('GET', p, { cookie: c.cookie });
      expect([400, 404], `${p} → ${r.status}`).toContain(r.status);
      expect(r.text).not.toContain('SQLite format 3');
      expect(r.text).not.toMatch(/root:.*:0:0:/);
      expect(r.body.includes(fs.readFileSync(fx('logo.png')).subarray(0, 64))).toBe(false);
      expect(leakProblems(r.text, [srv.dataDir, sid]), p).toEqual([]);
    }
  });
});
