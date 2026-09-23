'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/jobController');

router.get   ('/',               ctrl.list);
/* ANTES de '/:id': o Express casa na ordem, e 'excluir-varios' viraria um id. */
router.post  ('/excluir-varios', ctrl.removeVarios);
router.get   ('/:id',            ctrl.get);
router.post  ('/:id/pause',      ctrl.pause);
router.post  ('/:id/resume',     ctrl.resume);
router.post  ('/:id/cancel',     ctrl.cancel);
router.post  ('/:id/rerun',      ctrl.rerun);
router.post  ('/:id/toggle',     ctrl.togglePause);
router.delete('/:id',            ctrl.remove);

module.exports = router;
