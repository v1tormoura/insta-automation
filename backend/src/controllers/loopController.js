'use strict';

const Loop    = require('../models/Loop');
const Job     = require('../models/Job');
const Account = require('../models/Account');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');

// Mapeia Job → formato Loop (compatibilidade com Loop.jsx)
function jobToLoop(job) {
  const statusMap = {
    queued:           'ativo',
    running:          'ativo',
    waiting_interval: 'ativo',
    paused:           'pausado',
    completed:        'inativo',
    cancelled:        'inativo',
    failed:           'erro',
  };
  const obj = job.toObject ? job.toObject() : { ...job };
  return {
    ...obj,
    type:        obj.postType || 'reel',
    coverFile:   obj.cover    || '',
    folder:      obj.folder   || 'default',
    postsCount:  obj.roundsCompleted || 0,
    currentIndex: obj.currentRound   || 0,
    nextRunAt:   obj.nextRoundAt     || null,
    lastRunAt:   obj.updatedAt       || null,
    status:      statusMap[obj.status] || 'ativo',
    _jobStatus:  obj.status,  // status original do Job para o frontend avançado
    _isJob:      true,        // flag para saber que é um Job
  };
}

/* ── Upload de mídias para loop (sem salvar na biblioteca) ── */
exports.uploadMedia = async (req, res) => {
  try {
    console.log('[upload-media] content-type:', req.headers['content-type']);
    console.log('[upload-media] files recebidos:', req.files?.length ?? 'undefined');
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const files = req.files.map(f => ({
      filename: f.filename,
      type: /\.(mp4|mov|webm|avi|mkv)$/i.test(f.filename) ? 'video' : 'image',
    }));
    res.json({ files });
  } catch (err) {
    console.error('[upload-media] erro:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ── Listar loops — retorna Jobs com type='loop' adaptados + Loops legados ── */
exports.list = async (req, res) => {
  try {
    const [jobs, legacyLoops] = await Promise.all([
      Job.find({ type: 'loop' })
        .populate('accounts', 'username avatar name healthStatus accountType followers following postsCount accessToken igSession')
        .sort({ createdAt: -1 }),
      Loop.find()
        .populate('accounts', 'username avatar name healthStatus accountType followers following postsCount accessToken igSession')
        .sort({ createdAt: -1 }),
    ]);

    const jobLoops = jobs.map(jobToLoop);
    res.json([...jobLoops, ...legacyLoops]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Criar loop (Job-based) ── */
exports.create = async (req, res) => {
  try {
    const { name, accounts, mediaFiles, type, intervalMinutes, caption, coverFile, ctaComment, engageComment } = req.body;

    if (!accounts?.length)   return res.status(400).json({ error: 'Selecione ao menos uma conta' });
    if (!mediaFiles?.length) return res.status(400).json({ error: 'Selecione ao menos uma mídia' });
    if (!intervalMinutes || intervalMinutes < 1) return res.status(400).json({ error: 'Intervalo mínimo: 1 minuto' });

    const totalRounds = mediaFiles.length; // loops sempre postam 1 mídia por rodada

    const job = await Job.create({
      name:              name || `Loop ${new Date().toLocaleString('pt-BR')}`,
      type:              'loop',
      status:            'queued',
      accounts,
      mediaFiles,
      postType:          type || 'reel',
      caption:           caption       || '',
      cover:             coverFile     || '',
      ctaComment:        ctaComment    || '',
      engageComment:     engageComment || '',
      intervalMinutes:   Number(intervalMinutes),
      simultaneousLimit: 1,
      currentRound:      0,
      totalRounds,
      postsTotal:        0, // indefinido para loops
    });

    // Primeira rodada imediatamente
    const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
    await Job.findByIdAndUpdate(job._id, { bullMqJobId: String(bullJob.id) });

    const populated = await Job.findById(job._id).populate('accounts', 'username avatar healthStatus');
    broadcast('accounts', { action: 'loop_created' });
    res.json(jobToLoop(populated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Pausar / Retomar ── */
exports.togglePause = async (req, res) => {
  try {
    const id = req.params.id;

    // Tenta como Job primeiro
    const job = await Job.findById(id);
    if (job) {
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
      broadcast('accounts', { action: 'loop_updated' });
      return res.json(jobToLoop(job));
    }

    // Fallback: loop legado
    const loop = await Loop.findById(id);
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });

    loop.status = loop.status === 'ativo' ? 'pausado' : 'ativo';
    if (loop.status === 'ativo') {
      loop.nextRunAt = new Date();
      loop.lastError = '';
    }
    await loop.save();
    broadcast('accounts', { action: 'loop_updated' });
    res.json(loop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Deletar ── */
exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    const job = await Job.findByIdAndDelete(id);
    if (!job) await Loop.findByIdAndDelete(id);
    broadcast('accounts', { action: 'loop_deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Atualizar ── */
exports.update = async (req, res) => {
  try {
    const { name, intervalMinutes, caption, ctaComment, engageComment, mediaFiles } = req.body;
    const id = req.params.id;

    // Tenta como Job
    const job = await Job.findById(id);
    if (job) {
      const update = {};
      if (name            !== undefined) update.name            = name;
      if (intervalMinutes !== undefined) update.intervalMinutes = Number(intervalMinutes);
      if (caption         !== undefined) update.caption         = caption;
      if (ctaComment      !== undefined) update.ctaComment      = ctaComment;
      if (engageComment   !== undefined) update.engageComment   = engageComment;
      if (mediaFiles      !== undefined) {
        update.mediaFiles   = mediaFiles;
        update.totalRounds  = mediaFiles.length;
      }
      const updated = await Job.findByIdAndUpdate(id, update, { new: true })
        .populate('accounts', 'username avatar healthStatus');
      broadcast('accounts', { action: 'loop_updated' });
      return res.json(jobToLoop(updated));
    }

    // Fallback: loop legado
    const update = {};
    if (name            !== undefined) update.name            = name;
    if (intervalMinutes !== undefined) update.intervalMinutes = Number(intervalMinutes);
    if (caption         !== undefined) update.caption         = caption;
    if (ctaComment      !== undefined) update.ctaComment      = ctaComment;
    if (engageComment   !== undefined) update.engageComment   = engageComment;
    if (mediaFiles      !== undefined) update.mediaFiles      = mediaFiles;

    const loop = await Loop.findByIdAndUpdate(id, update, { new: true })
      .populate('accounts', 'username avatar healthStatus');
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });
    broadcast('accounts', { action: 'loop_updated' });
    res.json(loop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Histórico (últimos posts do loop) ── */
exports.history = async (req, res) => {
  try {
    const id  = req.params.id;
    const job = await Job.findById(id);

    if (job) {
      const posts = await require('../models/Post').find({ _id: { $in: job.postIds } })
        .sort({ createdAt: -1 }).limit(50).populate('accounts', 'username');
      return res.json(posts);
    }

    // Fallback: loop legado
    const loop = await Loop.findById(id);
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });

    const posts = await require('../models/Post').find({
      accounts: { $in: loop.accounts },
      media:    { $in: loop.mediaFiles },
    }).sort({ createdAt: -1 }).limit(50).populate('accounts', 'username');

    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
