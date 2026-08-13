'use strict';
const path      = require('path');
const fsExtra   = require('fs-extra');
const multer    = require('multer');
const VideoBatch     = require('../models/VideoBatch');
const VideoRenderJob = require('../models/VideoRenderJob');
const VideoTemplate  = require('../models/VideoTemplate');
const videoRenderQueue = require('../queue/videoRenderQueue');
const { broadcast }  = require('../events/broadcaster');

// ── Multer — upload de vídeos para o lote ────────────────────────────────────

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const tmpDir = path.join('uploads', 'tmp', 'batch-uploads');
    try { await fsExtra.ensureDir(tmpDir); cb(null, tmpDir); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 500 * 1024 * 1024, files: 50 } });

exports.uploadMiddleware = upload.array('videos', 50);

// ── Endpoints ─────────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const batches = await VideoBatch.find()
      .populate('templateId', 'name canvas')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const batch = await VideoBatch.findById(req.params.id)
      .populate('templateId', 'name canvas output variables');
    if (!batch) return res.status(404).json({ error: 'Batch não encontrado' });

    const renderJobs = await VideoRenderJob.find({ batchId: req.params.id })
      .select('-logs')
      .sort({ createdAt: 1 });

    res.json({ batch, renderJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { templateId, name, quality = 'balanced', defaultVariables } = req.body;
    const parsedVars = defaultVariables
      ? (typeof defaultVariables === 'string' ? JSON.parse(defaultVariables) : defaultVariables)
      : {};

    const template = await VideoTemplate.findById(templateId);
    if (!template) return res.status(404).json({ error: 'Template não encontrado' });

    // Vídeos: arquivos enviados via multipart + caminhos da biblioteca
    const allVideos = (req.files || []).map(f => ({
      path: f.path,
      name: f.originalname,
    }));

    // Aceita também `videoPaths` (array JSON de paths da biblioteca de mídia)
    if (req.body.videoPaths) {
      const vp = typeof req.body.videoPaths === 'string'
        ? JSON.parse(req.body.videoPaths)
        : req.body.videoPaths;
      for (const p of (Array.isArray(vp) ? vp : [])) {
        const resolved = path.isAbsolute(p)
          ? p
          : path.join('uploads', p.replace(/^\/?uploads\//, ''));
        allVideos.push({ path: resolved, name: path.basename(p) });
      }
    }

    if (!allVideos.length) return res.status(400).json({ error: 'Nenhum vídeo fornecido' });

    const batchName = name || `Lote ${new Date().toLocaleDateString('pt-BR')}`;
    const batch = await VideoBatch.create({
      name: batchName,
      templateId,
      templateSnapshot: template.toObject(),
      templateVersion: template.version,
      quality,
      defaultVariables: parsedVars,
      totalJobs:      allVideos.length,
      pendingJobs:    allVideos.length,
      processingJobs: 0,
      completedJobs:  0,
      failedJobs:     0,
      status:    'processing',
      startedAt: new Date(),
    });

    const renderJobs = [];
    for (const video of allVideos) {
      const rj = await VideoRenderJob.create({
        batchId:      batch._id,
        templateId,
        inputPath:    video.path,
        originalName: video.name,
        variables:    { ...parsedVars },
        status:       'queued',
      });
      const bullJob = await videoRenderQueue.add('render_job', { renderJobId: String(rj._id) });
      await VideoRenderJob.findByIdAndUpdate(rj._id, { bullMqJobId: String(bullJob.id) });
      renderJobs.push(rj);
    }

    await VideoTemplate.findByIdAndUpdate(templateId, { $inc: { usageCount: 1 } });
    broadcast('batch-created', { batchId: String(batch._id), name: batchName, totalJobs: allVideos.length });

    res.status(201).json({ batch, renderJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const batch = await VideoBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch não encontrado' });

    await VideoRenderJob.updateMany(
      { batchId: req.params.id, status: { $in: ['pending', 'queued'] } },
      { status: 'cancelled', $push: { logs: { message: 'Cancelado pelo usuário', level: 'warn' } } }
    );
    await VideoBatch.findByIdAndUpdate(req.params.id, { status: 'cancelled', completedAt: new Date() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getRenderJobLogs = async (req, res) => {
  try {
    const rj = await VideoRenderJob.findOne({ _id: req.params.renderId, batchId: req.params.id })
      .select('logs status error');
    if (!rj) return res.status(404).json({ error: 'Render job não encontrado' });
    res.json(rj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.downloadRender = async (req, res) => {
  try {
    const rj = await VideoRenderJob.findOne({ _id: req.params.renderId, batchId: req.params.id });
    if (!rj) return res.status(404).json({ error: 'Render job não encontrado' });
    if (rj.status !== 'completed' || !rj.outputPath) {
      return res.status(400).json({ error: 'Render ainda não concluído' });
    }
    const outPath = path.resolve(rj.outputPath);
    const filename = rj.originalName
      ? rj.originalName.replace(/\.[^.]+$/, '') + '_rendered.mp4'
      : `render_${rj._id}.mp4`;
    res.download(outPath, filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryRender = async (req, res) => {
  try {
    const rj = await VideoRenderJob.findOne({ _id: req.params.renderId, batchId: req.params.id });
    if (!rj) return res.status(404).json({ error: 'Render job não encontrado' });
    if (!['failed', 'cancelled'].includes(rj.status)) {
      return res.status(400).json({ error: 'Apenas jobs falhos ou cancelados podem ser reenviados' });
    }

    await VideoRenderJob.findByIdAndUpdate(rj._id, {
      status: 'queued',
      error:  '',
      $push:  { logs: { message: 'Reenviado pelo usuário', level: 'info' } },
    });
    const bullJob = await videoRenderQueue.add('render_job', { renderJobId: String(rj._id) });
    await VideoRenderJob.findByIdAndUpdate(rj._id, { bullMqJobId: String(bullJob.id) });
    await VideoBatch.findByIdAndUpdate(req.params.id, { status: 'processing', completedAt: null });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
