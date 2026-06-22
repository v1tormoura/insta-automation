const Post = require('../models/Post');
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
  const hours = Number(body.intervalHours || 0);
  const minutes = Number(body.intervalMinutes || 0);
  const seconds = Number(body.intervalSeconds || 0);

  return hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000;
}

exports.createPost = async (req, res) => {
  try {
    const allFiles = req.files || [];

    const mediaFiles = allFiles.filter((file) => file.fieldname === 'media');
    const coverFile = allFiles.find((file) => file.fieldname === 'cover') || null;
    if (!mediaFiles.length) {
      return res.status(400).json({ error: 'Nenhuma mídia enviada' });
    }

    const accounts = JSON.parse(req.body.accounts || '[]');

    if (!accounts.length) {
      return res.status(400).json({ error: 'Nenhuma conta selecionada' });
    }

    const caption = req.body.caption || '';
    const location = req.body.location || '';
    const requestedPostType = req.body.postType || 'auto';
    const intervalMs = getIntervalMs(req.body);

    const baseDate = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();

    const createdPosts = [];

    for (let i = 0; i < mediaFiles.length; i++) {
      const mediaType = getMediaType(mediaFiles[i].filename);

      let finalPostType = requestedPostType;

      if (!finalPostType || finalPostType === 'auto') {
        finalPostType = mediaType === 'video' ? 'reel' : 'post';
      }

      if (!['post', 'reel'].includes(finalPostType)) {
        finalPostType = mediaType === 'video' ? 'reel' : 'post';
      }

      const scheduledAt = new Date(baseDate.getTime() + i * intervalMs);

      const post = await Post.create({
        media: mediaFiles[i].filename,
        cover: coverFile ? coverFile.filename : '',
        mediaType,
        postType: finalPostType,
        caption,
        location,
        accounts,
        scheduledAt,
        status: i === 0 && !req.body.scheduledAt ? 'pendente' : 'agendado',
      });

      await postQueue.add(
        'newPost',
        { postId: post._id },
        { delay: Math.max(scheduledAt.getTime() - Date.now(), 0) }
      );

      createdPosts.push(post);
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
