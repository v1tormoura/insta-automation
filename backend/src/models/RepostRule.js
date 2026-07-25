'use strict';
const mongoose = require('mongoose');

const repostRuleSchema = new mongoose.Schema({
  name:   { type: String, required: true },
  active: { type: Boolean, default: true },
  condition: {
    metric:   { type: String, enum: ['videoViews','engagementScore','savedCount','likeCount'], default: 'videoViews' },
    operator: { type: String, enum: ['gt','gte'], default: 'gt' },
    value:    { type: Number, default: 50000 },
    period:   { type: String, enum: ['7d','30d','all'], default: '7d' },
  },
  action: {
    delay:          { type: String, enum: ['now','7d','30d'], default: '7d' },
    targetAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  },
  lastRun:   Date,
  runsCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('RepostRule', repostRuleSchema);
