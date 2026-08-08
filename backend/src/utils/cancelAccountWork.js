'use strict';

/**
 * Cancela/limpa todos os trabalhos ativos e posts pendentes/com erro
 * de uma conta específica. Chamado ao excluir ou banir uma conta.
 */
async function cancelAccountWork(accountId, reason = 'Conta removida ou banida') {
  const Job  = require('../models/Job');
  const Loop = require('../models/Loop');
  const Post = require('../models/Post');

  const id     = accountId.toString();
  const ACTIVE = ['queued', 'running', 'waiting_interval', 'paused'];

  // ── 1. Jobs ativos: remove a conta do array; cancela se ficou vazio ──────
  const jobs = await Job.find({ accounts: id, status: { $in: ACTIVE } });
  for (const job of jobs) {
    job.accounts = job.accounts.filter(a => a.toString() !== id);
    if (job.accounts.length === 0) {
      job.status    = 'cancelled';
      job.lastError = reason;
    }
    await job.save();
  }

  // ── 2. Loops legados ativos: mesma lógica ─────────────────────────────────
  const loops = await Loop.find({ accounts: id, status: { $in: ['ativo', 'pausado'] } });
  for (const loop of loops) {
    loop.accounts = loop.accounts.filter(a => a.toString() !== id);
    if (loop.accounts.length === 0) {
      loop.status   = 'inativo';
      loop.lastError = reason;
    }
    await loop.save();
  }

  // ── 3. Posts pendentes/erro/processando: remove conta do array ────────────
  const CLEAN_STATUSES = ['pendente', 'processando', 'erro'];
  await Post.updateMany(
    { accounts: id, status: { $in: CLEAN_STATUSES } },
    { $pull: { accounts: id } }
  );
  // Posts que ficaram sem conta alguma → exclui do banco
  await Post.deleteMany({ accounts: { $size: 0 }, status: { $in: CLEAN_STATUSES } });
}

module.exports = cancelAccountWork;
