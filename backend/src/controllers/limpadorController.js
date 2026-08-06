'use strict';

const path = require('path');
const fs   = require('fs');
const { convertToReelFormat } = require('../services/videoProcessor');

exports.process = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const mode      = req.body.mode || 'limpeza_leve';
  const ext       = path.extname(req.file.originalname).toLowerCase() || '.mp4';
  const tmpPath   = req.file.path;
  const inputPath = tmpPath + ext;
  fs.renameSync(tmpPath, inputPath);

  let outputPath = null;

  try {
    if (mode === 'watermark') {
      const { detectAndRemove } = require('../services/watermarkRemover');
      const preset = req.body.preset || 'auto';
      outputPath = inputPath.replace(ext, '_sem_marca' + ext);
      await detectAndRemove(inputPath, outputPath, preset);
    } else {
      outputPath = await convertToReelFormat(inputPath, { processMode: mode });
    }

    const prefix   = mode === 'watermark' ? 'sem_marca' : 'limpo';
    const filename = `${prefix}_${Date.now()}${ext}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', req.file.mimetype || 'video/mp4');

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    stream.on('close', () => {
      try { fs.unlinkSync(inputPath); } catch {}
      if (outputPath !== inputPath) try { fs.unlinkSync(outputPath); } catch {}
    });
    stream.on('error', () => {
      try { fs.unlinkSync(inputPath); } catch {}
    });

  } catch (err) {
    try { fs.unlinkSync(inputPath); } catch {}
    if (outputPath && outputPath !== inputPath) try { fs.unlinkSync(outputPath); } catch {}
    console.error('[Limpador]', err.message);
    res.status(500).json({ error: err.message || 'Erro ao processar arquivo' });
  }
};
