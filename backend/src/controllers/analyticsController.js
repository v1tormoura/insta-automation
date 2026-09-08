'use strict';
const mongoose = require('mongoose');
const Insight  = require('../models/Insight');
const Account  = require('../models/Account');

/**
 * Métricas dos perfis — somadas e por conta.
 *
 * ── Rota própria, e não `getGlobalMetrics` alargado
 *
 * Aquela aceita `7d/30d/90d/1a` e tem cache compartilhado com outras telas.
 * Esta precisa de `hoje`, `ontem`, `total` e faixa livre por data. Alargar a
 * outra mexeria numa consulta que três páginas já usam, com um cache que
 * passaria a ter chaves de dois formatos.
 *
 * ── Sobre "novos seguidores"
 *
 * É o único cartão que não sai do Insight. `Account.followers` guarda só o
 * número de agora, sobrescrito a cada sync — o ganho vem da série diária
 * (`SeguidoresDoDia`), construída para isso.
 *
 * A série começa no dia em que entrou em produção, e a resposta diz isso em
 * `novosSeguidoresMedido`: sem essa distinção, a tela mostraria "+0" no
 * primeiro dia e pareceria que ninguém seguiu ninguém.
 */
exports.getMetricasDosPerfis = async (req, res) => {
  try {
    const periodo = require('../services/periodoDeMetricas');
    const serie   = require('../services/serieDeSeguidores');

    const p = periodo.resolver(req.query);

    /* As mesmas contas que `getGlobalMetrics` considera: conta banida ou com
       sessão morta não deve somar seguidores num painel de desempenho. */
    const RUINS = ['banida', 'banido', 'sessao_expirada', 'token_invalido', 'erro_login'];
    const contas = await Account.find({ healthStatus: { $nin: RUINS } })
      .select('_id username name avatar followers provider lastSync')
      .lean();

    if (!contas.length) {
      return res.json({
        periodo: p.periodo, rotulo: p.rotulo, de: p.diaDe, ate: p.diaAte,
        seguidores: 0, novosSeguidores: 0, novosSeguidoresMedido: false,
        curtidas: 0, viewsPosts: 0, viewsStories: 0,
        contas: [], atualizadoEm: new Date(),
      });
    }

    const ids = contas.map(c => c._id);
    const noPeriodo = periodo.filtroDeInstante(p);

    const [somas, porConta, ganho] = await Promise.all([
      /* STORY fora do total de posts: a audiência de story é gravada como
         Insight desde o storyInsightSync, e somá-la aqui mudaria o
         significado de "views dos posts". Ela tem cartão próprio. */
      Insight.aggregate([
        { $match: { accountId: { $in: ids }, mediaType: { $ne: 'STORY' }, ...noPeriodo } },
        { $group: { _id: null, curtidas: { $sum: '$likeCount' }, views: { $sum: '$videoViews' } } },
      ]),
      Insight.aggregate([
        { $match: { accountId: { $in: ids }, ...noPeriodo } },
        { $group: {
          _id: '$accountId',
          curtidas:     { $sum: { $cond: [{ $ne: ['$mediaType', 'STORY'] }, '$likeCount', 0] } },
          viewsPosts:   { $sum: { $cond: [{ $ne: ['$mediaType', 'STORY'] }, '$videoViews', 0] } },
          viewsStories: { $sum: { $cond: [{ $eq: ['$mediaType', 'STORY'] }, '$videoViews', 0] } },
          sincronizado: { $max: '$syncedAt' },
        }},
      ]),
      /* Sem faixa de dias (período "total") a série inteira conta. */
      serie.novosNoPeriodo(p.diaDe || '0000-01-01', p.diaAte || '9999-12-31', ids),
    ]);

    const soma = somas[0] || {};
    const mapa = new Map(porConta.map(r => [String(r._id), r]));

    /* Stories somados a partir do mesmo agrupamento por conta, em vez de uma
       terceira consulta: o número é o mesmo e a ida ao banco não. */
    const viewsStories = porConta.reduce((t, r) => t + (r.viewsStories || 0), 0);

    res.json({
      periodo: p.periodo, rotulo: p.rotulo, de: p.diaDe, ate: p.diaAte,

      /* Seguidores é um ESTOQUE, não um fluxo: é sempre o número de agora,
         qualquer que seja o período. Filtrá-lo por data não faria sentido —
         não existe "seguidores de ontem" no que temos gravado. */
      seguidores: contas.reduce((t, c) => t + (Number(c.followers) || 0), 0),

      novosSeguidores: ganho.novos,
      novosSeguidoresMedido: ganho.comHistorico,
      contasSemHistorico: ganho.contasSemHistorico,

      curtidas:   soma.curtidas || 0,
      viewsPosts: soma.views || 0,
      viewsStories,

      contas: contas.map(c => {
        const r = mapa.get(String(c._id)) || {};
        return {
          id: String(c._id),
          username: c.username || '',
          avatar: c.avatar || '',
          rede: 'instagram',
          seguidores: Number(c.followers) || 0,
          curtidas: r.curtidas || 0,
          viewsPosts: r.viewsPosts || 0,
          viewsStories: r.viewsStories || 0,
          /* `syncedAt` do Insight quando existe; senão o `lastSync` da conta.
             Sem o segundo, conta sem nenhuma métrica mostraria "nunca" mesmo
             tendo sincronizado o perfil hoje. */
          sincronizadoEm: r.sincronizado || c.lastSync || null,
        };
      }).sort((a, b) => b.seguidores - a.seguidores),

      atualizadoEm: new Date(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /analytics/best-times?accountId=&period=30d
exports.getBestTimes = async (req, res) => {
  try {
    const { accountId, period = '30d' } = req.query;
    const days  = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
    const since = new Date(Date.now() - days * 86400000);

    const match = { postedAt: { $gte: since }, engagementScore: { $gt: 0 } };
    if (accountId) match.accountId = new mongoose.Types.ObjectId(accountId);

    const rows = await Insight.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            accountId: '$accountId',
            username:  '$username',
            hour:      { $hour: '$postedAt' },
          },
          avgEngagement: { $avg: '$engagementScore' },
          avgViews:      { $avg: '$videoViews' },
          count:         { $sum: 1 },
        },
      },
      { $sort: { '_id.accountId': 1, '_id.hour': 1 } },
    ]);

    // Pivot rows into per-account hour arrays
    const map = {};
    for (const row of rows) {
      const key = String(row._id.accountId);
      if (!map[key]) {
        map[key] = {
          accountId: row._id.accountId,
          username:  row._id.username,
          hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, avgEngagement: 0, avgViews: 0, count: 0 })),
        };
      }
      map[key].hours[row._id.hour] = {
        hour:          row._id.hour,
        avgEngagement: Math.round(row.avgEngagement),
        avgViews:      Math.round(row.avgViews),
        count:         row.count,
      };
    }

    const accounts = Object.values(map).map(a => {
      const peak = a.hours.reduce((best, h) => h.avgEngagement > best.avgEngagement ? h : best, a.hours[0]);
      return { ...a, peakHour: peak.hour };
    });

    // Enrich with avatar + name + followers from Account collection
    const accountDocs = await Account.find(
      { _id: { $in: accounts.map(a => a.accountId) } },
      { _id: 1, avatar: 1, name: 1, followers: 1 }
    ).lean();
    const accountMap = Object.fromEntries(accountDocs.map(d => [String(d._id), d]));
    accounts.forEach(a => {
      const doc = accountMap[String(a.accountId)] || {};
      a.avatar    = doc.avatar    || null;
      a.name      = doc.name      || null;
      a.followers = doc.followers ?? null;
    });

    // Global peak across all accounts
    const globalByHour = Array.from({ length: 24 }, (_, h) => {
      const vals = accounts.map(a => a.hours[h].avgEngagement).filter(Boolean);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    });
    const globalPeak = globalByHour.indexOf(Math.max(...globalByHour));

    res.json({ accounts, globalPeak, period });
  } catch (err) {
    console.error('[analyticsController.getBestTimes]', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /analytics/trending-audio?limit=12&period=7d
// Returns top-performing Reels from synced insights as "trending content"
exports.getTrendingAudio = async (req, res) => {
  try {
    const { limit = 12, period = '7d' } = req.query;
    const days  = { '7d': 7, '30d': 30 }[period] || 7;
    const since = new Date(Date.now() - days * 86400000);

    const items = await Insight.find({
      postedAt:   { $gte: since },
      mediaType:  'VIDEO',
      videoViews: { $gt: 0 },
    })
      .sort({ videoViews: -1 })
      .limit(Math.min(50, Number(limit)))
      .select('username igMediaId videoViews likeCount savedCount shareCount permalink postedAt caption');

    res.json({ items, updatedAt: new Date(), period });
  } catch (err) {
    console.error('[analyticsController.getTrendingAudio]', err);
    res.status(500).json({ error: err.message });
  }
};

// Cache simples em memória para aliviar banco sob múltiplos renders
let _globalMetricsCache = { data: null, expiresAt: 0, key: '' };

// GET /analytics/global-metrics?period=30d&force=true
exports.getGlobalMetrics = async (req, res) => {
  try {
    const { period = '30d', force = false } = req.query;
    const cacheKey = `${period}`;

    if (!force && _globalMetricsCache.data && _globalMetricsCache.key === cacheKey && Date.now() < _globalMetricsCache.expiresAt) {
      return res.json(_globalMetricsCache.data);
    }

    const days = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
    const since = new Date(Date.now() - days * 86400000);

    // 1. Considerar EXCLUSIVAMENTE contas atualmente conectadas e com sessão válida
    const BAD_STATUS = ['banida', 'banido', 'sessao_expirada', 'token_invalido', 'erro_login'];
    const connectedAccounts = await Account.find({
      healthStatus: { $nin: BAD_STATUS },
    })
      .select('_id username name avatar followers healthStatus accountType provider postsToday')
      .lean();

    if (!connectedAccounts.length) {
      const emptyResult = {
        connectedAccountsCount: 0,
        totalFollowers: 0,
        totalReach: 0,
        totalStoryViews: 0,
        totalViews: 0,
        bestPost: null,
        bestPostByAccount: [],
        accounts: [],
        period,
        periodLabel: `Últimos ${days} dias`,
        updatedAt: new Date(),
      };
      return res.json(emptyResult);
    }

    const connectedIds = connectedAccounts.map(a => a._id);

    // 2. Seguidores Totais (soma real de followers das contas conectadas)
    const totalFollowers = connectedAccounts.reduce((sum, a) => sum + (Number(a.followers) || 0), 0);

    // 3. Agregação de Alcance e Visualizações do período
    const [totalsAgg, topPosts, bestPerAccountAgg, storyViewsAgg] = await Promise.all([
      Insight.aggregate([
        // STORY fica de fora: agora que a audiência de story é gravada como
        // Insight, incluí-la aqui mudaria o significado de "alcance do feed" e
        // poderia eleger um story como "melhor post".
        { $match: { accountId: { $in: connectedIds }, postedAt: { $gte: since }, mediaType: { $ne: 'STORY' } } },
        { $group: {
          _id: null,
          totalReach:       { $sum: '$reach' },
          totalImpressions: { $sum: '$impressions' },
          totalViews:       { $sum: '$videoViews' },
          totalLikes:       { $sum: '$likeCount' },
          totalComments:    { $sum: '$commentsCount' },
          totalShares:      { $sum: '$shareCount' },
          totalSaves:       { $sum: '$savedCount' },
          totalPosts:       { $sum: 1 },
        }},
      ]),
      // Mesmo motivo do pipeline acima: sem o filtro, um story com muita
      // audiência viraria o "melhor post" do painel.
      Insight.find({
        accountId: { $in: connectedIds },
        postedAt: { $gte: since },
        mediaType: { $ne: 'STORY' },
      })
        .sort({ videoViews: -1, impressions: -1, reach: -1, engagementScore: -1 })
        .limit(1)
        .lean(),
      Insight.aggregate([
        // STORY fica de fora: agora que a audiência de story é gravada como
        // Insight, incluí-la aqui mudaria o significado de "alcance do feed" e
        // poderia eleger um story como "melhor post".
        { $match: { accountId: { $in: connectedIds }, postedAt: { $gte: since }, mediaType: { $ne: 'STORY' } } },
        { $sort: { videoViews: -1, impressions: -1, reach: -1, engagementScore: -1 } },
        { $group: {
          _id: '$accountId',
          bestPostId:      { $first: '$_id' },
          igMediaId:       { $first: '$igMediaId' },
          username:        { $first: '$username' },
          mediaType:       { $first: '$mediaType' },
          mediaUrl:        { $first: '$mediaUrl' },
          thumbnailUrl:    { $first: '$thumbnailUrl' },
          permalink:       { $first: '$permalink' },
          caption:         { $first: '$caption' },
          videoViews:      { $first: '$videoViews' },
          reach:           { $first: '$reach' },
          impressions:     { $first: '$impressions' },
          likeCount:       { $first: '$likeCount' },
          commentsCount:   { $first: '$commentsCount' },
          postedAt:        { $first: '$postedAt' },
        }},
      ]),
      Insight.aggregate([
        { $match: { accountId: { $in: connectedIds }, postedAt: { $gte: since }, mediaType: 'STORY' } },
        { $group: { _id: null, totalViews: { $sum: '$impressions' } } },
      ]),
    ]);

    const aggData = totalsAgg[0] || {};
    const totalReach = aggData.totalReach || aggData.totalImpressions || 0;
    const totalViews = aggData.totalViews || 0;
    const totalStoryViews = storyViewsAgg[0]?.totalViews || 0;

    // 4. Melhor Post Global (maior número de visualizações)
    let bestPost = null;
    if (topPosts.length > 0) {
      const p = topPosts[0];
      const acc = connectedAccounts.find(a => String(a._id) === String(p.accountId));
      bestPost = {
        accountId:     p.accountId,
        username:      p.username || acc?.username || '',
        avatar:        acc?.avatar || '',
        igMediaId:     p.igMediaId,
        mediaType:     p.mediaType || 'VIDEO',
        mediaUrl:      p.mediaUrl || '',
        thumbnailUrl:  p.thumbnailUrl || p.mediaUrl || '',
        permalink:     p.permalink || '',
        caption:       p.caption || '',
        videoViews:    p.videoViews || p.impressions || p.reach || 0,
        reach:         p.reach || p.impressions || 0,
        likeCount:     p.likeCount || 0,
        commentsCount: p.commentsCount || 0,
        postedAt:      p.postedAt || null,
      };
    }

    // 5. Melhor Post por Conta Conectada
    const bestPerAccountMap = {};
    bestPerAccountAgg.forEach(item => {
      bestPerAccountMap[String(item._id)] = item;
    });

    const bestPostByAccount = connectedAccounts.map(acc => {
      const p = bestPerAccountMap[String(acc._id)];
      return {
        accountId:     acc._id,
        username:      acc.username,
        name:          acc.name || '',
        avatar:        acc.avatar || '',
        followers:     acc.followers || 0,
        healthStatus:  acc.healthStatus,
        hasPost:       !!p,
        igMediaId:     p?.igMediaId || null,
        mediaType:     p?.mediaType || 'VIDEO',
        thumbnailUrl:  p?.thumbnailUrl || p?.mediaUrl || null,
        permalink:     p?.permalink || '',
        caption:       p?.caption || '',
        videoViews:    p ? (p.videoViews || p.impressions || p.reach || 0) : 0,
        reach:         p ? (p.reach || p.impressions || 0) : 0,
        likeCount:     p?.likeCount || 0,
        commentsCount: p?.commentsCount || 0,
        postedAt:      p?.postedAt || null,
      };
    }).sort((a, b) => b.videoViews - a.videoViews);

    const result = {
      connectedAccountsCount: connectedAccounts.length,
      totalFollowers,
      totalReach,
      totalViews,
      totalStoryViews,
      bestPost,
      bestPostByAccount,
      accounts: connectedAccounts,
      period,
      periodLabel: `Últimos ${days} dias`,
      updatedAt: new Date(),
    };

    // Atualiza cache (60s)
    _globalMetricsCache = {
      data: result,
      expiresAt: Date.now() + 60_000,
      key: cacheKey,
    };

    res.json(result);
  } catch (err) {
    console.error('[analyticsController.getGlobalMetrics]', err);
    res.status(500).json({ error: err.message });
  }
};

