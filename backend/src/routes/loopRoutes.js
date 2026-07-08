'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/loopController');

router.get('/',           ctrl.list);
router.post('/',          ctrl.create);
router.patch('/:id',      ctrl.update);
router.post('/:id/toggle',ctrl.togglePause);
router.delete('/:id',     ctrl.remove);
router.get('/:id/history',ctrl.history);

module.exports = router;
