'use strict';
const router = require('express').Router();
const {
  getBestTimes, getTrendingAudio, getGlobalMetrics, getMetricasDosPerfis,
  getAlcancePorEnvio, getPublico,
} = require('../controllers/analyticsController');

const { syncAllStoryInsights } = require('../services/storyInsightSync');

router.get('/global-metrics',  getGlobalMetrics);
/* Métricas dos perfis: rota própria porque precisa de hoje/ontem/total e de
   faixa livre por data — ver o comentário no controller. */
router.get('/metricas-dos-perfis', getMetricasDosPerfis);
router.get('/best-times',      getBestTimes);
/* O que está subindo: alcance por envio e por conta — ver alcancePorEnvio.js. */
router.get('/alcance-por-envio', getAlcancePorEnvio);
/* Quem viu: gênero, país, idade por conta — ver publicoDaConta.js. */
router.get('/publico',           getPublico);
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
