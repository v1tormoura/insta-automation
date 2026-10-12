import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetDTO, JobReport } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { fx, SENSITIVE } from '../helpers/fixtures';
import { flipByte, openFdsInside, readZip, removeTempDirs, tempDir, trackTempDir, waitFor, type ZipRead } from '../helpers/integrity-export-util';
import { decodeErrors, mainStreams, sessionArea, sessionId, sha256 } from '../helpers/inspecaoMidia';
import { tmpFile as tmpFileRaw } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

const NONE = { gps: false, dates: false, device: false, descriptive: false, software: false, custom: false, container: false, streams: false, embedded: false };

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv?.close();
  removeTempDirs();
});

/** `tmpFile` com o diretório registrado para remoção no fim do arquivo. */
const tmpFile = (buf: Buffer, ext: string) => {
  const p = tmpFileRaw(buf, ext);
  trackTempDir(path.dirname(p));
  return p;
};

interface ApiError {
  error: { code: string; message: string; details?: string[] };
}
interface Prepared {
  id: string;
  count: number;
  totalBytes: number;
  url: string;
}

const fileSha = (p: string) => sha256(fs.readFileSync(p));
const outputsDir = (sid: string) => sessionArea(srv.dataDir, sid, 'outputs');
const outputPath = (sid: string, job: JobDetail) => path.join(outputsDir(sid), job.output!.name);
const isZipBytes = (b: Buffer) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;

/** Processa vários arquivos num lote e devolve as tarefas concluídas por id do asset. */
async function processAll(c: Client, assets: AssetDTO[], settings: unknown): Promise<Map<string, JobDetail>> {
  const ids = await c.batch(
    assets.map((a) => a.id),
    settings,
  );
  const jobs = await c.waitJobs(ids);
  for (const j of jobs) if (j.status !== 'completed') throw new Error(`tarefa ${j.label} terminou como ${j.status}: ${j.error}`);
  return new Map(jobs.map((j) => [j.assetId, j]));
}

/** Prepara a exportação (200 esperado) e baixa o ZIP (200 esperado). */
async function exportZip(c: Client, jobIds: string[] | null) {
  const prep = await c.post<Prepared>('/api/exports', jobIds ? { jobIds } : {});
  expect(prep.status, JSON.stringify(prep.data)).toBe(200);
  const res = await c.download(prep.data.url);
  expect(res.status, res.body.toString('utf8').slice(0, 300)).toBe(200);
  const m = /^attachment; filename="(mediaforge-\d{4}-\d{2}-\d{2}-\d{2}-\d{2})\.zip"/.exec(res.headers.get('content-disposition') ?? '');
  expect(m, `content-disposition: ${res.headers.get('content-disposition')}`).not.toBeNull();
  const zip = readZip(res.body);
  if (!zip.ok) throw new Error(`ZIP ilegível: ${zip.error}`);
  expect(zip.bad, 'entrada com CRC-32 errado').toBeNull();
  return { prep: prep.data, res, zip, root: m![1]! };
}

/** Nomes relativos à pasta raiz do ZIP (todas as entradas precisam estar dentro dela). */
function relNames(zip: Extract<ZipRead, { ok: true }>, root: string): string[] {
  for (const e of zip.entries) expect(e.name.startsWith(`${root}/`), e.name).toBe(true);
  return zip.entries.map((e) => e.name.slice(root.length + 1)).sort();
}

