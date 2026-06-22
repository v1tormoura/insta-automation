const router = require('express').Router();

const {
  createLegend,
  getLegends,
  updateLegend,
  deleteLegend,
  getRandomLegend,
} = require('../controllers/legendController');

router.get('/', getLegends);
router.get('/random', getRandomLegend);
router.post('/', createLegend);
router.patch('/:id', updateLegend);
router.delete('/:id', deleteLegend);

module.exports = router;
