'use strict';

const router = require('express').Router();
const c = require('../controllers/insightController');

router.get('/',                  c.getInsights);
router.post('/sync',             c.syncInsights);
router.post('/sync/:accountId',  c.syncAccount);
router.post('/republish',        c.republishPost);

module.exports = router;