/** Lê uma resposta de erro JSON (409 etc.) garantindo que não veio um ZIP no lugar. */
async function expectJsonError(res: Response, status: number): Promise<ApiError['error']> {
  const body = Buffer.from(await res.arrayBuffer());
  expect(res.status, body.toString('utf8').slice(0, 300)).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  expect(isZipBytes(body)).toBe(false);
  expect(res.headers.get('x-content-sha256')).toBeNull();
  return (JSON.parse(body.toString('utf8')) as ApiError).error;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SHA-256: DTO, relatório e cabeçalho batem com os bytes reais', () => {
  let c: Client;
  let sid: string;
  let iphone: AssetDTO;
  let photo: AssetDTO;
  /** iphone.mov, modo rápido (cópia de fluxos), duas vezes seguidas, e uma vez só com GPS. */
  let v1: JobDetail;
  let v2: JobDetail;
  let vGps: JobDetail;
  /** photo.jpg, limpeza sem perdas, duas vezes seguidas. */
  let p1: JobDetail;
  let p2: JobDetail;

  beforeAll(async () => {
    c = new Client(srv.base);
    [iphone, photo] = (await c.importOk(fx('iphone.mov'), fx('photo.jpg'))) as [AssetDTO, AssetDTO];
    sid = await sessionId(c);
    // Em sequência: a segunda tarefa só valida depois que a primeira já está concluída.
    v1 = (await c.processOk(iphone.id, { mode: 'quick' }))[0]!;
    v2 = (await c.processOk(iphone.id, { mode: 'quick' }))[0]!;
    vGps = (await c.processOk(iphone.id, { mode: 'quick', metadata: { remove: { ...NONE, gps: true } } }))[0]!;
    p1 = (await c.processOk(photo.id, { mode: 'quick' }))[0]!;
    p2 = (await c.processOk(photo.id, { mode: 'quick' }))[0]!;
  });

  it('o SHA-256 anunciado (DTO, relatório, X-Content-SHA256) é o SHA-256 real dos bytes baixados e do arquivo em disco', async () => {
    for (const [job, ext] of [[v1, 'mov'], [vGps, 'mov'], [p1, 'jpg']] as const) {
      const r = await c.download(job.output!.downloadUrl);
      expect(r.status).toBe(200);
      const real = sha256(r.body);
      expect(r.headers.get('x-content-sha256'), job.label).toBe(real);
      expect(job.output!.sha256).toBe(real);
      expect(job.report!.output.sha256).toBe(real);
      expect(job.report!.integrity.algorithm).toBe('SHA-256');
      expect(job.report!.integrity.outputSha256).toBe(real);
      expect(r.body.length).toBe(job.output!.size);
      expect(job.report!.output.size).toBe(r.body.length);
      expect(fileSha(outputPath(sid, job))).toBe(real);
      expect(r.headers.get('content-disposition')).toContain('attachment');
      // A detalhe da tarefa consultado de novo traz o mesmo hash.
      expect((await c.job(job.id)).output!.sha256).toBe(real);
      // Os bytes são mídia válida (não basta o hash bater).
      const file = tmpFile(r.body, ext);
      const { v } = mainStreams(file);
      if (ext === 'mov') {
        expect(v.codec_name).toBe('h264');
        expect([v.width, v.height]).toEqual([640, 360]);
      } else {
        expect(v.codec_name).toBe('mjpeg');
        expect([v.width, v.height].sort()).toEqual([300, 400]);
      }
      expect(decodeErrors(file)).toEqual([]);
    }
  });

  it('o hash da entrada (importação e relatório) é o SHA-256 do arquivo original, que segue intacto após o processamento', () => {
    for (const [job, asset, name] of [[v1, iphone, 'iphone.mov'], [vGps, iphone, 'iphone.mov'], [p1, photo, 'photo.jpg']] as const) {
      const original = fileSha(fx(name));
      expect(asset.sha256).toBe(original);
      const r = job.report!;
      expect(r.input.name).toBe(name);
      expect(r.input.sha256).toBe(original);
      expect(r.input.size).toBe(fs.statSync(fx(name)).size);
      expect(r.integrity.inputSha256AtImport).toBe(original);
      expect(r.integrity.inputSha256BeforeProcessing).toBe(original);
      expect(r.integrity.inputUnchangedAfterProcessing).toBe(true);
      // A cópia armazenada da entrada continua byte a byte igual ao original.
      expect(fileSha(path.join(sessionArea(srv.dataDir, sid, 'uploads'), `${asset.id}.${asset.ext}`))).toBe(original);
      // Metadados removidos: a saída não é a entrada (e o relatório diz isso).
      expect(r.integrity.outputSha256).not.toBe(original);
      expect(r.integrity.outputIdenticalToInput).toBe(false);
    }
  });

  it('controle negativo: entrada alterada no armazenamento depois da importação → tarefa falha com "input-changed"; restaurada, o reprocessamento registra o hash real', async () => {
    // Prova que inputSha256BeforeProcessing é recalculado dos bytes (e não copiado do hash da importação).
    const other = new Client(srv.base);
    const [asset] = (await other.importOk(fx('plain.mp4'))) as [AssetDTO];
    const osid = await sessionId(other);
    const stored = path.join(sessionArea(srv.dataDir, osid, 'uploads'), `${asset.id}.${asset.ext}`);
    expect(fileSha(stored)).toBe(asset.sha256);
    const flip = flipByte(stored);
    let jobId: string;
    try {
      expect(fs.statSync(stored).size).toBe(asset.size);
      expect(fileSha(stored)).not.toBe(asset.sha256);
      [jobId] = (await other.batch([asset.id], { mode: 'quick' })) as [string];
      const [failed] = await other.waitJobs([jobId]);
      expect(failed!.status, failed!.error ?? '').toBe('failed');
      expect(failed!.errorCode).toBe('input-changed');
      expect(failed!.error).toBe('O arquivo de origem foi alterado desde a importação (SHA-256 diferente). Importe-o novamente.');
      expect(failed!.output).toBeNull();
      expect(fs.readdirSync(outputsDir(osid))).toEqual([]);
    } finally {
      flip.restore();
    }
    expect(fileSha(stored)).toBe(asset.sha256);
    const retry = await other.post(`/api/jobs/${jobId}/retry`);
    expect(retry.status, JSON.stringify(retry.data)).toBe(200);
    const [ok] = await other.waitJobs([jobId]);
    expect(ok!.status, ok!.error ?? '').toBe('completed');
    expect(ok!.report!.integrity.inputSha256BeforeProcessing).toBe(fileSha(fx('plain.mp4')));
    expect(ok!.report!.integrity.inputUnchangedAfterProcessing).toBe(true);
    expect(fileSha(path.join(outputsDir(osid), ok!.output!.name))).toBe(ok!.output!.sha256);
  });

  it('duas saídas idênticas (mesmo arquivo, mesma configuração sem perdas) aparecem em identicalOutputs', async () => {
    for (const [first, second, strategy] of [[v1, v2, 'stream-copy'], [p1, p2, 'image-lossless']] as const) {
      expect(first.report!.strategy).toBe(strategy);
      expect(second.report!.strategy).toBe(strategy);
      // Dois arquivos distintos em disco, com o mesmo conteúdo.
      expect(second.output!.name).not.toBe(first.output!.name);
      const a = await c.download(first.output!.downloadUrl);
      const b = await c.download(second.output!.downloadUrl);
      expect(b.body.equals(a.body), `${second.output!.name} difere de ${first.output!.name}`).toBe(true);
      expect(second.output!.sha256).toBe(sha256(a.body));
      expect(fs.statSync(outputPath(sid, first)).ino).not.toBe(fs.statSync(outputPath(sid, second)).ino);
      // A segunda aponta a primeira; a primeira não tinha nenhuma igual quando foi validada.
      expect(second.report!.integrity.identicalOutputs).toEqual([first.output!.name]);
      expect(first.report!.integrity.identicalOutputs).toEqual([]);
    }
    // Outra configuração (só GPS removido) gera bytes diferentes: nenhuma "idêntica" listada.
    expect(vGps.output!.sha256).not.toBe(v1.output!.sha256);
    expect(vGps.report!.integrity.identicalOutputs).toEqual([]);
  });

  it('a nota de integridade diz que o SHA-256 NÃO mede semelhança de conteúdo nem originalidade', async () => {
    for (const job of [v1, p1]) {
      const note = job.report!.integrity.note;
      expect(note).toMatch(/SHA-256 comprova integridade técnica/);
      expect(note).toMatch(/não mede semelhança de conteúdo/);
      expect(note).toMatch(/não indica originalidade/);
      // O relatório baixado (mascarado) mantém a mesma nota e o mesmo hash.
      const rep = await c.download(job.output!.reportUrl);
      expect(rep.status).toBe(200);
      const parsed = JSON.parse(rep.body.toString('utf8')) as JobReport;
      expect(parsed.integrity.note).toBe(note);
      expect(parsed.integrity.outputSha256).toBe(job.output!.sha256);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/jobs/:id/verify e download com a saída alterada no disco', () => {
  let c: Client;
  let sid: string;
  let job: JobDetail;
  let file: string;
  let pristine: Buffer;

  beforeAll(async () => {
    c = new Client(srv.base);
    const [plain] = await c.importOk(fx('plain.mp4'));
    sid = await sessionId(c);
    job = (await c.processOk(plain!.id, { mode: 'quick' }))[0]!;
    file = outputPath(sid, job);
    pristine = fs.readFileSync(file);
  });

  const verify = () => c.raw('GET', `/api/jobs/${job.id}/verify`);
  const download = () => c.raw('GET', `/api/jobs/${job.id}/download`);

  async function expectOk() {
    const v = await c.get(`/api/jobs/${job.id}/verify`);
    expect(v.status).toBe(200);
    expect(v.data).toEqual({ ok: true, size: pristine.length, sha256: sha256(pristine) });
    const d = await c.download(job.output!.downloadUrl);
    expect(d.status).toBe(200);
    expect(sha256(d.body)).toBe(job.output!.sha256);
    expect(d.headers.get('x-content-sha256')).toBe(job.output!.sha256);
  }

  it('verify confirma a saída íntegra com tamanho e SHA-256 reais', async () => {
    expect(sha256(pristine)).toBe(job.output!.sha256);
    expect(pristine.length).toBe(job.output!.size);
    await expectOk();
  });

  it('1 byte alterado (mesmo tamanho): verify e download respondem 409 "SHA-256 diferente"; ao restaurar, voltam a 200', async () => {
    const flip = flipByte(file);
    try {
      expect(fs.statSync(file).size).toBe(pristine.length);
      expect(fileSha(file)).not.toBe(job.output!.sha256);
      for (const req of [verify, download]) {
        const err = await expectJsonError(await req(), 409);
        expect(err.code).toBe('export-failed');
        expect(err.message).toBe(`Arquivo de saída alterado (SHA-256 diferente): ${job.output!.name}`);
      }
    } finally {
      flip.restore();
    }
    expect(fileSha(file)).toBe(job.output!.sha256);
    await expectOk();
  });

  it('tamanho alterado (byte a mais ou a menos): verify e download respondem 409 "tamanho diferente"', async () => {
    try {
      for (const mutate of [() => fs.appendFileSync(file, Buffer.from([0])), () => fs.truncateSync(file, pristine.length - 1)]) {
        fs.writeFileSync(file, pristine);
        mutate();
        expect(fs.statSync(file).size).not.toBe(pristine.length);
        for (const req of [verify, download]) {
          const err = await expectJsonError(await req(), 409);
          expect(err.code).toBe('export-failed');
          expect(err.message).toBe(`Arquivo de saída alterado (tamanho diferente): ${job.output!.name}`);
        }
      }
    } finally {
      fs.writeFileSync(file, pristine);
    }
    await expectOk();
  });

  it('saída apagada do disco: verify e download respondem 409 "ausente"', async () => {
    fs.rmSync(file);
    try {
      for (const req of [verify, download]) {
        const err = await expectJsonError(await req(), 409);
        expect(err.message).toBe(`Arquivo de saída ausente: ${job.output!.name}`);
      }
    } finally {
      fs.writeFileSync(file, pristine);
    }
    await expectOk();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('exportação ZIP', () => {
  let c: Client;
  let sid: string;
  let assets: { iphone: AssetDTO; photo: AssetDTO; plain: AssetDTO };
  let jobs: { iphone: JobDetail; photo: JobDetail; plain: JobDetail };
  let all: Awaited<ReturnType<typeof exportZip>>;

  const source = { iphone: 'iphone.mov', photo: 'photo.jpg', plain: 'plain.mp4' } as const;
  const folderOf = (j: JobDetail) => (j.output!.kind === 'image' ? 'imagens' : 'videos');
  const mediaPath = (j: JobDetail) => `${folderOf(j)}/${j.output!.name}`;
  const reportPath = (j: JobDetail) => `relatorios/${j.output!.name}.json`;

  beforeAll(async () => {
    c = new Client(srv.base);
    const [iphone, photo, plain] = (await c.importOk(fx('iphone.mov'), fx('photo.jpg'), fx('plain.mp4'))) as [AssetDTO, AssetDTO, AssetDTO];
    assets = { iphone, photo, plain };
    sid = await sessionId(c);
    const byAsset = await processAll(c, [iphone, photo, plain], { mode: 'quick' });
    jobs = { iphone: byAsset.get(iphone.id)!, photo: byAsset.get(photo.id)!, plain: byAsset.get(plain.id)! };
    all = await exportZip(c, null);
  });

  it('POST /api/exports (tudo) + GET url entregam um ZIP íntegro com videos/, imagens/, relatorios/ e os três relatórios gerais', () => {
    const list = Object.values(jobs);
    expect(all.prep.count).toBe(3);
    expect(all.prep.totalBytes).toBe(list.reduce((s, j) => s + fs.statSync(outputPath(sid, j)).size, 0));
    expect(all.prep.url).toBe(`/api/exports/${all.prep.id}`);
    expect(all.res.headers.get('content-type')).toMatch(/^application\/zip/);
    expect(all.res.headers.get('cache-control')).toBe('private, no-store');
    expect(isZipBytes(all.res.body)).toBe(true);
    expect(jobs.iphone.output!.kind).toBe('video');
    expect(jobs.plain.output!.kind).toBe('video');
    expect(jobs.photo.output!.kind).toBe('image');
    expect(relNames(all.zip as Extract<ZipRead, { ok: true }>, all.root)).toEqual(
      [...list.map(mediaPath), ...list.map(reportPath), 'relatorio.json', 'RELATORIO.txt', 'SHA256SUMS.txt'].sort(),
    );
  });

  it('cada mídia do ZIP tem exatamente os bytes da saída registrada (SHA-256 e tamanho) e é decodificável', () => {
    const z = all.zip as Extract<ZipRead, { ok: true }>;
    for (const [k, j] of Object.entries(jobs) as Array<[keyof typeof jobs, JobDetail]>) {
      const name = `${all.root}/${mediaPath(j)}`;
      expect(z.sha(name), name).toBe(j.output!.sha256);
      expect(z.sha(name)).toBe(fileSha(outputPath(sid, j)));
      expect(z.entries.find((e) => e.name === name)!.size).toBe(j.output!.size);
      const extracted = path.join(z.dir, ...name.split('/'));
      expect(decodeErrors(extracted), name).toEqual([]);
      const { v } = mainStreams(extracted);
      expect(v.codec_name).toBe(k === 'photo' ? 'mjpeg' : 'h264');
    }
  });

  it('cada linha de SHA256SUMS.txt bate com o SHA-256 real da entrada extraída', () => {
    const z = all.zip as Extract<ZipRead, { ok: true }>;
    const text = z.read(`${all.root}/SHA256SUMS.txt`).toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    const listed: string[] = [];
    for (const line of lines) {
      const m = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
      expect(m, `linha fora do formato do sha256sum: ${JSON.stringify(line)}`).not.toBeNull();
      const [, hex, rel] = m!;
      expect(z.sha(`${all.root}/${rel}`), rel).toBe(hex);
      listed.push(rel!);
    }
    expect(listed.sort()).toEqual(Object.values(jobs).map(mediaPath).sort());
    // Conferência por uma ferramenta independente (coreutils), quando disponível.
    if (process.platform === 'linux') {
      const r = spawnSync('sha256sum', ['--check', '--strict', 'SHA256SUMS.txt'], { cwd: path.join(z.dir, all.root), encoding: 'utf8' });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout.trim().split('\n').sort()).toEqual(listed.map((p) => `${p}: OK`).sort());
    }
  });

  it('relatorio.json, RELATORIO.txt e relatorios/*.json trazem os hashes reais de origem e saída e a nota de integridade', () => {
    const z = all.zip as Extract<ZipRead, { ok: true }>;
    const manifest = JSON.parse(z.read(`${all.root}/relatorio.json`).toString('utf8')) as {
      geradoEm: string;
      arquivos: Array<{ arquivo: string; sha256: string; bytes: number; origem: string; origemSha256: string; validacao: string; rotulo: string }>;
    };
    expect(Number.isNaN(Date.parse(manifest.geradoEm))).toBe(false);
    expect(manifest.arquivos).toHaveLength(3);
    const txt = z.read(`${all.root}/RELATORIO.txt`).toString('utf8');
    expect(txt).toContain('Ele não mede semelhança de conteúdo nem originalidade editorial.');
    for (const [k, j] of Object.entries(jobs) as Array<[keyof typeof jobs, JobDetail]>) {
      const origSha = fileSha(fx(source[k]));
      const entry = manifest.arquivos.find((a) => a.arquivo === mediaPath(j))!;
      expect(entry, mediaPath(j)).toBeDefined();
      expect(entry.sha256).toBe(z.sha(`${all.root}/${mediaPath(j)}`));
      expect(entry.bytes).toBe(j.output!.size);
      expect(entry.origem).toBe(source[k]);
      expect(entry.origemSha256).toBe(origSha);
      expect(entry.validacao).toBe(j.validationStatus);
      expect(entry.rotulo).toBe(j.label);

      expect(txt).toContain(`  Origem: ${source[k]} (SHA-256 ${origSha})`);
      expect(txt).toContain(`  SHA-256: ${j.output!.sha256}`);

      const rep = JSON.parse(z.read(`${all.root}/${reportPath(j)}`).toString('utf8')) as JobReport;
      expect(rep.job.id).toBe(j.id);
      expect(rep.output.sha256).toBe(j.output!.sha256);
      expect(rep.integrity.outputSha256).toBe(j.output!.sha256);
      expect(rep.integrity.inputSha256AtImport).toBe(origSha);
      expect(rep.integrity.inputUnchangedAfterProcessing).toBe(true);
      expect(rep.integrity.note).toMatch(/não mede semelhança de conteúdo/);
    }
  });

  it('os relatórios exportados mascaram valores sensíveis da origem (GPS, aparelho, comentário, autor)', async () => {
    const z = all.zip as Extract<ZipRead, { ok: true }>;
    const secrets = [
      SENSITIVE.videoModel,
      SENSITIVE.videoIso6709,
      '+37.7749',
      '-122.4194',
      SENSITIVE.videoComment,
      SENSITIVE.jpegModel,
      SENSITIVE.jpegArtist,
      SENSITIVE.jpegSerial,
      SENSITIVE.jpegLens,
      SENSITIVE.jpegXmpCity,
      SENSITIVE.jpegComment,
    ];
    // Não é vácuo: os relatórios completos (?raw=1) contêm esses valores.
    const rawIphone = (await c.download(`${jobs.iphone.output!.reportUrl}?raw=1`)).body.toString('utf8');
    const rawPhoto = (await c.download(`${jobs.photo.output!.reportUrl}?raw=1`)).body.toString('utf8');
    for (const s of [SENSITIVE.videoModel, '+37.7749', SENSITIVE.videoComment]) expect(rawIphone, s).toContain(s);
    for (const s of [SENSITIVE.jpegModel, SENSITIVE.jpegArtist]) expect(rawPhoto, s).toContain(s);

    const textual = z.entries.map((e) => e.name).filter((n) => /\/(relatorios\/.*\.json|relatorio\.json|RELATORIO\.txt|SHA256SUMS\.txt)$/.test(n));
    expect(textual).toHaveLength(6);
    for (const name of textual) {
      const t = z.read(name).toString('utf8');
      for (const s of secrets) expect(t.includes(s), `"${s}" aparece em ${name}`).toBe(false);
    }
    // Os itens continuam listados, com o valor trocado pela máscara.
    const rep = JSON.parse(z.read(`${all.root}/${reportPath(jobs.iphone)}`).toString('utf8')) as JobReport;
    const model = rep.metadata.removed.find((i) => i.id === 'fmt:com.apple.quicktime.model');
    expect(model, 'item do modelo do aparelho').toBeDefined();
    expect(model!.sensitive).toBe(true);
    expect(model!.value).toMatch(/^••• \(valor omitido/);
    const location = rep.metadata.removed.find((i) => i.id === 'fmt:com.apple.quicktime.location.iso6709');
    expect(location!.value).toMatch(/^••• \(valor omitido/);
  });

  it('exportação seletiva (jobIds) contém só os resultados escolhidos', async () => {
    const chosen = [jobs.photo, jobs.plain];
    const sel = await exportZip(
      c,
      chosen.map((j) => j.id),
    );
    expect(sel.prep.count).toBe(2);
    expect(sel.prep.totalBytes).toBe(jobs.photo.output!.size + jobs.plain.output!.size);
    const z = sel.zip as Extract<ZipRead, { ok: true }>;
    expect(relNames(z, sel.root)).toEqual(
      [...chosen.map(mediaPath), ...chosen.map(reportPath), 'relatorio.json', 'RELATORIO.txt', 'SHA256SUMS.txt'].sort(),
    );
    for (const j of chosen) expect(z.sha(`${sel.root}/${mediaPath(j)}`)).toBe(j.output!.sha256);
    const manifest = JSON.parse(z.read(`${sel.root}/relatorio.json`).toString('utf8')) as { arquivos: Array<{ arquivo: string; sha256: string }> };
    expect(manifest.arquivos.map((a) => a.arquivo).sort()).toEqual(chosen.map(mediaPath).sort());
    // SHA256SUMS.txt: exatamente uma linha "hash  caminho" por mídia escolhida (nada além disso),
    // com o hash real de cada uma, terminando em "\n".
    const sums = z.read(`${sel.root}/SHA256SUMS.txt`).toString('utf8');
    const sumLines = sums.split('\n');
    expect(sumLines.pop(), 'SHA256SUMS.txt deve terminar com quebra de linha').toBe('');
    expect(sumLines.sort()).toEqual(chosen.map((j) => `${sha256(z.read(`${sel.root}/${mediaPath(j)}`))}  ${mediaPath(j)}`).sort());
    const everything = z.entries.map((e) => e.name).join('\n');
    expect(everything).not.toContain(jobs.iphone.output!.name);
    expect(sums).not.toContain(jobs.iphone.output!.sha256);
    expect(z.read(`${sel.root}/RELATORIO.txt`).toString('utf8')).not.toContain(jobs.iphone.output!.sha256);
  });

  it('ids de outra sessão são recusados ao preparar e ao baixar; nada é exportado', async () => {
    const other = new Client(srv.base);
    const [own] = await other.importOk(fx('plain.mp4'));
    const ownJob = (await other.processOk(own!.id, { mode: 'quick' }))[0]!;
    expect(await sessionId(other)).not.toBe(sid);

    const attempts: Array<[Client, string[]]> = [
      [other, [jobs.photo.id]],
      [other, [ownJob.id, jobs.photo.id]],
      [c, [jobs.photo.id, ownJob.id]],
    ];
    for (const [who, jobIds] of attempts) {
      const r = await who.post<ApiError>('/api/exports', { jobIds });
      expect(r.status, JSON.stringify(jobIds)).toBe(409);
      expect(r.data.error.code).toBe('export-failed');
      expect(r.data.error.message).toMatch(/não pertencem a esta sessão/);
    }
    // A exportação preparada por uma sessão não pode ser baixada por outra.
    const stolen = await other.raw('GET', all.prep.url);
    expect((await expectJsonError(stolen, 404)).message).toMatch(/não encontrada/);
    // Nem as saídas individuais.
    expect((await other.raw('GET', `/api/jobs/${jobs.photo.id}/verify`)).status).toBe(404);
    expect((await other.raw('GET', `/api/jobs/${jobs.photo.id}/download`)).status).toBe(404);
    // A própria tarefa da outra sessão exporta normalmente (sanidade do cenário).
    const okOther = await exportZip(other, [ownJob.id]);
    expect(okOther.prep.count).toBe(1);
    expect((okOther.zip as Extract<ZipRead, { ok: true }>).sha(`${okOther.root}/videos/${ownJob.output!.name}`)).toBe(ownJob.output!.sha256);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('exportação: mudanças entre preparar e baixar', () => {
  let c: Client;
  let sid: string;
  let plain: JobDetail;
  let photo: JobDetail;

  beforeAll(async () => {
    c = new Client(srv.base);
    const [a, b] = (await c.importOk(fx('plain.mp4'), fx('photo.jpg'))) as [AssetDTO, AssetDTO];
    sid = await sessionId(c);
    const byAsset = await processAll(c, [a, b], { mode: 'quick' });
    plain = byAsset.get(a.id)!;
    photo = byAsset.get(b.id)!;
  });

  it('Regressão FI-2: 1 byte alterado (mesmo tamanho) depois de preparar → o GET do ZIP responde 409 antes de enviar', async () => {
    const prep = await c.post<Prepared>('/api/exports', { jobIds: [plain.id] });
    expect(prep.status).toBe(200);
    const file = outputPath(sid, plain);
    const size = fs.statSync(file).size;
    const flip = flipByte(file);
    try {
      expect(fs.statSync(file).size).toBe(size);
      expect(fileSha(file)).not.toBe(plain.output!.sha256);
      const res = await c.raw('GET', prep.data.url);
      expect(res.headers.get('content-disposition')).toBeNull();
      const err = await expectJsonError(res, 409);
      expect(err.code).toBe('export-failed');
      expect(err.message).toBe('Verificação dos arquivos falhou; nada foi exportado.');
      expect(err.details).toEqual([`Arquivo de saída alterado (SHA-256 diferente): ${plain.output!.name}`]);
      // Preparar de novo com o arquivo alterado também é recusado (nenhuma exportação nova é criada).
      const again = await c.post<ApiError>('/api/exports', { jobIds: [plain.id, photo.id] });
      expect(again.status).toBe(409);
      expect(again.data.error.message).toBe('Verificação dos arquivos falhou; nada foi exportado.');
      expect(again.data.error.details).toEqual([`Arquivo de saída alterado (SHA-256 diferente): ${plain.output!.name}`]);
    } finally {
      flip.restore();
    }
    // Arquivo restaurado: a mesma exportação volta a sair íntegra.
    const res = await c.download(prep.data.url);
    expect(res.status).toBe(200);
    const z = readZip(res.body);
    expect(z.ok).toBe(true);
    if (z.ok) {
      expect(z.bad).toBeNull();
      const media = z.entries.find((e) => e.name.endsWith(`/videos/${plain.output!.name}`))!;
      expect(z.sha(media.name)).toBe(plain.output!.sha256);
    }
  });

  it('mesmo com tamanho e mtime restaurados (cache de verificação), o ZIP nunca sai válido com o conteúdo alterado', async () => {
    const prep = await c.post<Prepared>('/api/exports', { jobIds: [plain.id] });
    expect(prep.status).toBe(200);
    const file = outputPath(sid, plain);
    // Copia os carimbos de tempo com precisão de nanossegundos (touch -r) para restaurá-los depois.
    const ref = path.join(tempDir('mf-mtime-'), 'ref');
    fs.writeFileSync(ref, '');
    execFileSync('touch', ['-r', file, ref]);
    const before = fs.statSync(file, { bigint: true });
    const flip = flipByte(file);
    execFileSync('touch', ['-r', ref, file]);
    try {
      const after = fs.statSync(file, { bigint: true });
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(fileSha(file)).not.toBe(plain.output!.sha256);

      const res = await c.raw('GET', prep.data.url);
      if (res.status === 409) {
        expect((await expectJsonError(res, 409)).details).toEqual([`Arquivo de saída alterado (SHA-256 diferente): ${plain.output!.name}`]);
      } else {
        // O servidor confiou no cache e começou a enviar: a verificação durante o envio
        // precisa interromper o download (corpo truncado ou ZIP inválido).
        expect(res.status).toBe(200);
        let body: Buffer | null = null;
        try {
          body = Buffer.from(await res.arrayBuffer());
        } catch {
          body = null;
        }
        if (body) {
          const z = readZip(body);
          expect(z.ok, 'o GET entregou um ZIP válido com o conteúdo alterado').toBe(false);
        }
      }
    } finally {
      flip.restore();
    }
    expect(fileSha(file)).toBe(plain.output!.sha256);
  });

  it('tarefa removida entre preparar e baixar → 409 (não um ZIP incompleto em silêncio)', async () => {
    const prep = await c.post<Prepared>('/api/exports', { jobIds: [plain.id, photo.id] });
    expect(prep.status).toBe(200);
    expect(prep.data.count).toBe(2);
    const del = await c.json('DELETE', `/api/jobs/${photo.id}`);
    expect(del.status).toBe(200);
    expect(fs.existsSync(outputPath(sid, photo))).toBe(false);

    const err = await expectJsonError(await c.raw('GET', prep.data.url), 409);
    expect(err.code).toBe('export-failed');
    expect(err.message).toBe('Alguns resultados desta exportação foram removidos. Prepare a exportação novamente.');

    // Uma nova exportação de "tudo" só tem o que restou, íntegro.
    const again = await exportZip(c, null);
    expect(again.prep.count).toBe(1);
    const z = again.zip as Extract<ZipRead, { ok: true }>;
    expect(relNames(z, again.root)).toEqual(
      [`videos/${plain.output!.name}`, `relatorios/${plain.output!.name}.json`, 'relatorio.json', 'RELATORIO.txt', 'SHA256SUMS.txt'].sort(),
    );
    expect(z.sha(`${again.root}/videos/${plain.output!.name}`)).toBe(plain.output!.sha256);
  });

  it('saída apagada do disco entre preparar e baixar → 409 "ausente"', async () => {
    const prep = await c.post<Prepared>('/api/exports', { jobIds: [plain.id] });
    expect(prep.status).toBe(200);
    const file = outputPath(sid, plain);
    const keep = fs.readFileSync(file);
    fs.rmSync(file);
    try {
      const err = await expectJsonError(await c.raw('GET', prep.data.url), 409);
      expect(err.details).toEqual([`Arquivo de saída ausente: ${plain.output!.name}`]);
    } finally {
      fs.writeFileSync(file, keep);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(process.platform !== 'linux')('Regressão FI-3: downloads de ZIP abortados não deixam descritores abertos', () => {
  let c: Client;
  let dir: string;
  let url: string;
  let jobs: JobDetail[];

  beforeAll(async () => {
    c = new Client(srv.base);
    const [plain, long] = (await c.importOk(fx('plain.mp4'), fx('long.mp4'))) as [AssetDTO, AssetDTO];
    const sid = await sessionId(c);
    dir = outputsDir(sid);
    const byAsset = await processAll(c, [plain, long], { mode: 'quick' });
    jobs = [byAsset.get(plain.id)!, byAsset.get(long.id)!];
    // Saída grande (~18 MB) para o servidor ainda estar enviando quando o cliente desiste.
    expect(jobs[1]!.output!.size).toBeGreaterThan(10 * 1024 * 1024);
    const prep = await c.post<Prepared>('/api/exports', {});
    expect(prep.status).toBe(200);
    expect(prep.data.count).toBe(2);
    url = prep.data.url;
  });

  /**
   * Espera (com prazo) não haver descritores em outputs/. O hash feito ao preparar
   * resolve no 'end' da leitura e o fs.ReadStream fecha o fd logo depois, de forma
   * assíncrona: a linha de base precisa de polling, não de leitura instantânea.
   * Um vazamento real nunca chega a zero e estoura o prazo.
   */
  const settledEmpty = (what: string) => waitFor(() => openFdsInside(dir), (v) => v.length === 0, 10_000, what);

  /** Inicia o download do ZIP e lê pelo menos `minBytes`; devolve o controle para abortar. */
  async function startDownload(minBytes: number) {
    const ac = new AbortController();
    const res = await fetch(srv.base + url, { headers: { cookie: c.cookie }, signal: ac.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let got = 0;
    let head: Buffer | null = null;
    while (got < minBytes) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`download terminou antes de ${minBytes} bytes`);
      if (!head) head = Buffer.from(value);
      got += value.byteLength;
    }
    expect(isZipBytes(head!)).toBe(true);
    return {
      got,
      abort() {
        ac.abort();
        reader.cancel().catch(() => undefined);
      },
    };
  }

  it('a sonda enxerga o arquivo de saída aberto pelo servidor durante um download pausado', async () => {
    // O servidor roda neste mesmo processo (helpers/server.ts chama buildApp + listen aqui).
    await settledEmpty('linha de base antes do download');
    const dl = await startDownload(1);
    const open = await waitFor(() => openFdsInside(dir), (v) => v.length >= 1, 10_000, 'descritor aberto em outputs/');
    const outputs = new Set(jobs.map((j) => path.join(dir, j.output!.name)));
    for (const p of open) expect(outputs.has(p), p).toBe(true);
    dl.abort();
    expect(await settledEmpty('fechamento após abortar')).toEqual([]);
  });

  it('10 downloads abortados depois dos primeiros bytes: nenhum descritor fica aberto em outputs/', async () => {
    await settledEmpty('linha de base antes dos abortos');
    const thresholds = [1, 16 << 10, 64 << 10, 200 << 10, 300 << 10, 512 << 10, 1 << 20, 2 << 20, 4 << 20, 8 << 20];
    const openAtAbort: number[] = [];
    for (const min of thresholds) {
      const dl = await startDownload(min);
      openAtAbort.push(openFdsInside(dir).length);
      dl.abort();
    }
    // Pelo menos parte dos abortos aconteceu com arquivo de saída aberto (senão o teste não provaria nada).
    expect(Math.max(...openAtAbort), `abertos no momento do aborto: ${openAtAbort}`).toBeGreaterThanOrEqual(1);
    expect(await settledEmpty('fechamento dos descritores após 10 abortos')).toEqual([]);

    // O servidor segue saudável: um download completo sai íntegro e também não deixa nada aberto.
    const full = await c.download(url);
    expect(full.status).toBe(200);
    const z = readZip(full.body);
    if (!z.ok) throw new Error(z.error);
    expect(z.bad).toBeNull();
    for (const j of jobs) {
      const e = z.entries.find((x) => x.name.endsWith(`/videos/${j.output!.name}`))!;
      expect(z.sha(e.name)).toBe(j.output!.sha256);
    }
    expect(await settledEmpty('fechamento após download completo')).toEqual([]);
  });
});
