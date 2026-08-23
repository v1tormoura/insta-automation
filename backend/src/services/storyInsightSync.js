'use strict';

/**
 * Audiência dos stories — coleta e persistência.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * O card "Stories · Visualizações estimadas" do painel soma `impressions` dos
 * Insight com `mediaType: 'STORY'`. Só que nada nunca criava esses documentos:
 * o insightSyncService lê `/{ig-user-id}/media`, que devolve APENAS posts do
 * feed — story não aparece nessa borda do Graph. O número era estruturalmente
 * zero, não "zero porque ninguém viu".
 *
 * ── A janela de 24h manda na arquitetura ────────────────────────────────────
 * Story publicado há mais de 24h deixa de existir para o Instagram: nenhum
 * endpoint devolve o histórico, em nenhuma das duas APIs. Então a coleta é uma
 * FOTOGRAFIA, e o valor precisa ser persistido enquanto o story está no ar.
 *
 * Daí duas regras:
 *   • a contagem gravada só sobe (`Math.max` com o que já existe). A audiência
 *     cresce enquanto o story vive; uma leitura mais recente nunca deveria
 *     rebaixar o total, e uma falha parcial de coleta jamais apaga o histórico;
 *   • o ciclo precisa rodar dentro da janela. Está pendurado no mesmo intervalo
 *     de 30 min do sync de insights — margem de sobra para 24h.
 *
 * ── Dois caminhos, por tipo de conta ────────────────────────────────────────
 *   • instagrapi (as contas da automação): serviço Python lê o feed privado de
 *     stories e devolve a audiência de cada um.
 *   • Graph API (contas OAuth): borda `/stories` + `/{id}/insights`.
 * Uma conta que tenha os dois usa o instagrapi, que é o caminho que funciona
 * sem exigir conta Business nem permissão de insights aprovada.
 */

const Account = require('../models/Account');
const Insight = require('../models/Insight');
const { gGet } = require('./insightSyncService');

let _rodando = false;

/* ── Graph API ─────────────────────────────────────────────────────────────── */

/**
 * Métricas de um story pela Graph API.
 *
 * `impressions` foi descontinuado para story nas versões mais novas e derruba a
 * chamada inteira quando não é aceito — por isso a lista completa é tentada
 * primeiro e, na recusa, cai para `reach` sozinho, que é aceito em todas.
 */
