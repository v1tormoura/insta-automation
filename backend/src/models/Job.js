'use strict';

const mongoose = require('mongoose');

const logEntrySchema = new mongoose.Schema({
  time:    { type: Date, default: Date.now },
  message: { type: String, required: true },
  level:   { type: String, enum: ['info', 'success', 'warn', 'error'], default: 'info' },
}, { _id: false });

const jobSchema = new mongoose.Schema({
  name:          { type: String, default: '' },
  type:          { type: String, enum: ['post', 'loop'], default: 'post' },
  status:        {
    type:    String,
    enum:    ['queued', 'running', 'waiting_interval', 'paused', 'completed', 'cancelled', 'failed'],
    default: 'queued',
  },

  // Config de publicação
  accounts:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  mediaFiles:       { type: [String], default: [] },
  postType:         { type: String, enum: ['post', 'reel', 'story'], default: 'reel' },
  caption:          { type: String, default: '' },
  cover:            { type: String, default: '' },
  ctaComment:       { type: String, default: '' },
  engageComment:    { type: String, default: '' },
  processMode:      { type: String, default: 'limpeza_leve' },
  location:         { type: String, default: '' },

  // Controle de rodadas
  intervalMinutes:   { type: Number, default: 0, min: 0 },
  simultaneousLimit: { type: Number, default: 1, min: 1 },
  currentRound:      { type: Number, default: 0 },   // próxima rodada a executar (0-indexed)
  totalRounds:       { type: Number, default: 0 },   // ceil(mediaFiles / simultaneousLimit)
  roundsCompleted:   { type: Number, default: 0 },

  // ID do BullMQ delayed job pendente — usado para cancelar ao pausar
  bullMqJobId: { type: String, default: '' },

  // Progresso
  postsPublished: { type: Number, default: 0 },
  postsErrors:    { type: Number, default: 0 },
  postsTotal:     { type: Number, default: 0 }, // totalRounds * accounts.length

  // Timing
  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
  nextRoundAt: { type: Date, default: null },

  // Post documents criados por este job (um por rodada)
  postIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],

  // Logs em tempo real (mantém os últimos 200)
  logs:      { type: [logEntrySchema], default: [] },
  lastError: { type: String, default: '' },
}, { timestamps: true });

jobSchema.index({ status: 1 });
jobSchema.index({ accounts: 1, status: 1 });
jobSchema.index({ status: 1, nextRoundAt: 1 });

module.exports = mongoose.model('Job', jobSchema);
