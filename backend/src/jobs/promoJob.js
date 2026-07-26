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
  const now = new Date();
  return template
    .replace(/\{link\}/gi,     vars.link     || '')
    .replace(/\{username\}/gi, vars.username  || '')
    .replace(/\{nome\}/gi,     vars.name      || vars.username || '')
    .replace(/\{data\}/gi,     now.toLocaleDateString('pt-BR'))
    .replace(/\{hora\}/gi,     now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{cidade\}/gi,   vars.cidade   || '');
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

// Posta comentário de engajamento (pergunta) ~60min após publicar para estimular replies
async function postEngageCommentForPost(accountId, engageComment) {
  try {
    const account = await Account.findById(accountId);
    if (!account?.accessToken || !account?.igUserId) return;

    const token  = account.accessToken;
    const userId = account.igUserId;

    console.log(`⏳ [Engage] @${account.username} — aguardando 60min para comentário de engajamento...`);
    await delay(60 * 60_000);

    const md = await igGet(`/${userId}/media?fields=id,media_type,timestamp&limit=10`, token);
    const latestMedia = (md.data || []).find(m => m.media_type === 'VIDEO') || md.data?.[0];
    if (!latestMedia) return;

    const vars = {
      link:     account.promoLink  || '',
      username: `@${account.username}`,
      nome:     account.name       || account.username,
      cidade:   account.location   || '',
    };
    const message = buildMessage(engageComment, vars);
    await igPost(`/${latestMedia.id}/comments`, token, { message });
    console.log(`✅ [Engage] @${account.username} — pergunta postada: "${message.slice(0, 60)}"`);
  } catch (err) {
    console.log(`⚠️ [Engage] erro: ${err.message}`);
  }
}

// Responde automaticamente os comentários mais recentes do último reel (via Graph API)
async function autoReplyComments(accountId, replyTemplate) {
  try {
    const account = await Account.findById(accountId);
    if (!account?.accessToken || !account?.igUserId) return;

    const token  = account.accessToken;
    const userId = account.igUserId;

    const md = await igGet(`/${userId}/media?fields=id,media_type,timestamp&limit=10`, token);
    const latestMedia = (md.data || []).find(m => m.media_type === 'VIDEO') || md.data?.[0];
    if (!latestMedia) return;

    const commentsRes = await igGet(`/${latestMedia.id}/comments?fields=id,text,username,timestamp&limit=20`, token);
    const comments = commentsRes.data || [];

    // Ignora comentários próprios e já respondidos (identificados pelo prefixo da reply)
    const botMarker = `@${account.username}`;
    const repliedTo = new Set();

    for (const c of comments.slice(0, 5)) {
      if (c.username === account.username) continue; // pula comentários da própria conta
      if (repliedTo.has(c.id)) continue;

      const vars = {
        link:     account.promoLink  || '',
        username: `@${c.username}`,
        nome:     c.username,
        cidade:   account.location   || '',
      };
      const reply = buildMessage(replyTemplate || `Obrigado pelo comentário, @{username}! 🙏`, vars);
      try {
        await igPost(`/${c.id}/replies`, token, { message: reply });
        repliedTo.add(c.id);
        console.log(`✅ [AutoReply] @${account.username} → @${c.username}: "${reply.slice(0, 50)}"`);
        await delay(8_000); // pausa entre replies para evitar spam detection
      } catch (e) {
        console.log(`⚠️ [AutoReply] falha ao responder @${c.username}: ${e.message}`);
      }
    }
  } catch (err) {
    console.log(`⚠️ [AutoReply] erro: ${err.message}`);
  }
}

module.exports = { runPromoAfterPost, testPromoNow, postCTACommentForPost, postEngageCommentForPost, autoReplyComments };
