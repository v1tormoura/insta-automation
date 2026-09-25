'use strict';

/** Envios (Postar e Loop): listar, pausar, retomar, cancelar, reexecutar, apagar. */

const { sql, ehUuid } = require('../db');
const { jobs, comContas } = require('../repos');
const { agendarRodada } = require('../worker');
const fila = require('../queue');
const { broadcast } = require('../events/broadcaster');

const avisar = (req, id) => broadcast('jobs', { action: 'job_updated', jobId: id }, req.user.id);

/** O envio, se for do usuário; senão responde 404 e devolve null. */
async function buscar(req, res) {
  const job = await jobs.de(req.user.id).findById(req.params.id);
  if (!job) res.status(404).json({ error: 'Envio não encontrado' });
  return job;
}

exports.list = async (req, res) => {
  const { type, status } = req.query;
  const lista = await sql`
    select * from jobs where usuario_id = ${req.user.id}
    ${type ? sql`and type = ${String(type)}` : sql``}
    ${status ? sql`and status = ${String(status)}` : sql``}
    order by created_at desc limit 100`;
  res.json(await comContas(lista));
};

exports.get = async (req, res) => {
  const job = await buscar(req, res);
  if (job) res.json(await comContas(job));
};

exports.pause = async (req, res) => {
  const job = await buscar(req, res);
  if (!job) return;
  if (['completed', 'cancelled', 'paused'].includes(job.status)) {
    return res.status(400).json({ error: `Não é possível pausar um envio com status '${job.status}'` });
  }
  const atualizado = await jobs.update(job.id, { status: 'paused' });
  await fila.cancelarPorDados('job_round', 'jobId', job.id);
  avisar(req, job.id);
  res.json(await comContas(atualizado));
};

exports.resume = async (req, res) => {
  const job = await buscar(req, res);
  if (!job) return;
  if (job.status !== 'paused') return res.status(400).json({ error: 'Só é possível retomar um envio pausado' });
  const atualizado = await jobs.update(job.id, { status: 'queued', nextRoundAt: new Date(), lastError: '' });
  await agendarRodada(job.id, 0);
  avisar(req, job.id);
  res.json(await comContas(atualizado));
};

/** Pausar ↔ retomar (a tela de Loop usa um botão só). */
exports.togglePause = async (req, res) => {
  const job = await jobs.de(req.user.id).findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Envio não encontrado' });
  return job.status === 'paused' ? exports.resume(req, res) : exports.pause(req, res);
};

exports.cancel = async (req, res) => {
  const job = await buscar(req, res);
  if (!job) return;
  if (['completed', 'cancelled'].includes(job.status)) return res.status(400).json({ error: `Envio já está ${job.status}` });
  const atualizado = await jobs.update(job.id, { status: 'cancelled' });
  await fila.cancelarPorDados('job_round', 'jobId', job.id);
  avisar(req, job.id);
  res.json(await comContas(atualizado));
};

/** Reexecuta do início um envio que terminou. */
exports.rerun = async (req, res) => {
  const job = await buscar(req, res);
  if (!job) return;
  if (!['completed', 'cancelled', 'failed'].includes(job.status)) {
    return res.status(400).json({ error: 'Só é possível reexecutar um envio finalizado ou cancelado' });
  }
  const atualizado = await jobs.update(job.id, {
    status: 'queued', currentRound: 0, roundsCompleted: 0, postsPublished: 0, postsErrors: 0,
    startedAt: null, completedAt: null, nextRoundAt: null, lastError: '',
  });
  await agendarRodada(job.id, 0);
  avisar(req, job.id);
  res.json(await comContas(atualizado));
};

/** Apagar para o envio: a rodada seguinte não encontra o registro e desiste. */
exports.remove = async (req, res) => {
  if (!(await jobs.de(req.user.id).findById(req.params.id))) return res.status(404).json({ error: 'Envio não encontrado' });
  await fila.cancelarPorDados('job_round', 'jobId', req.params.id);
  await jobs.remove(req.params.id);
  broadcast('jobs', { action: 'job_deleted', jobId: req.params.id }, req.user.id);
  res.json({ success: true });
};

exports.removeVarios = async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nenhum id enviado', code: 'SEM_IDS' });
  if (ids.length > 500) return res.status(400).json({ error: 'Máximo de 500 por vez', code: 'LISTA_LONGA' });
  const pedidos = ids.filter(ehUuid);
  // Só os envios do usuário.
  const validos = pedidos.length
    ? (await sql`select id from jobs where id = any(${pedidos}::uuid[]) and usuario_id = ${req.user.id}`).map(j => j.id)
    : [];
  if (validos.length) {
    await sql`delete from queue_jobs where status = 'queued' and name = 'job_round' and data->>'jobId' = any(${validos})`;
  }
  const r = validos.length ? await sql`delete from jobs where id = any(${validos}::uuid[])` : { count: 0 };
  broadcast('jobs', { action: 'jobs_deleted', quantos: r.count }, req.user.id);
  res.json({ ok: true, apagados: r.count, pedidos: ids.length });
};
