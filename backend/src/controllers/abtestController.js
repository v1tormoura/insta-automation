'use strict';
const ABTest  = require('../models/ABTest');
const Account = require('../models/Account');
const Insight = require('../models/Insight');

/* fetch live metrics for a media id via Graph API */
async function liveMetrics(igMediaId, accessToken) {
  try {
    const [mRes, iRes] = await Promise.all([
      fetch(`https://graph.instagram.com/v21.0/${igMediaId}?fields=like_count,comments_count,thumbnail_url,permalink,media_type&access_token=${accessToken}`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://graph.instagram.com/v21.0/${igMediaId}/insights?metric=reach,saved,video_views,plays&period=lifetime&access_token=${accessToken}`, { signal: AbortSignal.timeout(10000) }),
    ]);
    const m = mRes.ok  ? await mRes.json() : {};
    const i = iRes.ok  ? await iRes.json() : {};
    const g = (name)  => i.data?.find(x => x.name === name)?.values?.[0]?.value || 0;
    return {
      likes:        m.like_count     || 0,
      comments:     m.comments_count || 0,
      reach:        g('reach'),
      saves:        g('saved'),
      views:        g('video_views') || g('plays'),
      thumbnailUrl: m.thumbnail_url  || '',
      permalink:    m.permalink      || '',
    };
  } catch { return {}; }
}

exports.list = async (req, res) => {
  try {
    const tests = await ABTest.find()
      .populate('accountId', 'username avatar')
      .sort({ createdAt: -1 });
    res.json(tests);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { name, accountId, igMediaIdA, igMediaIdB, durationHours } = req.body;
    if (!name || !accountId || !igMediaIdA || !igMediaIdB)
      return res.status(400).json({ error: 'name, accountId, igMediaIdA e igMediaIdB são obrigatórios' });

    const test = await ABTest.create({
      name, accountId,
      durationHours: Number(durationHours) || 48,
      status:   'pendente',
      variantA: { label: 'Variante A', igMediaId: igMediaIdA.trim() },
      variantB: { label: 'Variante B', igMediaId: igMediaIdB.trim() },
    });
    res.json(await ABTest.findById(test._id).populate('accountId', 'username avatar'));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.get = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id).populate('accountId', 'username avatar accessToken');
    if (!test) return res.status(404).json({ error: 'Não encontrado' });

    if (test.status === 'ativo') {
      const token = test.accountId?.accessToken;

      /* try local insights first, then Graph API */
      const [insA, insB] = await Promise.all([
        test.variantA?.igMediaId ? Insight.findOne({ igMediaId: test.variantA.igMediaId }) : null,
        test.variantB?.igMediaId ? Insight.findOne({ igMediaId: test.variantB.igMediaId }) : null,
      ]);

      const fromIns = (ins) => ins ? {
        views:    ins.videoViews || ins.impressions || 0,
        likes:    ins.likeCount    || 0,
        saves:    ins.savedCount   || 0,
        reach:    ins.reach        || 0,
        comments: ins.commentsCount|| 0,
      } : null;

      const [mA, mB] = await Promise.all([
        fromIns(insA) || (token && test.variantA?.igMediaId ? liveMetrics(test.variantA.igMediaId, token) : {}),
        fromIns(insB) || (token && test.variantB?.igMediaId ? liveMetrics(test.variantB.igMediaId, token) : {}),
      ]);

      if (mA && Object.keys(mA).length) Object.assign(test.variantA, mA);
      if (mB && Object.keys(mB).length) Object.assign(test.variantB, mB);
    }
    res.json(test);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.start = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Não encontrado' });

    /* try to fetch initial metrics when starting */
    const account = await Account.findById(test.accountId);
    if (account?.accessToken) {
      const [mA, mB] = await Promise.all([
        test.variantA?.igMediaId ? liveMetrics(test.variantA.igMediaId, account.accessToken) : {},
        test.variantB?.igMediaId ? liveMetrics(test.variantB.igMediaId, account.accessToken) : {},
      ]);
      if (mA.likes !== undefined) Object.assign(test.variantA, mA);
      if (mB.likes !== undefined) Object.assign(test.variantB, mB);
    }

    test.status    = 'ativo';
    test.startedAt = new Date();
    await test.save();
    res.json(await ABTest.findById(test._id).populate('accountId', 'username avatar'));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.end = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Não encontrado' });

    const score = (v) => (v?.views || 0) * 0.1 + (v?.likes || 0) + (v?.saves || 0) * 4 + (v?.comments || 0) * 2;
    test.status  = 'concluido';
    test.winner  = score(test.variantA) >= score(test.variantB) ? 'A' : 'B';
    test.endedAt = new Date();
    await test.save();
    res.json(await ABTest.findById(test._id).populate('accountId', 'username avatar'));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    await ABTest.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
