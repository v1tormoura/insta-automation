'use strict';

const mongoose = require('mongoose');

const loopSchema = new mongoose.Schema({
  name:            { type: String, default: '' },
  accounts:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  folder:          { type: String, default: 'default' },
  mediaFiles:      { type: [String], default: [] }, // filenames selecionados
  type:            { type: String, enum: ['reel', 'story', 'post'], default: 'reel' },
  intervalMinutes: { type: Number, default: 60, min: 1 },
  caption:         { type: String, default: '' },

  // estado
  status:       { type: String, enum: ['ativo', 'pausado', 'erro'], default: 'ativo' },
  currentIndex: { type: Number, default: 0 }, // próximo índice da fila de mídias
  postsCount:   { type: Number, default: 0 },  // total de posts gerados
  lastRunAt:    { type: Date, default: null },
  nextRunAt:    { type: Date, default: null },
  lastError:    { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Loop', loopSchema);
