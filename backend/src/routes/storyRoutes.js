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
  const { accountIds, imageUrl, linkUrl, linkText, intervalMinutes } = req.body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos uma conta' });
  }
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL da imagem é obrigatória' });
  }

  const intervalMs = Math.max(0, Number(intervalMinutes) || 0) * 60 * 1000;
  const results = [];

  for (let i = 0; i < accountIds.length; i++) {
    // Aplica intervalo entre contas (exceto antes da primeira)
    if (i > 0 && intervalMs > 0) {
      await new Promise(r => setTimeout(r, intervalMs));
    }

    const account = await Account.findById(accountIds[i]).catch(() => null);
    if (!account) {
      results.push({ accountId: accountIds[i], status: 'error', error: 'Conta não encontrada' });
      continue;
    }

    // Tenta postar com 1 retry automático em caso de "too many actions"
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const info = await postStory(account, {
          imageUrl,
          linkUrl:  linkUrl  || null,
          linkText: linkText || 'Clique Aqui',
        });
        results.push({
          accountId: accountIds[i],
          username:  account.username,
          status:    'success',
          method:    info.method,
          withLink:  info.withLink,
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const isTooMany = /too many actions|please wait|rate limit|feedback_required/i.test(err.message);
        if (isTooMany && attempt === 1) {
          console.log(`⏳ [Story] @${account.username} — rate limit, aguardando 30s antes de tentar novamente...`);
          await new Promise(r => setTimeout(r, 30_000));
        }
      }
    }

    if (lastErr) {
      console.error(`❌ Story @${account.username}:`, lastErr.message);
      results.push({
        accountId: accountIds[i],
        username:  account.username,
        status:    'error',
        error:     lastErr.message,
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
