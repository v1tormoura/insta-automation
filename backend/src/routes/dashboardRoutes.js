const router = require('express').Router();

const { getDashboard, getAccountStats, getLivePosts } = require('../controllers/dashboardController');

router.get('/', getDashboard);
router.get('/account-stats', getAccountStats);
router.get('/live-posts', getLivePosts);

module.exports = router;
