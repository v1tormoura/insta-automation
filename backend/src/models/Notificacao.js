'use strict';

const mongoose = require('mongoose');

/**
 * Notificação persistida — o histórico da Central.
 *
 * ── Por que o texto fica gravado, e não só os dados
 *
 * A tentação é guardar `{ threshold: 1000, metricType: 'storyViews' }` e
 * renderizar o texto na hora de exibir. Mas o texto vem de um modelo editável
 * pelo usuário: se ele reescrever a mensagem amanhã, todo o histórico mudaria
 * de redação retroativamente — e uma notificação de três semanas atrás passaria
 * a dizer algo que nunca disse.
 *
 * Guardar o texto já renderizado torna o histórico um registro do que de fato
 * apareceu na tela. Os dados brutos ficam em `metadados` para quem precisar
 * reprocessar.
 */
const NotificacaoSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null, index: true },
    username:  { type: String, default: '' },
    avatar:    { type: String, default: '' },

    contentId:  { type: String, default: '' },
    eventType:  { type: String, required: true },   // milestone | resumo | sistema
    metricType: { type: String, default: '' },
    threshold:  { type: Number, default: 0 },

    /** Aparência: success | achievement | info | warning | milestone | viral | story | reach */
    tema:      { type: String, default: 'milestone' },
    prioridade:{ type: String, default: 'normal' },  // baixa | normal | alta

    titulo:   { type: String, required: true },
    mensagem: { type: String, default: '' },

    /** Cru, para reprocessar ou depurar. Nunca exibido direto. */
    metadados: { type: mongoose.Schema.Types.Mixed, default: {} },

    /** null = não lida. Data = quando foi lida. */
    lidaEm: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'criadaEm', updatedAt: false }, collection: 'notificacoes' }
);

/* A Central abre ordenando por data e filtrando por não-lidas: os dois campos
   juntos, nessa ordem, servem a consulta inteira pelo índice. */
NotificacaoSchema.index({ lidaEm: 1, criadaEm: -1 });
NotificacaoSchema.index({ accountId: 1, criadaEm: -1 });

/* Um marco nunca gera duas linhas. O índice único é a segunda barreira — a
   primeira é o teto em Milestone — e existe porque duas barreiras contra
   duplicata custam pouco e a alternativa é o usuário ver a mesma conquista
   duas vezes, que é exatamente o que este módulo promete não fazer.

   Parcial: só vale para evento de marco. Resumo e aviso de sistema não têm
   threshold e ficariam todos colidindo em (null, null, 0). */
NotificacaoSchema.index(
  { accountId: 1, contentId: 1, metricType: 1, threshold: 1 },
  {
    unique: true,
    name: 'marco_notificado_unico',
    partialFilterExpression: { eventType: 'milestone' },
  }
);

module.exports = mongoose.models.Notificacao || mongoose.model('Notificacao', NotificacaoSchema);
