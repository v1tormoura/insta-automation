const fs = require('fs');
const path = require('path');
const Media = require('../models/Media');

function getMediaType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'other';
}

exports.uploadMedia = async (req, res) => {
  try {
    const files = req.files || [];

    const created = [];

    for (const file of files) {
      const media = await Media.create({
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        url: `/uploads/${file.filename}`,
        mimeType: file.mimetype,
        size: file.size,
        type: getMediaType(file.mimetype),
      });

      created.push(media);
    }

    res.json({
      success: true,
      total: created.length,
      media: created,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMedia = async (req, res) => {
  try {
    const media = await Media.find().sort({ createdAt: -1 });
    res.json(media);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);

    if (!media) {
      return res.status(404).json({ error: 'Mídia não encontrada' });
    }

    const filePath = path.resolve(media.path);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Media.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
