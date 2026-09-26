'use strict';

/**
 * O Loop publica de novo a cada volta — e o painel conta o que saiu hoje.
 *
 *   loop que para calado → o post da rodada era achado pela chave
 *                          (envio, mídia, rodada). Na segunda volta a rodada
 *                          recomeça em 0, a chave batia com o post da volta
 *                          anterior, e as contas dele já constavam como
 *                          "publicadas": nada saía, e nada acusava.
 *   "postagens hoje"     → contava linhas de post (uma por mídia), não
 *                          publicações: uma mídia em 5 contas valia 1, e o
 *                          story não entrava.
 */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';

jest.mock('../src/services/publicar', () => ({
  publicar: jest.fn(async () => ({ mediaId: `ig-${Math.random().toString(36).slice(2)}` })),
}));

const banco = require('./helpers/banco');
const { sql } = banco;
const cotaDaApi = require('../src/services/cotaDaApi');
const { publicar } = require('../src/services/publicar');
const worker = require('../src/worker');
const painel = require('../src/controllers/dashboardController');

async function chamar(fn) {
  let corpo;
  await fn({ user: await banco.dono(), query: {} }, { json: c => { corpo = c; }, status() { return this; } });
  return corpo;
}

beforeEach(async () => {
  await banco.limpar();
  publicar.mockClear();
  jest.spyOn(cotaDaApi, 'consultar').mockResolvedValue(null);
});
afterAll(() => sql.end());

async function loopDeUmaMidia(contas) {
  const [job] = await sql`insert into jobs ${sql({
    usuarioId: banco.DONO_ID, name: 'Loop', type: 'loop', status: 'queued',
    accountIds: contas.map(c => c.id), mediaFiles: ['a.mp4'], simultaneousLimit: 1, intervalMinutes: 1,
  })} returning *`;
  return job;
}

test('a segunda volta do loop publica de novo', async () => {
  const conta = await banco.criarConta({ username: 'a', accessToken: 'x', igUserId: '1' });
  const job = await loopDeUmaMidia([conta]);

  await worker.processarRodada({ jobId: job.id });
  expect(publicar).toHaveBeenCalledTimes(1);

  await worker.processarRodada({ jobId: job.id });
  expect(publicar).toHaveBeenCalledTimes(2);
  expect(await sql`select id from posts where job_id = ${job.id}`).toHaveLength(2);
});

test('repetir a MESMA rodada (restart no meio) não publica duas vezes', async () => {
  const conta = await banco.criarConta({ username: 'a', accessToken: 'x', igUserId: '1' });
  const job = await loopDeUmaMidia([conta]);
  await worker.processarRodada({ jobId: job.id });
  // Simula o restart: a rodada volta a ser a mesma.
  await sql`update jobs set current_round = 0, ciclo = 0, status = 'queued' where id = ${job.id}`;
  await worker.processarRodada({ jobId: job.id });
  expect(publicar).toHaveBeenCalledTimes(1);
});

test('"postagens hoje" conta cada publicação em cada conta', async () => {
  // Uma mídia publicada em duas contas hoje, e uma de ontem que não conta.
  const agora = new Date(), ontem = new Date(Date.now() - 2 * 86_400_000);
  const a = await banco.criarConta({ username: 'a', accessToken: 'x', igUserId: '1', postsToday: 1, lastPostDate: agora });
  const b = await banco.criarConta({ username: 'b', accessToken: 'x', igUserId: '2', postsToday: 1, lastPostDate: agora });
  await banco.criarPost({ media: 'a.mp4', status: 'concluido', accountIds: [a.id, b.id], midiasPublicadas: [
    { accountId: a.id, igMediaId: '1', em: agora.toISOString() },
    { accountId: b.id, igMediaId: '2', em: agora.toISOString() },
  ] });
  await banco.criarPost({ media: 'b.mp4', status: 'concluido', accountIds: [a.id], midiasPublicadas: [
    { accountId: a.id, igMediaId: '3', em: ontem.toISOString() },
  ] });

  const dash = await chamar(painel.getDashboard);
  expect(dash.postsToday).toBe(2);
  expect(dash.dailyPosts.at(-1).posts).toBe(2);

  const stats = await chamar(painel.getAccountStats);
  const de = u => stats.find(c => c.username === u);
  expect([de('a').postsToday, de('b').postsToday]).toEqual([1, 1]);
  expect(de('a').posts7d).toBe(2);
});

test('um contador de ontem não entra no hoje', async () => {
  await banco.criarConta({ username: 'a', postsToday: 7, lastPostDate: new Date(Date.now() - 2 * 86_400_000) });
  expect((await chamar(painel.getDashboard)).postsToday).toBe(0);
});
