'use strict';
const router = require('express').Router();
const c = require('../controllers/abtestController');

router.get('/',           c.list);
router.post('/',          c.create);
router.get('/:id',        c.get);
router.delete('/:id',     c.remove);
router.post('/:id/start', c.start);
router.post('/:id/end',   c.end);

module.exports = router;
