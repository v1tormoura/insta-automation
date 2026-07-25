'use strict';

/**
 * Aquecimento de contas via Instagram Graph API (oficial)
 * Ações disponíveis: responder comentários, curtir comentários,
 * publicar respostas automáticas, monitorar posts.
 */

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
  leve:      { maxReplies: 3,  maxLikes: 5,  delayMin: 8000,  delayMax: 20000 },
  medio:     { maxReplies: 8,  maxLikes: 15, delayMin: 4000,  delayMax: 10000 },
  agressivo: { maxReplies: 15, maxLikes: 30, delayMin: 2000,  delayMax: 6000  },
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

/* ──────────────────── Warmup via API Oficial ──────────────────── */
async function warmupAccount(account, intensity = 'leve', actions = ['likes', 'comments']) {
  const label  = `@${account.username}`;
  const token  = account.accessToken;
  const userId = account.igUserId;
  const limits = INTENSITY_LIMITS[intensity] || INTENSITY_LIMITS.leve;
  const commentTemplates = account.warmupComments?.length ? account.warmupComments : COMMENT_TEMPLATES;

  if (!token) {
    await log(account._id, account.username, 'error', 'Conta sem token OAuth — reconecte a conta', { status: 'error' });
    return { status: 'sem_token', likes: 0, comments: 0, follows: 0, errors: ['sem token'] };
  }

  const results = { likes: 0, comments: 0, follows: 0, errors: [] };

  await log(account._id, account.username, 'cycle_start',
    `Iniciando ciclo ${intensity} via API Oficial`, { status: 'info' });

  try {
    // ── Busca posts recentes ────────────────────────────────────────────
    const mediaData = await igGet(`/${userId}/media?fields=id,timestamp,comments_count&limit=8`, token);
    const posts = mediaData.data || [];

    if (posts.length === 0) {
      await log(account._id, account.username, 'cycle_done',
        'Nenhum post encontrado na conta — publique conteúdo para ativar o aquecimento',
        { status: 'info' });
      return { status: 'sem_posts', ...results };
    }

    // ── Responder comentários não respondidos ───────────────────────────
    if (actions.includes('comments') || actions.includes('likes')) {
      let repliesDone = 0;
      let likesDone   = 0;

      for (const post of posts) {
        if (repliesDone >= limits.maxReplies && likesDone >= limits.maxLikes) break;

        let commentsData;
        try {
          commentsData = await igGet(`/${post.id}/comments?fields=id,text,username,replies{id}&limit=20`, token);
        } catch {
          continue;
        }

        const comments = commentsData.data || [];

        for (const comment of comments) {
          // ── Curtir comentário ──
          if (actions.includes('likes') && likesDone < limits.maxLikes) {
            try {
              await igPost(`/${comment.id}/likes`, token);
              likesDone++;
              results.likes++;
              await log(account._id, account.username, 'like',
                `Curtiu comentário de @${comment.username}`,
                { targetUser: comment.username, targetPostId: post.id });
              await delay(rand(limits.delayMin, limits.delayMax));
            } catch (e) {
              // like de comentário pode não estar disponível em todos os planos — ignora silenciosamente
            }
          }

          // ── Responder comentário (apenas se ainda não tem resposta) ──
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

      if (repliesDone === 0 && likesDone === 0) {
        await log(account._id, account.username, 'cycle_done',
          `${posts.length} post(s) monitorado(s) — sem novos comentários para responder`,
          { status: 'info' });
        broadcast('warmup', { action: 'cycle_done', username: account.username, ...results });
        return { status: 'ok', ...results };
      }
    }

  } catch (err) {
    console.log(`💥 [Warmup] ${label} — erro: ${err.message}`);
    await log(account._id, account.username, 'error', err.message, { status: 'error', error: err.message });
    results.errors.push(err.message);
  }

  const summary = `Ciclo concluído — ${results.likes} curtidas, ${results.comments} respostas`;
  await log(account._id, account.username, 'cycle_done', summary, { status: 'success' });
  console.log(`✅ [Warmup] ${label} — ${summary}`);
  broadcast('warmup', { action: 'cycle_done', username: account.username, ...results });
  return { status: 'ok', ...results };
}

/* ──────────────────── Job scheduler ──────────────────── */
const _activeJobs = new Map();

async function startWarmup(accountId, { intensity, actions, intervalMinutes, maxLikes, maxComments, maxFollows, commentList }) {
  const account = await Account.findById(accountId);
  if (!account) throw new Error('Conta não encontrada');

  stopWarmup(accountId);

  const interval = (intervalMinutes || 30) * 60 * 1000;

  async function run() {
    const fresh = await Account.findById(accountId);
    if (!fresh || fresh.warmupActive === false) {
      stopWarmup(accountId);
      return;
    }
    console.log(`🔥 [Warmup] Iniciando ciclo para @${fresh.username} (${intensity})`);
    await warmupAccount(fresh, intensity, actions);
    broadcast('accounts', { action: 'synced' });
  }

  run();

  const timer = setInterval(run, interval);
  _activeJobs.set(String(accountId), { timer });

  await Account.findByIdAndUpdate(accountId, {
    warmupActive: true,
    warmupIntensity: intensity,
    warmupActions: actions,
    warmupInterval: intervalMinutes || 30,
    warmupMaxLikes:    maxLikes    || 6,
    warmupMaxComments: maxComments || 2,
    warmupMaxFollows:  maxFollows  || 4,
    warmupComments: Array.isArray(commentList) ? commentList : [],
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
