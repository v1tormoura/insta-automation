'use strict';

const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const Account = require('../models/Account');
const Insight = require('../models/Insight');
const { broadcast } = require('../events/broadcaster');

const GRAPH_IG     = 'https://graph.instagram.com/v21.0';
const GRAPH_FB     = 'https://graph.facebook.com/v21.0';
const INSIGHTS_DIR = path.resolve(__dirname, '../../uploads/insights');

let _running = false;
const _accountRunning = new Set(); // previne sync simultâneo da mesma conta

function graphBase(token) {
  if (token && /^(IGAAL|IGQ|IG)/i.test(token)) return GRAPH_IG;
  return GRAPH_FB;
}

async function gGet(endpoint, params, token) {
  const url = new URL(graphBase(token) + endpoint);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  const d = await r.json();
  if (d.error) throw new Error(`[Graph] ${d.error.message} (${d.error.code})`);
  return d;
}

// Download thumbnail from CDN to local disk. Returns local path or null on failure.
function downloadThumbnail(cdnUrl, igMediaId) {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(INSIGHTS_DIR)) fs.mkdirSync(INSIGHTS_DIR, { recursive: true });
      const localFile = path.join(INSIGHTS_DIR, `${igMediaId}.jpg`);
      if (fs.existsSync(localFile)) return resolve(`/uploads/insights/${igMediaId}.jpg`);

      const file = fs.createWriteStream(localFile);
      const timer = setTimeout(() => {
        file.destroy(); fs.unlink(localFile, () => {}); resolve(null);
      }, 8_000);

      https.get(cdnUrl, (res) => {
        if (res.statusCode !== 200) {
          clearTimeout(timer); file.destroy(); fs.unlink(localFile, () => {}); return resolve(null);
        }
        res.pipe(file);
        file.on('finish', () => { clearTimeout(timer); file.close(); resolve(`/uploads/insights/${igMediaId}.jpg`); });
        file.on('error', () => { clearTimeout(timer); fs.unlink(localFile, () => {}); resolve(null); });
      }).on('error', () => { clearTimeout(timer); fs.unlink(localFile, () => {}); resolve(null); });
    } catch { resolve(null); }
  });
}

