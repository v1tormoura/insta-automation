'use strict';

/**
 * Promo Job — dispara após cada publicação bem-sucedida.
 * 1. Auto comentário com template editável
 * 2. Auto Story com link sticker para o Telegram
 * 3. Auto atualização da bio
 */

const Account = require('../models/Account');

const IG_API = 'https://graph.instagram.com/v21.0';
const delay  = ms => new Promise(r => setTimeout(r, ms));

async function igGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res  = await fetch(`${IG_API}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function igPost(path, token, body = {}) {
  const res  = await fetch(`${IG_API}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

function buildMessage(template, vars = {}) {
  return template
    .replace(/\{link\}/gi,     vars.link     || '')
    .replace(/\{username\}/gi, vars.username  || '')
    .replace(/\{nome\}/gi,     vars.name      || vars.username || '');
}

async function runPromoAfterPost(accountId) {
  try {
    const account = await Account.findById(accountId);
    if (!account?.promoEnabled) return;
    if (!account.accessToken || !account.igUserId) {
      console.log(`[Promo] @${account.username} — sem token OAuth, ignorando`);
      return;
    }

    const token  = account.accessToken;
    const userId = account.igUserId;

    // Aguarda 2 min para o post ser indexado na Graph API
    console.log(`⏳ [Promo] @${account.username} — aguardando 2min para post ser indexado...`);
    await delay(120_000);

    // Busca o post mais recente
    let latestMedia;
    try {
      const md = await igGet(`/${userId}/media?fields=id,thumbnail_url,media_url,timestamp&limit=1`, token);
      latestMedia = md.data?.[0];
    } catch (e) {
      console.log(`[Promo] @${account.username} — erro ao buscar mídia: ${e.message}`);
      return;
    }

    if (!latestMedia) {
      console.log(`[Promo] @${account.username} — nenhum post encontrado na Graph API`);
      return;
    }

    const vars = {
      link:     account.promoLink,
      username: `@${account.username}`,
      name:     account.name || account.username,
    };

    // ── 1. Auto comentário ──────────────────────────────────────────────
    if (account.autoComment && account.autoCommentTemplate?.trim()) {
      try {
        const message = buildMessage(account.autoCommentTemplate, vars);
        await igPost(`/${latestMedia.id}/comments`, token, { message });
        console.log(`✅ [Promo] @${account.username} — comentário publicado`);
      } catch (e) {
        console.log(`⚠️ [Promo] @${account.username} — erro comentário: ${e.message}`);
      }
      await delay(3000);
    }

    // ── 2. Auto Story com link ──────────────────────────────────────────
    if (account.autoStory && account.promoLink) {
      try {
        const thumbUrl = latestMedia.thumbnail_url || latestMedia.media_url;
        if (!thumbUrl) throw new Error('Sem thumbnail disponível');

        const container = await igPost(`/${userId}/media`, token, {
          media_type: 'STORIES',
          image_url:  thumbUrl,
          link:       account.promoLink,
        });

        if (container.id) {
          await delay(4000);
          await igPost(`/${userId}/media_publish`, token, { creation_id: container.id });
          console.log(`✅ [Promo] @${account.username} — story publicado`);
        }
      } catch (e) {
        console.log(`⚠️ [Promo] @${account.username} — erro story: ${e.message}`);
      }
    }

    // ── 3. Auto Bio ─────────────────────────────────────────────────────
    if (account.autoBio && account.promoLink) {
      try {
        await igPost(`/${userId}`, token, { website: account.promoLink });
        console.log(`✅ [Promo] @${account.username} — bio atualizada`);
      } catch (e) {
        console.log(`⚠️ [Promo] @${account.username} — bio: ${e.message}`);
      }
    }

    await Account.findByIdAndUpdate(accountId, { lastPromoAt: new Date() });

  } catch (err) {
    console.log(`💥 [Promo] erro geral: ${err.message}`);
  }
}

// Versão imediata para testes (sem delay de 2min)
async function testPromoNow(accountId, feature) {
  const account = await Account.findById(accountId);
  if (!account?.accessToken || !account?.igUserId) throw new Error('Conta sem token OAuth');

  const token  = account.accessToken;
  const userId = account.igUserId;

  const md = await igGet(`/${userId}/media?fields=id,thumbnail_url,media_url,timestamp&limit=1`, token);
  const latestMedia = md.data?.[0];
  if (!latestMedia) throw new Error('Nenhum post encontrado — publique um reel primeiro');

  const vars = {
    link:     account.promoLink,
    username: `@${account.username}`,
    name:     account.name || account.username,
  };

  if (feature === 'comment') {
    const message = buildMessage(account.autoCommentTemplate || '🤖 {link}', vars);
    await igPost(`/${latestMedia.id}/comments`, token, { message });
    return { ok: true, message: `Comentário postado no post mais recente: "${message}"` };
  }

  if (feature === 'story') {
    const thumbUrl = latestMedia.thumbnail_url || latestMedia.media_url;
    if (!thumbUrl) throw new Error('Sem thumbnail no último post');
    const container = await igPost(`/${userId}/media`, token, {
      media_type: 'STORIES',
      image_url:  thumbUrl,
      link:       account.promoLink,
    });
    await delay(3000);
    await igPost(`/${userId}/media_publish`, token, { creation_id: container.id });
    return { ok: true, message: 'Story publicado com o link do Telegram!' };
  }

  if (feature === 'bio') {
    await igPost(`/${userId}`, token, { website: account.promoLink });
    return { ok: true, message: 'Bio atualizada com o link do Telegram!' };
  }

  throw new Error('Feature inválida');
}

module.exports = { runPromoAfterPost, testPromoNow };
