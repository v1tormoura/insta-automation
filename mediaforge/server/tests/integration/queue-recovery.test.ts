import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetDTO, BatchDTO, HistoryEntryDTO, JobDTO, JobPhase, SystemInfoDTO } from '@mediaforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { DataDirLockedError } from '../../src/services/dataDirLock';
import { Client, type JobDetail } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { decodeErrors, listFiles, mainStreams, sessionArea, sessionId, sha256 } from '../helpers/inspecaoMidia';
import { tmpFile } from '../helpers/media';
import {
  buildAppInChildProcess,
  buildTruncatedPair,
  ffmpegProcsIn,
  filesWithSize,
  maxOverlap,
  observeQueue,
  TERMINAL,
  waitFor,
  type Snapshot,
} from '../helpers/queue-recovery-util';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Fila persistente sobre SQLite: concorrência, progresso, cancelamento (inclusive
 * o tardio), isolamento de falhas, recuperação após encerramento/queda, bloqueio
 * do DATA_DIR e limpeza de temporários. Tudo com servidor real, FFmpeg real e
 * conferência independente das saídas (ffprobe, decodificação, SHA-256, disco).
 */

const fast = { speed: 'fast' as const };
/** Recodifica 4 s de 1280×720 (≈2–3 s de FFmpeg): longa o bastante para observar a fila. */
const REENCODE_4S = { mode: 'custom', video: fast, trim: { start: 0, end: 4 } };
/** Recodifica 8 s de 1280×720 (≈4–5 s de FFmpeg). */
const REENCODE_8S = { mode: 'custom', video: fast, trim: { start: 0, end: 8 } };
/** Recodifica 19 s de 1280×720 (≈6–8 s): janela larga para cancelar, encerrar ou disputar o DATA_DIR. */
const REENCODE_19S = { mode: 'custom', video: fast, trim: { start: 0.5, end: 19.5 } };
/** Recorte de 1,5 s a partir de 4 s: no MP4 truncado esses dados não existem e o FFmpeg sai com erro. */
const TRIM_TAIL = { mode: 'custom', video: fast, trim: { start: 4, end: 5.5 } };

const PHASES: JobPhase[] = ['aguardando', 'preparando', 'processando', 'validando', 'finalizando'];
type QueueStats = SystemInfoDTO['queue'];

let srv: TestServer;
let c: Client;
let sid: string;
/** Quatro cópias de long.mp4 (1280×720, 20 s) com nomes distintos. */
let longs: AssetDTO[];
let plain: AssetDTO;
let inteiro: AssetDTO;
let metade: AssetDTO;
let work: string;
const extraDirs: string[] = [];
const extraServers: TestServer[] = [];

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-fila-'));
  const pair = buildTruncatedPair(work);
  srv = await startServer({ JOB_MAX_ATTEMPTS: 3 });
  c = new Client(srv.base);
  const assets = await c.importOk(
    ...[1, 2, 3, 4].map((i) => ({ path: fx('long.mp4'), name: `longo-${i}.mp4` })),
    fx('plain.mp4'),
    pair.full,
    pair.half,
  );
  longs = assets.slice(0, 4);
  [plain, inteiro, metade] = assets.slice(4) as [AssetDTO, AssetDTO, AssetDTO];
  // O MP4 truncado passa na importação: o moov (no início) ainda descreve 6 s.
  expect(metade.status).toBe('ready');
  expect(metade.durationSec).toBeCloseTo(6, 1);
  expect(metade.size).toBe(Math.floor(inteiro.size / 2));
  sid = await sessionId(c);
});

