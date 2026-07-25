'use strict';
const router = require('express').Router();
const { search, download } = require('../controllers/viralController');

router.get('/search',    search);
router.post('/download', download);

module.exports = router;
