'use strict';

const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const Account = require('../models/Account');
const { postStory } = require('../services/storyService');

// ── Upload de imagem para story ───────────────────────────────────────────────

const storiesDir = path.join(__dirname, '../../uploads/stories');
if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storiesDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Apenas imagens e vídeos são permitidos'));
  },
});

// POST /api/stories/upload — salva imagem/vídeo e retorna URL pública
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const url = `${base}/uploads/stories/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, mimetype: req.file.mimetype });
});

/**
 * POST /api/stories
 * Body: {
 *   accountIds: string[],   // IDs das contas
 *   imageUrl:   string,     // URL pública da imagem do story
 *   linkUrl?:   string,     // URL do link sticker (opcional)
 *   linkText?:  string,     // Texto da figurinha (opcional, default "Clique Aqui")
 * }
 */
router.post('/', async (req, res) => {
  const { accountIds, imageUrl, linkUrl, linkText } = req.body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos uma conta' });
  }
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL da imagem é obrigatória' });
  }

  const results = [];

  for (const accountId of accountIds) {
    const account = await Account.findById(accountId).catch(() => null);
    if (!account) {
      results.push({ accountId, status: 'error', error: 'Conta não encontrada' });
      continue;
    }

    try {
      const info = await postStory(account, {
        imageUrl,
        linkUrl:  linkUrl  || null,
        linkText: linkText || 'Clique Aqui',
      });
      results.push({
        accountId,
        username: account.username,
        status:   'success',
        method:   info.method,
        withLink: info.withLink,
      });
    } catch (err) {
      console.error(`❌ Story @${account.username}:`, err.message);
      results.push({
        accountId,
        username: account.username,
        status:   'error',
        error:    err.message,
      });
    }
  }

  const successCount = results.filter(r => r.status === 'success').length;

  res.json({
    results,
    successCount,
    total: accountIds.length,
  });
});

module.exports = router;
