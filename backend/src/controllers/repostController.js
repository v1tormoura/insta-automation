'use strict';
const RepostRule = require('../models/RepostRule');
const Insight    = require('../models/Insight');

exports.listRules = async (req, res) => {
  try {
    const rules = await RepostRule.find().sort({ createdAt: -1 });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createRule = async (req, res) => {
  try {
    const rule = await RepostRule.create(req.body);
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleRule = async (req, res) => {
  try {
    const rule = await RepostRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Não encontrado' });
    rule.active = !rule.active;
    await rule.save();
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const rule = await RepostRule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!rule) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteRule = async (req, res) => {
  try {
    await RepostRule.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getQueue = async (req, res) => {
  try {
    const rules = await RepostRule.find({ active: true });
    const queue = [];
    const seen  = new Set();

    for (const rule of rules) {
      const days  = { '30d': 30, 'all': 3650, '7d': 7 }[rule.condition.period] || 7;
      const since = new Date(Date.now() - days * 86400000);

      const filter = { postedAt: { $gte: since } };
      filter[rule.condition.metric] = { $gt: rule.condition.value };

      const insights = await Insight.find(filter)
        .sort({ [rule.condition.metric]: -1 })
        .limit(5)
        .select('username igMediaId videoViews likeCount savedCount postedAt thumbnailUrl caption');

      const delayMs = { 'now': 0, '7d': 7 * 86400000, '30d': 30 * 86400000 }[rule.action.delay] || 0;

      for (const ins of insights) {
        if (seen.has(ins.igMediaId)) continue;
        seen.add(ins.igMediaId);
        queue.push({
          ruleId:       rule._id,
          ruleName:     rule.name,
          igMediaId:    ins.igMediaId,
          username:     ins.username,
          caption:      (ins.caption || '').slice(0, 80),
          thumbnailUrl: ins.thumbnailUrl,
          views:        ins.videoViews,
          likes:        ins.likeCount,
          saves:        ins.savedCount,
          scheduledAt:  new Date(Date.now() + delayMs),
        });
      }
    }

    queue.sort((a, b) => a.scheduledAt - b.scheduledAt);
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const [total, active] = await Promise.all([
      RepostRule.countDocuments(),
      RepostRule.countDocuments({ active: true }),
    ]);
    res.json({ totalRules: total, activeRules: active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