async function _metricasGraph(storyId, token) {
  const tentativas = ['impressions,reach,replies', 'views,reach', 'reach'];
  for (const metric of tentativas) {
    try {
      const d = await gGet(`/${storyId}/insights`, { metric }, token);
      const m = {};
      for (const item of (d.data || [])) {
        m[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
      }
      if (Object.keys(m).length) return m;
    } catch {
      // tenta o próximo conjunto
    }
  }
  return {};
}

async function _coletarPelaGraph(account) {
  const campos = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';
  const lista = await gGet(`/${account.igUserId}/stories`, { fields: campos }, account.accessToken);

  const stories = [];
  for (const item of (lista.data || [])) {
    const m = await _metricasGraph(item.id, account.accessToken);
    // Ordem de preferência: impressions (visualizações) → views → reach.
    const vistos = m.impressions ?? m.views ?? m.reach ?? null;
    stories.push({
      story_id:      String(item.id),
      taken_at:      item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : null,
      thumbnail_url: item.thumbnail_url || item.media_url || '',
      permalink:     item.permalink || '',
      media_type:    item.media_type === 'VIDEO' ? 2 : 1,
      viewers:       typeof vistos === 'number' ? vistos : null,
      fonte:         'graph',
    });
  }
  return stories;
}

/* ── instagrapi ────────────────────────────────────────────────────────────── */

async function _coletarPeloInstagrapi(account) {
  const { getProvider } = require('../providers/ProviderFactory');
  const provider = getProvider(account);
  if (typeof provider.storyInsights !== 'function') {
    throw Object.assign(new Error('Provider sem suporte a insights de story'), { code: 'UNSUPPORTED' });
  }
  const r = await provider.storyInsights(account);
  return r?.stories || [];
}

/* ── Persistência ──────────────────────────────────────────────────────────── */

/**
 * Grava um story como Insight.
 *
 * O `$max` do Mongo faz o trabalho de "só sobe" de forma atômica: dois ciclos
 * concorrentes não podem rebaixar o valor um do outro.
 */
async function _gravar(account, story) {
  // `Number(null)` e `Number('')` valem 0, não NaN — sem esta checagem explícita
  // um story SEM audiência conhecida entraria no banco como zero visualizações,
  // que é exatamente o que rebaixaria o total do painel.
  const bruto = story.viewers;
  const numerico = typeof bruto === 'number'
    || (typeof bruto === 'string' && bruto.trim() !== '');
  if (!numerico) return false;

  const vistos = Number(bruto);
  if (!Number.isFinite(vistos) || vistos < 0) return false;

  const postedAt = story.taken_at ? new Date(Number(story.taken_at) * 1000) : new Date();

  await Insight.updateOne(
    { igMediaId: String(story.story_id) },
    {
      $set: {
        accountId:    account._id,
        username:     account.username,
        igMediaId:    String(story.story_id),
        mediaType:    'STORY',
        thumbnailUrl: story.thumbnail_url || '',
        permalink:    story.permalink || '',
        postedAt,
        syncedAt:     new Date(),
      },
      // Audiência só cresce enquanto o story vive — uma leitura menor (coleta
      // parcial, erro momentâneo) não pode apagar o que já foi contado.
      $max: { impressions: vistos, reach: vistos },
    },
    { upsert: true },
  );
  return true;
}

/* ── API pública ───────────────────────────────────────────────────────────── */

/**
 * Coleta e grava a audiência dos stories ativos de UMA conta.
 *
 * @returns {Promise<{skipped?: string, stories?: number, gravados?: number, viewers?: number, error?: string}>}
 */
async function syncAccountStoryInsights(account) {
  if (account.healthStatus === 'banida') return { skipped: 'banned' };

  const viaInstagrapi = account.provider === 'instagrapi' || account.instagrapiSession;
  const viaGraph      = Boolean(account.accessToken && account.igUserId);

  if (!viaInstagrapi && !viaGraph) return { skipped: 'sem_via_de_leitura' };

  try {
    const stories = viaInstagrapi
      ? await _coletarPeloInstagrapi(account)
      : await _coletarPelaGraph(account);

    let gravados = 0;
    let viewers  = 0;
    for (const story of stories) {
      if (await _gravar(account, story)) {
        gravados++;
        viewers += Number(story.viewers) || 0;
      }
    }

    // Sem story ativo é o caso normal da maior parte do dia — não é erro, e o
    // que já foi gravado antes continua valendo no painel.
    if (!stories.length) return { stories: 0, gravados: 0, viewers: 0 };

    console.log(
      `[StoryInsights] @${account.username} — ${gravados}/${stories.length} story(s) com audiência, ${viewers} visualizações ` +
      `(via ${viaInstagrapi ? 'instagrapi' : 'graph'})`
    );
    return { stories: stories.length, gravados, viewers };
  } catch (err) {
    // Falha de uma conta não pode derrubar o ciclo das outras.
    console.warn(`[StoryInsights] @${account.username}: ${err.message}`);
    return { error: err.message };
  }
}

/** Percorre todas as contas conectadas. Um ciclo por vez. */
async function syncAllStoryInsights() {
  if (_rodando) return { skipped: 'already_running' };
  _rodando = true;

  try {
    const contas = await Account.find({
      $or: [
        { provider: 'instagrapi' },
        { instagrapiSession: { $exists: true, $ne: null } },
        { accessToken: { $exists: true, $ne: '' } },
      ],
    });

    let totalStories = 0;
    let totalViewers = 0;
    let comErro      = 0;
    let ativos       = 0;
    for (const conta of contas) {
      const r = await syncAccountStoryInsights(conta);
      totalStories += r.gravados || 0;
      totalViewers += r.viewers  || 0;
      ativos       += r.stories  || 0;
      if (r.error) comErro++;
    }

    // Loga SEMPRE, mesmo sem story ativo. Silêncio em caso de sucesso torna
    // "rodou e não havia story" indistinguível de "nunca rodou" — e a primeira
    // pergunta de quem acabou de configurar isto é exatamente essa.
    console.log(
      `[StoryInsights] ciclo — ${contas.length} conta(s), ${ativos} story(s) ativo(s), ` +
      `${totalStories} com audiência, ${totalViewers} visualizações` +
      (comErro ? `, ${comErro} com erro` : '')
    );
    return { contas: contas.length, ativos, stories: totalStories, viewers: totalViewers, erros: comErro };
  } finally {
    _rodando = false;
  }
}

/**
 * Agenda o ciclo. O intervalo padrão acompanha o do sync de insights (30 min),
 * folgado para a janela de 24h do story.
 */
function startStoryInsightAutoSync(intervalMs = 30 * 60 * 1000) {
  // Atraso inicial maior que o do insightSync para os dois não competirem pelo
  // mesmo lock de conta logo na subida do processo.
  setTimeout(() => syncAllStoryInsights().catch(() => {}), 45_000);
  setInterval(() => syncAllStoryInsights().catch(() => {}), intervalMs);
}

module.exports = {
  syncAllStoryInsights,
  syncAccountStoryInsights,
  startStoryInsightAutoSync,
  // Exportados para teste — a regra de "só sobe" e a escolha de métrica são o
  // que decide se o número do painel está certo.
  _gravar,
  _metricasGraph,
};
