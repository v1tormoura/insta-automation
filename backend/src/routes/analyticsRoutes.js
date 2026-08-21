'use strict';
const router = require('express').Router();
const { getBestTimes, getTrendingAudio, getGlobalMetrics } = require('../controllers/analyticsController');

const { syncAllStoryInsights } = require('../services/storyInsightSync');

router.get('/global-metrics',  getGlobalMetrics);
router.get('/best-times',      getBestTimes);
router.get('/trending-audio',  getTrendingAudio);

/**
 * Forca a coleta de audiencia dos stories agora.
 *
 * O ciclo automatico roda a cada 30 min, mas story vive 24h e some sem aviso —
 * quem acabou de publicar precisa de um jeito de puxar o numero na hora, em vez
 * de esperar a proxima volta e nao saber se funcionou.
 */
router.post('/story-insights/sync', async (req, res) => {
  try {
    const r = await syncAllStoryInsights();
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
