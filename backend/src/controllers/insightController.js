'use strict';

const Insight   = require('../models/Insight');
const Post      = require('../models/Post');
const Account   = require('../models/Account');
const postQueue = require('../queue/postQueue');
const { broadcast } = require('../events/broadcaster');
const { syncAllInsights, syncAccountInsights } = require('../services/insightSyncService');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// POST /insights/sync  — fire and forget, responds immediately
exports.syncInsights = (req, res) => {
  res.json({ status: 'running', message: 'Sincronizando insights em background...' });
  syncAllInsights().catch(console.error);
};

// POST /insights/sync/:accountId
exports.syncAccount = async (req, res) => {
  const acc = await Account.findById(req.params.accountId).catch(() => null);
  if (!acc) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json({ status: 'running' });
  syncAccountInsights(acc).catch(console.error);
};

// GET /insights?metric=views&period=30d&mediaType=all&accountId=&limit=50
exports.getInsights = async (req, res) => {
  try {
    const { metric = 'engagementScore', period = '30d', mediaType, accountId, limit = 50 } = req.query;

    const days = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const filter = { postedAt: { $gte: since } };
    if (accountId) filter.accountId = accountId;
    if (mediaType && mediaType !== 'all' && mediaType !== 'tudo') {
      if      (mediaType === 'reel')      filter.mediaType = 'VIDEO';
      else if (mediaType === 'foto')      filter.mediaType = 'IMAGE';
      else if (mediaType === 'carrossel') filter.mediaType = 'CAROUSEL_ALBUM';
    }

    // Compound sorts: when the primary metric is 0 (e.g. videoViews before first sync with `plays`),
    // fall back to impressions/engagementScore so ranking always makes sense.
    const sortMap = {
      views:           { videoViews: -1, impressions: -1, engagementScore: -1 },
      alcance:         { reach: -1, impressions: -1, engagementScore: -1 },
      likes:           { likeCount: -1, engagementScore: -1 },
      coments:         { commentsCount: -1, engagementScore: -1 },
      saves:           { savedCount: -1, engagementScore: -1 },
      shares:          { shareCount: -1, engagementScore: -1 },
      engagementScore: { engagementScore: -1 },
    };
    const sortObj = sortMap[metric] || { engagementScore: -1 };

    const insights = await Insight.find(filter)
      .sort(sortObj)
      .limit(Math.min(200, Number(limit)));

    const totals = insights.reduce((acc, ins) => ({
      views:   acc.views   + ins.videoViews,
      alcance: acc.alcance + ins.reach,
      likes:   acc.likes   + ins.likeCount,
      coments: acc.coments + ins.commentsCount,
      saves:   acc.saves   + ins.savedCount,
      shares:  acc.shares  + ins.shareCount,
    }), { views: 0, alcance: 0, likes: 0, coments: 0, saves: 0, shares: 0 });

    const lastSync = insights.length ? insights[0].syncedAt : null;
    res.json({ insights, totals, lastSync, total: insights.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /insights/republish
// { igMediaId, mediaUrl, thumbnailUrl, mediaType, caption, accounts[], postType, processMode, intervalMinutes, scheduledAt }
exports.republishPost = async (req, res) => {
  try {
    const { igMediaId, mediaUrl, thumbnailUrl, mediaType, caption, accounts, postType, processMode, intervalMinutes, scheduledAt } = req.body;

    if (!accounts?.length) return res.status(400).json({ error: 'Selecione ao menos uma conta' });

    const isVideo  = postType === 'reel' || mediaType === 'VIDEO';
    const srcUrl   = isVideo ? (mediaUrl || thumbnailUrl) : (mediaUrl || thumbnailUrl);
    if (!srcUrl)   return res.status(400).json({ error: 'URL de mídia não encontrada — sincronize novamente' });

    // Re-fetch fresh URL from Graph API if igMediaId available, else use stored URL
    let finalUrl = srcUrl;
    if (igMediaId) {
      try {
        // Find any account with a valid token to re-fetch this media URL
        const acc = await Account.findOne({ accessToken: { $nin: [null, ''] }, igUserId: { $nin: [null, ''] } });
        if (acc) {
          const fields = isVideo ? 'media_url,thumbnail_url' : 'media_url';
          const GRAPH  = /^(IGAAL|IGQ|IG)/i.test(acc.accessToken)
            ? 'https://graph.instagram.com/v21.0'
            : 'https://graph.facebook.com/v21.0';
          const url = new URL(`${GRAPH}/${igMediaId}`);
          url.searchParams.set('fields', fields);
          url.searchParams.set('access_token', acc.accessToken);
          const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
          const d = await r.json();
          if (!d.error) finalUrl = d.media_url || d.thumbnail_url || srcUrl;
        }
      } catch { /* use stored URL */ }
    }

    // Download media to local uploads
    const ext      = isVideo ? '.mp4' : '.jpg';
    const filename = `republish_${(igMediaId || Date.now()).toString().slice(-10)}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const filePath = path.resolve(__dirname, '../../uploads', filename);
    const uploadDir = path.dirname(filePath);

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const resp = await fetch(finalUrl, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`Falha ao baixar mídia: HTTP ${resp.status}. Clique em Sincronizar e tente novamente.`);
    fs.writeFileSync(filePath, Buffer.from(await resp.arrayBuffer()));

    const finalPostType = postType || (isVideo ? 'reel' : 'post');
    const baseDate      = scheduledAt ? new Date(scheduledAt) : new Date();
    const intervalMs    = Math.max(0, (intervalMinutes || 0)) * 60 * 1000;

    if (intervalMs > 0) {
      // Com intervalo: um post por conta, cada um agendado com delay crescente
      const posts = [];
      for (let i = 0; i < accounts.length; i++) {
        const accountDelay = Math.max(baseDate.getTime() + i * intervalMs - Date.now(), 0);
        const p = await Post.create({
          media:       filename,
          mediaType:   isVideo ? 'video' : 'image',
          postType:    finalPostType,
          caption:     caption || '',
          processMode: processMode || 'limpeza_leve',
          accounts:    [accounts[i]],
          scheduledAt: new Date(Date.now() + accountDelay),
          status: accountDelay > 0 ? 'agendado' : 'pendente',
        });
        await postQueue.add('newPost', { postId: p._id }, { delay: accountDelay });
        posts.push(p);
      }
      broadcast('posts', { action: 'created' });
      res.json({ success: true, total: posts.length, post: posts[0] });
    } else {
      // Sem intervalo: todas as contas ao mesmo tempo
      const delay = Math.max(baseDate.getTime() - Date.now(), 0);
      const post = await Post.create({
        media:       filename,
        mediaType:   isVideo ? 'video' : 'image',
        postType:    finalPostType,
        caption:     caption || '',
        processMode: processMode || 'limpeza_leve',
        accounts,
        scheduledAt: baseDate,
        status: delay > 0 ? 'agendado' : 'pendente',
      });
      await postQueue.add('newPost', { postId: post._id }, { delay });
      broadcast('posts', { action: 'created' });
      res.json({ success: true, post });
    }
  } catch (err) {
    console.error('[republishPost]', err.message);
    res.status(500).json({ error: err.message });
  }
};
