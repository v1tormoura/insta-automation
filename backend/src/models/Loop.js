'use strict';

const mongoose = require('mongoose');

const loopSchema = new mongoose.Schema({
  name:            { type: String, default: '' },
  accounts:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  folder:          { type: String, default: 'default' },
  mediaFiles:      { type: [String], default: [] }, // filenames selecionados
  type:            { type: String, enum: ['reel', 'story', 'post'], default: 'reel' },
  intervalMinutes: { type: Number, default: 60, min: 1 },

  /* Como o vídeo é tratado antes de subir.
     O controller já gravava este campo, mas ele não existia aqui — e o
     Mongoose descarta em silêncio o que não está no schema. Quem escolhia
     "Humanizador" na tela via a escolha desaparecer entre o clique e o banco.
     `humanizador` como padrão: é o único modo que varia o arquivo em várias
     dimensões, e sem variação todas as contas sobem bytes idênticos. */
  processMode: {
    type: String,
    enum: ['sem_limpeza', 'limpeza_leve', 'ultra_clean', 'humanizador'],
    default: 'humanizador',
  },
  caption:         { type: String, default: '' },
  coverFile:       { type: String, default: '' },
  ctaComment:      { type: String, default: '' }, // comentário auto-postado ~2min após publicar
  engageComment:   { type: String, default: '' }, // pergunta de engajamento postada ~60min após publicar

  // estado
  status:       { type: String, enum: ['ativo', 'pausado', 'inativo', 'erro'], default: 'ativo' },
  currentIndex: { type: Number, default: 0 }, // próximo índice da fila de mídias
  postsCount:   { type: Number, default: 0 },  // total de posts gerados
  lastRunAt:    { type: Date, default: null },
  nextRunAt:    { type: Date, default: null },
  lastError:    { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Loop', loopSchema);