// Fetch per-media metrics from the Graph API insights endpoint
async function fetchMediaMetrics(mediaId, mediaType, token) {
  const isVideo = mediaType === 'VIDEO' || mediaType === 'REEL';
  // `impressions` is NOT a valid metric for VIDEO/REEL — it causes the entire
  // insight call to fail, zeroing out all other metrics. Use `reach` instead.
  // `likes` and `comments` from insights are more reliable than media-field counts.
  const metricList = isVideo
    ? 'reach,saved,shares,views,total_interactions,likes,comments'
    : 'impressions,reach,saved,shares,total_interactions,likes,comments';
  try {
    const d = await gGet(`/${mediaId}/insights`, { metric: metricList }, token);
    const m = {};
    for (const item of (d.data || [])) {
      m[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
    }
    return m;
  } catch (err) {
    // Fallback: try minimal safe set if the full list is rejected
    try {
      const d = await gGet(`/${mediaId}/insights`, { metric: 'reach,saved,shares,total_interactions' }, token);
      const m = {};
      for (const item of (d.data || [])) {
        m[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
      }
      return m;
    } catch (err2) {
      console.warn(`[InsightSync] metrics ${mediaId}: ${err2.message}`);
      return {};
    }
  }
}

async function syncAccountInsights(account) {
  if (!account.accessToken || !account.igUserId) return { skipped: true, reason: 'no_token' };
  if (account.healthStatus === 'banida')         return { skipped: true, reason: 'banned'   };

  const accountKey = String(account._id);
  if (_accountRunning.has(accountKey)) return { skipped: true, reason: 'already_running' };
  _accountRunning.add(accountKey);

  try {
  const now = new Date();
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < now) {
    return { skipped: true, reason: 'token_expired' };
  }

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  let mediaList = [];
  let nextUrl   = null;
  let pages     = 0;

  try {
    do {
      let data;
      if (nextUrl) {
        const r = await fetch(nextUrl + `&access_token=${account.accessToken}`, { signal: AbortSignal.timeout(12_000) });
        data = await r.json();
        if (data.error) break;
      } else {
        data = await gGet(`/${account.igUserId}/media`, { fields, limit: 50 }, account.accessToken);
      }
      mediaList = mediaList.concat(data.data || []);
      const raw = data.paging?.next || '';
      nextUrl = raw ? raw.replace(/access_token=[^&]+&?/, '') : null;
      pages++;
    } while (nextUrl && pages < 4);
  } catch (err) {
    console.warn(`[InsightSync] ${account.username} media list: ${err.message}`);
    return { error: err.message };
  }

  let synced = 0;
  const thumbJobs = []; // (cdnUrl, igMediaId) pairs for batch download

  for (const media of mediaList) {
    try {
      const metrics = await fetchMediaMetrics(media.id, media.media_type || 'IMAGE', account.accessToken);

      // Use max of media-field value and insights-endpoint value for accuracy.
      // Insights API `likes`/`comments` is more reliable than media fields for hidden counts.
      const likeCount     = Math.max(media.like_count     || 0, metrics.likes    || 0);
      const commentsCount = Math.max(media.comments_count || 0, metrics.comments  || 0);
      const shareCount    = metrics.shares      || 0;
      const savedCount    = metrics.saved       || 0;
      const reach         = metrics.reach       || 0;
      // impressions not available for VIDEO on insights API → fall back to reach
      const impressions   = metrics.impressions || metrics.reach || 0;
      // `views` = Reels play count (replaces deprecated `plays`)
      const videoViews    = metrics.views || metrics.plays || metrics.video_views || 0;
      const totalInteractions = metrics.total_interactions
        || (likeCount + commentsCount + shareCount + savedCount);
      const engagementScore = likeCount + commentsCount * 3 + shareCount * 5 + savedCount * 4
        + Math.floor((videoViews || impressions) * 0.1);

      const cdnMediaUrl = media.media_url     || media.thumbnail_url || '';
      const cdnThumbUrl = media.thumbnail_url || media.media_url     || '';

      // Prefer existing local file to avoid overwriting with expired CDN URL
      const localThumbFile = path.join(INSIGHTS_DIR, `${media.id}.jpg`);
      const hasLocal       = fs.existsSync(localThumbFile);
      const thumbToStore   = hasLocal ? `/uploads/insights/${media.id}.jpg` : cdnThumbUrl;

      await Insight.findOneAndUpdate(
        { igMediaId: media.id },
        {
          accountId: account._id,
          username:  account.username,
          igMediaId: media.id,
          mediaType: media.media_type || 'IMAGE',
          mediaUrl:  cdnMediaUrl,
          thumbnailUrl: thumbToStore,
          permalink:    media.permalink || '',
          caption:      media.caption   || '',
          postedAt:     media.timestamp ? new Date(media.timestamp) : null,
          likeCount, commentsCount, shareCount, savedCount,
          reach, impressions, videoViews, totalInteractions, engagementScore,
          syncedAt: now,
        },
        { upsert: true, new: true }
      );

      if (!hasLocal && cdnThumbUrl) thumbJobs.push({ cdnUrl: cdnThumbUrl, igMediaId: media.id });
      synced++;
    } catch (err) {
      console.warn(`[InsightSync] ${media.id}: ${err.message}`);
    }
  }

  // Download thumbnails in batches of 8 (background, after metrics upsert)
  const BATCH = 8;
  for (let i = 0; i < thumbJobs.length; i += BATCH) {
    await Promise.all(
      thumbJobs.slice(i, i + BATCH).map(async ({ cdnUrl, igMediaId }) => {
        const localPath = await downloadThumbnail(cdnUrl, igMediaId);
        if (localPath) {
          await Insight.updateOne({ igMediaId }, { thumbnailUrl: localPath }).catch(() => {});
        }
      })
    );
  }

  console.log(`[InsightSync] @${account.username} — ${synced}/${mediaList.length} posts atualizados`);
  return { synced, total: mediaList.length };
  } finally {
    _accountRunning.delete(accountKey);
  }
}

/**
 * Métricas de publicação pela sessão instagrapi.
 *
 * ── O que este caminho consegue, e o que não consegue
 *
 * Curtidas, comentários e reproduções vêm dos contadores públicos e existem em
 * qualquer conta. Alcance e impressões vêm do endpoint de insights do próprio
 * Instagram, que só responde para conta PROFISSIONAL — em conta pessoal a
 * chamada falha, e falhar ali é o comportamento correto.
 *
 * Quando o alcance não vem, ele fica em zero e o `engagementScore` é calculado
 * sobre reproduções. Zero aqui significa "não medido", não "ninguém viu" — a
 * distinção importa porque o segundo seria uma afirmação falsa sobre o post.
 */
async function syncAccountInsightsInstagrapi(account) {
  const { getProvider } = require('../providers/ProviderFactory');
  const now = new Date();

  let resposta;
  try {
    const provider = getProvider(account);
    resposta = await provider.mediaInsights(account, 12);
  } catch (err) {
    return { synced: 0, error: err.message?.slice(0, 120) || 'falha' };
  }

  const itens = resposta?.itens || [];
  let synced = 0;

  for (const m of itens) {
    try {
      const likeCount     = m.like_count    || 0;
      const commentsCount = m.comment_count || 0;
      const shareCount    = m.share_count   || 0;
      const savedCount    = m.saved_count   || 0;
      const reach         = m.reach         || 0;
      const impressions   = m.impressions   || 0;
      const videoViews    = m.video_views   || 0;

      const totalInteractions = likeCount + commentsCount + shareCount + savedCount;
      // A MESMA fórmula do caminho Graph. Duas fórmulas para a mesma métrica
      // fariam o ranking mudar de critério conforme a origem da conta, e
      // ninguém entenderia por que dois posts iguais pontuam diferente.
      const engagementScore = likeCount + commentsCount * 3 + shareCount * 5 + savedCount * 4
        + Math.floor((videoViews || impressions) * 0.1);

      await Insight.findOneAndUpdate(
        { igMediaId: m.media_id },
        {
          accountId: account._id,
          username:  account.username,
          igMediaId: m.media_id,
          mediaType: m.media_type || 'IMAGE',
          thumbnailUrl: m.thumbnail_url || '',
          permalink: m.code ? `https://www.instagram.com/p/${m.code}/` : '',
          caption:   m.caption || '',
          postedAt:  m.taken_at ? new Date(m.taken_at) : null,
          likeCount, commentsCount, shareCount, savedCount,
          reach, impressions, videoViews, totalInteractions, engagementScore,
          syncedAt: now,
        },
        { upsert: true, new: true }
      );
      synced++;
    } catch (err) {
      console.warn(`[InsightSync/instagrapi] ${m.media_id}: ${err.message}`);
    }
  }

  const comAlcance = itens.filter(i => i.fonte === 'insights').length;
  return { synced, total: itens.length, comAlcance };
}

async function syncAllInsights() {
  if (_running) return { skipped: true };
  _running = true;
  const results = [];
  try {
    /* DUAS fontes, e antes só uma era varrida.

       Esta consulta pedia `accessToken` e `igUserId` — o caminho Graph API.
       Numa base só instagrapi ela devolvia zero contas e o ciclo não fazia
       nada, para sempre: métrica de post nunca atualizava, os marcos de
       "visualizações de post" nunca disparavam, e o painel mostrava a opção
       ligada sem ter como funcionar.

       Agora cada conta vai pelo caminho que ela TEM. Graph quando há token da
       Meta; instagrapi quando há sessão. Conta com os dois usa Graph, que traz
       alcance e impressões oficiais. */
    const accounts = await Account.find({
      $or: [
        { accessToken: { $nin: [null, ''] }, igUserId: { $nin: [null, ''] } },
        { provider: 'instagrapi' },
        { instagrapiSession: { $nin: [null, ''] } },
      ],
    }).select('username accessToken igUserId provider instagrapiSession healthStatus tokenExpiresAt');

    for (const acc of accounts) {
      const temGraph = !!(acc.accessToken && acc.igUserId);
      const r = temGraph
        ? await syncAccountInsights(acc)
        : await syncAccountInsightsInstagrapi(acc);
      results.push({ username: acc.username, via: temGraph ? 'graph' : 'instagrapi', ...r });
    }
    broadcast('insights', { action: 'synced', count: results.length });

    /* Detecção de marcos: LÊ o que este ciclo acabou de gravar. Nenhuma
       chamada nova ao Instagram, nenhuma rotina paralela — a notificação é
       consequência da métrica ter subido, não uma segunda corrida atrás dela.

       Envelopado à parte: uma falha aqui não pode desfazer nem manchar uma
       sincronização de métricas que já deu certo. */
    try {
      const detector = require('./smartActivity/detector');
      const novas = await detector.varrer(accounts, { apenasStories: false });
      // Desligado por padrão; devolve null quando não está ativo.
      const resumo = await detector.resumoDoDia();
      const total = novas.length + (resumo ? 1 : 0);
      if (total) broadcast('notificacoes', { novas: total });
    } catch (err) {
      console.warn('[SmartActivity] detecção falhou:', err.message);
    }
  } catch (err) {
    console.error('[InsightSync] fatal:', err.message);
  } finally {
    _running = false;
  }
  return results;
}

function startInsightAutoSync(intervalMs = 30 * 60 * 1000) {
  setTimeout(() => syncAllInsights().catch(() => {}), 15_000);
  setInterval(() => syncAllInsights().catch(() => {}), intervalMs);
}

module.exports = {
  syncAllInsights, syncAccountInsights, syncAccountInsightsInstagrapi, startInsightAutoSync,
  // Compartilhados com o sync de stories: uma segunda implementação de chamada
  // ao Graph divergiria na escolha da base (graph.instagram vs graph.facebook),
  // que é justamente a parte que quebra em silêncio.
  gGet, graphBase,
};
