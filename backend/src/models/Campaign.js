'use strict';

const mongoose = require('mongoose');

/**
 * Campanha — planejador de publicações distribuídas.
 *
 * Guarda a CONFIGURAÇÃO da campanha. As publicações concretas ficam em
 * CampaignPublication, uma por combinação conta × conteúdo, geradas pelo
 * PublicationPlanner (fase 3).
 *
 * Princípio de modelagem: aqui só entram IDs e configuração. Dados de Account e
 * Media são buscados na exibição — duplicá-los aqui criaria cópias que envelhecem
 * (username trocado, mídia removida) e divergem da fonte.
 */

/* ── Estratégia de distribuição ────────────────────────────────────────────── */
const strategySchema = new mongoose.Schema({
  // Nomes alinhados com os modos implementados no publicationPlanner (fase 3).
  mode: {
    type:    String,
    enum:    ['interleaved_random', 'sequential', 'round_robin', 'account_first', 'manual'],
    default: 'interleaved_random',
  },
  // Semente do gerador pseudoaleatório do planner. Fixá-la torna o plano
  // reproduzível e auditável: a mesma campanha sempre gera a mesma sequência.
  seed: { type: String, default: '' },
}, { _id: false });

/* ── Janela e intervalos ───────────────────────────────────────────────────── */
const scheduleSchema = new mongoose.Schema({
  // Momento em que a primeira publicação pode ocorrer. Nulo = imediatamente.
  startAt: { type: Date, default: null },

  // Intervalo entre publicações consecutivas do plano, em minutos.
  // Com useFixedInterval, apenas fixedIntervalMinutes é considerado.
  intervalMinMinutes: { type: Number, default: 12, min: 0 },
  intervalMaxMinutes: { type: Number, default: 28, min: 0 },

  useFixedInterval:     { type: Boolean, default: false },
  fixedIntervalMinutes: { type: Number,  default: 30, min: 1 },

  // Janela diária no formato "HH:MM". Vazio nos dois = sem restrição de horário.
  windowStart: { type: String, default: '' },
  windowEnd:   { type: String, default: '' },

  // Dias da semana permitidos (0 = domingo … 6 = sábado).
  // Vazio = todos os dias.
  weekdays: { type: [Number], default: [] },
}, { _id: false });

/* ── Legendas ──────────────────────────────────────────────────────────────── */
//
// Os templates ficam guardados aqui em estado BRUTO, com as variáveis
// ({username}, {campaign}…) ainda não resolvidas. O planner escolhe qual
// template aplicar a cada publicação conforme o captionMode e copia para a
// CampaignPublication; a resolução das variáveis acontece só na execução.
//
// As chaves dos Maps são strings de ObjectId (hex — nunca contêm ponto, que o
// Mongoose proíbe em chave de Map). A chave composta usa "__" pelo mesmo motivo.
const captionsSchema = new mongoose.Schema({
  global:           { type: String, default: '' },
  byAccount:        { type: Map, of: String, default: () => new Map() }, // accountId → template
  byContent:        { type: Map, of: String, default: () => new Map() }, // contentId → template
  byAccountContent: { type: Map, of: String, default: () => new Map() }, // `${accountId}__${contentId}`
}, { _id: false });

/* ── Comentários ───────────────────────────────────────────────────────────── */
// Mesma estrutura das legendas: o planner resolve comentário pela mesma
// prioridade (conta+conteúdo → conta → conteúdo → geral). byContent e
// byAccountContent faltavam aqui, então o Mongoose os descartava em silêncio e
// os dois níveis nunca chegavam ao planner.
const commentsSchema = new mongoose.Schema({
  global:           { type: String, default: '' },
  byAccount:        { type: Map, of: String, default: () => new Map() },
  byContent:        { type: Map, of: String, default: () => new Map() },
  byAccountContent: { type: Map, of: String, default: () => new Map() },
  // Atraso entre a publicação e o comentário. A execução (fase 8) deve agendar
  // um job com este atraso, nunca dormir dentro do worker.
  delayMinutes: { type: Number, default: 2, min: 0 },
}, { _id: false });

/* ── Configurações gerais ──────────────────────────────────────────────────── */
const settingsSchema = new mongoose.Schema({
  // Cobertura: como conteúdos são atribuídos às contas.
  // Hoje só 'all_accounts_all_contents' é implementado (decisão 1). Os demais
  // valores existem para o planner evoluir sem migração de schema.
  coverage: {
    mode: {
      type:    String,
      enum:    ['all_accounts_all_contents', 'max_per_account', 'custom', 'manual'],
      default: 'all_accounts_all_contents',
    },
    // Usado apenas por 'max_per_account'. Nulo = sem teto próprio.
    maxContentsPerAccount: { type: Number, default: null, min: 1 },
  },

  // Camada 1 da proteção de limite diário: o planner não gera mais publicações
  // do que a conta ainda pode receber hoje. A camada 2 (checkDailyLimit na
  // execução) permanece ativa e independente.
  respectDailyLimit: { type: Boolean, default: true },

  // Repassados a cada publicação — mesmos valores aceitos por Job/Post.
  postType:    { type: String, enum: ['post', 'reel', 'story'], default: 'reel' },
  processMode: { type: String, default: 'limpeza_leve' },
  location:    { type: String, default: '' },
}, { _id: false });

/* ── Campanha ──────────────────────────────────────────────────────────────── */
const campaignSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  status: {
    type: String,
    enum: [
      'draft',      // em criação pelo wizard
      'planning',   // plano sendo gerado
      'scheduled',  // plano gerado, aguardando o primeiro horário
      'running',
      'paused',
      'completed',  // todas publicadas
      'partial',    // terminou com parte falhando
      'failed',     // nenhuma publicou
      'cancelled',
    ],
    default: 'draft',
  },

  // Participantes escolhidos no momento da criação. Guardar os IDs preserva a
  // seleção mesmo que a conta mude de estado depois.
  accountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
  contentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media' }],

  strategy: { type: strategySchema, default: () => ({}) },
  schedule: { type: scheduleSchema, default: () => ({}) },

  captionMode: {
    type:    String,
    enum:    ['global', 'per_account', 'per_content', 'per_account_content'],
    default: 'global',
  },
  commentMode: {
    type:    String,
    // per_content e per_account_content foram adicionados para acompanhar o que
    // o planner já resolvia. per_publication permanece por compatibilidade.
    enum:    ['disabled', 'global', 'per_account', 'per_content', 'per_account_content', 'per_publication'],
    default: 'disabled',
  },

  captions: { type: captionsSchema, default: () => ({}) },
  comments: { type: commentsSchema, default: () => ({}) },
  settings: { type: settingsSchema, default: () => ({}) },

  // Contadores desnormalizados — evitam contar CampaignPublication a cada
  // abertura do painel. A execução (fase 8) mantém em dia.
  totalPublications:     { type: Number, default: 0, min: 0 },
  pendingPublications:   { type: Number, default: 0, min: 0 },
  publishedPublications: { type: Number, default: 0, min: 0 },
  failedPublications:    { type: Number, default: 0, min: 0 },

  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
