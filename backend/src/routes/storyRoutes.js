'use strict';

const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { ehUuid } = require('../db');
const stories = require('../services/stories');
const { limparTextoLivre } = require('../services/textoNoStory');

const PASTA = path.resolve(__dirname, '../../uploads/stories');
fs.mkdirSync(PASTA, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PASTA),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(Object.assign(new Error('Apenas imagens e vídeos são permitidos'), { status: 400 }));
  },
});

// POST /api/stories/upload — guarda a mídia e devolve a URL pública
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  res.json({ url: `${config.publicUrl}/uploads/stories/${req.file.filename}`, filename: req.file.filename, mimetype: req.file.mimetype });
});

router.get('/status', (req, res) => res.json(stories.status()));

/**
 * POST /api/stories
 * { accountIds, imageUrl, mediaUrls?, textoLivre?, intervalMinutes? }
 * Uma conta e uma mídia saem na hora; o resto vira um lote na fila, com
 * `intervalMinutes` entre uma mídia e a próxima.
 */
router.post('/', async (req, res) => {
  const accountIds = (Array.isArray(req.body.accountIds) ? req.body.accountIds : []).map(String).filter(ehUuid);
  const midias = (Array.isArray(req.body.mediaUrls) && req.body.mediaUrls.length ? req.body.mediaUrls : [req.body.imageUrl])
    .map(m => String(m || '').trim()).filter(Boolean);
  const textoLivre = limparTextoLivre(req.body.textoLivre);
  const intervalMinutes = Math.max(0, Number(req.body.intervalMinutes) || 0);

  if (!accountIds.length) return res.status(400).json({ error: 'Selecione pelo menos uma conta' });
  if (!midias.length) return res.status(400).json({ error: 'URL da imagem é obrigatória' });

  if (accountIds.length === 1 && midias.length === 1) {
    const r = await stories.publicarAgora(accountIds[0], midias[0], textoLivre);
    return res.json({ success: true, results: [r], successCount: 1, total: 1 });
  }

  const lote = await stories.iniciarLote(accountIds, midias, textoLivre, intervalMinutes);
  res.json({
    success: true,
    inBackground: true,
    message: `Publicação de stories iniciada para ${lote.total} conta(s) em segundo plano.`,
    total: lote.total,
  });
});

module.exports = router;
