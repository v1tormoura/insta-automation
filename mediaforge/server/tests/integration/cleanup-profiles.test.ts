import fs from 'node:fs';
import path from 'node:path';
import type { AssetDTO, BatchDTO, JobDTO, PlanResponse, SavedProfileDTO, ServerEvent, SessionDTO } from '@mediaforge/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type JobDetail } from '../helpers/client';
import { structural, SseStream, treeHashes, waitFor } from '../helpers/cleanup-profiles-util';
import { fx } from '../helpers/fixtures';
import { decodeErrors, mainStreams, makeReference, sessionArea, sessionId, sha256 } from '../helpers/inspecaoMidia';
import { frameMd5, meanLuma, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Perfis salvos e embutidos, limpeza de sessões expiradas e eventos em tempo
 * real da remoção de tarefas. Tudo contra o servidor real (FFmpeg de verdade):
 * as saídas são medidas com ffprobe, comparadas por SHA-256 e conferidas no disco.
 */

let srv: TestServer;
const streams: SseStream[] = [];

beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await Promise.all(streams.map((s) => s.close()));
  await srv?.close();
});

/** Recodificação lenta (preset "slow" do x264, 20 s de 1280×720): janela larga para observar/cancelar. */
const SLOW = { mode: 'custom', video: { codec: 'h264', speed: 'quality' } };

const zeroCounts = { queued: 0, running: 0, completed: 0, failed: 0, canceled: 0 };

/** Ajustes que o modo Rápido descarta: nenhum deles pode voltar com a promoção de um perfil. */
const QUICK_WITH_HIDDEN = {
  mode: 'quick',
  color: { brightness: 90, contrast: 60, saturation: -40 },
  segmentation: { mode: 'count', value: 4 },
  trim: { start: 0.5, end: 1.5 },
  speed: 2,
  audio: { volume: 3 },
  video: { fps: '60' },
};

const PROMOTION_NOTE =
  'Perfil "Vertical 9:16": o modo Rápido não altera proporção, resolução nem taxa de quadros; este perfil foi processado no modo Personalizado.';

/** Baixa a saída da tarefa conferindo o SHA-256 anunciado; devolve bytes + caminho temporário. */
async function download(c: Client, job: JobDetail | JobDTO, ext: string) {
  const r = await c.download(job.output!.downloadUrl);
  expect(r.status).toBe(200);
  const hash = sha256(r.body);
  expect(r.headers.get('x-content-sha256')).toBe(hash);
  expect(job.output!.sha256).toBe(hash);
  expect(r.body.length).toBe(job.output!.size);
  return { body: r.body, file: tmpFile(r.body, ext) };
}

async function completed(c: Client, ids: string[]): Promise<JobDetail[]> {
  const jobs = await c.waitJobs(ids);
  for (const j of jobs) expect(j.status, `${j.label}: ${j.error}\n${j.logTail ?? ''}`).toBe('completed');
  return jobs;
}

async function createBatch(c: Client, body: Record<string, unknown>): Promise<{ batch: BatchDTO; jobs: JobDTO[] }> {
  const { status, data } = await c.post('/api/batches', body);
  expect(status, JSON.stringify(data)).toBe(201);
  return data;
}

/** Abre o SSE (sessão já criada) e espera o primeiro evento: daí em diante a conexão está inscrita. */
async function openSse(c: Client): Promise<SseStream> {
  await c.get('/api/session');
  const s = await SseStream.open(srv.base, c.cookie);
  streams.push(s);
  expect(s.status).toBe(200);
  expect(s.contentType).toMatch(/^text\/event-stream/);
  await s.until(0, (evs) => evs.length > 0, 10_000, 'primeiro evento do SSE');
  expect(s.events[0]!.type).toBe('queue');
  expect(s.raw.startsWith('retry: 3000\n\n')).toBe(true);
  return s;
}

/**
 * Fila ociosa + barreira: espera não haver tarefas rodando/na fila e então
 * provoca um evento conhecido (ajuste de concorrência gera um registro de
 * histórico). Quando ele chega, tudo que foi publicado antes já chegou também.
 */
async function quiesce(c: Client, sse: SseStream) {
  const q = await waitFor(
    async () => (await c.get('/api/system')).data.queue as { running: number; queued: number; concurrency: number },
    (v) => v.running === 0 && v.queued === 0,
    60_000,
    'fila ociosa',
  );
  const m = sse.mark();
  const r = await c.json('PUT', '/api/system/concurrency', { value: q.concurrency });
  expect(r.status).toBe(200);
  await sse.until(
    m,
    (evs) => evs.some((e) => e.type === 'history' && e.entry.message === `Processamento simultâneo ajustado para ${q.concurrency}`),
    10_000,
    'evento-barreira',
  );
}

const db = () => srv.mf.ctx.db;
const outputsOf = (dataDir: string, sid: string) => treeHashes(sessionArea(dataDir, sid, 'outputs'));

