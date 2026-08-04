'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/loopController');
const upload = require('../config/upload');

router.post('/upload-media', (req, res, next) => {
  upload.array('files', 30)(req, res, (err) => {
    if (err) {
      console.error('[upload-media] multer erro:', err);
      return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    }
    next();
  });
}, ctrl.uploadMedia);
router.get('/',           ctrl.list);
router.post('/',          ctrl.create);
router.patch('/:id',      ctrl.update);
router.post('/:id/toggle',ctrl.togglePause);
router.delete('/:id',     ctrl.remove);
router.get('/:id/history',ctrl.history);

module.exports = router;
