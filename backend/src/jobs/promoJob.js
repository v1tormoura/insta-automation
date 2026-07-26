'use strict';

const Account = require('../models/Account');
const path    = require('path');
const fs      = require('fs');
const { generateStoryCard } = require('../services/storyCardGenerator');

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

    // Busca o reel mais recente (media_type VIDEO = Reel)
    let latestMedia;
    try {
      const md = await igGet(`/${userId}/media?fields=id,media_type,thumbnail_url,media_url,timestamp&limit=10`, token);
      latestMedia = (md.data || []).find(m => m.media_type === 'VIDEO') || md.data?.[0];
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

    // ── 2. Auto Story com imagem customizada ───────────────────────────
    if (account.autoStory && account.promoLink) {
      try {
        const BACKEND_URL = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3000';

        const { filename } = await generateStoryCard({
          username: account.username,
          botLink:  account.promoLink,
          botName:  account.name || account.username,
        });
        const imageUrl = `${BACKEND_URL}/uploads/stories/${filename}`;

        // Aguarda 2s para o arquivo estar disponível via HTTP
        await delay(2000);

        const container = await igPost(`/${userId}/media`, token, {
          media_type: 'STORIES',
          image_url:  imageUrl,
        });

        if (container.id) {
          await delay(4000);
          await igPost(`/${userId}/media_publish`, token, { creation_id: container.id });
          console.log(`✅ [Promo] @${account.username} — story publicado com imagem customizada`);
        }

        // Remove imagem temporária após publicar
        setTimeout(() => {
          try { fs.unlinkSync(path.resolve(__dirname, '../../uploads/stories', filename)); } catch {}
        }, 60_000);

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

  const md = await igGet(`/${userId}/media?fields=id,media_type,thumbnail_url,media_url,timestamp&limit=10`, token);
  const latestMedia = (md.data || []).find(m => m.media_type === 'VIDEO') || md.data?.[0];
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
    const BACKEND_URL = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3000';
    const { filename } = await generateStoryCard({
      username: account.username,
      botLink:  account.promoLink,
      botName:  account.name || account.username,
    });
    const imageUrl = `${BACKEND_URL}/uploads/stories/${filename}`;
    await delay(2000);
    const container = await igPost(`/${userId}/media`, token, { media_type: 'STORIES', image_url: imageUrl });
    await delay(3000);
    await igPost(`/${userId}/media_publish`, token, { creation_id: container.id });
    setTimeout(() => {
      try { fs.unlinkSync(path.resolve(__dirname, '../../uploads/stories', filename)); } catch {}
    }, 60_000);
    return { ok: true, message: 'Story publicado com imagem customizada!' };
  }

  if (feature === 'bio') {
    await igPost(`/${userId}`, token, { website: account.promoLink });
    return { ok: true, message: 'Bio atualizada com o link do Telegram!' };
  }

  throw new Error('Feature inválida');
}

// Posta comentário CTA específico de um post (independente das config de promo global)
async function postCTACommentForPost(accountId, ctaComment) {
  try {
    const account = await Account.findById(accountId);
    if (!account?.accessToken || !account?.igUserId) return;

    const token  = account.accessToken;
    const userId = account.igUserId;

    console.log(`⏳ [CTA] @${account.username} — aguardando 2min para indexação...`);
    await delay(120_000);

    const md = await igGet(`/${userId}/media?fields=id,media_type,timestamp&limit=10`, token);
    const latestMedia = (md.data || []).find(m => m.media_type === 'VIDEO') || md.data?.[0];
    if (!latestMedia) { console.log(`[CTA] @${account.username} — nenhum reel encontrado`); return; }

    const vars = {
      link:     account.promoLink   || '',
      username: `@${account.username}`,
      nome:     account.name        || account.username,
    };
    const message = buildMessage(ctaComment, vars);
    await igPost(`/${latestMedia.id}/comments`, token, { message });
    console.log(`✅ [CTA] @${account.username} — comentário postado: "${message.slice(0, 60)}"`);
  } catch (err) {
    console.log(`⚠️ [CTA] erro: ${err.message}`);
  }
}

module.exports = { runPromoAfterPost, testPromoNow, postCTACommentForPost };
