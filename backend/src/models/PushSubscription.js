'use strict';

const mongoose = require('mongoose');

/**
 * Inscrição de Web Push — um documento por APARELHO, não por usuário.
 *
 * ── Por que por aparelho
 *
 * A mesma pessoa usa o painel no computador e no celular, e cada navegador
 * gera a sua própria inscrição com endpoint e chaves próprios. Guardar "a
 * inscrição do usuário" faria o segundo aparelho apagar o primeiro, e a
 * notificação chegaria só no último lugar onde alguém ativou.
 *
 * ── Por que o endpoint é a identidade
 *
 * O endpoint é a URL que o serviço de push do navegador gera, e é única por
 * inscrição. Usá-lo como chave única resolve o caso comum de reativar no mesmo
 * aparelho: o navegador devolve o mesmo endpoint, o upsert atualiza em vez de
 * duplicar, e a pessoa não recebe a mesma notificação duas vezes.
 *
 * ── Sobre as chaves
 *
 * `p256dh` e `auth` são material criptográfico do NAVEGADOR, usados para
 * cifrar o payload de forma que só aquele aparelho consiga ler. Não são
 * segredo nosso e não dão acesso a nada — mas também não servem para mais
 * nada, então não vão para log nem para resposta de API.
 */
const PushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: { type: String, required: true, unique: true, index: true },

    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },

    /* Só para a pessoa reconhecer o aparelho na hora de remover um. */
    aparelho: { type: String, default: '' },

    /**
     * Quantas entregas seguidas falharam sem ser erro definitivo.
     *
     * Erro definitivo (410 Gone, 404) apaga na hora — o navegador avisou que a
     * inscrição morreu. Falha transitória (rede, 500 do serviço de push) só
     * conta: apagar na primeira faria uma instabilidade de dez minutos
     * desinscrever todo mundo em silêncio.
     */
    falhas: { type: Number, default: 0 },

    ultimoEnvio: { type: Date, default: null },
  },
  { timestamps: true, collection: 'pushsubscriptions' }
);

module.exports = mongoose.models.PushSubscription
  || mongoose.model('PushSubscription', PushSubscriptionSchema);
