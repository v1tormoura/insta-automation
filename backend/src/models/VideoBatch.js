'use strict';
const mongoose = require('mongoose');

const videoBatchSchema = new mongoose.Schema({
  name:             { type: String, required: true },
  templateId:       { type: mongoose.Schema.Types.ObjectId, ref: 'VideoTemplate', required: true },
  templateSnapshot: { type: mongoose.Schema.Types.Mixed },
  templateVersion:  { type: Number, default: 1 },

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  },

  totalJobs:      { type: Number, default: 0 },
  completedJobs:  { type: Number, default: 0 },
  failedJobs:     { type: Number, default: 0 },
  processingJobs: { type: Number, default: 0 },
  pendingJobs:    { type: Number, default: 0 },

  quality:          { type: String, enum: ['fast', 'balanced', 'high'], default: 'balanced' },
  concurrency:      { type: Number, default: 2 },
  defaultVariables: { type: mongoose.Schema.Types.Mixed, default: {} },

  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },

  logs: [{
    time:    { type: Date, default: Date.now },
    message: { type: String },
    level:   { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
  }],
}, { timestamps: true });

videoBatchSchema.index({ status: 1, createdAt: -1 });
videoBatchSchema.index({ templateId: 1 });

module.exports = mongoose.model('VideoBatch', videoBatchSchema);
