'use strict';

const mongoose = require('mongoose');

const apiLogSchema = new mongoose.Schema({
  accountId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
  endpoint:   { type: String, required: true },
  method:     { type: String, default: 'GET' },
  statusCode: { type: Number, default: 200 },
  success:    { type: Boolean, default: true },
  errorCode:  { type: Number, default: null },
  durationMs: { type: Number, default: 0 },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false });

// TTL index: documentos expiram automaticamente após 30 dias
apiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
apiLogSchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model('ApiLog', apiLogSchema);
