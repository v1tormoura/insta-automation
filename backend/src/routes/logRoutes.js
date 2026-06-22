const router = require('express').Router();

const { getAccountLogs } = require('../controllers/logController');

router.get('/:username', getAccountLogs);

module.exports = router;
