'use strict';

const Account   = require('../models/Account');
const WarmupLog = require('../models/WarmupLog');
const { broadcast } = require('../events/broadcaster');

const IG_API = 'https://graph.instagram.com/v21.0';

async function igGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${IG_API}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function igPost(path, token, body = {}) {
  const res = await fetch(`${IG_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function log(accountId, username, action, detail = '', opts = {}) {
  try {
    await WarmupLog.create({
      accountId, username, action, detail,
      targetUser:   opts.targetUser   || '',
      targetPostId: opts.targetPostId || '',
      status:       opts.status       || 'success',
      errorMsg:     opts.error        || '',
    });
    const count = await WarmupLog.countDocuments({ accountId });
    if (count > 500) {
      const oldest = await WarmupLog.find({ accountId }).sort({ createdAt: 1 }).limit(count - 500).select('_id');
      await WarmupLog.deleteMany({ _id: { $in: oldest.map(d => d._id) } });
    }
  } catch {}
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const INTENSITY_LIMITS = {
  leve:      { maxReplies: 3,  maxLikes: 5,  maxScrollReels: 5,  maxPostLikes: 3,  delayMin: 8000,  delayMax: 20000 },
  medio:     { maxReplies: 8,  maxLikes: 15, maxScrollReels: 12, maxPostLikes: 8,  delayMin: 4000,  delayMax: 10000 },
  agressivo: { maxReplies: 15, maxLikes: 30, maxScrollReels: 20, maxPostLikes: 15, delayMin: 2000,  delayMax: 6000  },
};

const COMMENT_TEMPLATES = [
  '🔥🔥🔥', '❤️', 'Incrível!', 'Muito bom!', '👏👏', 'Perfeito!',
  'Que lindo!', '😍', 'Top demais!', '💯', 'Amei!', '👌',
  'Sensacional!', '🙌', 'Maravilhoso!', 'Show!', '💪', 'Que demais!',
];

function pickComment(templates) {
  const list = (templates?.length) ? templates : COMMENT_TEMPLATES;
  return list[Math.floor(Math.random() * list.length)];
}

/* ──────────────────── Ação: Rolar Reels (Private API) ──────────────────── */
async function scrollReels(account, limits, results) {
  let ig;
  try {
    const { createClient } = require('../services/instagramPrivateService');
    ig = await createClient(account);
  } catch {
    await log(account._id, account.username, 'error', 'Rolar Reels requer sessão privada — reconecte a conta', { status: 'error' });
    return;
  }

  try {
    const feed = ig.feed.timeline();
    const items = await feed.items();
    const reels = items.filter(i => i.media_type === 2 || i.product_type === 'clips').slice(0, limits.maxScrollReels);

    let watched = 0;
    for (const item of reels) {
      try {
        // simula tempo assistindo
        const watchSecs = rand(4, 18);
        await delay(watchSecs * 1000);
        watched++;

        // curte ~40% dos reels assistidos
        if (Math.random() < 0.4) {
          await ig.media.like({ mediaId: item.pk, moduleInfo: { module_name: 'feed_timeline' }, d: 0 });
          results.likes++;
          await log(account._id, account.username, 'like',
            `Curtiu reel no feed (${watchSecs}s assistidos)`,
            { targetPostId: String(item.pk) });
        } else {
          await log(account._id, account.username, 'scroll',
            `Rolou reel — assistiu ${watchSecs}s`,
            { targetPostId: String(item.pk) });
        }

        await delay(rand(1000, 3000));
      } catch {}
    }

    if (watched > 0) {
      await log(account._id, account.username, 'cycle_done',
        `Rolou ${watched} reel(s) no feed`, { status: 'info' });
    }
  } catch (e) {
    await log(account._id, account.username, 'error', `Erro ao rolar reels: ${e.message}`, { status: 'error', error: e.message });
  }
}

/* ──────────────────── Ação: Curtir posts (Private API) ──────────────────── */
async function likeExplorePosts(account, limits, results) {
  let ig;
  try {
    const { createClient } = require('../services/instagramPrivateService');
    ig = await createClient(account);
  } catch {
    await log(account._id, account.username, 'error', 'Curtir posts requer sessão privada — reconecte a conta', { status: 'error' });
    return;
  }

  try {
    const feed = ig.feed.discover();
    const items = (await feed.items()).slice(0, limits.maxPostLikes * 3);
    let liked = 0;

    for (const item of items) {
      if (liked >= limits.maxPostLikes) break;
      try {
        await ig.media.like({ mediaId: item.pk, moduleInfo: { module_name: 'feed_contextual_self_profile' }, d: 0 });
        liked++;
        results.likes++;
        await log(account._id, account.username, 'like',
          `Curtiu post no Explorar`,
          { targetPostId: String(item.pk) });
        await delay(rand(5000, 15000));
      } catch {}
    }
  } catch (e) {
    await log(account._id, account.username, 'error', `Erro ao curtir posts: ${e.message}`, { status: 'error', error: e.message });
  }
}

/* ──────────────────── Warmup via API Oficial ──────────────────── */
async function warmupAccount(account, intensity = 'leve', actions = ['likes']) {
  const token  = account.accessToken;
  const userId = account.igUserId;
  const limits = INTENSITY_LIMITS[intensity] || INTENSITY_LIMITS.leve;
  const commentTemplates = account.warmupComments?.length ? account.warmupComments : COMMENT_TEMPLATES;

  const results = { likes: 0, comments: 0, follows: 0, errors: [] };

  await log(account._id, account.username, 'cycle_start',
    `Iniciando ciclo ${intensity}`, { status: 'info' });

  // ── Rolar Reels (Private API) ──
  if (actions.includes('scroll_reels')) {
    await scrollReels(account, limits, results);
  }

  // ── Curtir posts do Explorar (Private API) ──
  if (actions.includes('like_posts')) {
    await likeExplorePosts(account, limits, results);
  }

  // ── Ações via API Oficial ──
  if ((actions.includes('likes') || actions.includes('comments')) && token && userId) {
    try {
      const mediaData = await igGet(`/${userId}/media?fields=id,timestamp,comments_count&limit=8`, token);
      const posts = mediaData.data || [];

      if (posts.length > 0) {
        let repliesDone = 0;
        let likesDone   = 0;

        for (const post of posts) {
          if (repliesDone >= limits.maxReplies && likesDone >= limits.maxLikes) break;

          let commentsData;
          try {
            commentsData = await igGet(`/${post.id}/comments?fields=id,text,username,replies{id}&limit=20`, token);
          } catch { continue; }

          const comments = commentsData.data || [];

          for (const comment of comments) {
            if (actions.includes('likes') && likesDone < limits.maxLikes) {
              try {
                await igPost(`/${comment.id}/likes`, token);
                likesDone++;
                results.likes++;
                await log(account._id, account.username, 'like',
                  `Curtiu comentário de @${comment.username}`,
                  { targetUser: comment.username, targetPostId: post.id });
                await delay(rand(limits.delayMin, limits.delayMax));
              } catch {}
            }

            const alreadyReplied = (comment.replies?.data?.length || 0) > 0;
            if (actions.includes('comments') && !alreadyReplied && repliesDone < limits.maxReplies) {
              try {
                const text = pickComment(commentTemplates);
                await igPost(`/${comment.id}/replies`, token, { message: text });
                repliesDone++;
                results.comments++;
                await log(account._id, account.username, 'comment',
                  `Respondeu comentário de @${comment.username}: "${text}"`,
                  { targetUser: comment.username, targetPostId: post.id });
                await delay(rand(limits.delayMin * 2, limits.delayMax * 2));
              } catch (e) {
                results.errors.push(`reply: ${e.message}`);
                await log(account._id, account.username, 'error',
                  `Erro ao responder comentário: ${e.message}`,
                  { status: 'error', error: e.message });
              }
            }
          }
        }
      }
    } catch (err) {
      await log(account._id, account.username, 'error', err.message, { status: 'error', error: err.message });
      results.errors.push(err.message);
    }
  }

  const summary = `Ciclo concluído — ${results.likes} curtidas, ${results.comments} respostas`;
  await log(account._id, account.username, 'cycle_done', summary, { status: 'success' });
  broadcast('warmup', { action: 'cycle_done', username: account.username, ...results });
  return { status: 'ok', ...results };
}

/* ──────────────────── Job scheduler ──────────────────── */
const _activeJobs = new Map();

async function startWarmup(accountId, { intensity, actions, intervalMinutes, maxLikes, maxComments, maxFollows, commentList, maxDurationHours }) {
  const account = await Account.findById(accountId);
  if (!account) throw new Error('Conta não encontrada');

  stopWarmup(accountId);

  const interval       = (intervalMinutes || 30) * 60 * 1000;
  const maxDurationMs  = (maxDurationHours || 0) * 3600 * 1000;
  const startedAt      = Date.now();

  async function run() {
    const fresh = await Account.findById(accountId);
    if (!fresh || fresh.warmupActive === false) {
      stopWarmup(accountId);
      return;
    }

    // Auto-stop por duração
    if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
      const hrs = maxDurationHours;
      await log(accountId, fresh.username, 'cycle_done',
        `⏱ Duração máxima de ${hrs}h atingida — aquecimento encerrado automaticamente`,
        { status: 'info' });
      await stopWarmupAndSave(accountId);
      return;
    }

    await warmupAccount(fresh, intensity, actions);
    broadcast('accounts', { action: 'synced' });
  }

  run();

  const timer = setInterval(run, interval);
  _activeJobs.set(String(accountId), { timer, startedAt, maxDurationMs });

  await Account.findByIdAndUpdate(accountId, {
    warmupActive:        true,
    warmupIntensity:     intensity,
    warmupActions:       actions,
    warmupInterval:      intervalMinutes || 30,
    warmupMaxLikes:      maxLikes    || 6,
    warmupMaxComments:   maxComments || 2,
    warmupMaxFollows:    maxFollows  || 4,
    warmupComments:      Array.isArray(commentList) ? commentList : [],
    warmupMaxDuration:   maxDurationHours || 0,
    warmupStartedAt:     new Date(),
  });

  broadcast('accounts', { action: 'synced' });
  return { started: true };
}

function stopWarmup(accountId) {
  const job = _activeJobs.get(String(accountId));
  if (job) {
    clearInterval(job.timer);
    _activeJobs.delete(String(accountId));
  }
}

async function stopWarmupAndSave(accountId) {
  stopWarmup(accountId);
  await Account.findByIdAndUpdate(accountId, { warmupActive: false });
  broadcast('accounts', { action: 'synced' });
  return { stopped: true };
}

function getActiveJobs() {
  return Array.from(_activeJobs.keys());
}

module.exports = { startWarmup, stopWarmupAndSave, warmupAccount, getActiveJobs };
