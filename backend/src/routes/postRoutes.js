const router = require('express').Router();
const upload = require('../config/upload');

const { createPost, getPosts, deletePost, cancelPost, retryPost, retryAllErrors, filaDePostagens, limparFila } = require('../controllers/postController');

router.post('/', upload.any(), createPost);
router.post('/retry-errors', retryAllErrors);

/* A fila fica ANTES de `/:id` — senão o Express casaria 'fila' como um id e a
   rota nunca seria alcançada. */
router.get('/fila', filaDePostagens);
router.post('/fila/limpar', limparFila);

router.get('/', getPosts);
router.delete('/:id', deletePost);
router.patch('/:id/cancel', cancelPost);
router.post('/:id/retry', retryPost);

module.exports = router;
