'use strict';

/**
 * Aquecimento de contas — simula comportamento humano via Private API
 * Intensidades: leve (5-10 ações), medio (15-25), agressivo (30-50)
 */

const Account = require('../models/Account');
const { broadcast } = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const INTENSITY = {
  leve:      { likes: [3, 6],   comments: [1, 2],  follows: [2, 4],  delayMin: 15000, delayMax: 45000 },
  medio:     { likes: [8, 15],  comments: [3, 5],  follows: [5, 10], delayMin: 8000,  delayMax: 25000 },
  agressivo: { likes: [20, 35], comments: [6, 12], follows: [10, 20],delayMin: 3000,  delayMax: 12000 },
};

const COMMENT_TEMPLATES = [
  '🔥🔥🔥', '❤️', 'Incrível!', 'Muito bom!', '👏👏', 'Perfeito!',
  'Que lindo!', '😍', 'Top demais!', '💯', 'Amei!', '👌',
  'Sensacional!', '🙌', 'Maravilhoso!', 'Show!', '💪', 'Que demais!',
];

function randomComment() {
  return COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)];
}

function getIgClient() {
  const { IgApiClient } = require('instagram-private-api');
  return IgApiClient;
}

async function warmupAccount(account, intensity = 'leve', actions = ['likes', 'comments', 'follows']) {
  const label = `@${account.username}`;
  const baseCfg = INTENSITY[intensity] || INTENSITY.leve;
  const maxLikes = account.warmupMaxLikes || baseCfg.likes[1];
  const maxComments = account.warmupMaxComments || baseCfg.comments[1];
  const maxFollows = account.warmupMaxFollows || baseCfg.follows[1];
  const commentTemplates = (account.warmupComments?.length ? account.warmupComments : COMMENT_TEMPLATES);
  const cfg = {
    ...baseCfg,
    likes: [1, maxLikes],
    comments: [1, maxComments],
    follows: [1, maxFollows],
  };

  let ig;
  try {
    const IgApiClient = getIgClient();
    ig = new IgApiClient();

    // Carrega sessão salva
    if (account.igSession && account.igSession !== 'use_cookies') {
      try {
        const state = JSON.parse(account.igSession);
        ig.state.generateDevice(state._deviceSeed || account.username);
        await ig.state.deserialize(state);
      } catch {
        ig.state.generateDevice(account.username);
      }
    } else {
      ig.state.generateDevice(account.username);
    }
  } catch (err) {
    console.log(`⚠️ [Warmup] ${label} — Private API indisponível: ${err.message}`);
    return { status: 'erro', error: err.message };
  }

  const results = { likes: 0, comments: 0, follows: 0, errors: [] };

  try {
    // Busca timeline feed para interagir
    const feed = ig.feed.timeline();
    const posts = await feed.items();

    if (!posts || posts.length === 0) {
      return { status: 'sem_feed', ...results };
    }

    // ── CURTIDAS ─────────────────────────────────────────────────────
    if (actions.includes('likes')) {
      const count = rand(...cfg.likes);
      const targets = posts.slice(0, Math.min(count, posts.length));
      for (const post of targets) {
        try {
          if (!post.has_liked) {
            await ig.media.like({ mediaId: post.id, moduleInfo: { module_name: 'feed_timeline' }, d: 1 });
            results.likes++;
            console.log(`❤️ [Warmup] ${label} — curtiu post ${post.id}`);
          }
          await delay(rand(cfg.delayMin, cfg.delayMax));
        } catch (err) {
          results.errors.push(`like: ${err.message}`);
        }
      }
    }

    // ── COMENTÁRIOS ───────────────────────────────────────────────────
    if (actions.includes('comments')) {
      const count = rand(...cfg.comments);
      const targets = posts.slice(0, Math.min(count, posts.length));
      for (const post of targets) {
        try {
          const text = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
          await ig.media.comment({ mediaId: post.id, text });
          results.comments++;
          console.log(`💬 [Warmup] ${label} — comentou "${text}" em ${post.id}`);
          await delay(rand(cfg.delayMin * 2, cfg.delayMax * 2));
        } catch (err) {
          results.errors.push(`comment: ${err.message}`);
        }
      }
    }

    // ── SEGUIR ────────────────────────────────────────────────────────
    if (actions.includes('follows')) {
      const count = rand(...cfg.follows);
      const targets = posts.slice(0, Math.min(count, posts.length));
      for (const post of targets) {
        try {
          const userId = post.user?.pk;
          if (userId) {
            await ig.friendship.create(userId);
            results.follows++;
            console.log(`➕ [Warmup] ${label} — seguiu @${post.user.username}`);
            await delay(rand(cfg.delayMin, cfg.delayMax));
          }
        } catch (err) {
          results.errors.push(`follow: ${err.message}`);
        }
      }
    }

    // Salva sessão atualizada
    try {
      const state = await ig.state.serialize();
      delete state.constants;
      await Account.findByIdAndUpdate(account._id, { igSession: JSON.stringify(state) });
    } catch {}

  } catch (err) {
    console.log(`💥 [Warmup] ${label} — erro geral: ${err.message}`);
    results.errors.push(err.message);
  }

  console.log(`✅ [Warmup] ${label} — likes:${results.likes} comentários:${results.comments} follows:${results.follows}`);
  return { status: 'ok', ...results };
}

// Mapa de jobs ativos: accountId → { timer, running }
const _activeJobs = new Map();

async function startWarmup(accountId, { intensity, actions, intervalMinutes, maxLikes, maxComments, maxFollows, commentList }) {
  const account = await Account.findById(accountId);
  if (!account) throw new Error('Conta não encontrada');

  // Para job anterior se existir
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

  // Executa imediatamente
  run();

  // Agenda próximas execuções
  const timer = setInterval(run, interval);
  _activeJobs.set(String(accountId), { timer });

  await Account.findByIdAndUpdate(accountId, {
    warmupActive: true,
    warmupIntensity: intensity,
    warmupActions: actions,
    warmupInterval: intervalMinutes || 30,
    warmupMaxLikes: maxLikes || 6,
    warmupMaxComments: maxComments || 2,
    warmupMaxFollows: maxFollows || 4,
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
