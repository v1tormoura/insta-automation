const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/downloaderController');

router.get('/profile', ctrl.searchProfile);
router.get('/file',    ctrl.proxyFile);

module.exports = router;
