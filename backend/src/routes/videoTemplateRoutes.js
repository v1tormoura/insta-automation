'use strict';
const path    = require('path');
const router  = require('express').Router();
const multer  = require('multer');
const fsExtra = require('fs-extra');
const ctrl    = require('../controllers/videoTemplateController');

// ── Upload de PNG para template de fundo ──────────────────────────────────────
const pngStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.resolve('uploads/template-pngs');
    await fsExtra.ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  },
});
const pngUpload = multer({
  storage: pngStorage,
  limits:  { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Apenas imagens são permitidas'));
    cb(null, true);
  },
});

// IMPORTANTE: esta rota deve ficar ANTES de /:id para não ser interceptada
router.post('/upload-png', pngUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const relPath = `uploads/template-pngs/${req.file.filename}`;
  res.json({
    serverPath: path.resolve(relPath),
    name:       req.file.originalname,
    url:        `/${relPath}`,
  });
});

router.get   ('/',               ctrl.list);
router.get   ('/:id',            ctrl.get);
router.post  ('/',               ctrl.create);
router.put   ('/:id',            ctrl.update);
router.delete('/:id',            ctrl.remove);
router.post  ('/:id/duplicate',  ctrl.duplicate);

module.exports = router;
