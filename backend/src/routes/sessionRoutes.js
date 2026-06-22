const router = require('express').Router();

const { getSessions, testSession, openSession } = require('../controllers/sessionController');

router.get('/', getSessions);
router.post('/:id/test', testSession);
router.post('/:id/open', openSession);

module.exports = router;
