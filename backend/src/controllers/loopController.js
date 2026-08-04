'use strict';

const Loop    = require('../models/Loop');
const Account = require('../models/Account');
const { broadcast } = require('../events/broadcaster');

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

/* ── Listar loops ── */
exports.list = async (req, res) => {
  try {
    const loops = await Loop.find().populate('accounts', 'username avatar healthStatus').sort({ createdAt: -1 });
    res.json(loops);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Criar loop ── */
exports.create = async (req, res) => {
  try {
    const { name, accounts, folder, mediaFiles, type, intervalMinutes, caption, coverFile, ctaComment, engageComment } = req.body;

    if (!accounts?.length)  return res.status(400).json({ error: 'Selecione ao menos uma conta' });
    if (!mediaFiles?.length) return res.status(400).json({ error: 'Selecione ao menos uma mídia' });
    if (!intervalMinutes || intervalMinutes < 1) return res.status(400).json({ error: 'Intervalo mínimo: 1 minuto' });

    const nextRunAt = new Date(Date.now() + Number(intervalMinutes) * 60 * 1000);

    const loop = await Loop.create({
      name:            name || `Loop ${new Date().toLocaleString('pt-BR')}`,
      accounts,
      folder:          folder || 'default',
      mediaFiles:      mediaFiles || [],
      type:            type || 'reel',
      intervalMinutes: Number(intervalMinutes),
      caption:         caption || '',
      coverFile:       coverFile || '',
      ctaComment:      ctaComment    || '',
      engageComment:   engageComment || '',
      status:          'ativo',
      currentIndex:    0,
      postsCount:      0,
      nextRunAt,
    });

    await loop.populate('accounts', 'username avatar healthStatus');
    broadcast('accounts', { action: 'loop_created' });
    res.json(loop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Pausar / Retomar ── */
exports.togglePause = async (req, res) => {
  try {
    const loop = await Loop.findById(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });

    loop.status = loop.status === 'pausado' ? 'ativo' : 'pausado';
    if (loop.status === 'ativo') {
      loop.nextRunAt = new Date(Date.now() + loop.intervalMinutes * 60 * 1000);
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
    await Loop.findByIdAndDelete(req.params.id);
    broadcast('accounts', { action: 'loop_deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Atualizar ── */
exports.update = async (req, res) => {
  try {
    const { name, intervalMinutes, caption, ctaComment, engageComment, mediaFiles, folder } = req.body;
    const update = {};
    if (name !== undefined)            update.name = name;
    if (intervalMinutes !== undefined) update.intervalMinutes = Number(intervalMinutes);
    if (caption !== undefined)         update.caption = caption;
    if (ctaComment !== undefined)      update.ctaComment = ctaComment;
    if (engageComment !== undefined)   update.engageComment = engageComment;
    if (mediaFiles !== undefined)      update.mediaFiles = mediaFiles;
    if (folder !== undefined)          update.folder = folder;

    const loop = await Loop.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('accounts', 'username avatar healthStatus');
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });

    broadcast('accounts', { action: 'loop_updated' });
    res.json(loop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── Histórico de um loop (últimos posts) ── */
exports.history = async (req, res) => {
  try {
    const Post = require('../models/Post');
    const loop = await Loop.findById(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop não encontrado' });

    const posts = await Post.find({
      accounts: { $in: loop.accounts },
      media:    { $in: loop.mediaFiles },
    }).sort({ createdAt: -1 }).limit(50).populate('accounts', 'username');

    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
