const Post    = require('../models/Post');
const Job     = require('../models/Job');
const Media   = require('../models/Media');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');
const fs   = require('fs');
const path = require('path');

function getMediaType(filename) {
  const file = filename.toLowerCase();

  if (file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.webm')) {
    return 'video';
  }

  return 'image';
}

function getIntervalMs(body) {
  // Suporta novo campo intervalMinutes (slider) ou campos legados
  const mins = Number(body.intervalMinutes || 0);
  if (mins > 0) return mins * 60 * 1000;
  const hours = Number(body.intervalHours || 0);
  const minutes = Number(body.intervalMins || 0);
  const seconds = Number(body.intervalSeconds || 0);
  return hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000;
}

exports.createPost = async (req, res) => {
  try {
    const allFiles  = req.files || [];
    const mediaFiles = allFiles.filter(f => f.fieldname === 'media');
    const coverFile  = allFiles.find(f => f.fieldname === 'cover') || null;

    // Suporte a mídias da biblioteca
    const mediaIds = JSON.parse(req.body.mediaIds || '[]');
    let libraryFiles = [];
    if (mediaIds.length) {
      const docs = await Media.find({ _id: { $in: mediaIds } });
      libraryFiles = docs.map(d => ({ filename: d.filename, fieldname: 'media', fromLibrary: true }));
    }

    const allMedia = [...mediaFiles, ...libraryFiles];
    if (!allMedia.length) return res.status(400).json({ error: 'Nenhuma mídia enviada' });

    const accounts = JSON.parse(req.body.accounts || '[]');
    if (!accounts.length) return res.status(400).json({ error: 'Nenhuma conta selecionada' });

    const intervalMinutes    = Number(req.body.intervalMinutes || 0);
    const simultaneousLimit  = Math.max(1, Number(req.body.simultaneousLimit) || 1);
    const requestedPostType  = req.body.postType || 'reel';

    // Normaliza tipo (auto → reel ou post dependendo da mídia do primeiro arquivo)
    let postType = requestedPostType;
    if (!postType || postType === 'auto') {
      const firstIsVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(allMedia[0]?.filename || '');
      postType = firstIsVideo ? 'reel' : 'post';
    }
    if (!['post', 'reel', 'story'].includes(postType)) postType = 'reel';

    const mediaFilenames = allMedia.map(f => f.filename);
    const totalRounds    = Math.ceil(mediaFilenames.length / simultaneousLimit);

    const job = await Job.create({
      name:              req.body.name || `Post ${new Date().toLocaleString('pt-BR')}`,
      type:              'post',
      status:            'queued',
      accounts,
      mediaFiles:        mediaFilenames,
      postType,
      caption:           req.body.caption       || '',
      cover:             coverFile ? coverFile.filename : '',
      ctaComment:        req.body.ctaComment     || '',
      engageComment:     req.body.engageComment  || '',
      processMode:       req.body.processMode    || 'limpeza_leve',
      location:          req.body.location       || '',
      intervalMinutes,
      simultaneousLimit,
      currentRound:      0,
      totalRounds,
      postsTotal:        totalRounds * accounts.length,
    });

    // Enfileira primeira rodada imediatamente (ou no scheduledAt solicitado)
    const scheduledDelay = req.body.scheduledAt
      ? Math.max(new Date(req.body.scheduledAt).getTime() - Date.now(), 0)
      : 0;

    const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: scheduledDelay });
    await Job.findByIdAndUpdate(job._id, { bullMqJobId: String(bullJob.id) });

    broadcast('posts', { action: 'created' });
    res.json({ success: true, job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find().populate('accounts').sort({ updatedAt: -1 }).skip(skip).limit(limit),
      Post.countDocuments(),
    ]);

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    const mediaPath = path.resolve(__dirname, '../../uploads', post.media);

    if (fs.existsSync(mediaPath)) {
      fs.unlinkSync(mediaPath);
    }

    if (post.cover) {
      const coverPath = path.resolve(__dirname, '../../uploads', post.cover);

      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
      }
    }

    await Post.findByIdAndDelete(req.params.id);

    broadcast('posts', { action: 'deleted' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancelPost = async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelado' },
      { new: true }
    );

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    if (!['erro', 'parcial', 'cancelado'].includes(post.status)) {
      return res.status(400).json({ error: 'Só é possível reprocessar posts com erro, parcial ou cancelado' });
    }

    post.status = 'pendente';
    post.error = '';
    await post.save();

    await postQueue.add('newPost', { postId: post._id }, { delay: 0 });

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryAllErrors = async (req, res) => {
  try {
    const errorPosts = await Post.find({ status: { $in: ['erro', 'parcial'] } });

    if (!errorPosts.length) {
      return res.json({ success: true, total: 0, message: 'Nenhum post com erro encontrado' });
    }

    for (const post of errorPosts) {
      post.status = 'pendente';
      post.error = '';
      await post.save();

      await postQueue.add('newPost', { postId: post._id }, { delay: 0 });
    }

    res.json({ success: true, total: errorPosts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
