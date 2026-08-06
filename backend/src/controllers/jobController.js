'use strict';

const Job = require('../models/Job');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');

/* ── Listar jobs ── */
exports.list = async (req, res) => {
  try {
    const { type, status } = req.query;
    const filter = {};
    if (type)   filter.type   = type;
    if (status) filter.status = status;

    const jobs = await Job.find(filter)
      .populate('accounts', 'username avatar name healthStatus accountType')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Buscar job por ID ── */
exports.get = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('accounts', 'username avatar name healthStatus accountType');
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Pausar ── */
exports.pause = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    if (['completed', 'cancelled', 'paused'].includes(job.status)) {
      return res.status(400).json({ error: `Não é possível pausar um job com status '${job.status}'` });
    }

    job.status = 'paused';
    await job.save();
    broadcast('jobs', { action: 'job_updated', jobId: String(job._id) });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Retomar ── */
exports.resume = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    if (job.status !== 'paused') {
      return res.status(400).json({ error: 'Só é possível retomar um job pausado' });
    }

    // Agenda a próxima rodada imediatamente
    const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
    job.bullMqJobId = String(bullJob.id);
    job.status      = 'queued';
    job.nextRoundAt = new Date();
    await job.save();

    broadcast('jobs', { action: 'job_updated', jobId: String(job._id) });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Cancelar ── */
exports.cancel = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    if (['completed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: `Job já está ${job.status}` });
    }

    job.status = 'cancelled';
    await job.save();
    broadcast('jobs', { action: 'job_updated', jobId: String(job._id) });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Reexecutar (cria nova rodada a partir do início) ── */
exports.rerun = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    if (!['completed', 'cancelled', 'failed'].includes(job.status)) {
      return res.status(400).json({ error: 'Só é possível reexecutar um job finalizado ou cancelado' });
    }

    job.status         = 'queued';
    job.currentRound   = 0;
    job.roundsCompleted = 0;
    job.postsPublished = 0;
    job.postsErrors    = 0;
    job.startedAt      = null;
    job.completedAt    = null;
    job.nextRoundAt    = null;
    job.lastError      = '';
    job.logs           = [];

    const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
    job.bullMqJobId = String(bullJob.id);
    await job.save();

    broadcast('jobs', { action: 'job_updated', jobId: String(job._id) });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Deletar ── */
exports.remove = async (req, res) => {
  try {
    const job = await Job.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    broadcast('jobs', { action: 'job_deleted', jobId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Alternar pause/resume (compatibilidade com Loop page) ── */
exports.togglePause = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });

    if (job.status === 'paused') {
      const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
      job.bullMqJobId = String(bullJob.id);
      job.status      = 'queued';
      job.nextRoundAt = new Date();
      job.lastError   = '';
    } else {
      job.status = 'paused';
    }

    await job.save();
    broadcast('jobs', { action: 'job_updated', jobId: String(job._id) });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
