const router = require('express').Router();

const { getHealth } = require('../controllers/healthController');
const { runHealthCheck } = require('../jobs/healthCheck');

router.get('/', getHealth);

// Dispara verificação imediata (botão "Verificar agora" no frontend)
router.post('/check-now', async (req, res) => {
  try {
    runHealthCheck(); // dispara em background, não aguarda
    res.json({ success: true, message: 'Verificação iniciada em background.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