afterAll(async () => {
  for (const s of extraServers) await s.close({ keepData: true }).catch(() => undefined);
  await srv?.close();
  for (const d of [work, ...extraDirs]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

// ── Utilitários ───────────────────────────────────────────────────────────

const jobTmp = (dataDir: string, s: string, jobId: string) => path.join(sessionArea(dataDir, s, 'tmp'), `job-${jobId}`);
const hasPartialOutput = (dir: string) => Object.values(filesWithSize(dir)).some((size) => size > 0);

async function createBatch(cl: Client, assetIds: string[], settings: unknown): Promise<{ batchId: string; ids: string[] }> {
  const r = await cl.post<{ batch: BatchDTO; jobs: JobDTO[] }>('/api/batches', { assetIds, scope: 'common', settings });
  if (r.status !== 201) throw new Error(`lote HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { batchId: r.data.batch.id, ids: r.data.jobs.map((j) => j.id) };
}

async function setConcurrency(cl: Client, value: number): Promise<QueueStats> {
  const r = await cl.json<QueueStats>('PUT', '/api/system/concurrency', { value });
  expect(r.status).toBe(200);
  expect(r.data.concurrency).toBe(value);
  return r.data;
}

async function jobsById(cl: Client): Promise<Map<string, JobDTO>> {
  const r = await cl.get<JobDTO[]>('/api/jobs');
  expect(r.status).toBe(200);
  return new Map(r.data.map((j) => [j.id, j]));
}

async function history(cl: Client): Promise<string[]> {
  return (await cl.get<HistoryEntryDTO[]>('/api/history')).data.map((h) => h.message);
}

/**
 * Saída concluída de verdade: download com SHA-256 e tamanho anunciados, mesmo
 * conteúdo no disco (outputs/), e vídeo H.264 conferido pelo ffprobe e por uma
 * decodificação completa sem erros.
 */
async function expectValidOutput(cl: Client, dataDir: string, s: string, j: JobDTO, exp: { durationSec: number; width: number; height: number }) {
  expect(j.status, `${j.assetName} · ${j.label}: ${j.error}`).toBe('completed');
  expect(j.validationStatus).not.toBe('failed');
  const out = j.output!;
  const r = await cl.download(out.downloadUrl);
  expect(r.status).toBe(200);
  const hash = sha256(r.body);
  expect(hash).toBe(out.sha256);
  expect(r.headers.get('x-content-sha256')).toBe(hash);
  expect(r.body.length).toBe(out.size);
  expect(sha256(fs.readFileSync(path.join(sessionArea(dataDir, s, 'outputs'), out.name)))).toBe(hash);
  const file = tmpFile(r.body, 'mp4');
  const { v, a, duration } = mainStreams(file);
  expect(v?.codec_name).toBe('h264');
  expect([v?.width, v?.height]).toEqual([exp.width, exp.height]);
  expect(a?.codec_type).toBe('audio');
  expect(Math.abs(duration - exp.durationSec), `duração ${duration} s, esperado ${exp.durationSec} s`).toBeLessThan(0.2);
  expect(decodeErrors(file)).toEqual([]);
  return hash;
}

/** outputs/ e miniaturas de tarefas contêm exatamente o que pertence às tarefas concluídas (nada órfão). */
async function expectNoOrphanOutputs(cl: Client, dataDir: string, s: string) {
  const jobs = [...(await jobsById(cl)).values()];
  const done = jobs.filter((j) => j.status === 'completed');
  expect(fs.readdirSync(sessionArea(dataDir, s, 'outputs')).sort()).toEqual(done.map((j) => j.output!.name).sort());
  const thumbs = fs.readdirSync(sessionArea(dataDir, s, 'thumbs')).filter((n) => n.startsWith('job-'));
  expect(thumbs.sort()).toEqual(done.filter((j) => j.output!.thumbnailUrl).map((j) => `job-${j.id}.jpg`).sort());
  for (const j of jobs.filter((x) => x.status !== 'completed')) expect(j.output, `${j.id} (${j.status}) não pode ter saída`).toBeNull();
}

// ── Concorrência e progresso ─────────────────────────────────────────────

interface Observed {
  ids: string[];
  snaps: Snapshot[];
  final: JobDetail[];
}
const observed: Observed[] = [];

describe('concorrência configurável', () => {
  it('com 1, nunca há mais de uma tarefa em execução e as três rodam em sequência, na ordem do lote', async () => {
    const stats = await setConcurrency(c, 1);
    expect(stats.maxConcurrency).toBe(4);
    expect((await c.get<SystemInfoDTO>('/api/system')).data.queue.concurrency).toBe(1);

    const { batchId, ids } = await createBatch(c, longs.slice(0, 3).map((a) => a.id), REENCODE_4S);
    const snaps = await observeQueue(c, ids, batchId);
    const final = await c.waitJobs(ids);
    observed.push({ ids, snaps, final });

    expect(Math.max(...snaps.map((s) => s.running))).toBe(1);
    expect(Math.max(...snaps.map((s) => s.queueRunning))).toBe(1);
    // Foi visto de fato: uma rodando e as outras duas aguardando.
    expect(snaps.some((s) => s.running === 1 && ids.filter((id) => s.jobs.get(id)!.status === 'queued').length === 2)).toBe(true);

    // Pelos instantes registrados: intervalos [início, fim) sem sobreposição, na ordem do lote.
    const byStart = [...final].sort((a, b) => a.startedAt! - b.startedAt!);
    expect(byStart.map((j) => j.id)).toEqual(ids);
    for (let i = 1; i < byStart.length; i++) expect(byStart[i]!.startedAt!).toBeGreaterThanOrEqual(byStart[i - 1]!.finishedAt!);
    expect(maxOverlap(final.map((j) => [j.startedAt!, j.finishedAt!]))).toBe(1);

    for (const j of final) await expectValidOutput(c, srv.dataDir, sid, j, { durationSec: 4, width: 1280, height: 720 });
  });

  it('ajustada para 2 com a fila em andamento: a segunda começa na hora, chegam a 2 simultâneas e nunca passam disso', async () => {
    await setConcurrency(c, 1);
    const { batchId, ids } = await createBatch(c, longs.map((a) => a.id), REENCODE_4S);
    await waitFor(
      () => jobsById(c),
      (m) => m.get(ids[0]!)!.status === 'running' && ids.slice(1).every((id) => m.get(id)!.status === 'queued'),
      30_000,
      'uma tarefa rodando e três na fila',
    );
    const tPut = Date.now();
    const stats = await setConcurrency(c, 2);
    // O ajuste vale imediatamente: a resposta já mostra a segunda tarefa iniciada.
    expect(stats.running).toBe(2);
    expect(stats.queued).toBe(2);

    const snaps = await observeQueue(c, ids, batchId);
    const final = await c.waitJobs(ids);
    observed.push({ ids, snaps, final });

    expect(Math.max(...snaps.map((s) => s.running))).toBe(2);
    expect(Math.max(...snaps.map((s) => s.queueRunning))).toBe(2);
    const [j0, j1] = ids.map((id) => final.find((j) => j.id === id)!) as [JobDetail, JobDetail];
    expect(j1.startedAt!).toBeGreaterThanOrEqual(tPut);
    expect(j1.startedAt!).toBeLessThan(j0.finishedAt!);
    expect(maxOverlap(final.map((j) => [j.startedAt!, j.finishedAt!]))).toBe(2);
    // Ordem FIFO de início.
    const starts = ids.map((id) => final.find((j) => j.id === id)!.startedAt!);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    for (const j of final) await expectValidOutput(c, srv.dataDir, sid, j, { durationSec: 4, width: 1280, height: 720 });
  });

  it('progresso por tarefa e do lote avança; início, fim e duração ficam registrados e coerentes', () => {
    expect(observed).toHaveLength(2);
    for (const run of observed) {
      for (const id of run.ids) {
        const fin = run.final.find((j) => j.id === id)!;
        const seen = run.snaps.map((s) => ({ s, j: s.jobs.get(id)! }));
        const running = seen.filter((x) => x.j.status === 'running');
        expect(running.length, `amostras em execução de ${fin.assetName}`).toBeGreaterThan(5);

        // Progresso nunca regride e as fases seguem a ordem.
        for (let i = 1; i < running.length; i++) {
          expect(running[i]!.j.progress).toBeGreaterThanOrEqual(running[i - 1]!.j.progress);
          expect(PHASES.indexOf(running[i]!.j.phase!)).toBeGreaterThanOrEqual(PHASES.indexOf(running[i - 1]!.j.phase!));
        }
        const phases = new Set(running.map((x) => x.j.phase));
        expect(phases.has('processando')).toBe(true);
        expect(phases.has('validando')).toBe(true);
        // Durante o FFmpeg o progresso anda (vários valores intermediários, não só saltos de fase).
        const mid = new Set(running.filter((x) => x.j.phase === 'processando' && x.j.progress > 0.05 && x.j.progress < 0.85).map((x) => x.j.progress));
        expect(mid.size, `valores de progresso em processamento: ${[...mid].join(', ')}`).toBeGreaterThanOrEqual(2);

        for (const x of seen.filter((y) => y.j.status === 'queued')) {
          expect(x.j.phase).toBe('aguardando');
          expect(x.j.progress).toBe(0);
          expect(x.j.startedAt).toBeNull();
        }
        for (const x of running) expect(x.j.startedAt).toBe(fin.startedAt);

        expect(fin.status).toBe('completed');
        expect(fin.phase).toBeNull();
        expect(fin.progress).toBe(1);
        expect(fin.attempts).toBe(1);
        expect(fin.startedAt!).toBeGreaterThanOrEqual(fin.createdAt);
        expect(fin.finishedAt!).toBeGreaterThan(fin.startedAt!);
        expect(fin.durationMs).toBe(fin.finishedAt! - fin.startedAt!);
        // Coerência com o que foi observado (mesmo relógio): início antes da 1ª leitura "running",
        // fim depois da última leitura "running" e antes da 1ª leitura "completed".
        expect(fin.startedAt!).toBeLessThanOrEqual(running[0]!.s.tRecv);
        expect(fin.finishedAt!).toBeGreaterThanOrEqual(running.at(-1)!.s.tSent);
        const firstDone = seen.find((x) => x.j.status === 'completed');
        if (firstDone) expect(fin.finishedAt!).toBeLessThanOrEqual(firstDone.s.tRecv);
        const lastQueued = seen.filter((x) => x.j.status === 'queued').at(-1);
        if (lastQueued) expect(fin.startedAt!).toBeGreaterThanOrEqual(lastQueued.s.tSent);
        // O relatório registra os mesmos instantes.
        expect(fin.report!.job.startedAt).toBe(new Date(fin.startedAt!).toISOString());
        expect(fin.report!.job.finishedAt).toBe(new Date(fin.finishedAt!).toISOString());
        expect(fin.report!.job.durationMs).toBe(fin.durationMs);
        expect(fin.report!.job.attempts).toBe(1);
      }

      // Progresso geral do lote: só cresce, passa por vários valores intermediários e termina em 1.
      const bp = run.snaps.map((s) => s.batch!.progress);
      for (let i = 1; i < bp.length; i++) expect(bp[i]!).toBeGreaterThanOrEqual(bp[i - 1]! - 1e-9);
      expect(new Set(bp.filter((p) => p > 0 && p < 1)).size).toBeGreaterThanOrEqual(5);
      const last = run.snaps.at(-1)!.batch!;
      expect(last.progress).toBe(1);
      expect(last.counts).toMatchObject({ completed: run.ids.length, total: run.ids.length, running: 0, queued: 0 });
    }
  });
});

// ── Cancelamento ──────────────────────────────────────────────────────────

describe('cancelamento', () => {
  it('na fila: vira "canceled" sem nunca rodar; em execução: "canceled", FFmpeg encerrado, sem saída e sem temporários', async () => {
    await setConcurrency(c, 1);
    const outputsDir = sessionArea(srv.dataDir, sid, 'outputs');
    const outputsBefore = fs.readdirSync(outputsDir).sort();
    const { ids } = await createBatch(c, [longs[0]!.id, longs[1]!.id], REENCODE_19S);
    const [runId, queuedId] = ids as [string, string];
    const runDir = jobTmp(srv.dataDir, sid, runId);
    const queuedDir = jobTmp(srv.dataDir, sid, queuedId);

    expect((await c.job(queuedId)).status).toBe('queued');
    const rq = await c.post(`/api/jobs/${queuedId}/cancel`);
    expect(rq).toEqual({ status: 200, data: { ok: true } });
    const q = await c.job(queuedId);
    expect(q).toMatchObject({
      status: 'canceled',
      phase: null,
      attempts: 0,
      startedAt: null,
      durationMs: null,
      errorCode: 'canceled',
      error: 'Cancelada antes de iniciar.',
      output: null,
      report: null,
    });
    expect(q.finishedAt).toBeGreaterThanOrEqual(q.createdAt);

    // Espera a outra em pleno FFmpeg, com saída parcial gravada no temporário.
    let queuedDirEverSeen = false;
    const running = await waitFor(
      async () => {
        queuedDirEverSeen ||= fs.existsSync(queuedDir);
        return c.job(runId);
      },
      (j) => j.status === 'running' && j.phase === 'processando' && j.progress > 0.1 && hasPartialOutput(runDir),
      30_000,
      'tarefa em processamento com saída parcial',
    );
    expect(running.attempts).toBe(1);
    expect(ffmpegProcsIn(runDir)).toHaveLength(1);

    const rr = await c.post(`/api/jobs/${runId}/cancel`);
    expect(rr).toEqual({ status: 200, data: { ok: true } });
    const canceled = await waitFor(
      async () => {
        queuedDirEverSeen ||= fs.existsSync(queuedDir);
        return c.job(runId);
      },
      (j) => TERMINAL.has(j.status),
      30_000,
      'fim da tarefa cancelada',
    );
    expect(canceled).toMatchObject({ status: 'canceled', phase: null, attempts: 1, errorCode: 'canceled', error: 'Cancelada durante o processamento.', output: null });
    expect(canceled.progress).toBeLessThan(0.85); // parou no processamento
    expect(canceled.durationMs).toBe(canceled.finishedAt! - canceled.startedAt!);
    expect(fs.existsSync(runDir)).toBe(false);
    expect(ffmpegProcsIn(runDir)).toEqual([]);
    expect(fs.readdirSync(outputsDir).sort()).toEqual(outputsBefore);
    expect(fs.existsSync(path.join(sessionArea(srv.dataDir, sid, 'thumbs'), `job-${runId}.jpg`))).toBe(false);
    expect((await c.download(`/api/jobs/${runId}/download`)).status).toBeGreaterThanOrEqual(400);

    // Com a vaga livre, a fila não pega a tarefa cancelada antes de rodar.
    await waitFor(() => c.get<SystemInfoDTO>('/api/system'), (r) => r.data.queue.running === 0 && r.data.queue.queued === 0, 15_000, 'fila vazia');
    expect(await c.job(queuedId)).toMatchObject({ status: 'canceled', attempts: 0, startedAt: null, output: null });
    expect(queuedDirEverSeen || fs.existsSync(queuedDir)).toBe(false);

    // Já terminadas: novo cancelamento é recusado.
    for (const id of ids) {
      const again = await c.post(`/api/jobs/${id}/cancel`);
      expect(again.status).toBe(409);
      expect(again.data.error.code).toBe('not-cancelable');
    }
    expect(await history(c)).toContain(`Cancelada: ${canceled.label}`);
  });

  it('cancelamento tardio (regressão): se o cancelamento responde ok:true, a tarefa nunca termina "completed" com saída', async () => {
    await setConcurrency(c, 2);
    type Round = { target: JobPhase; extraPolls: number; cancel: { status: number; data: any } | null; final: JobDetail };
    /**
     * Polling rápido (≈1–3 ms por leitura) até a fase-alvo; dispara POST cancel
     * depois de N leituras extras (ou logo que a tarefa terminar).
     */
    const round = async (target: JobPhase, extraPolls: number): Promise<Round> => {
      const {
        ids: [id],
      } = await createBatch(c, [plain.id], { mode: 'quick' });
      let cancel: Round['cancel'] = null;
      let since = -1;
      const deadline = Date.now() + 30_000;
      while (!cancel) {
        const j = await c.job(id!);
        if (since < 0 && j.phase === target) since = 0;
        if (since >= 0 && (since++ >= extraPolls || TERMINAL.has(j.status))) cancel = await c.post(`/api/jobs/${id}/cancel`);
        else if (TERMINAL.has(j.status)) break; // a fase-alvo passou sem ser vista
        if (Date.now() > deadline) throw new Error(`tarefa ${id} não chegou à fase ${target}`);
      }
      const final = await waitFor(() => c.job(id!), (j) => TERMINAL.has(j.status), 30_000, 'fim da tarefa');
      return { target, extraPolls, cancel, final };
    };
    const results: Round[] = [];
    // 1) Pontos fixos dentro da validação e da finalização.
    for (const k of [0, 20, 80]) results.push(await round('validando', k));
    for (const k of [0, 1, 3, 6, 12, 25]) results.push(await round('finalizando', k));
    // 2) Procura o fim da finalização: dobra N até o cancelamento chegar tarde (409).
    let lo = 25;
    let hi = -1;
    for (let k = 50; hi < 0 && k <= 3200; k *= 2) {
      const r = await round('finalizando', k);
      results.push(r);
      if (r.cancel?.status === 409) hi = k;
      else lo = k;
    }
    // 3) Bissecção em torno do instante da conclusão: é ali que mora a corrida.
    for (let i = 0; i < 6 && hi > lo + 1; i++) {
      const k = Math.floor((lo + hi) / 2);
      const r = await round('finalizando', k);
      results.push(r);
      if (r.cancel?.status === 409) hi = k;
      else lo = k;
    }

    const summary = results.map((r) => `${r.target}+${r.extraPolls}: HTTP ${r.cancel?.status ?? '-'} → ${r.final.status} (progresso ${r.final.progress})`).join('\n');
    expect(results.filter((r) => r.cancel).length, summary).toBeGreaterThanOrEqual(results.length - 2);
    // A fronteira foi cercada: houve cancelamento tarde demais (409, tarefa concluída) na finalização.
    expect(hi, summary).toBeGreaterThan(0);
    for (const r of results) {
      if (!r.cancel) continue;
      expect([200, 409], summary).toContain(r.cancel.status);
      if (r.cancel.status === 200) {
        expect(r.cancel.data).toEqual({ ok: true });
        expect(r.final.status, `cancelamento aceito mas a tarefa terminou "${r.final.status}"\n${summary}`).toBe('canceled');
        expect(r.final.output).toBeNull();
        expect(r.final.errorCode).toBe('canceled');
        expect((await c.download(`/api/jobs/${r.final.id}/download`)).status).toBeGreaterThanOrEqual(400);
      } else {
        expect(r.cancel.data.error.code).toBe('not-cancelable');
        expect(r.final.status).toBe('completed');
        await expectValidOutput(c, srv.dataDir, sid, r.final, { durationSec: 2, width: 320, height: 240 });
      }
      expect(fs.existsSync(jobTmp(srv.dataDir, sid, r.final.id))).toBe(false);
    }
    // A janela foi atingida de fato: cancelamentos aceitos com a tarefa já na
    // validação (progresso 0,85–0,98) e já na finalização (progresso 0,98).
    const accepted = results.filter((r) => r.cancel?.status === 200);
    expect(accepted.some((r) => r.final.progress >= 0.85 && r.final.progress < 0.98), summary).toBe(true);
    expect(accepted.some((r) => r.final.progress >= 0.98), summary).toBe(true);
    // Nenhuma saída nem miniatura órfã de tarefa cancelada no fim.
    await expectNoOrphanOutputs(c, srv.dataDir, sid);
  });
});

// ── Isolamento de falhas e repetição ─────────────────────────────────────

describe('isolamento de falhas e repetição', () => {
  let batchId: string;
  let badId: string;
  let goodIds: string[];
  let goodBefore: JobDTO[];
  const countHistory = (msgs: string[], prefix: string) => msgs.filter((m) => m.startsWith(prefix)).length;

  it('no lote, só o MP4 truncado falha (FFmpeg com erro), com tentativas até maxAttempts; as outras concluem', async () => {
    await setConcurrency(c, 2);
    const created = await createBatch(c, [inteiro.id, metade.id, longs[2]!.id], TRIM_TAIL);
    batchId = created.batchId;
    const ids = created.ids;
    badId = ids[1]!;
    goodIds = [ids[0]!, ids[2]!];
    const snaps = await observeQueue(c, ids, batchId);
    const final = await c.waitJobs(ids);
    const bad = final.find((j) => j.id === badId)!;

    // Nenhuma leitura mostrou mais tentativas que o máximo.
    expect(Math.max(...snaps.map((s) => s.jobs.get(badId)!.attempts))).toBeLessThanOrEqual(3);
    expect(bad).toMatchObject({ status: 'failed', errorCode: 'ffmpeg-failed', attempts: 3, maxAttempts: 3, output: null, phase: null });
    expect(bad.error).toMatch(/^FFmpeg terminou com código \d+/);
    expect(bad.logTail).toMatch(/partial file|Invalid NAL unit size|Decod/i);
    expect(bad.durationMs).toBe(bad.finishedAt! - bad.startedAt!);
    expect(fs.existsSync(jobTmp(srv.dataDir, sid, badId))).toBe(false);

    goodBefore = goodIds.map((id) => final.find((j) => j.id === id)!);
    const [gInteiro, gLong] = goodBefore as [JobDTO, JobDTO];
    expect(gInteiro.attempts).toBe(1);
    expect(gLong.attempts).toBe(1);
    await expectValidOutput(c, srv.dataDir, sid, gInteiro, { durationSec: 1.5, width: 640, height: 360 });
    await expectValidOutput(c, srv.dataDir, sid, gLong, { durationSec: 1.5, width: 1280, height: 720 });

    const batch = (await c.get<BatchDTO[]>('/api/batches')).data.find((b) => b.id === batchId)!;
    expect(batch.counts).toMatchObject({ completed: 2, failed: 1, running: 0, queued: 0, total: 3 });
    const h = await history(c);
    expect(countHistory(h, 'Nova tentativa agendada: metade.mp4')).toBe(2);
    expect(countHistory(h, 'Falhou: metade.mp4')).toBe(1);
    expect(countHistory(h, 'Falhou: inteiro.mp4') + countHistory(h, 'Nova tentativa agendada: inteiro.mp4')).toBe(0);
  });

  it('POST /api/jobs/:id/retry recoloca a tarefa com erro na fila (tentativas zeradas) e só aceita tarefas com erro/canceladas', async () => {
    // Ocupa a única vaga para observar a tarefa parada na fila.
    await setConcurrency(c, 1);
    const {
      ids: [blocker],
    } = await createBatch(c, [longs[3]!.id], REENCODE_4S);
    await waitFor(() => c.job(blocker!), (j) => j.status === 'running', 30_000, 'tarefa ocupando a vaga');
    const prev = await c.job(badId);

    const r = await c.post(`/api/jobs/${badId}/retry`);
    expect(r).toEqual({ status: 200, data: { ok: true } });
    expect(await c.job(badId)).toMatchObject({
      status: 'queued',
      phase: 'aguardando',
      progress: 0,
      attempts: 0,
      error: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      report: null,
      output: null,
    });
    // Concluída, em execução ou já na fila: não dá para repetir.
    for (const id of [goodIds[0]!, blocker!, badId]) {
      const again = await c.post(`/api/jobs/${id}/retry`);
      expect(again.status).toBe(409);
      expect(again.data.error.code).toBe('not-retryable');
    }

    const [fin] = await c.waitJobs([badId]);
    const [blk] = await c.waitJobs([blocker!]);
    expect(blk!.status).toBe('completed');
    // Rodou de novo depois da que ocupava a vaga, e de novo esgotou exatamente maxAttempts.
    expect(fin).toMatchObject({ status: 'failed', errorCode: 'ffmpeg-failed', attempts: 3, maxAttempts: 3, output: null });
    expect(fin!.startedAt!).toBeGreaterThan(prev.finishedAt!);
    expect(fin!.startedAt!).toBeGreaterThanOrEqual(blk!.finishedAt!);
    const h = await history(c);
    expect(countHistory(h, 'Nova tentativa agendada: metade.mp4')).toBe(4);
    expect(countHistory(h, 'Falhou: metade.mp4')).toBe(2);
  });

  it('repetir o lote reenvia só as tarefas com erro; as concluídas ficam intactas (sem saídas duplicadas)', async () => {
    await setConcurrency(c, 2);
    const outputsDir = sessionArea(srv.dataDir, sid, 'outputs');
    const outputsBefore = fs.readdirSync(outputsDir).sort();
    const r = await c.post(`/api/batches/${batchId}/retry`);
    expect(r).toEqual({ status: 200, data: { retried: 1 } });
    const [fin] = await c.waitJobs([badId]);
    expect(fin).toMatchObject({ status: 'failed', attempts: 3, maxAttempts: 3, errorCode: 'ffmpeg-failed' });

    const now = await jobsById(c);
    for (const g of goodBefore) {
      const cur = now.get(g.id)!;
      expect(cur).toMatchObject({ status: 'completed', attempts: 1, startedAt: g.startedAt, finishedAt: g.finishedAt, durationMs: g.durationMs });
      expect(cur.output!.sha256).toBe(g.output!.sha256);
      expect(cur.output!.name).toBe(g.output!.name);
    }
    expect(fs.readdirSync(outputsDir).sort()).toEqual(outputsBefore);
    const h = await history(c);
    expect(countHistory(h, 'Nova tentativa agendada: metade.mp4')).toBe(6);
    expect(countHistory(h, 'Falhou: metade.mp4')).toBe(3);
    const batch = (await c.get<BatchDTO[]>('/api/batches')).data.find((b) => b.id === batchId)!;
    expect(batch.counts).toMatchObject({ completed: 2, failed: 1, total: 3 });
    // Lote sem tarefas com erro: nada a repetir.
    const okBatch = (await c.get<BatchDTO[]>('/api/batches')).data.find((b) => b.counts.failed === 0 && b.counts.completed > 0)!;
    expect((await c.post(`/api/batches/${okBatch.id}/retry`)).data).toEqual({ retried: 0 });
  });
});

// ── Limpeza de temporários ────────────────────────────────────────────────

describe('limpeza de temporários órfãos', () => {
  it('remove temporários órfãos e velhos, mas nunca o diretório de uma tarefa em execução', async () => {
    await setConcurrency(c, 2);
    const tmp = sessionArea(srv.dataDir, sid, 'tmp');
    const {
      ids: [id],
    } = await createBatch(c, [longs[1]!.id], REENCODE_8S);
    const dir = jobTmp(srv.dataDir, sid, id!);
    await waitFor(() => c.job(id!), (j) => j.status === 'running' && j.phase === 'processando' && hasPartialOutput(dir), 30_000, 'saída parcial no temporário');
    const before = filesWithSize(dir);

    const hourAgo2 = new Date(Date.now() - 2 * 3600_000);
    const min20Ago = new Date(Date.now() - 20 * 60_000);
    const orphanJob = path.join(tmp, 'job-ZZZZZZZZZZZZ');
    fs.mkdirSync(orphanJob);
    fs.writeFileSync(path.join(orphanJob, 'parcial.mp4'), Buffer.alloc(4096, 1));
    fs.writeFileSync(path.join(tmp, 'upload-antigo'), Buffer.alloc(2048, 2));
    fs.utimesSync(path.join(tmp, 'upload-antigo'), hourAgo2, hourAgo2);
    fs.writeFileSync(path.join(tmp, 'upload-recente'), Buffer.alloc(2048, 3));
    fs.mkdirSync(path.join(tmp, 'preview-antiga'));
    fs.writeFileSync(path.join(tmp, 'preview-antiga', 'p.mp4'), Buffer.alloc(1024, 4));
    fs.utimesSync(path.join(tmp, 'preview-antiga'), min20Ago, min20Ago);
    fs.mkdirSync(path.join(tmp, 'preview-recente'));
    const orphanSession = path.join(srv.dataDir, 'sessions', 'sessaoOrfa0001');
    fs.mkdirSync(path.join(orphanSession, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(orphanSession, 'uploads', 'x.mp4'), Buffer.alloc(1024, 5));
    expect(fs.readdirSync(tmp).sort()).toEqual([`job-${id}`, 'job-ZZZZZZZZZZZZ', 'preview-antiga', 'preview-recente', 'upload-antigo', 'upload-recente'].sort());

    const r1 = await srv.mf.deps.cleanup.run();
    expect(r1).toEqual({ sessionsRemoved: 0, orphansRemoved: 1, tmpRemoved: 3 });
    expect(fs.readdirSync(tmp).sort()).toEqual([`job-${id}`, 'preview-recente', 'upload-recente']);
    expect(fs.existsSync(orphanSession)).toBe(false);
    // O diretório da tarefa em execução ficou: todos os arquivos, nenhum encolheu, FFmpeg segue gravando.
    const job1 = await c.job(id!);
    expect(job1.status).toBe('running');
    const after1 = filesWithSize(dir);
    for (const [f, size] of Object.entries(before)) expect(after1[f], f).toBeGreaterThanOrEqual(size);
    if (job1.phase === 'processando') expect(ffmpegProcsIn(dir)).toHaveLength(1);

    // Com o relógio um ano à frente (sessão vencida, todo temporário "velho"): a sessão com
    // tarefa ativa e o diretório da tarefa continuam; só os demais temporários saem.
    const r2 = await srv.mf.deps.cleanup.run(Date.now() + 365 * 24 * 3600_000);
    expect(r2).toEqual({ sessionsRemoved: 0, orphansRemoved: 0, tmpRemoved: 2 });
    expect(fs.readdirSync(tmp)).toEqual([`job-${id}`]);
    expect(await sessionId(c)).toBe(sid);
    const after2 = filesWithSize(dir);
    for (const [f, size] of Object.entries(after1)) expect(after2[f], f).toBeGreaterThanOrEqual(size);

    const [fin] = await c.waitJobs([id!]);
    expect(fin!.attempts).toBe(1);
    await expectValidOutput(c, srv.dataDir, sid, fin!, { durationSec: 8, width: 1280, height: 720 });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

// ── Recuperação após reinício ─────────────────────────────────────────────

describe('recuperação após reinício (mesmo DATA_DIR)', () => {
  it('encerramento gracioso devolve as tarefas em execução à fila; a nova instância as conclui com saída válida', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-fila-reinicio-'));
    extraDirs.push(dataDir);
    const s1 = await startServer({}, { dataDir });
    extraServers.push(s1);
    const c1 = new Client(s1.base);
    const [a1, a2] = (await c1.importOk({ path: fx('long.mp4'), name: 'reinicio-1.mp4' }, { path: fx('long.mp4'), name: 'reinicio-2.mp4' })) as [AssetDTO, AssetDTO];
    const sid1 = await sessionId(c1);
    await setConcurrency(c1, 3);
    // 2 arquivos × 2 partes de 4 s = 4 tarefas; 3 rodando e 1 na fila no momento do encerramento.
    const { batchId, ids } = await createBatch(c1, [a1.id, a2.id], { ...REENCODE_8S, segmentation: { mode: 'count', value: 2 } });
    expect(ids).toHaveLength(4);
    const busy = await waitFor(
      async () => [...(await jobsById(c1)).values()].filter((j) => j.status === 'running' && j.phase === 'processando' && hasPartialOutput(jobTmp(dataDir, sid1, j.id))),
      (v) => v.length === 3,
      30_000,
      'três tarefas no FFmpeg com saída parcial',
    );
    const runningIds = busy.map((j) => j.id);
    const queuedId = ids.find((id) => !runningIds.includes(id))!;
    const dirs = runningIds.map((id) => jobTmp(dataDir, sid1, id));
    for (const d of dirs) expect(ffmpegProcsIn(d)).toHaveLength(1);

    await s1.close({ keepData: true });
    // Encerramento gracioso: FFmpeg encerrado, temporários removidos, nenhuma saída.
    for (const d of dirs) {
      expect(ffmpegProcsIn(d)).toEqual([]);
      expect(fs.existsSync(d)).toBe(false);
    }
    expect(listFiles(sessionArea(dataDir, sid1, 'outputs'))).toEqual([]);

    // Nova instância no mesmo DATA_DIR, fila ainda parada: o estado persistido mostra tudo na fila.
    const s2 = await startServer({}, { dataDir, startQueue: false });
    extraServers.push(s2);
    const c2 = new Client(s2.base);
    c2.cookie = c1.cookie;
    expect(await sessionId(c2)).toBe(sid1);
    const persisted = await jobsById(c2);
    for (const id of ids) {
      expect(persisted.get(id), id).toMatchObject({ status: 'queued', attempts: 0, startedAt: null, finishedAt: null, output: null, progress: 0 });
    }
    for (const id of runningIds) {
      expect(persisted.get(id)).toMatchObject({ phase: null, error: 'Interrompida pelo encerramento do servidor; será retomada.' });
    }
    expect(persisted.get(queuedId)).toMatchObject({ phase: 'aguardando', error: null });
    // A concorrência ajustada também persistiu (3, diferente do padrão 2).
    expect((await c2.get<SystemInfoDTO>('/api/system')).data.queue).toMatchObject({ concurrency: 3, running: 0, queued: 4 });

    const tStart = Date.now();
    await s2.mf.start();
    const snaps = await observeQueue(c2, ids, batchId);
    const final = await c2.waitJobs(ids);
    expect(Math.max(...snaps.map((s) => s.running))).toBe(3);
    for (const j of final) {
      // O encerramento não consome tentativa: uma única tentativa, a desta instância.
      expect(j).toMatchObject({ status: 'completed', attempts: 1, error: null });
      expect(j.startedAt!).toBeGreaterThanOrEqual(tStart);
      await expectValidOutput(c2, dataDir, sid1, j, { durationSec: 4, width: 1280, height: 720 });
    }
    expect(fs.readdirSync(sessionArea(dataDir, sid1, 'outputs'))).toHaveLength(4);
    await expectNoOrphanOutputs(c2, dataDir, sid1);
    await s2.close({ keepData: true });
  });

  it('queda simulada: tarefa deixada em "running" é reenfileirada e concluída; sem tentativas restantes vira falha "interrupted"', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-fila-queda-'));
    extraDirs.push(dataDir);
    // Primeira instância sem fila: só cria as tarefas e "cai" no meio do processamento.
    const s3 = await startServer({ JOB_MAX_ATTEMPTS: 2 }, { dataDir, startQueue: false });
    extraServers.push(s3);
    const c3 = new Client(s3.base);
    const [a] = (await c3.importOk(fx('plain.mp4'))) as [AssetDTO];
    const sid3 = await sessionId(c3);
    const {
      ids: [j1],
    } = await createBatch(c3, [a.id], { mode: 'quick' });
    const {
      ids: [j2],
    } = await createBatch(c3, [a.id], { mode: 'quick' });
    const t0 = Date.now() - 4000;
    s3.mf.ctx.repos.updateJob(j1!, { status: 'running', phase: 'processando', progress: 0.42, attempts: 1, started_at: t0 });
    s3.mf.ctx.repos.updateJob(j2!, { status: 'running', phase: 'validando', progress: 0.9, attempts: 2, started_at: t0 });
    // Restos do processamento interrompido.
    for (const id of [j1!, j2!]) {
      fs.mkdirSync(jobTmp(dataDir, sid3, id), { recursive: true });
      fs.writeFileSync(path.join(jobTmp(dataDir, sid3, id), 'parcial.mp4'), Buffer.alloc(64 * 1024, 7));
    }
    await s3.close({ keepData: true });

    // Reinício: primeiro sem fila, para confirmar que a queda deixou as linhas em "running" no disco.
    const s4 = await startServer({ JOB_MAX_ATTEMPTS: 2 }, { dataDir, startQueue: false });
    extraServers.push(s4);
    const c4 = new Client(s4.base);
    c4.cookie = c3.cookie;
    const crashed = await jobsById(c4);
    expect(crashed.get(j1!)).toMatchObject({ status: 'running', attempts: 1, progress: 0.42, startedAt: t0 });
    expect(crashed.get(j2!)).toMatchObject({ status: 'running', attempts: 2, maxAttempts: 2 });

    const tStart = Date.now();
    await s4.mf.start();
    // A recuperação é feita na partida: sem tentativas restantes → falha "interrupted"; temporários removidos.
    const f2 = await c4.job(j2!);
    expect(f2).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
      error: 'Interrompida por reinicialização do servidor e sem tentativas restantes.',
      attempts: 2,
      phase: null,
      output: null,
    });
    expect(f2.finishedAt!).toBeGreaterThanOrEqual(tStart);
    expect(fs.existsSync(jobTmp(dataDir, sid3, j2!))).toBe(false);

    const [f1] = await c4.waitJobs([j1!]);
    expect(f1).toMatchObject({ status: 'completed', attempts: 2, error: null, phase: null, progress: 1 });
    expect(f1!.startedAt!).toBeGreaterThanOrEqual(tStart);
    await expectValidOutput(c4, dataDir, sid3, f1!, { durationSec: 2, width: 320, height: 240 });
    // O "parcial.mp4" lixo não sobrou em lugar nenhum.
    expect(fs.existsSync(jobTmp(dataDir, sid3, j1!))).toBe(false);
    expect(fs.readdirSync(sessionArea(dataDir, sid3, 'outputs'))).toEqual([f1!.output!.name]);
    const h = await history(c4);
    expect(h.filter((m) => m === `Reenfileirada após reinicialização: ${f1!.label}`)).toHaveLength(1);
    expect(h.filter((m) => m === `Falhou após reinicialização: ${f2.label}`)).toHaveLength(1);
    await s4.close({ keepData: true });
  });
});

// ── Bloqueio do DATA_DIR ──────────────────────────────────────────────────

describe('bloqueio do DATA_DIR (regressão FI-1)', () => {
  it('segunda instância no mesmo DATA_DIR falha com DataDirLockedError sem tocar nos temporários nem nas tarefas da primeira', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-fila-bloqueio-'));
    extraDirs.push(dataDir);
    const s5 = await startServer({}, { dataDir });
    extraServers.push(s5);
    const c5 = new Client(s5.base);
    const [a1, a2] = (await c5.importOk({ path: fx('long.mp4'), name: 'bloqueio-1.mp4' }, { path: fx('long.mp4'), name: 'bloqueio-2.mp4' })) as [AssetDTO, AssetDTO];
    const sid5 = await sessionId(c5);
    await setConcurrency(c5, 2);
    const { ids } = await createBatch(c5, [a1.id, a2.id], REENCODE_19S);
    const dirs = ids.map((id) => jobTmp(dataDir, sid5, id));
    await waitFor(
      async () => Promise.all(ids.map((id) => c5.job(id))),
      (js) => js.every((j) => j.status === 'running' && j.phase === 'processando') && dirs.every(hasPartialOutput),
      30_000,
      'duas tarefas no FFmpeg com saída parcial',
    );
    const before = dirs.map(filesWithSize);
    const config = loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'silent', SERVE_WEB: false, MIN_FREE_MEMORY_MB: 0 });

    // Outro processo Node (como uma segunda instância iniciada pelo usuário) e, ao mesmo tempo, no mesmo processo.
    const child = buildAppInChildProcess(dataDir);
    let err: unknown = null;
    try {
      const mf = await buildApp(config, { logger: false });
      await mf.stop();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataDirLockedError);
    expect((err as Error).message).toContain(dataDir);
    const childRes = await child;
    expect(childRes, childRes.stderr).toMatchObject({ ok: false, name: 'DataDirLockedError' });
    expect(childRes.message).toContain(dataDir);

    // As tarefas continuam da primeira instância: em execução, 1 tentativa, temporários intactos.
    const during = await Promise.all(ids.map((id) => c5.job(id)));
    for (const j of during) expect(j).toMatchObject({ status: 'running', attempts: 1 });
    for (const id of ids) expect(s5.mf.ctx.queue.isRunning(id)).toBe(true);
    dirs.forEach((d, i) => {
      const now = filesWithSize(d);
      for (const [f, size] of Object.entries(before[i]!)) expect(now[f], `${d}/${f}`).toBeGreaterThanOrEqual(size);
      if (during[i]!.phase === 'processando') expect(ffmpegProcsIn(d)).toHaveLength(1);
    });

    const final = await c5.waitJobs(ids);
    for (const j of final) {
      expect(j).toMatchObject({ status: 'completed', attempts: 1, error: null });
      await expectValidOutput(c5, dataDir, sid5, j, { durationSec: 19, width: 1280, height: 720 });
    }
    expect((await history(c5)).filter((m) => /após reinicialização/.test(m))).toEqual([]);

    // Depois do stop() da primeira, a segunda abre — e não há nada para ela reivindicar.
    await s5.close({ keepData: true });
    const second = await buildApp(config, { logger: false });
    try {
      await second.start();
      for (const id of ids) expect(second.ctx.repos.jobById(id)).toMatchObject({ status: 'completed', attempts: 1 });
      expect(second.ctx.queue.stats()).toMatchObject({ running: 0, queued: 0 });
      expect(fs.readdirSync(sessionArea(dataDir, sid5, 'outputs')).sort()).toEqual(final.map((j) => j.output!.name).sort());
    } finally {
      await second.stop();
    }
  });
});
