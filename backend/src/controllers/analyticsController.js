'use strict';
const mongoose = require('mongoose');
const Insight  = require('../models/Insight');

// GET /analytics/best-times?accountId=&period=30d
exports.getBestTimes = async (req, res) => {
  try {
    const { accountId, period = '30d' } = req.query;
    const days  = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
    const since = new Date(Date.now() - days * 86400000);

    const match = { postedAt: { $gte: since }, engagementScore: { $gt: 0 } };
    if (accountId) match.accountId = new mongoose.Types.ObjectId(accountId);

    const rows = await Insight.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            accountId: '$accountId',
            username:  '$username',
            hour:      { $hour: '$postedAt' },
          },
          avgEngagement: { $avg: '$engagementScore' },
          avgViews:      { $avg: '$videoViews' },
          count:         { $sum: 1 },
        },
      },
      { $sort: { '_id.accountId': 1, '_id.hour': 1 } },
    ]);

    // Pivot rows into per-account hour arrays
    const map = {};
    for (const row of rows) {
      const key = String(row._id.accountId);
      if (!map[key]) {
        map[key] = {
          accountId: row._id.accountId,
          username:  row._id.username,
          hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, avgEngagement: 0, avgViews: 0, count: 0 })),
        };
      }
      map[key].hours[row._id.hour] = {
        hour:          row._id.hour,
        avgEngagement: Math.round(row.avgEngagement),
        avgViews:      Math.round(row.avgViews),
        count:         row.count,
      };
    }

    const accounts = Object.values(map).map(a => {
      const peak = a.hours.reduce((best, h) => h.avgEngagement > best.avgEngagement ? h : best, a.hours[0]);
      return { ...a, peakHour: peak.hour };
    });

    // Global peak across all accounts
    const globalByHour = Array.from({ length: 24 }, (_, h) => {
      const vals = accounts.map(a => a.hours[h].avgEngagement).filter(Boolean);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    });
    const globalPeak = globalByHour.indexOf(Math.max(...globalByHour));

    res.json({ accounts, globalPeak, period });
  } catch (err) {
    console.error('[analyticsController.getBestTimes]', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /analytics/trending-audio?limit=12&period=7d
// Returns top-performing Reels from synced insights as "trending content"
exports.getTrendingAudio = async (req, res) => {
  try {
    const { limit = 12, period = '7d' } = req.query;
    const days  = { '7d': 7, '30d': 30 }[period] || 7;
    const since = new Date(Date.now() - days * 86400000);

    const items = await Insight.find({
      postedAt:   { $gte: since },
      mediaType:  'VIDEO',
      videoViews: { $gt: 0 },
    })
      .sort({ videoViews: -1 })
      .limit(Math.min(50, Number(limit)))
      .select('username igMediaId videoViews likeCount savedCount shareCount permalink postedAt caption');

    res.json({ items, updatedAt: new Date(), period });
  } catch (err) {
    console.error('[analyticsController.getTrendingAudio]', err);
    res.status(500).json({ error: err.message });
  }
};
