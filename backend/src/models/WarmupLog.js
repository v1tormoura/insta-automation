'use strict';
const mongoose = require('mongoose');

const WarmupLogSchema = new mongoose.Schema({
  accountId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  username:     { type: String, required: true },
  action:       { type: String, enum: ['like', 'comment', 'follow', 'cycle_start', 'cycle_done', 'error'], required: true },
  detail:       { type: String, default: '' },
  targetUser:   { type: String, default: '' },
  targetPostId: { type: String, default: '' },
  status:       { type: String, enum: ['success', 'error', 'info'], default: 'success' },
  errorMsg:     { type: String, default: '' },
}, { timestamps: true });

// Keep only last 500 logs per account (TTL-style cleanup happens on insert)
WarmupLogSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model('WarmupLog', WarmupLogSchema);
