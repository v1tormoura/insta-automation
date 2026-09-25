'use strict';

/** Métricas: alcance por envio, público, métricas dos perfis e métricas globais. */

const { sql } = require('../db');
const { agrupar: agruparPorEnvio } = require('../services/alcancePorEnvio');
const publicoDaConta = require('../services/publicoDaConta');
const periodo = require('../services/periodoDeMetricas');
const serie = require('../services/serieDeSeguidores');
const { accounts } = require('../repos');

/* Conta banida ou sem token não soma num painel de desempenho. */
const RUINS = ['banida', 'token_invalido'];

/** GET /analytics/alcance-por-envio?dias=30 — alcance e views por envio e por conta. */
exports.getAlcancePorEnvio = async (req, res) => {
  const dias = Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 30));
  const desde = new Date(Date.now() - dias * 86_400_000);
  const insights = await sql`
    select * from insights
    where usuario_id = ${req.user.id} and posted_at >= ${desde} and media_type in ('VIDEO', 'REELS', 'REEL')`;
  const ids = insights.map(i => i.igMediaId).filter(Boolean);
  const posts = ids.length
    ? await sql`
        select ig_media_id, midias_publicadas, job_id, job_name from posts
        where usuario_id = ${req.user.id} and (ig_media_id = any(${ids})
           or exists (select 1 from jsonb_array_elements(midias_publicadas) m where m->>'igMediaId' = any(${ids})))`
    : [];
  res.json({ dias, ...agruparPorEnvio(insights, posts) });
};

/** GET /analytics/publico?timeframe=last_30_days — gênero, país e idade de quem os reels alcançaram. */
exports.getPublico = async (req, res) => {
  const contas = (await accounts.de(req.user.id).findMany()).filter(c => c.accessToken && c.igUserId);
  const lista = await Promise.all(contas.map(c => publicoDaConta.buscarPublico(c, req.query.timeframe)));
  res.json({
    timeframe: lista[0]?.timeframe || 'last_30_days',
    minimoSeguidores: publicoDaConta.MINIMO_SEGUIDORES,
    contas: lista.map((p, i) => ({ ...p, avatar: contas[i].avatar || '' })),
    agregado: publicoDaConta.agregar(lista),
  });
};

/**
 * Métricas dos perfis, somadas e por conta, com hoje/ontem/total e faixa livre.
 * "Novos seguidores" sai da série diária; a resposta diz se já há histórico.
 */
exports.getMetricasDosPerfis = async (req, res) => {
  const p = periodo.resolver(req.query);
  const contas = await sql`
    select id, username, avatar, followers, last_sync from accounts
    where usuario_id = ${req.user.id} and health_status <> all(${RUINS})`;

  const vazio = {
    periodo: p.periodo, rotulo: p.rotulo, de: p.diaDe, ate: p.diaAte,
    seguidores: 0, novosSeguidores: 0, novosSeguidoresMedido: false,
    curtidas: 0, viewsPosts: 0, viewsStories: 0, contas: [], atualizadoEm: new Date(),
  };
  if (!contas.length) return res.json(vazio);

  const ids = contas.map(c => c.id);
  const noPeriodo = p.desde && p.ate ? sql`and posted_at >= ${p.desde} and posted_at < ${p.ate}` : sql``;

  const [porConta, ganho] = await Promise.all([
    sql`
      select account_id,
        coalesce(sum(like_count) filter (where media_type <> 'STORY'), 0) as curtidas,
        coalesce(sum(video_views) filter (where media_type <> 'STORY'), 0) as views_posts,
        coalesce(sum(video_views) filter (where media_type = 'STORY'), 0) as views_stories,
        max(synced_at) as sincronizado
      from insights where account_id = any(${ids}::uuid[]) ${noPeriodo}
      group by account_id`,
    serie.novosNoPeriodo(p.diaDe || '0000-01-01', p.diaAte || '9999-12-31', ids),
  ]);
  const mapa = new Map(porConta.map(r => [r.accountId, r]));
  const somar = campo => porConta.reduce((t, r) => t + (r[campo] || 0), 0);

  res.json({
    ...vazio,
    // Seguidores é estoque: sempre o número de agora, qualquer que seja o período.
    seguidores: contas.reduce((t, c) => t + (c.followers || 0), 0),
    novosSeguidores: ganho.novos,
    novosSeguidoresMedido: ganho.comHistorico,
    contasSemHistorico: ganho.contasSemHistorico,
    curtidas: somar('curtidas'),
    viewsPosts: somar('viewsPosts'),
    viewsStories: somar('viewsStories'),
    contas: contas.map(c => {
      const r = mapa.get(c.id) || {};
      return {
        id: c.id,
        username: c.username,
        avatar: c.avatar || '',
        rede: 'instagram',
        seguidores: c.followers || 0,
        curtidas: r.curtidas || 0,
        viewsPosts: r.viewsPosts || 0,
        viewsStories: r.viewsStories || 0,
        sincronizadoEm: r.sincronizado || c.lastSync || null,
      };
    }).sort((a, b) => b.seguidores - a.seguidores),
  });
};

