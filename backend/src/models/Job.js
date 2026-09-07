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

  /* ── Como a fila foi ordenada ─────────────────────────────────────────────

     `mediaFiles` já sai ordenado da criação — o worker apenas caminha por ele.
     Estes três campos ficam para o registro: sem eles não há como responder
     "por que a fila saiu nessa ordem" depois, e a ordem aleatória em especial
     seria irreproduzível.

     Estar no schema não é detalhe: o Mongoose DESCARTA em silêncio o que não
     está declarado aqui. Foi assim que `processMode` sumia entre o clique e o
     banco no Loop, e quem escolhia "Humanizador" via a escolha evaporar. */
  ordemDasMidias:   { type: String, enum: ['antigos_primeiro', 'recentes_primeiro', 'selecao'], default: 'antigos_primeiro' },
  midiasAleatorias: { type: Boolean, default: false },
  sementeDaOrdem:   { type: String, default: '' },

  /* Marca d'água com o @ de cada conta.
     `ativa: false` desliga tudo e é o padrão — nada muda para quem não pediu.
     O texto NÃO é guardado aqui: ele é o @ de cada conta, resolvido na hora de
     publicar. Guardá-lo faria a marca de uma conta aparecer no vídeo de outra. */
  marcaDagua: {
    ativa:     { type: Boolean, default: false },
    opacidade: { type: Number, default: 40, min: 5, max: 100 },
    posicao:   { type: String, enum: ['superior', 'centro', 'inferior'], default: 'centro' },
    tamanho:   { type: String, enum: ['pequena', 'media', 'grande'], default: 'pequena' },
  },

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
