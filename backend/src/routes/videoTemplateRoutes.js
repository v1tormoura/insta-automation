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

// ── Upload de trilha para a 2ª camada de áudio ────────────────────────────────
//
// Existe porque o render só aceita um caminho ABSOLUTO que exista no disco do
// container (`/app/uploads/…`). Sem esta rota, a única forma de usar a 2ª camada
// era entrar na VPS e copiar o arquivo na mão — e um caminho errado fazia o
// vídeo sair sem trilha sem avisar ninguém.
const EXT_AUDIO = /.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

const audioStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.resolve('uploads/template-audio');
    await fsExtra.ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  },
});
const audioUpload = multer({
  storage: audioStorage,
  limits:  { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    /* A extensão também vale: o navegador manda `video/ogg` para .ogg e
       `application/octet-stream` quando não reconhece o tipo — recusar pelo
       mimetype sozinho barraria arquivo bom. */
    const ok = String(file.mimetype || '').startsWith('audio/')
      || EXT_AUDIO.test(path.extname(file.originalname || ''));
    if (!ok) return cb(new Error('Apenas arquivos de áudio são permitidos'));
    cb(null, true);
  },
});

// IMPORTANTE: estas rotas devem ficar ANTES de /:id para não serem interceptadas
router.post('/upload-audio', audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const relPath = `uploads/template-audio/${req.file.filename}`;
  res.json({
    serverPath: path.resolve(relPath),
    name:       req.file.originalname,
    url:        `/${relPath}`,
  });
});

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
