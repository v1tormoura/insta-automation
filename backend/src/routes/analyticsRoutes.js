'use strict';
const router = require('express').Router();
const { getBestTimes, getTrendingAudio } = require('../controllers/analyticsController');

router.get('/best-times',      getBestTimes);
router.get('/trending-audio',  getTrendingAudio);

module.exports = router;
