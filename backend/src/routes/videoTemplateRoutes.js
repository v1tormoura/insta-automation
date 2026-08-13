'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/videoTemplateController');

router.get   ('/',               ctrl.list);
router.get   ('/:id',            ctrl.get);
router.post  ('/',               ctrl.create);
router.put   ('/:id',            ctrl.update);
router.delete('/:id',            ctrl.remove);
router.post  ('/:id/duplicate',  ctrl.duplicate);

module.exports = router;
