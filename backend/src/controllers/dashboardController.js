const fs = require('fs');
const path = require('path');
const Growth = require('../models/Growth');
const Account = require('../models/Account');
const Post = require('../models/Post');
const Job  = require('../models/Job');
const CampaignPublication = require('../models/CampaignPublication');
/* A aritmética mora fora do controller e é testada sozinha. Aqui ela estava no
   meio de um `Promise.all` de quinze consultas, onde ninguém revisa uma soma —
   e foi assim que uma das três origens da fila ficou de fora sem nada acusar. */
const { somarFilas, pendentesDoLoop, postagensDeHoje, porStatus } = require('./contagemDaFila');
const mongoose = require('mongoose');
let Insight;
try { Insight = require('../models/Insight'); } catch {}
let redisClient;
try { redisClient = require('../queue/connection'); } catch {}

// Converte Jobs ativos em itens "upcoming" equivalentes a Posts agendados.
// Para cada rodada restante do Job, gera um item por mídia com scheduledAt calculado.
function jobsToUpcomingPosts(jobs) {
  const items = [];
  const now = Date.now();

  for (const job of jobs) {
    if (!job.mediaFiles?.length || !job.accounts?.length) continue;

    const totalMedia  = job.mediaFiles.length;
    const limit       = Math.max(1, job.simultaneousLimit || 1);
    const totalRounds = Math.ceil(totalMedia / limit);
    const intervalMs  = (job.intervalMinutes || 0) * 60 * 1000;

    const baseTime = (job.status === 'waiting_interval' && job.nextRoundAt)
      ? new Date(job.nextRoundAt).getTime()
      : now;

    const startRound = job.currentRound || 0;
    // Para loops: projeta no máximo 5 rodadas à frente para não poluir o forecast
    const endRound = job.type === 'loop'
      ? startRound + Math.min(5, totalRounds)
      : totalRounds;

    for (let round = startRound; round < endRound; round++) {
      const startIdx  = (round % totalRounds) * limit;
      if (startIdx >= totalMedia) break;
      const roundMedia  = job.mediaFiles.slice(startIdx, Math.min(startIdx + limit, totalMedia));
      const scheduledAt = new Date(baseTime + (round - startRound) * intervalMs);

      const isCurrentRound = round === startRound;
      const status = (isCurrentRound && job.status === 'running') ? 'processando'
                   : (isCurrentRound && job.status === 'queued')  ? 'pendente'
                   : 'agendado';

      for (const mediaFile of roundMedia) {
        items.push({
          _id:       `job-${job._id}-r${round}-${mediaFile}`,
          media:     mediaFile,
          postType:  job.postType || 'reel',
          caption:   job.caption  || '',
          accounts:  job.accounts,
          scheduledAt,
          status,
          _isJob:    true,
          _jobId:    String(job._id),
          _jobName:  job.name || '',
          _round:    round,
        });
      }
    }
  }

  return items;
}

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
    const cooldownAccounts      = accounts.filter((a) => a.dailyPostLimit > 0 && (a.postsToday || 0) >= a.dailyPostLimit).length;

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

    const [
      totalPosts, completedPosts,
      scheduledPostsLegacy, processingPostsLegacy, pendingPostsLegacy,
      partialPosts, errorPosts,
      allActiveJobsRaw,
      campanhaPubs,
      loopsAtivos,
    ] = await Promise.all([
      Post.countDocuments(),
      Post.countDocuments({ status: 'concluido' }),
      Post.countDocuments({ status: 'agendado' }),
      Post.countDocuments({ status: 'processando' }),
      Post.countDocuments({ status: 'pendente' }),
      Post.countDocuments({ status: 'parcial' }),
      Post.countDocuments({ status: 'erro' }),
      Job.find({ status: { $in: ['queued', 'running', 'waiting_interval'] } })
        .populate('accounts', 'username avatar healthStatus')
        .lean(),

      /* As publicações de campanha faltavam nas contagens.

         Uma campanha planeja dezenas de publicações e só cria o `Post` no
         instante em que cada uma executa. Até lá elas vivem em
         `CampaignPublication` — e o painel não olhava para lá. O efeito: subir
         uma campanha com trinta publicações não mudava nada na fila, e quem
         acabou de subi-la via os mesmos zeros de antes.

         Agrupado por status numa consulta só: seis `countDocuments` seriam
         seis idas ao banco para responder a mesma pergunta. */
      CampaignPublication.aggregate([
        { $match: { status: { $in: ['pending', 'scheduled', 'processing', 'published'] } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]).catch(() => []),

      /* Os loops ativos. Só os campos da conta — um loop carrega a lista
         inteira de mídias, e trazer 44 nomes de arquivo por loop para contar
         o tamanho da lista é buscar o balde para medir a alça. */
      require('../models/Loop')
        .find({ status: 'ativo' })
        .select('mediaFiles currentIndex status')
        .lean()
        .catch(() => []),
    ]);

    const campanhasPorStatus = porStatus(campanhaPubs);

    // Filtra jobs cujas contas estão todas banidas ou foram excluídas
    const BANNED_STATUSES = ['banida', 'banido'];
    const allActiveJobs = allActiveJobsRaw.filter(job =>
      job.accounts?.some(acc => acc && !BANNED_STATUSES.includes(acc.healthStatus))
    );

    // Conta mídias individuais por job (não apenas 1 por job)
    const countJobMedia = (jobs, status) =>
      jobs.filter(j => j.status === status)
          .reduce((sum, j) => sum + (j.mediaFiles?.length || 1), 0);

    const jobsWaiting = countJobMedia(allActiveJobs, 'waiting_interval');
    const jobsRunning = countJobMedia(allActiveJobs, 'running');
    const jobsQueued  = countJobMedia(allActiveJobs, 'queued');

    /* Três origens: publicação avulsa (`Post`), lote (`Job`) e campanha
       (`CampaignPublication`). O painel diz "a fila", e fila com uma das três
       faltando é um número que contradiz a tela de Campanhas logo ao lado. */
    const fila = somarFilas(
      { agendados: scheduledPostsLegacy, processando: processingPostsLegacy, pendentes: pendingPostsLegacy },
      { esperando: jobsWaiting, rodando: jobsRunning, enfileirados: jobsQueued },
      campanhasPorStatus,
      { pendentes: pendentesDoLoop(loopsAtivos) },
    );
    const scheduledPosts  = fila.agendados;
    const processingPosts = fila.processando;
    const pendingPosts    = fila.pendentes;

    /* "Postagens hoje" soma as duas origens que produzem publicação real.

       O `Post` cobre o caminho avulso e o do loop — os dois criam documento e
       o worker os marca como concluídos. A campanha também cria um `Post`,
       mas por conta: uma publicação para três contas vira três `Post`, e
       contar só ali já estava certo. O que faltava era o caso em que a
       publicação da campanha termina sem `Post` correspondente (falha ao
       criar, ou publicação feita antes deste código existir).

       `$max` em vez de soma para não contar a mesma publicação duas vezes:
       quando as duas fontes concordam, o número é o mesmo; quando divergem,
       o maior é o que descreve o que de fato saiu. */
    const [postsTodayLegacy, pubsHoje] = await Promise.all([
      Post.countDocuments({
        status: { $in: ['concluido', 'parcial'] },
        updatedAt: { $gte: today },
      }),
      CampaignPublication.countDocuments({
        status: 'published',
        publishedAt: { $gte: today },
      }).catch(() => 0),
    ]);
    const postsToday = postagensDeHoje(postsTodayLegacy, pubsHoje);

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
      { $match: { status: { $in: ['concluido', 'parcial'] }, updatedAt: { $gte: ninetyDaysAgo } } },
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
    const realLimitAccounts = accounts.filter(a => a.dailyPostLimit && a.dailyPostLimit < 999999);
    const dailyPostLimit = realLimitAccounts.reduce((sum, a) => sum + a.dailyPostLimit, 0);

    const accountsAddedToday = accounts.filter(a => new Date(a.createdAt) >= today).length;
    const accountsAdded7d    = accounts.filter(a => new Date(a.createdAt) >= sevenDaysAgo).length;
    const accountsAdded30d   = accounts.filter(a => new Date(a.createdAt) >= thirtyDaysAgo).length;

    const problemStatuses = ['banida', 'restrita', 'token_invalido'];
    const problemsToday = accounts.filter(a => problemStatuses.includes(a.healthStatus) && new Date(a.updatedAt) >= today).length;
    const problems7d    = accounts.filter(a => problemStatuses.includes(a.healthStatus) && new Date(a.updatedAt) >= sevenDaysAgo).length;
    const problems30d   = accounts.filter(a => problemStatuses.includes(a.healthStatus)).length;

    const legacyUpcoming = await Post.find({ status: { $in: ['agendado', 'pendente', 'processando'] } })
      .populate('accounts')
      .sort({ scheduledAt: 1 })
      .limit(200)
      .lean();

    // Reutiliza allActiveJobs já filtrado (sem contas banidas/excluídas)
    const upcomingPosts = [...legacyUpcoming, ...jobsToUpcomingPosts(allActiveJobs)]
      .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0))
      .slice(0, 200);

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

    // Engajamento médio por conta (views + likes) — últimos 30 dias
    let avgEngagementByAccount = [];
    if (Insight) {
      try {
        const activeAccounts = await Account.find({ healthStatus: { $nin: ['banida', 'banido'] } }).select('_id');
        const activeIds = activeAccounts.map(a => a._id);
        const engRaw = await Insight.aggregate([
          { $match: { postedAt: { $gte: thirtyDaysAgo }, accountId: { $in: activeIds } } },
          { $group: {
            _id: '$accountId',
            avgViews:    { $avg: '$videoViews' },
            avgLikes:    { $avg: '$likeCount' },
            avgComments: { $avg: '$commentsCount' },
            totalViews:  { $sum: '$videoViews' },
            totalLikes:  { $sum: '$likeCount' },
            totalPosts:  { $sum: 1 },
            username: { $first: '$username' },
          }},
          { $sort: { totalViews: -1 } },
          { $limit: 10 },
        ]);
        const accIds   = engRaw.map(r => r._id).filter(Boolean);
        const accDocs  = await Account.find({ _id: { $in: accIds } }).select('avatar');
        const avatarMap = {};
        accDocs.forEach(a => { avatarMap[String(a._id)] = a.avatar || null; });
        avgEngagementByAccount = engRaw.map(r => ({
          accountId:   r._id,
          username:    r.username || String(r._id),
          avgViews:    Math.round(r.avgViews    || 0),
          avgLikes:    Math.round(r.avgLikes    || 0),
          avgComments: Math.round(r.avgComments || 0),
          totalViews:  Math.round(r.totalViews  || 0),
          totalLikes:  Math.round(r.totalLikes  || 0),
          totalPosts:  r.totalPosts,
          avatar:      avatarMap[String(r._id)] || null,
        }));
      } catch {}
    }

    // Erros por dia — últimos 7 dias
    const dailyErrorsRaw = await Post.aggregate([
      { $match: { status: 'erro', updatedAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
        count: { $sum: 1 },
      }},
    ]);
    const errMap = {};
    dailyErrorsRaw.forEach(d => { errMap[d._id] = d.count; });
    const dailyErrors7d = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyErrors7d.push({ date: key, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), errors: errMap[key] || 0 });
    }

    res.json({
      totalAccounts,
      activeAccounts,
      restrictedAccounts,
      expiredSessions,
      bannedAccounts,
      loginErrorAccounts,
      busyAccounts,
      cooldownAccounts,
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
      dailyPostLimit,
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

      avgEngagementByAccount,
      dailyErrors7d,

      system: {
        backend: true,
        mongo: mongoose.connection.readyState === 1,
        redis: await (async () => {
          try { await redisClient?.ping(); return true; } catch { return false; }
        })(),
        worker: await (async () => {
          try { await redisClient?.ping(); return true; } catch { return false; }
        })(),
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
      else if (acc.healthStatus === 'token_invalido')  status = 'token_expired';
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

exports.getLivePosts = async (req, res) => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sel = 'username avatar';

    const BANNED_LIVE = ['banida', 'banido'];
    const [legacyProcessing, legacyQueue, errors, completed, activeJobsLiveRaw] = await Promise.all([
      Post.find({ status: 'processando' })
        .populate('accounts', sel).sort({ updatedAt: -1 }).limit(10).lean(),
      Post.find({ status: { $in: ['pendente', 'agendado'] } })
        .populate('accounts', sel).sort({ scheduledAt: 1, createdAt: 1 }).limit(30).lean(),
      Post.find({ status: 'erro', updatedAt: { $gte: oneHourAgo } })
        .populate('accounts', sel).sort({ updatedAt: -1 }).limit(15).lean(),
      Post.find({ status: { $in: ['concluido', 'parcial'] }, updatedAt: { $gte: oneHourAgo } })
        .populate('accounts', sel).sort({ updatedAt: -1 }).limit(15).lean(),
      Job.find({ status: { $in: ['queued', 'running', 'waiting_interval'] } })
        .populate('accounts', sel).lean(),
    ]);

    const activeJobsLive = activeJobsLiveRaw.filter(job =>
      job.accounts?.some(acc => acc && !BANNED_LIVE.includes(acc.healthStatus))
    );

    const runningJobs = activeJobsLive
      .filter(j => j.status === 'running')
      .map(j => ({
        _id:      j._id,
        accounts: j.accounts,
        caption:  j.caption || j.name || '',
        status:   'processando',
        updatedAt: j.updatedAt,
        error:    j.lastError || '',
      }));

    const processing = [...legacyProcessing, ...runningJobs].slice(0, 10);

    const queue = [...legacyQueue, ...jobsToUpcomingPosts(activeJobsLive)]
      .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0))
      .slice(0, 30);

    res.json({ processing, queue, errors, completed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
