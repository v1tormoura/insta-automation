'use strict';

/**
 * Audiência dos stories pela API oficial (`/{ig-user-id}/stories` + insights).
 *
 * Story some do Instagram depois de 24h e nenhum endpoint devolve o histórico:
 * a coleta é uma fotografia, gravada como insight `STORY` enquanto o story está
 * no ar. O valor gravado só sobe — uma leitura parcial nunca rebaixa o total.
 */

const { sql } = require('../db');
const { accounts } = require('../repos');
const graph = require('./instagramAPI');

let _rodando = false;

/** `impressions` foi descontinuado para story em versões novas; cai para views e reach. */
async function _metricasGraph(storyId, token) {
  for (const metric of ['impressions,reach,replies', 'views,reach', 'reach']) {
    try {
      const d = await graph.get(`/${storyId}/insights`, { metric }, token);
      const m = {};
      for (const item of d.data || []) m[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? item.value ?? 0;
      if (Object.keys(m).length) return m;
    } catch {
      // tenta o próximo conjunto
    }
  }
  return {};
}

async function _coletar(conta) {
  const lista = await graph.get(`/${conta.igUserId}/stories`, { fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp' }, conta.accessToken);
  const stories = [];
  for (const item of lista.data || []) {
    const m = await _metricasGraph(item.id, conta.accessToken);
    const vistos = m.impressions ?? m.views ?? m.reach ?? null;
    stories.push({
      story_id: String(item.id),
      taken_at: item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : null,
      thumbnail_url: item.thumbnail_url || item.media_url || '',
      permalink: item.permalink || '',
      viewers: typeof vistos === 'number' ? vistos : null,
    });
  }
  return stories;
}

/** Grava um story como insight. `greatest` faz o "só sobe" de forma atômica. */
async function _gravar(conta, story) {
  // Number(null) e Number('') valem 0: sem esta checagem, audiência desconhecida viraria zero.
  const bruto = story.viewers;
  if (!(typeof bruto === 'number' || (typeof bruto === 'string' && bruto.trim() !== ''))) return false;
  const vistos = Number(bruto);
  if (!Number.isFinite(vistos) || vistos < 0) return false;

  const postedAt = story.taken_at ? new Date(Number(story.taken_at) * 1000) : new Date();
  await sql`
    insert into insights ${sql({
      accountId: conta.id, username: conta.username, igMediaId: String(story.story_id), mediaType: 'STORY',
      thumbnailUrl: story.thumbnail_url || '', permalink: story.permalink || '', postedAt,
      impressions: vistos, reach: vistos, syncedAt: new Date(),
    })}
    on conflict (ig_media_id) do update set
      account_id = excluded.account_id, username = excluded.username, media_type = 'STORY',
      thumbnail_url = excluded.thumbnail_url, permalink = excluded.permalink, posted_at = excluded.posted_at,
      impressions = greatest(insights.impressions, excluded.impressions),
      reach = greatest(insights.reach, excluded.reach),
      synced_at = excluded.synced_at`;
  return true;
}

async function syncAccountStoryInsights(conta) {
  if (conta.healthStatus === 'banida') return { skipped: 'banned' };
  if (!conta.accessToken || !conta.igUserId) return { skipped: 'sem_via_de_leitura' };

  try {
    const stories = await _coletar(conta);
    let gravados = 0, viewers = 0;
    for (const story of stories) {
      if (await _gravar(conta, story)) {
        gravados++;
        viewers += Number(story.viewers) || 0;
      }
    }
    if (stories.length) {
      console.log(`[StoryInsights] @${conta.username} — ${gravados}/${stories.length} story(s) com audiência, ${viewers} visualizações`);
    }
    return { stories: stories.length, gravados, viewers };
  } catch (err) {
    console.warn(`[StoryInsights] @${conta.username}: ${err.message}`);
    return { error: err.message };
  }
}

async function syncAllStoryInsights() {
  if (_rodando) return { skipped: 'already_running' };
  _rodando = true;
  try {
    const contas = (await accounts.findMany()).filter(c => c.accessToken && c.igUserId);
    let gravados = 0, viewers = 0, ativos = 0, erros = 0;
    for (const conta of contas) {
      const r = await syncAccountStoryInsights(conta);
      gravados += r.gravados || 0;
      viewers += r.viewers || 0;
      ativos += r.stories || 0;
      if (r.error) erros++;
    }

    // Marcos de story: a audiência vive 24h e sobe rápido.
    try {
      const detector = require('./smartActivity/detector');
      const { broadcast } = require('../events/broadcaster');
      const novas = await detector.varrer(contas, { apenasStories: true });
      if (novas.length) broadcast('notificacoes', { novas: novas.length });
    } catch (err) {
      console.warn('[SmartActivity] detecção de story falhou:', err.message);
    }

    console.log(`[StoryInsights] ciclo — ${contas.length} conta(s), ${ativos} story(s) ativo(s), ${gravados} com audiência, ${viewers} visualizações${erros ? `, ${erros} com erro` : ''}`);
    return { contas: contas.length, ativos, stories: gravados, viewers, erros };
  } finally {
    _rodando = false;
  }
}

function startStoryInsightAutoSync(intervalMs = 30 * 60 * 1000) {
  setTimeout(() => syncAllStoryInsights().catch(() => {}), 45_000);
  setInterval(() => syncAllStoryInsights().catch(() => {}), intervalMs);
}

module.exports = { syncAllStoryInsights, syncAccountStoryInsights, startStoryInsightAutoSync, _gravar, _metricasGraph };
