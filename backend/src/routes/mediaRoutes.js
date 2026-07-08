const router = require('express').Router();
const upload = require('../config/upload');
const {
  uploadMedia, getMedia, deleteMedia, moveMedia, createFolder, deleteFolder,
} = require('../controllers/mediaController');

router.get('/', getMedia);
router.post('/upload', upload.any(), uploadMedia);
router.delete('/:id', deleteMedia);
router.patch('/:id/folder', moveMedia);
router.post('/folder', createFolder);
router.delete('/folder/:name', deleteFolder);

module.exports = router;
