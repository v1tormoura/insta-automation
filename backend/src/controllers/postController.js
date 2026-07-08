const Post = require('../models/Post');
const Media = require('../models/Media');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');
const fs = require('fs');
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
    const allFiles = req.files || [];

    const mediaFiles = allFiles.filter((file) => file.fieldname === 'media');
    const coverFile = allFiles.find((file) => file.fieldname === 'cover') || null;

    // Suporte a mídias da biblioteca (já salvas no servidor)
    const mediaIds = JSON.parse(req.body.mediaIds || '[]');
    let libraryFiles = [];
    if (mediaIds.length) {
      const docs = await Media.find({ _id: { $in: mediaIds } });
      libraryFiles = docs.map(d => ({
        filename: d.filename,
        fieldname: 'media',
        path: d.path,
        mimetype: d.mimeType,
        size: d.size,
        fromLibrary: true,
      }));
    }

    const allMedia = [...mediaFiles, ...libraryFiles];
    if (!allMedia.length) {
      return res.status(400).json({ error: 'Nenhuma mídia enviada' });
    }

    const accounts = JSON.parse(req.body.accounts || '[]');
    if (!accounts.length) {
      return res.status(400).json({ error: 'Nenhuma conta selecionada' });
    }

    const caption = req.body.caption || '';
    const location = req.body.location || '';
    const processMode = req.body.processMode || 'limpeza_leve';
    const requestedPostType = req.body.postType || 'auto';
    const intervalMs = getIntervalMs(req.body);
    // simultaneousLimit: quantas contas publicam por lote (padrão = todas de uma vez)
    const simultaneousLimit = Math.max(1, Number(req.body.simultaneousLimit) || accounts.length);

    const baseDate = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();

    const createdPosts = [];
    let batchIndex = 0; // cada grupo de mídias = 1 lote com intervalo

    // Divide as MÍDIAS em grupos de simultaneousLimit.
    // Cada grupo é postado ao mesmo tempo para TODAS as contas.
    // O intervalo (intervalMs) separa um grupo do próximo.
    //
    // Exemplo: 6 mídias, simultaneousLimit=2, intervalo=7min, 20 contas
    //   Lote 0 (T+0):   mídia 1 e 2 → todas as 20 contas ao mesmo tempo
    //   Lote 1 (T+7min): mídia 3 e 4 → todas as 20 contas ao mesmo tempo
    //   Lote 2 (T+14min): mídia 5 e 6 → todas as 20 contas ao mesmo tempo

    for (let mi = 0; mi < allMedia.length; mi += simultaneousLimit) {
      const batchMedia = allMedia.slice(mi, mi + simultaneousLimit);
      const scheduledAt = new Date(baseDate.getTime() + batchIndex * intervalMs);
      const isFirst = batchIndex === 0 && !req.body.scheduledAt;
      const jobDelay = Math.max(scheduledAt.getTime() - Date.now(), 0);

      // Cria um post por mídia do lote, todos com o mesmo scheduledAt
      for (const mediaFile of batchMedia) {
        const mediaType = getMediaType(mediaFile.filename);
        let finalPostType = requestedPostType;
        if (!finalPostType || finalPostType === 'auto') {
          finalPostType = mediaType === 'video' ? 'reel' : 'post';
        }
        if (!['post', 'reel', 'story'].includes(finalPostType)) {
          finalPostType = mediaType === 'video' ? 'reel' : 'post';
        }

        const post = await Post.create({
          media:    mediaFile.filename,
          cover:    coverFile ? coverFile.filename : '',
          mediaType,
          postType: finalPostType,
          caption,
          location,
          processMode,
          accounts,
          scheduledAt,
          status: isFirst ? 'pendente' : 'agendado',
        });

        await postQueue.add('newPost', { postId: post._id }, { delay: jobDelay });
        createdPosts.push(post);
      }

      batchIndex++;
    }

    broadcast('posts', { action: 'created' });

    res.json({
      success: true,
      total: createdPosts.length,
      posts: createdPosts,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find().populate('accounts').sort({ createdAt: -1 }).skip(skip).limit(limit),
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
