'use strict';

/** Top posts: métricas por publicação, sincronização e republicação. */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sql, ehUuid } = require('../db');
const { accounts, posts } = require('../repos');
const fila = require('../queue');
const graph = require('../services/instagramAPI');
const { broadcast } = require('../events/broadcaster');
const { syncAllInsights, syncAccountInsights } = require('../services/insightSyncService');

const UPLOADS = path.resolve(__dirname, '../../uploads');
/* A republicação baixa a mídia de uma URL que vem do navegador. Só as CDNs da
   Meta: qualquer outro endereço faria o servidor buscar o que pedissem. */
const CDN_DA_META = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
function urlDaMeta(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && CDN_DA_META.test(u.hostname); } catch { return false; }
}

// Métrica principal zerada (antes do primeiro sync) cai para as seguintes.
const ORDENS = {
  views:           'video_views desc, impressions desc, engagement_score desc',
  alcance:         'reach desc, impressions desc, engagement_score desc',
  likes:           'like_count desc, engagement_score desc',
  coments:         'comments_count desc, engagement_score desc',
  saves:           'saved_count desc, engagement_score desc',
  shares:          'share_count desc, engagement_score desc',
  engagementScore: 'engagement_score desc',
};
const TIPOS = { reel: 'VIDEO', foto: 'IMAGE', carrossel: 'CAROUSEL_ALBUM' };

exports.syncInsights = (req, res) => {
  res.json({ status: 'running', message: 'Sincronizando insights em background...' });
  syncAllInsights(req.user.id).catch(console.error);
};

exports.syncAccount = async (req, res) => {
  const conta = await accounts.de(req.user.id).findById(req.params.accountId);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json({ status: 'running' });
  syncAccountInsights(conta).catch(console.error);
};

// GET /insights?metric=views&period=30d&mediaType=all&accountId=&accountIds=&limit=50
exports.getInsights = async (req, res) => {
  const { metric = 'engagementScore', period = '30d', mediaType, accountId, accountIds, limit = 50 } = req.query;
  const days = { '7d': 7, '30d': 30, '90d': 90, '1a': 365 }[period] || 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const ids = accountId ? [accountId] : String(accountIds || '').split(',').filter(Boolean);
  const porConta = ids.length
    ? sql`and account_id = any(${ids.filter(ehUuid)}::uuid[])`
    // Sem filtro explícito, contas banidas ficam de fora.
    : sql`and account_id not in (select id from accounts where health_status = 'banida' and usuario_id = ${req.user.id})`;
  const porTipo = TIPOS[mediaType] ? sql`and media_type = ${TIPOS[mediaType]}` : sql``;

  const insights = await sql`
    select * from insights where usuario_id = ${req.user.id} and posted_at >= ${since} ${porConta} ${porTipo}
    order by ${sql.unsafe(ORDENS[metric] || ORDENS.engagementScore)}
    limit ${Math.min(200, Math.max(1, Number(limit) || 50))}`;

  const totals = insights.reduce((t, i) => ({
    views: t.views + i.videoViews,
    alcance: t.alcance + i.reach,
    likes: t.likes + i.likeCount,
    coments: t.coments + i.commentsCount,
    saves: t.saves + i.savedCount,
    shares: t.shares + i.shareCount,
  }), { views: 0, alcance: 0, likes: 0, coments: 0, saves: 0, shares: 0 });

  res.json({ insights, totals, lastSync: insights[0]?.syncedAt || null, total: insights.length });
};

/**
 * POST /insights/republish — baixa uma publicação da própria conta e a publica
 * de novo nas contas escolhidas, de uma vez ou espaçada por `intervalMinutes`.
 */
exports.republishPost = async (req, res) => {
  const { igMediaId, mediaUrl, thumbnailUrl, mediaType, caption, postType, processMode, intervalMinutes, scheduledAt } = req.body;
  const pedidas = [...new Set((req.body.accounts || []).map(String).filter(ehUuid))];
  const accountIds = (await accounts.de(req.user.id).porIds(pedidas)).map(c => c.id);
  if (!pedidas.length) return res.status(400).json({ error: 'Selecione ao menos uma conta' });
  if (accountIds.length !== pedidas.length) return res.status(400).json({ error: 'Conta não encontrada' });

  const video = postType === 'reel' || mediaType === 'VIDEO';
  let url = mediaUrl || thumbnailUrl;
  if (!url) return res.status(400).json({ error: 'URL de mídia não encontrada — sincronize novamente' });

  // A URL da CDN expira; com o id da mídia, pede uma nova à API.
  if (igMediaId) {
    const [dona] = await sql`select account_id from insights where ig_media_id = ${String(igMediaId)} and usuario_id = ${req.user.id}`;
    const conta = dona && await accounts.findById(dona.accountId);
    if (conta?.accessToken) {
      const d = await graph.get(`/${igMediaId}`, { fields: video ? 'media_url,thumbnail_url' : 'media_url' }, conta.accessToken).catch(() => null);
      url = d?.media_url || d?.thumbnail_url || url;
    }
  }

  if (!urlDaMeta(url)) return res.status(400).json({ error: 'A mídia precisa vir do Instagram — sincronize e tente novamente.' });

  const filename = `republish_${String(igMediaId || Date.now()).slice(-10)}_${crypto.randomBytes(4).toString('hex')}${video ? '.mp4' : '.jpg'}`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) return res.status(502).json({ error: `Falha ao baixar mídia: HTTP ${resp.status}. Clique em Sincronizar e tente novamente.` });
  fs.writeFileSync(path.join(UPLOADS, filename), Buffer.from(await resp.arrayBuffer()));

  const base = {
    media: filename,
    mediaType: video ? 'video' : 'image',
    postType: postType || (video ? 'reel' : 'post'),
    caption: caption || '',
    processMode: processMode || 'limpeza_leve',
  };
  const inicio = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
  const intervalo = Math.max(0, Number(intervalMinutes) || 0) * 60_000;

  // Com intervalo, um post por conta; ±12% para não cair em múltiplos exatos.
  const grupos = intervalo > 0 ? accountIds.map(id => [id]) : [accountIds];
  const criados = [];
  for (const [i, ids] of grupos.entries()) {
    const quando = inicio + (i === 0 ? 0 : i * intervalo * (1 + (Math.random() * 0.24 - 0.12)));
    const atraso = Math.max(quando - Date.now(), 0);
    const post = await posts.de(req.user.id).insert({
      ...base, accountIds: ids, scheduledAt: new Date(quando), status: atraso > 0 ? 'agendado' : 'pendente',
    });
    await fila.enfileirar('post', { postId: post.id }, { atrasoMs: atraso, chave: `post:${post.id}` });
    criados.push(post);
  }

  broadcast('posts', { action: 'created' }, req.user.id);
  res.json({ success: true, total: criados.length, post: criados[0] });
};
