'use strict';

const mongoose = require('mongoose');

/**
 * Linha do tempo de uma campanha.
 *
 * ── Por que persistir o que já ia para o log
 *
 * Os eventos existiam e iam só para `console.log`. Isso serve para quem tem
 * acesso ao terminal do servidor no momento em que a coisa acontece — e não
 * serve para mais ninguém, nem para o mesmo alguém no dia seguinte.
 *
 * A pergunta que se faz de uma campanha que não publicou é sempre a mesma:
 * "o que aconteceu?". Sem histórico, a resposta disponível é o estado final —
 * "falhou" — que diz o resultado e esconde o caminho. Com histórico, dá para
 * ver que as três primeiras publicaram, a quarta pegou 407, e as demais nem
 * chegaram a tentar.
 *
 * ── Por que não é o log de aplicação
 *
 * Log de aplicação mistura tudo e é apagado por rotação. Aqui é uma tabela
 * própria, consultável por campanha e por publicação, e é o que a tela mostra.
 *
 * ── Por que expira
 *
 * Uma campanha grande gera centenas de eventos, e o valor deles cai rápido:
 * depois de trinta dias, o que importa já virou o resultado. O índice TTL
 * limpa sozinho — sem ele, esta coleção cresceria para sempre e ninguém
 * lembraria de podá-la.
 */
const CampaignEventSchema = new mongoose.Schema(
  {
    campaignId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    publicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignPublication', default: null },
    accountId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },

    /** PUBLICATION_STARTED, PUBLICATION_OK, PUBLICATION_FAILED, COMMENT_OK… */
    evento: { type: String, required: true, index: true },

    /* O código separa causa de mensagem. `PROXY_ERROR` em quinze eventos
       seguidos é uma frase que aponta a causa sozinha; quinze mensagens
       diferentes com o mesmo sentido, não. */
    errorCode:  { type: String, default: '' },
    error:      { type: String, default: '' },

    mediaId:    { type: String, default: '' },
    attempt:    { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },

    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'campaignevents' }
);

/* A tela abre por campanha, do mais recente para o mais antigo. */
CampaignEventSchema.index({ campaignId: 1, criadoEm: -1 });

/* Trinta dias. Sem TTL, esta coleção cresce para sempre — e a poda manual é
   sempre aquilo que ninguém lembra de fazer até o disco encher. */
CampaignEventSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.models.CampaignEvent || mongoose.model('CampaignEvent', CampaignEventSchema);
