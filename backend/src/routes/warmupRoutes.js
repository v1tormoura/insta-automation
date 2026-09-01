'use strict';

const express   = require('express');
const router    = express.Router();
const Account   = require('../models/Account');
const WarmupLog = require('../models/WarmupLog');
const { startWarmup, stopWarmupAndSave, getActiveJobs } = require('../jobs/warmupJob');

// GET /warmup — lista status de todas as contas
router.get('/', async (req, res) => {
  try {
    const accounts = await Account.find({}, 'username avatar name followers following postsCount accountType healthStatus tokenExpiresAt warmupActive warmupIntensity warmupActions warmupInterval warmupMaxLikes warmupMaxComments warmupMaxFollows warmupMaxStories warmupComments warmupFonte warmupHashtags warmupMaxDuration igSession instagrapiSession provider');
    const activeIds = getActiveJobs();
    const data = accounts.map(a => ({
      _id:             a._id,
      username:        a.username,
      avatar:          a.avatar,
      name:            a.name,
      followers:       a.followers,
      following:       a.following,
      postsCount:      a.postsCount,
      accountType:     a.accountType,
      healthStatus:    a.healthStatus,
      tokenExpiresAt:  a.tokenExpiresAt,
      warmupActive:    a.warmupActive || false,
      warmupIntensity: a.warmupIntensity || 'leve',
      warmupActions:   a.warmupActions || ['likes'],
      warmupInterval:  a.warmupInterval || 30,
      warmupMaxLikes:      a.warmupMaxLikes    || 6,
      warmupMaxComments:   a.warmupMaxComments || 2,
      warmupMaxFollows:    a.warmupMaxFollows  || 4,
      warmupComments:      a.warmupComments    || [],
      running:         activeIds.includes(String(a._id)),
      hasSession:      !!(a.igSession && a.igSession !== 'use_cookies' && a.igSession.length > 10),
      warmupMaxStories: a.warmupMaxStories ?? 3,
      warmupMaxDuration: a.warmupMaxDuration || 0,
      warmupFonte:     a.warmupFonte || 'reels',
      warmupHashtags:  a.warmupHashtags || [],
      provider:        a.provider || 'official',
      /* O que decide quais ações funcionam. Sem sessão mobile, seguir e ver
         stories não têm por onde acontecer, e a tela precisa dizer isso ANTES
         de a pessoa ligar o aquecimento e esperar meia hora por um ciclo
         vazio. Vai como booleano: a sessão em si nunca sai daqui. */
      temMobile:       !!a.instagrapiSession,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup/:id/login — cria sessão Private API via username+password
router.post('/:id/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Senha é obrigatória.' });

    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

    const { IgApiClient } = require('instagram-private-api');
    const ig = new IgApiClient();
    ig.state.generateDevice(account.username);

    try {
      await ig.simulate.preLoginFlow();
    } catch {}

    await ig.account.login(account.username, password);

    try {
      await ig.simulate.postLoginFlow();
    } catch {}

    const state = await ig.state.serialize();
    delete state.constants;
    const sessionStr = JSON.stringify({ ...state, _deviceSeed: account.username });

    await Account.findByIdAndUpdate(account._id, { igSession: sessionStr });

    res.json({ ok: true, message: 'Sessão conectada com sucesso!' });
  } catch (err) {
    const msg = err.message || '';
    if (/IgLoginTwoFactorRequiredError/.test(msg) || /two_factor/.test(msg)) {
      return res.status(400).json({ error: 'Esta conta tem verificação em duas etapas ativada. Desative temporariamente o 2FA e tente novamente.' });
    }
    if (/IgCheckpointError/.test(msg) || /checkpoint/.test(msg)) {
      return res.status(400).json({ error: 'Instagram bloqueou o login (checkpoint). Abra o app do Instagram, confirme o login e tente novamente.' });
    }
    if (/IgLoginBadPasswordError/.test(msg) || /bad_password/.test(msg)) {
      return res.status(400).json({ error: 'Senha incorreta. Verifique e tente novamente.' });
    }
    res.status(500).json({ error: `Erro ao fazer login: ${err.message}` });
  }
});

// POST /warmup/:id/logout — remove sessão Private API
router.post('/:id/logout', async (req, res) => {
  try {
    await Account.findByIdAndUpdate(req.params.id, { igSession: '' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    /* `maxDurationHours` estava fora desta lista e chegava sempre indefinido ao
       job — o encerramento automático por duração existia, era configurável na
       tela, e nunca disparava. Campo que a interface oferece e o servidor
       descarta é pior que campo ausente: a pessoa confia nele. */
    const {
      intensity = 'leve', actions = ['likes'], intervalMinutes = 30,
      maxLikes = 6, maxComments = 2, maxFollows = 4, maxStories = 3,
      commentList = [], maxDurationHours = 0,
      fonte = 'reels', hashtags = [],
    } = req.body;

    const result = await startWarmup(req.params.id, {
      intensity, actions, intervalMinutes,
      maxLikes, maxComments, maxFollows, maxStories,
      commentList, maxDurationHours, fonte, hashtags,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    const result = await stopWarmupAndSave(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /warmup/logs?accountId=&limit=50
router.get('/logs', async (req, res) => {
  try {
    const { accountId, limit = 60 } = req.query;
    const filter = accountId ? { accountId } : {};
    const logs = await WarmupLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Number(limit)))
      .select('accountId username action detail targetUser status errorMsg createdAt')
      .lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
