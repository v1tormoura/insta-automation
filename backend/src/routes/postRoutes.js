const router = require('express').Router();
const upload = require('../config/upload');

const { createPost, getPosts, deletePost, cancelPost, retryPost, retryAllErrors } = require('../controllers/postController');

router.post('/', upload.any(), createPost);
router.post('/retry-errors', retryAllErrors);

router.get('/', getPosts);
router.delete('/:id', deletePost);
router.patch('/:id/cancel', cancelPost);
router.post('/:id/retry', retryPost);

module.exports = router;
