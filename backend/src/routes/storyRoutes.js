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
 *   linkText?:  string,     // Texto da figurinha (opcional; vazio = domínio do link)
 * }
 */
const { broadcast } = require('../events/broadcaster');

// Memória em runtime dos últimos envios de stories para histórico/status
let _lastStoryJob = { running: false, total: 0, completed: 0, errors: 0, results: [], startedAt: null };

router.get('/status', (req, res) => {
  res.json(_lastStoryJob);
});

/**
 * POST /api/stories
 * Body: {
 *   accountIds: string[],   // IDs das contas
 *   imageUrl:   string,     // URL pública da imagem do story
 *   linkUrl?:   string,     // URL do link sticker (opcional)
 *   linkText?:  string,     // Texto da figurinha (opcional)
 *   intervalMinutes?: number,
 *   linkX?:     number,
 *   linkY?:     number,
 * }
 */
router.post('/', async (req, res) => {
  const { accountIds, imageUrl, linkUrl, linkText, intervalMinutes, linkX, linkY } = req.body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos uma conta' });
  }
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL da imagem é obrigatória' });
  }

  const intervalMs = Math.max(0, Number(intervalMinutes) || 0) * 60 * 1000;

  // Ordem das contas sorteada a cada lote. Publicar sempre na ordem em que as
  // contas aparecem na tela repete a mesma sequência todo dia — padrão fixo.
  // A seed inclui o instante do lote, então cada envio tem sua própria ordem.
  const { criarRandom, embaralhar } = require('../services/publicationPlanner');
  const ordemDoLote = embaralhar(accountIds, criarRandom(`stories:${Date.now()}`));

  // Processador em segundo plano que não trava o navegador
  const runStoryBatch = async () => {
    _lastStoryJob = {
      running: true,
      total: accountIds.length,
      completed: 0,
      errors: 0,
      results: [],
      startedAt: new Date(),
    };
    broadcast('stories', { action: 'started', total: accountIds.length });

    for (let i = 0; i < ordemDoLote.length; i++) {
      // Aplica intervalo entre contas (com jitter orgânico de ±10%)
      if (i > 0) {
        let waitMs = intervalMs;
        if (waitMs <= 0) {
          // Padrão de 2 a 5 min, a mesma faixa do Postar. Os 12–25s anteriores
          // eram uma ordem de grandeza mais rápidos do que qualquer pessoa
          // trocando de conta no celular.
          waitMs = Math.floor(Math.random() * 180000) + 120000;
        } else {
          const jitter = 1 + ((Math.random() * 0.20) - 0.10);
          waitMs = Math.round(waitMs * jitter);
        }
        console.log(`[Stories] Aguardando ${(waitMs / 1000).toFixed(1)}s antes de postar na próxima conta...`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      const account = await Account.findById(ordemDoLote[i]).catch(() => null);
      if (!account) {
        _lastStoryJob.errors++;
        _lastStoryJob.results.push({ accountId: ordemDoLote[i], status: 'error', error: 'Conta não encontrada' });
        continue;
      }

      let lastErr;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const info = await postStory(account, {
            imageUrl,
            linkUrl:  linkUrl  || null,
            linkText: linkText || null,
            linkX:    linkX !== undefined ? Number(linkX) : undefined,
            linkY:    linkY !== undefined ? Number(linkY) : undefined,
          });
          _lastStoryJob.completed++;
          _lastStoryJob.results.push({
            accountId: ordemDoLote[i],
            username:  account.username,
            status:      'success',
            method:      info.method,
            withLink:    info.withLink,
            linkVisible: info.linkVisible,
          });
          lastErr = null;
          broadcast('stories', { action: 'progress', completed: _lastStoryJob.completed, total: accountIds.length, username: account.username });
          break;
        } catch (err) {
          lastErr = err;
          const isTooMany = /too many actions|please wait|rate limit|feedback_required/i.test(err.message);
          if (isTooMany && attempt === 1) {
            console.log(`⏳ [Story] @${account.username} — rate limit, aguardando 25s antes de tentar novamente...`);
            await new Promise(r => setTimeout(r, 25_000));
          }
        }
      }

      if (lastErr) {
        _lastStoryJob.errors++;
        console.error(`❌ Story @${account.username}:`, lastErr.message);
        _lastStoryJob.results.push({
          accountId: ordemDoLote[i],
          username:  account.username,
          status:    'error',
          error:     lastErr.message,
        });
        broadcast('stories', { action: 'error', username: account.username, error: lastErr.message });
      }
    }

    _lastStoryJob.running = false;
    broadcast('stories', { action: 'completed', results: _lastStoryJob.results });
    broadcast('posts', { action: 'created' });
  };

  // Se for apenas 1 conta sem intervalo configurado, executa rápido síncrono
  if (accountIds.length === 1 && intervalMs === 0) {
    const account = await Account.findById(accountIds[0]).catch(() => null);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    try {
      const info = await postStory(account, {
        imageUrl,
        linkUrl:  linkUrl  || null,
        linkText: linkText || null,
        linkX:    linkX !== undefined ? Number(linkX) : undefined,
        linkY:    linkY !== undefined ? Number(linkY) : undefined,
      });
      return res.json({
        success: true,
        results: [{ accountId: account._id, username: account.username, status: 'success', method: info.method, withLink: info.withLink, linkVisible: info.linkVisible }],
        successCount: 1,
        total: 1,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Para múltiplas contas ou com intervalo, inicia em segundo plano imediatamente
  runStoryBatch().catch(err => console.error('[Stories Background] Erro fatal:', err));

  return res.json({
    success: true,
    inBackground: true,
    message: `Publicação de stories iniciada para ${accountIds.length} conta(s) em segundo plano.`,
    total: accountIds.length,
  });
});

module.exports = router;
