const router = require('express').Router();

const { getHealth } = require('../controllers/healthController');

router.get('/', getHealth);

module.exports = router;
