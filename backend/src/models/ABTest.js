'use strict';
const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  label:     { type: String, default: 'Variante' },
  coverFile: String,
  postId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  igMediaId: String,
  views:     { type: Number, default: 0 },
  likes:     { type: Number, default: 0 },
  saves:     { type: Number, default: 0 },
  reach:     { type: Number, default: 0 },
  comments:  { type: Number, default: 0 },
}, { _id: false });

const abtestSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  accountId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  caption:       String,
  status:        { type: String, enum: ['pendente','ativo','concluido'], default: 'pendente' },
  variantA:      variantSchema,
  variantB:      variantSchema,
  winner:        { type: String, enum: ['A','B',null], default: null },
  durationHours: { type: Number, default: 48 },
  startedAt:     Date,
  endedAt:       Date,
}, { timestamps: true });

module.exports = mongoose.model('ABTest', abtestSchema);