// ─────────────────────────────────────────────────────────────────────────────

describe('perfis salvos', () => {
  let c: Client;
  let plain: AssetDTO;
  let profile: SavedProfileDTO;
  const NAME = 'Vertical 720 (teste)';
  const SAVED = {
    mode: 'custom',
    output: { format: 'mp4' },
    video: { codec: 'h264', speed: 'fast', quality: 60 },
    audio: { codec: 'aac', bitrateKbps: 128 },
    geometry: { aspect: '9:16', resolution: '720', fit: 'crop' },
  };

  beforeAll(async () => {
    c = new Client(srv.base);
    [plain] = (await c.importOk({ path: fx('plain.mp4'), name: 'perfil-salvo.mp4' })) as [AssetDTO];
  });

  it('cria (201), recusa nome duplicado/configuração inválida e lista o perfil para qualquer sessão', async () => {
    const r = await c.post<SavedProfileDTO>('/api/profiles', { name: NAME, settings: SAVED });
    expect(r.status).toBe(201);
    profile = r.data;
    expect(profile.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(profile.name).toBe(NAME);
    expect(profile.mode).toBe('custom');
    // Guardado já validado e completo (padrões preenchidos pelo esquema).
    expect(profile.settings.geometry).toMatchObject({ aspect: '9:16', resolution: '720', fit: 'crop' });
    expect(profile.settings.output.format).toBe('mp4');
    expect(profile.settings.video).toMatchObject({ codec: 'h264', speed: 'fast', quality: 60, fps: 'original' });
    expect(profile.settings.color).toEqual({ brightness: 0, contrast: 0, saturation: 0 });
    expect(profile.settings.metadata.remove.gps).toBe(true);
    expect(profile.createdAt).toBe(profile.updatedAt);

    // Nome repetido (sem diferenciar maiúsculas) → 409; nada novo é gravado.
    const dup = await c.post('/api/profiles', { name: NAME.toUpperCase(), settings: { mode: 'quick' } });
    expect(dup.status).toBe(409);
    expect(dup.data.error.code).toBe('profile-exists');
    expect(dup.data.error.message).toBe(`Já existe um perfil chamado "${NAME.toUpperCase()}".`);

    const bad = await c.post('/api/profiles', { name: 'Proporção inválida', settings: { mode: 'custom', geometry: { aspect: '3:2' } } });
    expect(bad.status).toBe(400);
    expect(bad.data.error.code).toBe('invalid-request');
    expect(bad.data.error.details.join(' ')).toMatch(/settings\.geometry\.aspect/);
    const empty = await c.post('/api/profiles', { name: '   ', settings: SAVED });
    expect(empty.status).toBe(400);

    // Perfis são da instalação: outra sessão vê exatamente o mesmo registro.
    const other = new Client(srv.base);
    const list = await other.get<SavedProfileDTO[]>('/api/profiles');
    expect(list.status).toBe(200);
    expect(list.data).toEqual([profile]);
    expect(await sessionId(other)).not.toBe(await sessionId(c));
  });

  it('o perfil salvo SUBSTITUI as configurações atuais: plano e saída real 720×1280 (vertical) medida com ffprobe', async () => {
    // Configurações "atuais" bem diferentes: quadrado 480, MOV, brilho alto.
    const current = { mode: 'custom', output: { format: 'mov' }, video: { codec: 'h264', speed: 'fast' }, geometry: { aspect: '1:1', resolution: '480', fit: 'pad' }, color: { brightness: 90 } };
    const body = { assetIds: [plain.id], scope: 'common', settings: current, profiles: [`saved:${profile.id}`] };

    const plan = (await c.post<PlanResponse>('/api/plan', body)).data;
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.jobs).toHaveLength(1);
    const p = plan.jobs[0]!;
    expect(p.profileName).toBe(NAME);
    expect(p.label).toBe(NAME);
    expect(p.outputFormat).toBe('mp4');
    expect(p.expected).toMatchObject({ width: 720, height: 1280, hasAudio: true });
    expect(p.operations.map((o) => o.id)).not.toContain('color');
    expect(p.warnings.filter((w) => w.includes('processado no modo Personalizado'))).toEqual([]);

    const { jobs } = await createBatch(c, body);
    expect(jobs).toHaveLength(1);
    const [job] = await completed(c, [jobs[0]!.id]);
    expect(job!.mode).toBe('custom');
    expect(job!.profileName).toBe(NAME);
    expect(job!.label).toBe(NAME);
    expect(job!.output!.name.endsWith('.mp4')).toBe(true);
    expect([job!.output!.width, job!.output!.height]).toEqual([720, 1280]);

    const out = await download(c, job!, 'mp4');
    const { v, a, format, duration } = mainStreams(out.file);
    expect([v.width, v.height]).toEqual([720, 1280]);
    expect(v.width).toBeLessThan(v.height);
    expect(v.codec_name).toBe('h264');
    expect(a.codec_name).toBe('aac');
    expect(format.tags.major_brand).toBe('isom'); // MP4 do perfil, não o MOV ("qt  ") das configurações atuais
    expect(duration).toBeCloseTo(2, 1);
    expect(decodeErrors(out.file)).toEqual([]);

    const report = job!.report!;
    expect(report.settings.geometry).toMatchObject({ aspect: '9:16', resolution: '720', fit: 'crop' });
    expect(report.settings.color).toEqual({ brightness: 0, contrast: 0, saturation: 0 });
    expect(report.command.join(' ')).not.toContain('eq=');
    // Brilho das configurações atuais (+0,27) somaria ~60 níveis de luma; a saída bate com o recorte central da fonte.
    const ref = makeReference(['-i', fx('plain.mp4'), '-vf', 'crop=ih*9/16:ih,scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-qp', '0', '-an'], 'mp4');
    expect(Math.abs(meanLuma(out.file) - meanLuma(ref))).toBeLessThan(5);
  });

  it('excluído: some da lista, nova exclusão dá 404 e o lote que o usa é recusado com erro claro, sem criar nada', async () => {
    const del = await c.json('DELETE', `/api/profiles/${profile.id}`);
    expect(del.status).toBe(200);
    expect(del.data).toEqual({ ok: true });
    expect((await c.get('/api/profiles')).data).toEqual([]);
    const again = await c.json('DELETE', `/api/profiles/${profile.id}`);
    expect(again.status).toBe(404);
    expect(again.data.error.code).toBe('not-found');

    const jobsBefore = (await c.get<JobDTO[]>('/api/jobs')).data;
    const batchesBefore = (await c.get<BatchDTO[]>('/api/batches')).data;
    const expectedError = { assetId: null, assetName: null, message: `Perfil salvo não encontrado (${profile.id}).` };
    const body = { assetIds: [plain.id], scope: 'common', settings: { mode: 'quick' }, profiles: [`saved:${profile.id}`] };

    const plan = (await c.post<PlanResponse>('/api/plan', body)).data;
    expect(plan).toEqual({ ok: false, jobs: [], errors: [expectedError] });

    const r = await c.post('/api/batches', body);
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe('invalid-batch');
    expect(r.data.error.message).toBe('Há configurações inválidas; nenhuma tarefa foi criada.');
    expect(r.data.error.details).toEqual([expectedError]);

    expect((await c.get<JobDTO[]>('/api/jobs')).data).toEqual(jobsBefore);
    expect((await c.get<BatchDTO[]>('/api/batches')).data).toEqual(batchesBefore);
    expect(Number(db().get<{ n: number }>('SELECT COUNT(*) AS n FROM profiles')!.n)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('perfis embutidos no modo Rápido (regressão UI-02)', () => {
  let c: Client;
  let plain: AssetDTO;
  let vertical: JobDetail;
  let original: JobDetail;
  let batch: BatchDTO;

  beforeAll(async () => {
    c = new Client(srv.base);
    [plain] = (await c.importOk({ path: fx('plain.mp4'), name: 'rapido.mp4' })) as [AssetDTO];
    const created = await createBatch(c, {
      assetIds: [plain.id],
      scope: 'common',
      settings: QUICK_WITH_HIDDEN,
      profiles: ['vertical-9x16', 'original-limpo'],
    });
    batch = created.batch;
    // Uma saída por perfil: a divisão em 4 partes (oculta no modo Rápido) não pode multiplicar as tarefas.
    expect(created.jobs.map((j) => j.label)).toEqual(['Vertical 9:16', 'Original limpo']);
    [vertical, original] = (await completed(c, created.jobs.map((j) => j.id))) as [JobDetail, JobDetail];
  });

  it('/api/plan: quick + vertical-9x16 → 1080×1920 (largura < altura), uma tarefa e aviso de modo Personalizado', async () => {
    const { status, data } = await c.post<PlanResponse>('/api/plan', {
      assetIds: [plain.id],
      scope: 'common',
      settings: QUICK_WITH_HIDDEN,
      profiles: ['vertical-9x16'],
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.errors).toEqual([]);
    expect(data.jobs).toHaveLength(1);
    const p = data.jobs[0]!;
    expect(p.profileName).toBe('Vertical 9:16');
    expect(p.label).toBe('Vertical 9:16');
    expect(p.strategy).toBe('re-encode');
    expect(p.outputFormat).toBe('mp4');
    expect(p.expected.width).toBe(1080);
    expect(p.expected.height).toBe(1920);
    expect(p.expected.width!).toBeLessThan(p.expected.height!);
    // Sem corte/velocidade ocultos: a duração prevista é a da fonte (2 s), não 1 s nem 0,5 s.
    expect(p.expected.durationSec!).toBeCloseTo(2, 1);
    expect(p.warnings).toContain(PROMOTION_NOTE);
    const ops = p.operations.map((o) => o.id);
    for (const hidden of ['color', 'speed', 'segment', 'trim', 'volume']) expect(ops, `operação oculta "${hidden}"`).not.toContain(hidden);

    // Controle: os mesmos ajustes no modo Personalizado SÃO aplicados (4 partes, cor, velocidade, volume),
    // então a ausência acima é efeito da regra do modo Rápido e não de ajustes ignorados.
    const ctl = (
      await c.post<PlanResponse>('/api/plan', { assetIds: [plain.id], scope: 'common', settings: { ...QUICK_WITH_HIDDEN, mode: 'custom' }, profiles: ['vertical-9x16'] })
    ).data;
    expect(ctl.ok).toBe(true);
    expect(ctl.jobs.map((j) => j.label)).toEqual([1, 2, 3, 4].map((i) => `Vertical 9:16 · parte ${i}/4`));
    for (const j of ctl.jobs) {
      expect(j.operations.map((o) => o.id)).toEqual(expect.arrayContaining(['color', 'speed', 'segment', 'volume']));
      expect(j.warnings).not.toContain(PROMOTION_NOTE);
    }
  });

  it('a tarefa promovida produz vídeo vertical real, sem reativar brilho, corte, velocidade, volume nem divisão', () => {
    // Duas saídas (uma por perfil), não 2 × 4 partes.
    expect(batch.counts.total).toBe(2);
    expect(batch.counts.completed + batch.counts.failed + batch.counts.canceled).toBe(0);
    expect(vertical.mode).toBe('custom');
    expect(vertical.profileName).toBe('Vertical 9:16');
    expect(vertical.validationStatus).toBe('passed');
    const r = vertical.report!;
    expect(r.strategy).toBe('re-encode');
    // (O aviso de promoção é do plano — "o plano avisa"; o relatório registra as configurações efetivas.)
    expect(r.job.mode).toBe('custom');
    expect(r.settings.mode).toBe('custom');
    expect(r.settings.color).toEqual({ brightness: 0, contrast: 0, saturation: 0 });
    expect(r.settings.speed).toBe(1);
    expect(r.settings.trim).toEqual({ start: null, end: null });
    expect(r.settings.segmentation.mode).toBe('none');
    expect(r.settings.audio.volume).toBe(1);
    expect(r.settings.video.fps).toBe('30'); // do perfil, não o "60" oculto
    const cmd = r.command.join(' ');
    expect(cmd).not.toContain('eq=');
    expect(cmd).not.toContain('atempo');
    expect(cmd).not.toMatch(/volume=/);
    expect(cmd).not.toMatch(/-ss\b|-to\b/);
  });

  it('ffprobe confirma 1080×1920 H.264 30 fps com a duração inteira, e a luma bate com o recorte sem brilho', async () => {
    const out = await download(c, vertical, 'mp4');
    const { v, a, duration } = mainStreams(out.file);
    expect([v.width, v.height]).toEqual([1080, 1920]);
    expect(v.codec_name).toBe('h264');
    expect(v.r_frame_rate).toBe('30/1');
    expect(a.codec_name).toBe('aac');
    expect(duration).toBeGreaterThan(1.9);
    expect(duration).toBeLessThan(2.15);
    expect(Number(v.nb_frames)).toBe(60);
    expect(decodeErrors(out.file)).toEqual([]);
    const ref = makeReference(['-i', fx('plain.mp4'), '-vf', 'crop=ih*9/16:ih,scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-qp', '0', '-an'], 'mp4');
    expect(Math.abs(meanLuma(out.file) - meanLuma(ref))).toBeLessThan(5);
  });

  it("'original-limpo' no mesmo lote continua no modo Rápido com cópia de fluxo (quadros idênticos à fonte)", async () => {
    expect(original.mode).toBe('quick');
    expect(original.profileName).toBe('Original limpo');
    const r = original.report!;
    expect(r.strategy).toBe('stream-copy');
    expect(r.warnings.filter((w) => w.includes('processado no modo Personalizado'))).toEqual([]);
    expect(r.settings.mode).toBe('quick');
    expect(r.command).toContain('copy');
    expect(r.command.join(' ')).not.toMatch(/libx264|eq=|scale=/);
    const out = await download(c, original, 'mp4');
    const { v, duration } = mainStreams(out.file);
    expect([v.width, v.height]).toEqual([320, 240]);
    expect(duration).toBeCloseTo(2, 1);
    expect(frameMd5(out.file)).toBe(frameMd5(fx('plain.mp4')));

    // O plano isolado do perfil também mostra cópia de fluxo, sem promoção.
    const plan = (await c.post<PlanResponse>('/api/plan', { assetIds: [plain.id], scope: 'common', settings: QUICK_WITH_HIDDEN, profiles: ['original-limpo'] })).data;
    expect(plan.ok).toBe(true);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]!.strategy).toBe('stream-copy');
    expect(plan.jobs[0]!.expected).toMatchObject({ width: 320, height: 240 });
    expect(plan.jobs[0]!.warnings.filter((w) => w.includes('processado no modo Personalizado'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('limpeza de sessão expirada', () => {
  let s2: TestServer;
  const rows = (sid: string) => {
    const count = (table: string, col = 'session_id') => Number(s2.mf.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [sid])!.n);
    return { sessions: count('sessions', 'id'), assets: count('assets'), batches: count('batches'), jobs: count('jobs'), history: count('history'), exports: count('exports') };
  };
  const dirOf = (sid: string) => path.join(s2.dataDir, 'sessions', sid);
  const expire = (sid: string) => s2.mf.ctx.repos.touchSession(sid, Date.now() - s2.mf.ctx.config.sessionTtlMs - 60_000);

  beforeAll(async () => {
    s2 = await startServer();
  });
  afterAll(async () => s2?.close());

  it('cleanup.run() remove o diretório e todos os registros da sessão expirada; a sessão ativa fica intacta', async () => {
    const old = new Client(s2.base);
    const [oldAsset] = (await old.importOk({ path: fx('plain.mp4'), name: 'expira.mp4' })) as [AssetDTO];
    const [oldJob] = await old.processOk(oldAsset.id, { mode: 'quick' });
    const exp = await old.post('/api/exports', { jobIds: null });
    expect(exp.status).toBe(200);
    const sidOld = await sessionId(old);

    const active = new Client(s2.base);
    const [actAsset] = (await active.importOk({ path: fx('noaudio.mp4'), name: 'fica.mp4' })) as [AssetDTO];
    const [actJob] = await active.processOk(actAsset.id, { mode: 'quick' });
    const sidActive = await sessionId(active);
    // A tarefa fica "concluída" no banco um instante antes de o executor apagar o temporário dela.
    await waitFor(() => s2.mf.ctx.queue.stats(), (q) => q.running === 0 && q.queued === 0, 30_000, 'fila ociosa');

    // Antes: a sessão antiga tem arquivos reais e registros em todas as tabelas.
    const oldTree = treeHashes(dirOf(sidOld));
    expect(Object.values(oldTree)).toContain(oldJob!.output!.sha256);
    expect(Object.values(oldTree)).toContain(oldAsset.sha256);
    const oldRows = rows(sidOld);
    expect(oldRows).toMatchObject({ sessions: 1, assets: 1, batches: 1, jobs: 1, exports: 1 });
    expect(oldRows.history).toBeGreaterThanOrEqual(3);
    const activeTree = treeHashes(dirOf(sidActive));
    expect(Object.values(activeTree)).toContain(actJob!.output!.sha256);
    const activeRows = rows(sidActive);
    const activeSession = s2.mf.ctx.repos.sessionById(sidActive);

    expire(sidOld);
    expect(s2.mf.ctx.repos.expiredSessions(Date.now() - s2.mf.ctx.config.sessionTtlMs).map((s) => s.id)).toEqual([sidOld]);
    const result = await s2.mf.deps.cleanup.run();
    expect(result).toEqual({ sessionsRemoved: 1, orphansRemoved: 0, tmpRemoved: 0 });

    expect(fs.existsSync(dirOf(sidOld))).toBe(false);
    expect(rows(sidOld)).toEqual({ sessions: 0, assets: 0, batches: 0, jobs: 0, history: 0, exports: 0 });

    // Sessão ativa: mesmos bytes no disco, mesmos registros, mesmo last_seen_at.
    expect(treeHashes(dirOf(sidActive))).toEqual(activeTree);
    expect(rows(sidActive)).toEqual(activeRows);
    expect(s2.mf.ctx.repos.sessionById(sidActive)).toEqual(activeSession);
    const dl = await active.download(actJob!.output!.downloadUrl);
    expect(dl.status).toBe(200);
    expect(sha256(dl.body)).toBe(actJob!.output!.sha256);

    // O cookie antigo não dá mais acesso a nada: vira uma sessão nova e vazia.
    expect((await old.get(`/api/jobs/${oldJob!.id}`)).status).toBe(404);
    expect((await old.get(`/api/assets/${oldAsset.id}`)).status).toBe(404);
    const fresh = (await old.get<SessionDTO>('/api/session')).data;
    expect(fresh.id).not.toBe(sidOld);
    expect(fresh.counts).toEqual({ assets: 0, jobs: 0, completed: 0 });

    // Segunda passada: nada mais a remover.
    expect(await s2.mf.deps.cleanup.run()).toEqual({ sessionsRemoved: 0, orphansRemoved: 0, tmpRemoved: 0 });
  });

  it('sessão expirada com tarefa em execução não é removida; depois que a tarefa termina, é', async () => {
    const busy = new Client(s2.base);
    const [asset] = (await busy.importOk({ path: fx('long.mp4'), name: 'ocupada.mp4' })) as [AssetDTO];
    const sid = await sessionId(busy);
    const { jobs } = await createBatch(busy, { assetIds: [asset.id], scope: 'common', settings: SLOW });
    const jobId = jobs[0]!.id;
    const repos = s2.mf.ctx.repos;
    // Daqui em diante só leituras em processo: uma requisição HTTP renovaria o last_seen_at.
    await waitFor(() => repos.job(sid, jobId)!, (j) => j.status === 'running' && s2.mf.ctx.queue.isRunning(jobId), 30_000, 'tarefa em execução');

    expire(sid);
    const r1 = await s2.mf.deps.cleanup.run();
    expect(r1.sessionsRemoved).toBe(0);
    expect(fs.existsSync(path.join(dirOf(sid), 'uploads', `${asset.id}.mp4`))).toBe(true);
    expect(repos.sessionById(sid)).toBeDefined();
    expect(repos.job(sid, jobId)!.status).toBe('running');
    expect(s2.mf.ctx.queue.isRunning(jobId)).toBe(true);

    expect(s2.mf.ctx.queue.cancel(repos.job(sid, jobId)!)).toBe(true);
    await waitFor(
      () => ({ status: repos.job(sid, jobId)!.status, active: s2.mf.ctx.queue.activeSessions().has(sid) }),
      (v) => v.status === 'canceled' && !v.active,
      30_000,
      'cancelamento concluído',
    );
    const r2 = await s2.mf.deps.cleanup.run();
    expect(r2.sessionsRemoved).toBe(1);
    expect(fs.existsSync(dirOf(sid))).toBe(false);
    expect(rows(sid)).toEqual({ sessions: 0, assets: 0, batches: 0, jobs: 0, history: 0, exports: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('remoção de tarefas e eventos SSE (regressão UI-05)', () => {
  afterEach(async () => {
    await Promise.all(streams.splice(0).map((s) => s.close()));
  });

  it("DELETE /api/jobs/:id publica 'job-removed' e depois 'batch' com contagens; o último publica 'batch-removed'", async () => {
    const c = new Client(srv.base);
    const [a1, a2] = (await c.importOk({ path: fx('plain.mp4'), name: 'evento-1.mp4' }, { path: fx('noaudio.mp4'), name: 'evento-2.mp4' })) as [AssetDTO, AssetDTO];
    const sid = await sessionId(c);
    const sse = await openSse(c);
    const { batch, jobs } = await createBatch(c, { assetIds: [a1.id, a2.id], scope: 'common', settings: { mode: 'quick' } });
    const [j1, j2] = await completed(c, jobs.map((j) => j.id));
    await quiesce(c, sse);

    const out1 = srv.mf.ctx.repos.job(sid, j1!.id)!;
    const out2 = srv.mf.ctx.repos.job(sid, j2!.id)!;
    const outputsDir = sessionArea(srv.dataDir, sid, 'outputs');
    expect(outputsOf(srv.dataDir, sid)).toEqual({ [out1.output_file!]: j1!.output!.sha256, [out2.output_file!]: j2!.output!.sha256 });
    expect(out1.output_thumb).toBeTruthy();
    const thumb1 = path.join(sessionArea(srv.dataDir, sid, 'thumbs'), out1.output_thumb!);
    expect(fs.statSync(thumb1).size).toBeGreaterThan(0);

    const m = sse.mark();
    const del1 = await c.json('DELETE', `/api/jobs/${j1!.id}`);
    expect(del1.status).toBe(200);
    expect(del1.data).toEqual({ ok: true });
    const evs1 = structural(await sse.until(m, (e) => structural(e).length >= 2, 10_000, 'job-removed + batch'));
    expect(evs1[0]).toEqual({ type: 'job-removed', jobId: j1!.id });
    expect(evs1[1]).toMatchObject({ type: 'batch', batch: { id: batch.id, counts: { ...zeroCounts, completed: 1, total: 1 }, progress: 1 } });
    // A lista de lotes da API reflete exatamente o que o evento trouxe.
    const listed = (await c.get<BatchDTO[]>('/api/batches')).data;
    expect(listed).toEqual([(evs1[1] as Extract<ServerEvent, { type: 'batch' }>).batch]);
    expect((await c.get(`/api/jobs/${j1!.id}`)).status).toBe(404);
    // Arquivos da tarefa removida saem do disco; os da outra continuam idênticos.
    expect(fs.existsSync(path.join(outputsDir, out1.output_file!))).toBe(false);
    expect(fs.existsSync(thumb1)).toBe(false);
    expect(outputsOf(srv.dataDir, sid)).toEqual({ [out2.output_file!]: j2!.output!.sha256 });

    const del2 = await c.json('DELETE', `/api/jobs/${j2!.id}`);
    expect(del2.status).toBe(200);
    const all = structural(await sse.until(m, (e) => structural(e).length >= 4, 10_000, 'job-removed + batch-removed'));
    expect(all).toEqual([evs1[0], evs1[1], { type: 'job-removed', jobId: j2!.id }, { type: 'batch-removed', batchId: batch.id }]);
    expect((await c.get<BatchDTO[]>('/api/batches')).data).toEqual([]);
    expect(srv.mf.ctx.repos.batch(sid, batch.id)).toBeUndefined();
    expect(outputsOf(srv.dataDir, sid)).toEqual({});
  });

  it('tarefa ativa não pode ser removida (409) e nada é publicado; depois de cancelada, a remoção funciona', async () => {
    const c = new Client(srv.base);
    const [asset] = (await c.importOk({ path: fx('long.mp4'), name: 'ativa.mp4' })) as [AssetDTO];
    const sse = await openSse(c);
    const { batch, jobs } = await createBatch(c, { assetIds: [asset.id], scope: 'common', settings: SLOW });
    const id = jobs[0]!.id;
    const m = sse.mark();
    const r = await c.json('DELETE', `/api/jobs/${id}`);
    expect(r.status).toBe(409);
    expect(r.data.error).toEqual({ code: 'job-active', message: 'Cancele a tarefa antes de removê-la.' });
    expect(['queued', 'running']).toContain((await c.job(id)).status);

    expect((await c.post(`/api/jobs/${id}/cancel`)).status).toBe(200);
    expect((await c.waitJobs([id]))[0]!.status).toBe('canceled');
    await quiesce(c, sse);
    expect(sse.since(m).filter((e) => e.type === 'job-removed' || e.type === 'batch-removed')).toEqual([]);
    const lastBatch = [...sse.since(m)].reverse().find((e) => e.type === 'batch') as Extract<ServerEvent, { type: 'batch' }>;
    expect(lastBatch.batch.counts).toEqual({ ...zeroCounts, canceled: 1, total: 1 });

    const m2 = sse.mark();
    expect((await c.json('DELETE', `/api/jobs/${id}`)).status).toBe(200);
    const evs = structural(await sse.until(m2, (e) => structural(e).length >= 2, 10_000, 'job-removed + batch-removed'));
    expect(evs).toEqual([{ type: 'job-removed', jobId: id }, { type: 'batch-removed', batchId: batch.id }]);
    expect((await c.get<BatchDTO[]>('/api/batches')).data).toEqual([]);
  });

  it('POST /api/jobs/clear-finished remove só canceladas/falhas: job-removed de cada uma, depois batch (contagens) e batch-removed', async () => {
    const c = new Client(srv.base);
    const [plain, long1, long2] = (await c.importOk(
      { path: fx('plain.mp4'), name: 'limpar-ok.mp4' },
      { path: fx('long.mp4'), name: 'limpar-longo-1.mp4' },
      { path: fx('long.mp4'), name: 'limpar-longo-2.mp4' },
    )) as [AssetDTO, AssetDTO, AssetDTO];
    const sid = await sessionId(c);
    const sse = await openSse(c);

    // Lote misto: um arquivo no modo Rápido (conclui) e outro em recodificação lenta (cancelado).
    const mixed = await createBatch(c, {
      assetIds: [plain.id, long1.id],
      scope: 'individual',
      settings: { mode: 'quick' },
      perAsset: { [plain.id]: { mode: 'quick' }, [long1.id]: SLOW },
    });
    const allCanceled = await createBatch(c, { assetIds: [long2.id], scope: 'common', settings: SLOW });
    const okId = mixed.jobs.find((j) => j.assetId === plain.id)!.id;
    const cancelId = mixed.jobs.find((j) => j.assetId === long1.id)!.id;
    const cancel2Id = allCanceled.jobs[0]!.id;
    expect((await c.post(`/api/jobs/${cancelId}/cancel`)).status).toBe(200);
    expect((await c.post(`/api/batches/${allCanceled.batch.id}/cancel`)).data).toEqual({ canceled: 1 });
    const final = await c.waitJobs([okId, cancelId, cancel2Id]);
    expect(final.map((j) => j.status)).toEqual(['completed', 'canceled', 'canceled']);
    await quiesce(c, sse);
    const okRow = srv.mf.ctx.repos.job(sid, okId)!;
    const outputsBefore = outputsOf(srv.dataDir, sid);
    expect(outputsBefore).toEqual({ [okRow.output_file!]: final[0]!.output!.sha256 });

    const m = sse.mark();
    const r = await c.post('/api/jobs/clear-finished', {});
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ removed: 2 });
    const evs = structural(await sse.until(m, (e) => structural(e).length >= 4, 10_000, 'eventos da limpeza'));
    expect(evs).toHaveLength(4);
    expect(evs.slice(0, 2)).toEqual([
      { type: 'job-removed', jobId: cancelId },
      { type: 'job-removed', jobId: cancel2Id },
    ]);
    expect(evs[2]).toMatchObject({ type: 'batch', batch: { id: mixed.batch.id, counts: { ...zeroCounts, completed: 1, total: 1 }, progress: 1 } });
    expect(evs[3]).toEqual({ type: 'batch-removed', batchId: allCanceled.batch.id });

    expect((await c.get<BatchDTO[]>('/api/batches')).data).toEqual([(evs[2] as Extract<ServerEvent, { type: 'batch' }>).batch]);
    expect((await c.get<JobDTO[]>('/api/jobs')).data.map((j) => j.id)).toEqual([okId]);
    expect((await c.get(`/api/jobs/${cancelId}`)).status).toBe(404);
    // A saída concluída continua no disco, byte a byte.
    expect(outputsOf(srv.dataDir, sid)).toEqual(outputsBefore);
    const dl = await c.download(final[0]!.output!.downloadUrl);
    expect(sha256(dl.body)).toBe(final[0]!.output!.sha256);
  });

  it('clear-finished com includeCompleted apaga as tarefas concluídas e também os arquivos de saída do disco', async () => {
    const c = new Client(srv.base);
    const [plain, noaudio, photo] = (await c.importOk(
      { path: fx('plain.mp4'), name: 'saida-1.mp4' },
      { path: fx('noaudio.mp4'), name: 'saida-2.mp4' },
      { path: fx('photo.jpg'), name: 'saida-3.jpg' },
    )) as [AssetDTO, AssetDTO, AssetDTO];
    const sid = await sessionId(c);
    const sse = await openSse(c);
    const b1 = await createBatch(c, { assetIds: [plain.id, noaudio.id], scope: 'common', settings: { mode: 'quick' } });
    const b2 = await createBatch(c, { assetIds: [photo.id], scope: 'common', settings: { mode: 'quick' } });
    const ids = [...b1.jobs, ...b2.jobs].map((j) => j.id);
    const done = await completed(c, ids);
    await quiesce(c, sse);

    const jobRows = ids.map((id) => srv.mf.ctx.repos.job(sid, id)!);
    const outputsDir = sessionArea(srv.dataDir, sid, 'outputs');
    const thumbsDir = sessionArea(srv.dataDir, sid, 'thumbs');
    const outputs = outputsOf(srv.dataDir, sid);
    expect(outputs).toEqual(Object.fromEntries(jobRows.map((row, i) => [row.output_file!, done[i]!.output!.sha256])));
    const outThumbs = jobRows.map((row) => path.join(thumbsDir, row.output_thumb!));
    for (const t of outThumbs) expect(fs.statSync(t).size).toBeGreaterThan(0);
    const removedBytes =
      jobRows.reduce((n, row) => n + fs.statSync(path.join(outputsDir, row.output_file!)).size, 0) +
      outThumbs.reduce((n, t) => n + fs.statSync(t).size, 0);
    const uploadsBefore = treeHashes(sessionArea(srv.dataDir, sid, 'uploads'));
    const assetThumbs = [plain, noaudio, photo].map((a) => path.join(thumbsDir, srv.mf.ctx.repos.asset(sid, a.id)!.thumb_name!));
    const sessionBefore = (await c.get<SessionDTO>('/api/session')).data;
    expect(sessionBefore.counts).toEqual({ assets: 3, jobs: 3, completed: 3 });

    // Sem includeCompleted: nada concluído sai (nem registro, nem arquivo).
    const m = sse.mark();
    expect((await c.post('/api/jobs/clear-finished', {})).data).toEqual({ removed: 0 });
    expect(outputsOf(srv.dataDir, sid)).toEqual(outputs);

    const r = await c.post('/api/jobs/clear-finished', { includeCompleted: true });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ removed: 3 });
    const evs = structural(await sse.until(m, (e) => structural(e).length >= 5, 10_000, 'eventos da limpeza com concluídas'));
    expect(evs).toEqual([
      ...ids.map((jobId) => ({ type: 'job-removed', jobId })),
      { type: 'batch-removed', batchId: b1.batch.id },
      { type: 'batch-removed', batchId: b2.batch.id },
    ]);

    // Disco: saídas e miniaturas das saídas apagadas; uploads e miniaturas dos arquivos importados intactos.
    expect(fs.readdirSync(outputsDir)).toEqual([]);
    for (const t of outThumbs) expect(fs.existsSync(t)).toBe(false);
    for (const t of assetThumbs) expect(fs.statSync(t).size).toBeGreaterThan(0);
    expect(treeHashes(sessionArea(srv.dataDir, sid, 'uploads'))).toEqual(uploadsBefore);
    const sessionAfter = (await c.get<SessionDTO>('/api/session')).data;
    expect(sessionAfter.counts).toEqual({ assets: 3, jobs: 0, completed: 0 });
    expect(sessionBefore.storageBytes - sessionAfter.storageBytes).toBe(removedBytes);

    expect((await c.get<JobDTO[]>('/api/jobs')).data).toEqual([]);
    expect((await c.get<BatchDTO[]>('/api/batches')).data).toEqual([]);
    for (const j of done) expect((await c.download(j.output!.downloadUrl)).status).toBe(404);
  });
});
