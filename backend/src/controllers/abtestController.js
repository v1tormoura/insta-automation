'use strict';
const ABTest  = require('../models/ABTest');
const Insight = require('../models/Insight');

exports.list = async (req, res) => {
  try {
    const tests = await ABTest.find()
      .populate('accountId', 'username avatar')
      .sort({ createdAt: -1 });
    res.json(tests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, accountId, caption, durationHours, variantAFile, variantBFile } = req.body;
    if (!name || !accountId) return res.status(400).json({ error: 'name e accountId obrigatórios' });

    const test = await ABTest.create({
      name,
      accountId,
      caption,
      durationHours: durationHours || 48,
      status: 'pendente',
      variantA: { label: 'Variante A', coverFile: variantAFile || '' },
      variantB: { label: 'Variante B', coverFile: variantBFile || '' },
    });
    res.json(test);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id).populate('accountId', 'username avatar');
    if (!test) return res.status(404).json({ error: 'Não encontrado' });

    // Refresh live metrics from Insights if test is active
    if (test.status === 'ativo') {
      const [insA, insB] = await Promise.all([
        test.variantA?.igMediaId ? Insight.findOne({ igMediaId: test.variantA.igMediaId }) : null,
        test.variantB?.igMediaId ? Insight.findOne({ igMediaId: test.variantB.igMediaId }) : null,
      ]);
      if (insA) {
        test.variantA.views    = insA.videoViews || insA.impressions;
        test.variantA.likes    = insA.likeCount;
        test.variantA.saves    = insA.savedCount;
        test.variantA.reach    = insA.reach;
        test.variantA.comments = insA.commentsCount;
      }
      if (insB) {
        test.variantB.views    = insB.videoViews || insB.impressions;
        test.variantB.likes    = insB.likeCount;
        test.variantB.saves    = insB.savedCount;
        test.variantB.reach    = insB.reach;
        test.variantB.comments = insB.commentsCount;
      }
    }
    res.json(test);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.start = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Não encontrado' });
    test.status    = 'ativo';
    test.startedAt = new Date();
    await test.save();
    res.json(test);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.end = async (req, res) => {
  try {
    const test = await ABTest.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Não encontrado' });

    const scoreA = (test.variantA?.views || 0) * 0.1 + (test.variantA?.likes || 0) + (test.variantA?.saves || 0) * 4;
    const scoreB = (test.variantB?.views || 0) * 0.1 + (test.variantB?.likes || 0) + (test.variantB?.saves || 0) * 4;

    test.status  = 'concluido';
    test.winner  = scoreA >= scoreB ? 'A' : 'B';
    test.endedAt = new Date();
    await test.save();
    res.json(test);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await ABTest.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
