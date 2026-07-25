'use strict';
const router = require('express').Router();
const c = require('../controllers/repostController');

router.get('/rules',             c.listRules);
router.post('/rules',            c.createRule);
router.patch('/rules/:id',       c.updateRule);
router.patch('/rules/:id/toggle', c.toggleRule);
router.delete('/rules/:id',      c.deleteRule);
router.get('/queue',             c.getQueue);
router.get('/stats',             c.getStats);

module.exports = router;
