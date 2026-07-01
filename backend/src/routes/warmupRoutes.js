'use strict';

const express = require('express');
const router = express.Router();
const Account = require('../models/Account');
const { startWarmup, stopWarmupAndSave, getActiveJobs } = require('../jobs/warmupJob');

// GET /warmup — lista status de todas as contas
router.get('/', async (req, res) => {
  try {
    const accounts = await Account.find({}, 'username avatar warmupActive warmupIntensity warmupActions warmupInterval warmupMaxLikes warmupMaxComments warmupMaxFollows warmupComments');
    const activeIds = getActiveJobs();
    const data = accounts.map(a => ({
      _id: a._id,
      username: a.username,
      avatar: a.avatar,
      warmupActive: a.warmupActive || false,
      warmupIntensity: a.warmupIntensity || 'leve',
      warmupActions: a.warmupActions || ['likes'],
      warmupInterval: a.warmupInterval || 30,
      running: activeIds.includes(String(a._id)),
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const { intensity = 'leve', actions = ['likes'], intervalMinutes = 30, maxLikes = 6, maxComments = 2, maxFollows = 4, commentList = [] } = req.body;
    const result = await startWarmup(req.params.id, { intensity, actions, intervalMinutes, maxLikes, maxComments, maxFollows, commentList });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    const result = await stopWarmupAndSave(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
