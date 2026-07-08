const router = require('express').Router();

const { getDashboard, getAccountStats } = require('../controllers/dashboardController');

router.get('/', getDashboard);
router.get('/account-stats', getAccountStats);

module.exports = router;
