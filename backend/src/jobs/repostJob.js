'use strict';
const RepostRule = require('../models/RepostRule');
const Insight    = require('../models/Insight');
const Post       = require('../models/Post');
const postQueue  = require('../queue/postQueue');

async function runRepostJob() {
  const rules = await RepostRule.find({ active: true });

  for (const rule of rules) {
    try {
      const days  = { '30d': 30, 'all': 3650, '7d': 7 }[rule.condition.period] || 7;
      const since = new Date(Date.now() - days * 86400000);

      const filter = { postedAt: { $gte: since } };
      filter[rule.condition.metric] = { [rule.condition.operator === 'gte' ? '$gte' : '$gt']: rule.condition.value };

      const insights = await Insight.find(filter)
        .sort({ [rule.condition.metric]: -1 })
        .limit(3)
        .populate({ path: 'accountId', select: 'username' });

      const delayMs = { 'now': 0, '7d': 7 * 86400000, '30d': 30 * 86400000 }[rule.action.delay] || 0;

      for (const ins of insights) {
        // Skip if already reposted recently (30d guard)
        const thirtyAgo = new Date(Date.now() - 30 * 86400000);
        const alreadyQueued = await Post.findOne({
          caption:     { $regex: ins.igMediaId },
          createdAt:   { $gte: thirtyAgo },
        });
        if (alreadyQueued) continue;

        // Only repost if we have a local thumbnail (means it was fully synced)
        if (!ins.thumbnailUrl?.startsWith('/uploads/')) continue;

        const scheduledAt = new Date(Date.now() + delayMs);
        const accounts = rule.action.targetAccounts?.length
          ? rule.action.targetAccounts
          : [ins.accountId?._id].filter(Boolean);

        if (!accounts.length) continue;

        const post = await Post.create({
          media:       ins.thumbnailUrl.replace('/uploads/', ''),
          mediaType:   'video',
          postType:    'reel',
          caption:     ins.caption || '',
          accounts,
          scheduledAt,
          status:      delayMs > 0 ? 'agendado' : 'pendente',
        });

        if (delayMs === 0) {
          await postQueue.add('post', { postId: String(post._id) });
        }
      }

      rule.runsCount += 1;
      rule.lastRun    = new Date();
      await rule.save();
    } catch (err) {
      console.error(`[repostJob] rule "${rule.name}":`, err.message);
    }
  }
}

let _timer = null;

function startRepostJob() {
  if (_timer) return;
  // Run once after 2 min, then every hour
  setTimeout(async () => {
    try { await runRepostJob(); } catch (e) { console.error('[repostJob]', e.message); }
    _timer = setInterval(async () => {
      try { await runRepostJob(); } catch (e) { console.error('[repostJob]', e.message); }
    }, 60 * 60 * 1000);
  }, 2 * 60 * 1000);
  console.log('[repostJob] iniciado — primeira execução em 2 min');
}

module.exports = { startRepostJob };
