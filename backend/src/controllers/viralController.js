'use strict';
const mongoose = require('mongoose');
const Insight  = require('../models/Insight');
const Account  = require('../models/Account');
const path     = require('path');
const fs       = require('fs');

// GET /viral/search?q=&niche=&period=7d&limit=12
exports.search = async (req, res) => {
  try {
    const { q = '', niche = '', period = '7d', limit = 12 } = req.query;
    const days  = { '7d': 7, '30d': 30 }[period] || 7;
    const since = new Date(Date.now() - days * 86400000);

    const filter = { postedAt: { $gte: since }, mediaType: 'VIDEO', videoViews: { $gt: 0 } };
    if (q)     filter.caption  = { $regex: q,     $options: 'i' };
    if (niche) filter.username = { $regex: niche, $options: 'i' };

    const items = await Insight.find(filter)
      .sort({ videoViews: -1 })
      .limit(Math.min(50, Number(limit)))
      .select('username igMediaId videoViews likeCount savedCount shareCount commentsCount reach permalink thumbnailUrl postedAt caption mediaType');

    res.json({ items, updatedAt: new Date(), source: 'insights' });
  } catch (err) {
    console.error('[viralController.search]', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /viral/download  { igMediaId, videoUrl }
// Downloads the video at original quality and saves to uploads/viral/
exports.download = async (req, res) => {
  try {
    const { igMediaId, videoUrl, permalink } = req.body;
    if (!igMediaId) return res.status(400).json({ error: 'igMediaId obrigatório' });

    // Try to get videoUrl from Graph API if not provided
    let url = videoUrl;
    if (!url && permalink) {
      // Last resort: try to get via Graph API using any account's access token
      const acc = await Account.findOne({ accessToken: { $exists: true, $ne: '' } });
      if (acc) {
        const apiUrl = `https://graph.instagram.com/v21.0/${igMediaId}?fields=media_url,video_url&access_token=${acc.accessToken}`;
        const r = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const d = await r.json();
          url = d.video_url || d.media_url;
        }
      }
    }

    if (!url) return res.status(400).json({ error: 'videoUrl obrigatório — URL do vídeo não disponível' });

    // Ensure uploads/viral directory exists
    const viralDir = path.resolve(__dirname, '../../uploads/viral');
    if (!fs.existsSync(viralDir)) fs.mkdirSync(viralDir, { recursive: true });

    const filename = `viral_${igMediaId}_${Date.now()}.mp4`;
    const dest     = path.join(viralDir, filename);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(120000),
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
