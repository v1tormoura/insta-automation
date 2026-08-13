'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/videoBatchController');

router.get ('/',                                   ctrl.list);
router.get ('/:id',                                ctrl.get);
router.post('/',       ctrl.uploadMiddleware,       ctrl.create);
router.post('/:id/cancel',                         ctrl.cancel);
router.get ('/:id/renders/:renderId/logs',         ctrl.getRenderJobLogs);
router.get ('/:id/renders/:renderId/download',     ctrl.downloadRender);
router.post('/:id/renders/:renderId/retry',        ctrl.retryRender);

module.exports = router;
