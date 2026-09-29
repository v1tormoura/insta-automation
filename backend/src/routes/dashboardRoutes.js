const router = require('express').Router();

const { getDashboard, getAccountStats, getLivePosts } = require('../controllers/dashboardController');

router.get('/', getDashboard);
router.get('/account-stats', getAccountStats);
router.get('/live-posts', getLivePosts);

/* Mapa do Dashboard: audiência por estado (demografia oficial da Meta). */
router.get('/audiencia-estados', async (req, res) => {
  try {
    const { accounts } = require('../repos');
    const contas = await accounts.de(req.user.id).findMany();
    res.json(await require('../services/audienciaPorEstado').doUsuario(contas, String(req.query.metrica || 'alcancados')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