/* Cache de 60s por usuário e período. */
const _cache = new Map();

function melhorPost(p, conta) {
  return {
    accountId: p.accountId,
    username: p.username || conta?.username || '',
    avatar: conta?.avatar || '',
    igMediaId: p.igMediaId,
    mediaType: p.mediaType || 'VIDEO',
    mediaUrl: p.mediaUrl || '',
    thumbnailUrl: p.thumbnailUrl || p.mediaUrl || '',
    permalink: p.permalink || '',
    caption: p.caption || '',
    videoViews: p.videoViews || p.impressions || p.reach || 0,
    reach: p.reach || p.impressions || 0,
    likeCount: p.likeCount || 0,
    commentsCount: p.commentsCount || 0,
    postedAt: p.postedAt || null,
  };
}

/** GET /analytics/global-metrics?period=30d&force=true (cache de 60s). */
exports.getGlobalMetrics = async (req, res) => {
  const { period = '30d', force = false } = req.query;
  const chave = `${req.user.id}:${period}`;
  const guardado = _cache.get(chave);
  if (!force && guardado && Date.now() < guardado.expiresAt) return res.json(guardado.data);

  const days = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const periodLabel = `Últimos ${days} dias`;

  const contas = await sql`
    select id, username, name, avatar, followers, health_status, account_type, posts_today
    from accounts where usuario_id = ${req.user.id} and health_status <> all(${RUINS})`;
  if (!contas.length) {
    return res.json({
      connectedAccountsCount: 0, totalFollowers: 0, totalReach: 0, totalStoryViews: 0, totalViews: 0,
      bestPost: null, bestPostByAccount: [], accounts: [], period, periodLabel, updatedAt: new Date(),
    });
  }
  const ids = contas.map(c => c.id);
  const ORDEM = sql`video_views desc, impressions desc, reach desc, engagement_score desc`;

  // STORY fica fora do feed: senão um story com muita audiência viraria o "melhor post".
  const [[totais], [melhor], porConta, [stories]] = await Promise.all([
    sql`select coalesce(sum(reach), 0) as reach, coalesce(sum(impressions), 0) as impressions, coalesce(sum(video_views), 0) as views
        from insights where account_id = any(${ids}::uuid[]) and posted_at >= ${since} and media_type <> 'STORY'`,
    sql`select * from insights where account_id = any(${ids}::uuid[]) and posted_at >= ${since} and media_type <> 'STORY'
        order by ${ORDEM} limit 1`,
    sql`select distinct on (account_id) * from insights
        where account_id = any(${ids}::uuid[]) and posted_at >= ${since} and media_type <> 'STORY'
        order by account_id, ${ORDEM}`,
    sql`select coalesce(sum(impressions), 0) as views from insights
        where account_id = any(${ids}::uuid[]) and posted_at >= ${since} and media_type = 'STORY'`,
  ]);

  const contaPorId = new Map(contas.map(c => [c.id, c]));
  const melhorPorConta = new Map(porConta.map(p => [p.accountId, p]));

  const result = {
    connectedAccountsCount: contas.length,
    totalFollowers: contas.reduce((t, c) => t + (c.followers || 0), 0),
    totalReach: totais.reach || totais.impressions,
    totalViews: totais.views,
    totalStoryViews: stories.views,
    bestPost: melhor ? melhorPost(melhor, contaPorId.get(melhor.accountId)) : null,
    bestPostByAccount: contas.map(c => {
      const p = melhorPorConta.get(c.id);
      return {
        ...(p ? melhorPost(p, c) : { igMediaId: null, mediaType: 'VIDEO', thumbnailUrl: null, permalink: '', caption: '', videoViews: 0, reach: 0, likeCount: 0, commentsCount: 0, postedAt: null }),
        accountId: c.id,
        username: c.username,
        name: c.name || '',
        avatar: c.avatar || '',
        followers: c.followers || 0,
        healthStatus: c.healthStatus,
        hasPost: !!p,
      };
    }).sort((a, b) => b.videoViews - a.videoViews),
    accounts: contas,
    period,
    periodLabel,
    updatedAt: new Date(),
  };

  if (_cache.size > 1000) _cache.clear();
  _cache.set(chave, { data: result, expiresAt: Date.now() + 60_000 });
  res.json(result);
};
