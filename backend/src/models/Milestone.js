'use strict';

const mongoose = require('mongoose');

/**
 * O teto de marco já notificado, por conta + conteúdo + métrica.
 *
 * ── Por que guardar o TETO e não o valor anterior da métrica
 *
 * A alternativa óbvia seria comparar o valor de antes com o de agora e ver o
 * que passou no meio. Ela obriga a capturar o "antes" no caminho de escrita da
 * métrica — mexer no sincronizador — e quebra em três situações reais: duas
 * execuções simultâneas leem o mesmo "antes" e disparam duas vezes; um restart
 * entre a leitura e a gravação perde o marco; e um recálculo de histórico
 * dispararia tudo de novo.
 *
 * Guardar o maior marco JÁ NOTIFICADO resolve os três de uma vez. A pergunta
 * deixa de ser "o que mudou desde a última vez" e passa a ser "o que ainda não
 * foi avisado" — que é idempotente por construção e não depende de ordem, de
 * quantas vezes rodou, nem de o processo ter sobrevivido.
 *
 * ── Sobre o índice único
 *
 * É ele que impede duas notificações do mesmo marco quando dois ciclos se
 * cruzam: o segundo `updateOne` com `upsert` colide, o Mongo devolve E11000, e
 * o detector trata isso como "outro já cuidou" em vez de erro.
 */
const MilestoneSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },

    /**
     * `igMediaId` do post ou do story. Para métricas de conta inteira, a
     * constante 'GLOBAL' — assim a mesma tabela serve aos dois casos sem um
     * campo opcional que só um deles usa.
     */
    contentId: { type: String, required: true },

    metricType: { type: String, required: true },   // storyViews | contentViews | reach

    /** Maior marco já notificado. Nunca desce. */
    maiorDisparado: { type: Number, default: 0, min: 0 },

    /** Último valor observado — só para diagnóstico; a decisão usa o teto. */
    ultimoValor: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'milestones' }
);

MilestoneSchema.index(
  { accountId: 1, contentId: 1, metricType: 1 },
  { unique: true, name: 'marco_unico' }
);

module.exports = mongoose.models.Milestone || mongoose.model('Milestone', MilestoneSchema);
