'use strict';
const mongoose = require('mongoose');

const renderLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  message:   { type: String, required: true },
  level:     { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
}, { _id: false });

const videoRenderJobSchema = new mongoose.Schema({
  batchId:    { type: mongoose.Schema.Types.ObjectId, ref: 'VideoBatch', required: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoTemplate', required: true },

  inputPath:    { type: String, required: true },
  outputPath:   { type: String, default: '' },
  originalName: { type: String, default: '' },

  status: {
    type: String,
    enum: ['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  },

  variables:   { type: mongoose.Schema.Types.Mixed, default: {} },

  retryCount:  { type: Number, default: 0 },
  maxRetries:  { type: Number, default: 3 },

  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
  duration:    { type: Number, default: 0 },

  error:     { type: String, default: '' },
  errorCode: { type: String, default: '' },

  bullMqJobId: { type: String, default: '' },

  logs: { type: [renderLogSchema], default: [] },

  metrics: {
    renderDuration: { type: Number, default: 0 },
    inputSize:      { type: Number, default: 0 },
    outputSize:     { type: Number, default: 0 },
    outputDuration: { type: Number, default: 0 },
    retries:        { type: Number, default: 0 },
  },
}, { timestamps: true });

videoRenderJobSchema.index({ batchId: 1, status: 1 });
videoRenderJobSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model('VideoRenderJob', videoRenderJobSchema);
