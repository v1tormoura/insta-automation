const router = require('express').Router();
const upload = require('../config/upload');

const { uploadMedia, getMedia, deleteMedia } = require('../controllers/mediaController');

router.get('/', getMedia);
router.post('/upload', upload.array('media', 100), uploadMedia);
router.delete('/:id', deleteMedia);

module.exports = router;
