const fs = require('fs');
const path = require('path');
const Growth = require('../models/Growth');
const Account = require('../models/Account');
const Post = require('../models/Post');

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
    const activeAccounts = accounts.filter((a) => a.healthStatus === 'ativa').length;
    const restrictedAccounts = accounts.filter((a) => a.healthStatus === 'restrita').length;
    const expiredSessions = accounts.filter((a) => a.healthStatus === 'sessao_expirada').length;
    const bannedAccounts = accounts.filter((a) => a.healthStatus === 'banida').length;
    const loginErrorAccounts = accounts.filter((a) => a.healthStatus === 'erro_login').length;
    const busyAccounts = accounts.filter((a) => a.isBusy).length;

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

    const queueTotal = scheduledPosts + processingPosts + pendingPosts;

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
        healthStatus: a.healthStatus,
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
      activities.push({
        type: 'post',
        status: post.status,
        text: `${post.postType === 'reel' ? 'Reel' : 'Post'} ${post.status}`,
        date: post.updatedAt || post.createdAt,
      });
    });

    accounts.slice(0, 10).forEach((account) => {
      activities.push({
        type: 'account',
        status: account.healthStatus || 'ativa',
        text: `Conta @${account.username}`,
        date: account.updatedAt,
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