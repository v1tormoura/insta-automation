'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const ctrl    = require('../controllers/limpadorController');

const upload = multer({
  dest: path.resolve(__dirname, '../../uploads/limpador-tmp'),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = express.Router();
router.post('/process', upload.single('file'), ctrl.process);

module.exports = router;
