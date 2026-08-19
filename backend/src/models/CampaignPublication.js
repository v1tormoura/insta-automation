'use strict';

const mongoose = require('mongoose');

/**
 * Publicação individual de uma campanha — uma conta, um conteúdo, um horário.
 *
 * É a unidade de execução. Cada linha é independente, e é isso que viabiliza
 * retry individual, pausa, cancelamento e recuperação após restart sem
 * reprocessar a campanha inteira.
 *
 * Cadeia (decisão 2): Campaign → CampaignPublication → Post → histórico atual.
 * O Post é criado na execução e vinculado por postId, preservando a tela de
 * Posts e o histórico por publicação que já existe hoje.
 *
 * Templates ficam BRUTOS em captionTemplate/commentTemplate. As variáveis
 * ({username}, {campaign}…) são resolvidas na execução pelo templateResolver, e
 * o texto final é gravado em resolvedCaption/resolvedComment — assim fica
 * registrado o que foi de fato publicado, sem perder o template de origem.
 */
const campaignPublicationSchema = new mongoose.Schema({
  campaignId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Campaign',
    required: true,
  },

  accountId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Account',
    required: true,
  },
  contentId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Media',
    required: true,
  },

  // Preenchido na execução: o Post criado para esta publicação.
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

  // Vínculo opcional com um Job do engine, caso a fase 8 opte por agrupar
  // publicações sob um Job guarda-chuva. Nulo na execução item a item.
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },

  // Id do job atrasado no BullMQ. Necessário para cancelar ou reagendar sem
  // varrer a fila — mesmo papel do bullMqJobId em Job.js.
  bullMqJobId: { type: String, default: '' },

  // Posição no plano (1-indexed). Dá ordem estável à prévia e aos logs, sem
  // depender de ordenação por horário quando dois itens coincidem.
  order: { type: Number, default: 0, min: 0 },

  scheduledAt: { type: Date, required: true },

  captionTemplate: { type: String, default: '' },
  commentTemplate: { type: String, default: '' },
  resolvedCaption: { type: String, default: '' },
  resolvedComment: { type: String, default: '' },

  status: {
    type: String,
    enum: [
      'pending',    // no plano, ainda não enfileirada
      'scheduled',  // enfileirada no BullMQ com atraso
      'processing',
      'published',
      'failed',
      'cancelled',
    ],
    default: 'pending',
  },

  attempts:    { type: Number, default: 0, min: 0 },
  error:       { type: String, default: '' },
  // Categoria do último erro (SESSION_EXPIRED, RATE_LIMITED…). Guardada separada
  // da mensagem para o painel filtrar e agrupar sem casar texto livre.
  errorCode:   { type: String, default: '' },
  publishedAt: { type: Date,   default: null },

  // Id da mídia criada no Instagram, devolvido pela própria publicação.
  //
  // É o que amarra o comentário à publicação certa. Sem ele o comentário teria
  // de procurar "a mídia mais recente da conta" — e numa campanha, onde a mesma
  // conta publica várias vezes, a mais recente frequentemente não é a que se
  // quer comentar.
  //
  // Formato instagrapi: "pk_userid" quando disponível (evita uma requisição
  // extra em media_comment); Graph API: o id devolvido pelo publish.
  // Vazio quando a via de publicação não expõe o id (Private API).
  instagramMediaId: { type: String, default: '' },

  /* ── Comentário ──────────────────────────────────────────────────────────
   * O comentário é uma tarefa PRÓPRIA, agendada depois que o post sai. Por
   * isso tem estado separado: uma publicação pode estar 'published' com o
   * comentário ainda 'scheduled', e uma falha ao comentar não pode reverter
   * uma publicação que já saiu.
   */
  commentStatus: {
    type: String,
    enum: ['none', 'scheduled', 'posted', 'failed', 'cancelled'],
    default: 'none',
  },
  commentJobId:    { type: String, default: '' },
  commentPostedAt: { type: Date,   default: null },
  commentError:    { type: String, default: '' },
  // Categoria do erro do comentário, separada da publicação: comentar pode
  // falhar por RATE_LIMITED enquanto a publicação saiu perfeitamente.
  commentErrorCode: { type: String, default: '' },
  // Id do comentário criado — evidência de que saiu, e permite conferir depois.
  commentId:        { type: String, default: '' },
  commentAttempts:  { type: Number, default: 0, min: 0 },
}, { timestamps: true });

/* ── Índices ───────────────────────────────────────────────────────────────── */

// Painel da campanha: contagem por status e listagem filtrada.
campaignPublicationSchema.index({ campaignId: 1, status: 1 });

// "Próximas publicações" e ordenação do plano.
campaignPublicationSchema.index({ campaignId: 1, scheduledAt: 1 });

// Agenda de uma conta — usado ao checar carga e limite diário por conta.
campaignPublicationSchema.index({ accountId: 1, scheduledAt: 1 });

// Recuperação após restart: pendentes/agendadas cujo horário já passou.
campaignPublicationSchema.index({ status: 1, scheduledAt: 1 });

// Comentários pendentes — usado pela recuperação após restart.
campaignPublicationSchema.index({ commentStatus: 1 });

// Busca a partir do id da mídia (suporte, conferência de duplicidade).
// Esparso porque a maioria das linhas fica sem valor até publicar.
campaignPublicationSchema.index({ instagramMediaId: 1 }, { sparse: true });

// Busca reversa a partir da fila e do histórico.
campaignPublicationSchema.index({ bullMqJobId: 1 });
campaignPublicationSchema.index({ postId: 1 });
campaignPublicationSchema.index({ jobId: 1 });

// Impede a mesma combinação conta+conteúdo duas vezes na mesma campanha
// (decisão 1). Não conflita com retry, que reaproveita a linha e incrementa
// attempts, nem com duplicar campanha, que gera outro campaignId.
//
// ATENÇÃO: um modo futuro que repita o mesmo conteúdo para a mesma conta dentro
// da campanha exigirá remover este índice — está registrado no relatório da fase.
campaignPublicationSchema.index(
  { campaignId: 1, accountId: 1, contentId: 1 },
  { unique: true }
);

module.exports = mongoose.models.CampaignPublication
  || mongoose.model('CampaignPublication', campaignPublicationSchema);
