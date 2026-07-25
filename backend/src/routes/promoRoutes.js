'use strict';

const router  = require('express').Router();
const Account = require('../models/Account');
const { testPromoNow } = require('../jobs/promoJob');

const PROMO_FIELDS = 'username avatar name igUserId accessToken promoEnabled promoLink autoComment autoCommentTemplate autoStory autoBio lastPromoAt';

// GET /promo — lista contas com configurações de promo
router.get('/', async (req, res) => {
  try {
    const accounts = await Account.find({}, PROMO_FIELDS).lean();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /promo/:id — salva configurações de promo
router.post('/:id', async (req, res) => {
  try {
    const { promoEnabled, promoLink, autoComment, autoCommentTemplate, autoStory, autoBio } = req.body;
    const update = {};
    if (promoEnabled          !== undefined) update.promoEnabled          = promoEnabled;
    if (promoLink             !== undefined) update.promoLink             = promoLink;
    if (autoComment           !== undefined) update.autoComment           = autoComment;
    if (autoCommentTemplate   !== undefined) update.autoCommentTemplate   = autoCommentTemplate;
    if (autoStory             !== undefined) update.autoStory             = autoStory;
    if (autoBio               !== undefined) update.autoBio               = autoBio;

    const account = await Account.findByIdAndUpdate(req.params.id, update, { new: true })
      .select(PROMO_FIELDS);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /promo/:id/test/:feature — testa imediatamente (comment | story | bio)
router.post('/:id/test/:feature', async (req, res) => {
  try {
    const result = await testPromoNow(req.params.id, req.params.feature);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
