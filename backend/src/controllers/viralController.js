'use strict';
const path    = require('path');
const fs      = require('fs');
const Account = require('../models/Account');

/* GET /viral/search?hashtag=hot&limit=12&type=top|recent */
exports.search = async (req, res) => {
  try {
    const { hashtag = 'hot', limit = 12, type = 'top' } = req.query;
    const tag = hashtag.replace(/^#/, '').trim();
    if (!tag) return res.status(400).json({ error: 'hashtag obrigatória' });

    /* find any account with a valid Graph API token */
    const account = await Account.findOne({
      accessToken: { $exists: true, $ne: '' },
      igUserId:    { $exists: true, $ne: '' },
    });
    if (!account) {
      return res.status(503).json({
        error: 'Nenhuma conta com API conectada. Conecte ao menos uma conta via Meta API para minerar hashtags.',
      });
    }

    const { accessToken, igUserId } = account;

    /* Step 1 — resolve hashtag to an ID */
    const hashRes = await fetch(
      `https://graph.instagram.com/v21.0/ig_hashtag_search?user_id=${igUserId}&q=${encodeURIComponent(tag)}&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(12000) }
    );
    const hashData = await hashRes.json();
    if (!hashRes.ok || !hashData.data?.[0]?.id) {
      return res.status(400).json({ error: hashData.error?.message || `Hashtag #${tag} não encontrada` });
    }
    const hashtagId = hashData.data[0].id;

    /* Step 2 — get top or recent media */
    const endpoint  = type === 'recent' ? 'recent_media' : 'top_media';
    const fields    = 'id,caption,media_type,media_url,thumbnail_url,like_count,comments_count,timestamp,permalink';
    const mediaRes  = await fetch(
      `https://graph.instagram.com/v21.0/${hashtagId}/${endpoint}?user_id=${igUserId}&fields=${fields}&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const mediaData = await mediaRes.json();
    if (!mediaRes.ok) {
      return res.status(502).json({ error: mediaData.error?.message || 'Erro ao buscar mídia da hashtag' });
    }

    const raw = mediaData.data || [];

    /* keep only videos, sort by likes desc */
    const items = raw
      .filter(m => m.media_type === 'VIDEO')
      .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
      .slice(0, Number(limit))
      .map(m => ({
        igMediaId:    m.id,
        caption:      m.caption      || '',
        thumbnailUrl: m.thumbnail_url || m.media_url || '',
        mediaUrl:     m.media_url    || '',   /* direct CDN video URL */
        permalink:    m.permalink    || '',
        likeCount:    m.like_count   || 0,
        commentsCount:m.comments_count || 0,
        postedAt:     m.timestamp,
        videoViews:   0,   /* not available via hashtag endpoint */
      }));

    res.json({
      items,
      hashtag: tag,
      hashtagId,
      total:   raw.length,
      videos:  items.length,
      source:  'instagram_hashtag_api',
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error('[viralController.search]', err);
    res.status(500).json({ error: err.message });
  }
};

/* POST /viral/download  { igMediaId, mediaUrl, permalink } */
exports.download = async (req, res) => {
  try {
    const { igMediaId, mediaUrl, permalink } = req.body;
    if (!igMediaId) return res.status(400).json({ error: 'igMediaId obrigatório' });

    /* use direct CDN url if provided, else try Graph API */
    let url = mediaUrl || '';

    if (!url) {
      const account = await Account.findOne({ accessToken: { $exists: true, $ne: '' } });
      if (account) {
        const r = await fetch(
          `https://graph.instagram.com/v21.0/${igMediaId}?fields=media_url,video_url&access_token=${account.accessToken}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (r.ok) {
          const d = await r.json();
          url = d.video_url || d.media_url || '';
        }
      }
    }

    if (!url) return res.status(400).json({ error: 'URL do vídeo não disponível — tente novamente logo após a busca (URLs do CDN expiram)' });

    /* ensure uploads/viral dir */
    const viralDir = path.resolve(__dirname, '../../uploads/viral');
    if (!fs.existsSync(viralDir)) fs.mkdirSync(viralDir, { recursive: true });

    const filename = `viral_${igMediaId}_${Date.now()}.mp4`;
    const dest     = path.join(viralDir, filename);

    const response = await fetch(url, {
      signal:  AbortSignal.timeout(120000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
    });
    if (!response.ok) return res.status(502).json({ error: `Falha ao baixar: HTTP ${response.status}` });

    const buf = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buf));

    res.json({ filename, url: `/uploads/viral/${filename}`, size: buf.byteLength });
  } catch (err) {
    console.error('[viralController.download]', err);
    res.status(500).json({ error: err.message });
  }
};
