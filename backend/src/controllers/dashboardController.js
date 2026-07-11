const fs = require('fs');
const path = require('path');
const Growth = require('../models/Growth');
const Account = require('../models/Account');
const Post = require('../models/Post');
const mongoose = require('mongoose');

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hasSession(username) {
  const cookiesPath = path.resolve(__dirname, '../../sessions', username, 'cookies.json');
  return fs.existsSync(cookiesPath);
}

function calcHealthScore(account) {
  let score = 100;

  if (!hasSession(account.username)) score -= 30;
  if (account.healthStatus === 'restrita') score -= 25;
  if (account.healthStatus === 'erro_login') score -= 45;
  if (account.healthStatus === 'sessao_expirada') score -= 40;
  if (account.healthStatus === 'banida') score = 0;
  if (account.lastError) score -= 15;
  if (account.proxy && account.proxyStatus === 'offline') score -= 15;
  if (account.isBusy) score -= 5;

  return Math.max(score, 0);
}

exports.getDashboard = async (req, res) => {
  try {
    const today = startOfDay();
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(30);

    const accounts = await Account.find().sort({ updatedAt: -1 });

    const totalAccounts = accounts.length;
    const BAD = ['banida', 'restrita', 'token_invalido'];
    const activeAccounts = accounts.filter((a) =>
      a.healthStatus === 'ativa' ||
      (a.accessToken && a.igUserId && !BAD.includes(a.healthStatus))
    ).length;
    const restrictedAccounts    = accounts.filter((a) => a.healthStatus === 'restrita').length;
    const bannedAccounts        = accounts.filter((a) => a.healthStatus === 'banida').length;
    const tokenInvalidAccounts  = accounts.filter((a) => a.healthStatus === 'token_invalido').length;
    const expiredSessions       = accounts.filter((a) => a.healthStatus === 'sessao_expirada').length;
    const loginErrorAccounts    = accounts.filter((a) => a.healthStatus === 'erro_login').length;
    const busyAccounts          = accounts.filter((a) => a.isBusy).length;

    const sessionsOk = accounts.filter((a) => hasSession(a.username)).length;
    const sessionsMissing = totalAccounts - sessionsOk;

    const proxiesConfigured = accounts.filter((a) => !!a.proxy).length;
    const proxiesOnline = accounts.filter((a) => a.proxy && a.proxyStatus === 'online').length;
    const proxiesOffline = accounts.filter((a) => a.proxy && a.proxyStatus !== 'online').length;

    const healthyAccounts = accounts.filter((a) => calcHealthScore(a) >= 80).length;
    const attentionAccounts = accounts.filter((a) => {
      const score = calcHealthScore(a);
      return score >= 50 && score < 80;
    }).length;
    const riskAccounts = accounts.filter((a) => calcHealthScore(a) < 50).length;

    const totalFollowers = accounts.reduce((sum, acc) => sum + (acc.followers || 0), 0);

    const totalPosts = await Post.countDocuments();
    const completedPosts = await Post.countDocuments({ status: 'concluido' });
    const scheduledPosts = await Post.countDocuments({ status: 'agendado' });
    const processingPosts = await Post.countDocuments({ status: 'processando' });
    const pendingPosts = await Post.countDocuments({ status: 'pendente' });
    const partialPosts = await Post.countDocuments({ status: 'parcial' });
    const errorPosts = await Post.countDocuments({ status: 'erro' });

    const postsToday = await Post.countDocuments({
      updatedAt: { $gte: today },
    });

    const completedToday = await Post.countDocuments({
      status: 'concluido',
      updatedAt: { $gte: today },
    });

    const errorsToday = await Post.countDocuments({
      status: 'erro',
      updatedAt: { $gte: today },
    });

    const posts7Days = await Post.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const posts30Days = await Post.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    const growth30Days = await Growth.find().sort({ createdAt: -1 }).limit(500);

    // Série temporal: posts publicados/processados por dia (últimos 90 dias)
    // Usa updatedAt para capturar quando o post foi de fato publicado, não quando foi criado/agendado
    const ninetyDaysAgo = daysAgo(90);
    const dailyPostsRaw = await Post.aggregate([
      { $match: { updatedAt: { $gte: ninetyDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
        count: { $sum: 1 },
      }},
    ]);
    const rawMap = {};
    dailyPostsRaw.forEach(d => { rawMap[d._id] = d.count; });
    const dailyPosts = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyPosts.push({
        date: key,
        label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
        posts: rawMap[key] || 0,
      });
    }

    const queueTotal = scheduledPosts + processingPosts + pendingPosts;

    const accountsAddedToday = accounts.filter(a => new Date(a.createdAt) >= today).length;
    const accountsAdded7d    = accounts.filter(a => new Date(a.createdAt) >= sevenDaysAgo).length;
    const accountsAdded30d   = accounts.filter(a => new Date(a.createdAt) >= thirtyDaysAgo).length;

    const problemStatuses = ['banida', 'restrita', 'token_invalido'];
    const problemsToday = accounts.filter(a => problemStatuses.includes(a.healthStatus) && new Date(a.updatedAt) >= today).length;
    const problems7d    = accounts.filter(a => problemStatuses.includes(a.healthStatus) && new Date(a.updatedAt) >= sevenDaysAgo).length;
    const problems30d   = accounts.filter(a => problemStatuses.includes(a.healthStatus)).length;

    const upcomingPosts = await Post.find({
      status: 'agendado',
      scheduledAt: { $gte: new Date() },
    })
      .populate('accounts')
      .sort({ scheduledAt: 1 })
      .limit(10);

    const latestPosts = await Post.find().populate('accounts').sort({ updatedAt: -1 }).limit(10);

    const accountsInUse = accounts
      .filter((a) => a.isBusy)
      .sort((a, b) => new Date(b.busySince || 0) - new Date(a.busySince || 0))
      .slice(0, 10);

    const accountMostActive =
      [...accounts].sort((a, b) => (b.postsToday || 0) - (a.postsToday || 0))[0] || null;

    const topAccounts = [...accounts]
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 5)
      .map((a) => ({
        _id: a._id,
        username: a.username,
        followers: a.followers || 0,
        following: a.following || 0,
        postsCount: a.postsCount || 0,
        healthStatus: a.healthStatus,
        avatar: a.avatar || '',
        healthScore: calcHealthScore(a),
      }));

    const worstAccounts = [...accounts]
      .sort((a, b) => calcHealthScore(a) - calcHealthScore(b))
      .slice(0, 5)
      .map((a) => ({
        _id: a._id,
        username: a.username,
        score: calcHealthScore(a),
        healthStatus: a.healthStatus,
        lastError: a.lastError,
      }));

    const lastErrorPost = await Post.findOne({
      status: 'erro',
    })
      .populate('accounts')
      .sort({ updatedAt: -1 });

    const activities = [];

    latestPosts.forEach((post) => {
      const accountName = post.accounts?.[0]?.username || '';
      const typeLabel   = post.postType === 'reel' ? 'Reel' : post.postType === 'story' ? 'Story' : 'Post';
      const statusLabel = { concluido: 'publicado', erro: 'com erro', pendente: 'na fila', processando: 'processando', agendado: 'agendado', parcial: 'parcial' }[post.status] || post.status;
      activities.push({
        type:     'post',
        action:   `${typeLabel} ${statusLabel}`,
        status:   post.status,
        account:  accountName,
        postType: post.postType || 'post',
        caption:  (post.caption || '').slice(0, 50),
        date:     post.updatedAt || post.createdAt,
      });
    });

    accounts.slice(0, 10).forEach((account) => {
      const statusLabel = { ativa: 'conectada', banida: 'banida', restrita: 'restrita', sessao_expirada: 'sessão expirada', erro_login: 'erro de login' }[account.healthStatus] || account.healthStatus;
      activities.push({
        type:     'account',
        action:   `Conta ${statusLabel}`,
        status:   account.healthStatus || 'ativa',
        account:  account.username,
        avatar:   account.avatar || '',
        username: account.username,
        date:     account.updatedAt,
      });
    });

    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    const finishedPosts = completedPosts + errorPosts + partialPosts;

    const successRate =
      finishedPosts > 0 ? Math.round((completedPosts / finishedPosts) * 100) : 100;

    const errorRate = finishedPosts > 0 ? Math.round((errorPosts / finishedPosts) * 100) : 0;

    const operationalScore =
      totalAccounts > 0
        ? Math.round(
            (healthyAccounts * 100 + attentionAccounts * 65 + riskAccounts * 25) / totalAccounts
          )
        : 100;

    const growthMap = {};

    growth30Days.forEach((item) => {
      if (!growthMap[item.username]) {
        growthMap[item.username] = {
          username: item.username,
          first: item.followers,
          last: item.followers,
        };
      }

      growthMap[item.username].first = item.followers;
    });

    const topGrowth = Object.values(growthMap)
      .map((item) => ({
        username: item.username,
        gained: item.last - item.first,
      }))
      .sort((a, b) => b.gained - a.gained)
      .slice(0, 10);

    res.json({
      totalAccounts,
      activeAccounts,
      restrictedAccounts,
      expiredSessions,
      bannedAccounts,
      loginErrorAccounts,
      busyAccounts,
      topGrowth,
      sessionsOk,
      sessionsMissing,

      proxiesConfigured,
      proxiesOnline,
      proxiesOffline,

      healthyAccounts,
      attentionAccounts,
      riskAccounts,
      operationalScore,

      totalFollowers,

      totalPosts,
      completedPosts,
      scheduledPosts,
      processingPosts,
      pendingPosts,
      partialPosts,
      errorPosts,
      queueTotal,

      postsToday,
      completedToday,
      errorsToday,
      posts7Days,
      posts30Days,

      successRate,
      errorRate,

      accountMostActive,
      topAccounts,
      worstAccounts,
      lastErrorPost,

      upcomingPosts,
      latestPosts,
      accountsInUse,
      activities: activities.slice(0, 20),
      dailyPosts,

      accountsAddedToday,
      accountsAdded7d,
      accountsAdded30d,
      problemsToday,
      problems7d,
      problems30d,

      system: {
        backend: true,
        mongo: true,
        redis: true,
        worker: true,
        headless: String(process.env.HEADLESS || 'false') === 'true',
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getAccountStats = async (req, res) => {
  try {
    const today        = startOfDay();
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(30);

    const accounts = await Account.find()
      .select('username avatar followers following postsCount healthStatus accessToken tokenExpiresAt igUserId lastSync lastPostAt updatedAt createdAt')
      .lean();

    const [successAgg, failureAgg, growthAgg] = await Promise.all([
      Post.aggregate([
        { $match: { updatedAt: { $gte: thirtyDaysAgo }, status: { $in: ['concluido', 'parcial'] } } },
        { $unwind: '$accounts' },
        { $group: {
          _id: '$accounts',
          posts30d:   { $sum: 1 },
          postsToday: { $sum: { $cond: [{ $gte: ['$updatedAt', today]        }, 1, 0] } },
          posts7d:    { $sum: { $cond: [{ $gte: ['$updatedAt', sevenDaysAgo] }, 1, 0] } },
        }},
      ]),
      Post.aggregate([
        { $match: { updatedAt: { $gte: thirtyDaysAgo }, status: 'erro' } },
        { $unwind: '$accounts' },
        { $group: {
          _id: '$accounts',
          failures30d:   { $sum: 1 },
          failuresToday: { $sum: { $cond: [{ $gte: ['$updatedAt', today]        }, 1, 0] } },
          failures7d:    { $sum: { $cond: [{ $gte: ['$updatedAt', sevenDaysAgo] }, 1, 0] } },
        }},
      ]),
      Growth.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$account', first: { $first: '$followers' }, last: { $last: '$followers' } } },
      ]),
    ]);

    const successMap = {};  successAgg.forEach(s  => { successMap[String(s._id)]  = s; });
    const failureMap = {};  failureAgg.forEach(f  => { failureMap[String(f._id)]  = f; });
    const growthMap  = {};  growthAgg.forEach(g   => { growthMap[String(g._id)]   = (g.last || 0) - (g.first || 0); });

    const now = new Date();
    const result = accounts.map(acc => {
      const id = String(acc._id);
      const s  = successMap[id] || {};
      const f  = failureMap[id] || {};
      const postsToday    = s.postsToday    || 0;
      const posts7d       = s.posts7d       || 0;
      const posts30d      = s.posts30d      || 0;
      const failuresToday = f.failuresToday || 0;
      const failures7d    = f.failures7d    || 0;
      const failures30d   = f.failures30d   || 0;
      const successRate   = (posts30d + failures30d) > 0
        ? Math.round(posts30d / (posts30d + failures30d) * 100) : 0;
      const growth30d = growthMap[id] || 0;

      let status = 'ativa';
      if      (acc.healthStatus === 'banida')          status = 'banida';
      else if (acc.healthStatus === 'sessao_expirada') status = 'token_expired';
      else if (acc.healthStatus === 'erro_login')      status = 'token_expired';
      else if (acc.healthStatus === 'restrita')        status = 'restrita';
      else if (acc.accessToken && acc.tokenExpiresAt && new Date(acc.tokenExpiresAt) < now) status = 'token_expired';
      else if (acc.accessToken && acc.igUserId)        status = 'connected';

      return {
        _id: id, username: acc.username, avatar: acc.avatar || '',
        followers: acc.followers || 0, following: acc.following || 0, postsCount: acc.postsCount || 0,
        postsToday, posts7d, posts30d, failuresToday, failures7d, failures30d, successRate, growth30d,
        status, healthStatus: acc.healthStatus,
        lastSync: acc.lastSync || acc.lastPostAt || null,
      };
    });

    result.sort((a, b) => b.posts30d - a.posts30d);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};