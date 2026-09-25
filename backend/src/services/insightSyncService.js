'use strict';

/**
 * Métricas das publicações pela API oficial, a cada 30 minutos.
 *
 * Para cada conta conectada: as últimas ~200 mídias, as métricas de cada uma e
 * a miniatura guardada em uploads/insights (a URL da CDN do Instagram expira).
 */

const path = require('path');
const fs = require('fs');
const { sql } = require('../db');
const { accounts } = require('../repos');
const graph = require('./instagramAPI');
const { broadcast } = require('../events/broadcaster');

const INSIGHTS_DIR = path.resolve(__dirname, '../../uploads/insights');
const LOTE_DE_MINIATURAS = 8;

let _running = false;
const _contasRodando = new Set();

/** Baixa a miniatura para o disco. Devolve o caminho público ou null. */
async function baixarMiniatura(cdnUrl, igMediaId) {
  try {
    fs.mkdirSync(INSIGHTS_DIR, { recursive: true });
    const arquivo = path.join(INSIGHTS_DIR, `${igMediaId}.jpg`);
    if (!fs.existsSync(arquivo)) {
      const r = await fetch(cdnUrl, { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) return null;
      fs.writeFileSync(arquivo, Buffer.from(await r.arrayBuffer()));
    }
    return `/uploads/insights/${igMediaId}.jpg`;
  } catch {
    return null;
  }
}

function lerMetricas(resposta) {
  const m = {};
  for (const item of resposta?.data || []) m[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? item.value ?? 0;
  return m;
}

/**
 * Métricas de uma mídia. `impressions` não existe para vídeo e derruba a
 * chamada inteira; por isso a lista muda com o tipo, e há um conjunto mínimo
 * de reserva.
 */
async function metricasDaMidia(mediaId, mediaType, token) {
  const video = mediaType === 'VIDEO' || mediaType === 'REEL' || mediaType === 'REELS';
  const lista = video
    ? 'reach,saved,shares,views,total_interactions,likes,comments'
    : 'impressions,reach,saved,shares,total_interactions,likes,comments';
  try {
    return lerMetricas(await graph.get(`/${mediaId}/insights`, { metric: lista }, token));
  } catch {
    try {
      return lerMetricas(await graph.get(`/${mediaId}/insights`, { metric: 'reach,saved,shares,total_interactions' }, token));
    } catch (err) {
      console.warn(`[InsightSync] métricas ${mediaId}: ${err.message}`);
      return {};
    }
  }
}

/** Tempo assistido do reel, em chamada separada: métrica inválida derrubaria as outras. */
async function tempoAssistido(mediaId, token) {
  try {
    const m = lerMetricas(await graph.get(`/${mediaId}/insights`, { metric: 'ig_reels_avg_watch_time,ig_reels_video_view_total_time' }, token));
    const media = Number(m.ig_reels_avg_watch_time);
    const total = Number(m.ig_reels_video_view_total_time);
    return { media: Number.isFinite(media) ? media : null, total: Number.isFinite(total) ? total : null };
  } catch {
    return { media: null, total: null };
  }
}

async function syncAccountInsights(conta) {
  if (!conta.accessToken || !conta.igUserId) return { skipped: true, reason: 'no_token' };
  if (conta.healthStatus === 'banida') return { skipped: true, reason: 'banned' };
  if (conta.tokenExpiresAt && new Date(conta.tokenExpiresAt) < new Date()) return { skipped: true, reason: 'token_expired' };
  if (_contasRodando.has(conta.id)) return { skipped: true, reason: 'already_running' };
  _contasRodando.add(conta.id);

  try {
    const token = conta.accessToken;
    const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
    let midias = [];
    try {
      let pagina = await graph.get(`/${conta.igUserId}/media`, { fields, limit: 50 }, token);
      for (let n = 1; ; n++) {
        midias = midias.concat(pagina.data || []);
        if (!pagina.paging?.next || n >= 4) break;
        pagina = await graph.get(pagina.paging.next, {}, token);
      }
    } catch (err) {
      console.warn(`[InsightSync] @${conta.username} lista de mídias: ${err.message}`);
      return { error: err.message };
    }

    const agora = new Date();
    const miniaturas = [];
    let synced = 0;

    for (const media of midias) {
      try {
        const tipo = media.media_type || 'IMAGE';
        const m = await metricasDaMidia(media.id, tipo, token);
        const tempo = tipo === 'VIDEO' ? await tempoAssistido(media.id, token) : { media: null, total: null };

        const likeCount = Math.max(media.like_count || 0, m.likes || 0);
        const commentsCount = Math.max(media.comments_count || 0, m.comments || 0);
        const shareCount = m.shares || 0;
        const savedCount = m.saved || 0;
        const reach = m.reach || 0;
        const impressions = m.impressions || reach;
        const videoViews = m.views || 0;
        const totalInteractions = m.total_interactions || likeCount + commentsCount + shareCount + savedCount;
        const engagementScore = likeCount + commentsCount * 3 + shareCount * 5 + savedCount * 4
          + Math.floor((videoViews || impressions) * 0.1);

        const cdnThumb = media.thumbnail_url || media.media_url || '';
        const temLocal = fs.existsSync(path.join(INSIGHTS_DIR, `${media.id}.jpg`));

        await sql`
          insert into insights ${sql({
            accountId: conta.id, username: conta.username, igMediaId: media.id,
            mediaType: tipo, mediaUrl: media.media_url || media.thumbnail_url || '',
            thumbnailUrl: temLocal ? `/uploads/insights/${media.id}.jpg` : cdnThumb,
            permalink: media.permalink || '', caption: media.caption || '',
            postedAt: media.timestamp ? new Date(media.timestamp) : null,
            likeCount, commentsCount, shareCount, savedCount, reach, impressions, videoViews,
            totalInteractions, engagementScore,
            avgWatchTimeMs: tempo.media, totalWatchTimeMs: tempo.total, syncedAt: agora,
          })}
          on conflict (ig_media_id) do update set
            account_id = excluded.account_id, username = excluded.username, media_type = excluded.media_type,
            media_url = excluded.media_url, thumbnail_url = excluded.thumbnail_url, permalink = excluded.permalink,
            caption = excluded.caption, posted_at = excluded.posted_at, like_count = excluded.like_count,
            comments_count = excluded.comments_count, share_count = excluded.share_count,
            saved_count = excluded.saved_count, reach = excluded.reach, impressions = excluded.impressions,
            video_views = excluded.video_views, total_interactions = excluded.total_interactions,
            engagement_score = excluded.engagement_score,
            avg_watch_time_ms = coalesce(excluded.avg_watch_time_ms, insights.avg_watch_time_ms),
            total_watch_time_ms = coalesce(excluded.total_watch_time_ms, insights.total_watch_time_ms),
            synced_at = excluded.synced_at`;

        if (!temLocal && cdnThumb) miniaturas.push({ cdnThumb, id: media.id });
        synced++;
      } catch (err) {
        console.warn(`[InsightSync] ${media.id}: ${err.message}`);
      }
    }

    for (let i = 0; i < miniaturas.length; i += LOTE_DE_MINIATURAS) {
      await Promise.all(miniaturas.slice(i, i + LOTE_DE_MINIATURAS).map(async ({ cdnThumb, id }) => {
        const local = await baixarMiniatura(cdnThumb, id);
        if (local) await sql`update insights set thumbnail_url = ${local} where ig_media_id = ${id}`.catch(() => {});
      }));
    }

    console.log(`[InsightSync] @${conta.username} — ${synced}/${midias.length} posts atualizados`);
    return { synced, total: midias.length };
  } finally {
    _contasRodando.delete(conta.id);
  }
}

async function syncAllInsights() {
  if (_running) return { skipped: true };
  _running = true;
  const results = [];
  try {
    const contas = (await accounts.findMany()).filter(c => c.accessToken && c.igUserId);
    for (const conta of contas) {
      results.push({ username: conta.username, ...(await syncAccountInsights(conta)) });
    }
    broadcast('insights', { action: 'synced', count: results.length });

    // Marcos: lê o que este ciclo acabou de gravar. Falha aqui não mancha o sync.
    try {
      const detector = require('./smartActivity/detector');
      const novas = await detector.varrer(contas, { apenasStories: false });
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

module.exports = { syncAllInsights, syncAccountInsights, startInsightAutoSync, lerMetricas };
