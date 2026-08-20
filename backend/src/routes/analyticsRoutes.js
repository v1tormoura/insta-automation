'use strict';
const router = require('express').Router();
const { getBestTimes, getTrendingAudio, getGlobalMetrics } = require('../controllers/analyticsController');

router.get('/global-metrics',  getGlobalMetrics);
router.get('/best-times',      getBestTimes);
router.get('/trending-audio',  getTrendingAudio);

module.exports = router;
