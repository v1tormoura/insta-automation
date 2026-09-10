const router = require('express').Router();

const { getHealth } = require('../controllers/healthController');
const { runHealthCheck } = require('../jobs/healthCheck');

router.get('/', getHealth);

/**
 * Auditoria de coerência entre as contas.
 *
 * Fica em `/health` porque é diagnóstico da frota, do mesmo tipo que o resto
 * desta rota — e não em `/accounts`, que é sobre uma conta por vez. O achado
 * que importa aqui é justamente o que só existe ENTRE contas.
 *
 * `?formato=texto` devolve o relatório pronto para ler no terminal, para quem
 * está no SSH e não quer garimpar JSON.
 */
router.get('/coerencia', async (req, res) => {
  try {
    const auditoria = require('../services/auditoriaDeCoerencia');
    const r = await auditoria.auditar();
    if (req.query.formato === 'texto') {
      res.type('text/plain').send(auditoria.emTexto(r));
      return;
    }
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'COERENCIA_ERRO' });
  }
});

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
