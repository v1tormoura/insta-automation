'use strict';
const VideoTemplate = require('../models/VideoTemplate');

exports.list = async (req, res) => {
  try {
    const templates = await VideoTemplate.find({ isActive: true }).sort({ createdAt: -1 }).limit(100);
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const tmpl = await VideoTemplate.findById(req.params.id);
    if (!tmpl) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(tmpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const tmpl = await VideoTemplate.create(req.body);
    res.status(201).json(tmpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { _id, createdAt, updatedAt, usageCount, ...body } = req.body;
    const tmpl = await VideoTemplate.findByIdAndUpdate(
      req.params.id,
      { ...body, $inc: { version: 1 } },
      { new: true, runValidators: true }
    );
    if (!tmpl) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(tmpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await VideoTemplate.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.duplicate = async (req, res) => {
  try {
    const src = await VideoTemplate.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ error: 'Template não encontrado' });
    const { _id, createdAt, updatedAt, ...body } = src;
    body.name = `${src.name} (cópia)`;
    body.version = 1;
    body.usageCount = 0;
    const copy = await VideoTemplate.create(body);
    res.status(201).json(copy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
