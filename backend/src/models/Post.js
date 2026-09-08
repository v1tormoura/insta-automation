const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    media: {
      type: String,
      required: true,
    },

    cover: {
      type: String,
      default: '',
    },

    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },

    postType: {
      type: String,
      enum: ['post', 'reel', 'story'],
      default: 'post',
    },

    caption: {
      type: String,
      default: '',
    },

    ctaComment: {
      type: String,
      default: '',
    },

    storyLink: {
      type: String,
      default: '',
    },

    storyLinkText: {
      type: String,
      default: '',
    },

    location: {
      type: String,
      default: '',
    },

    processMode: {
      type: String,
      enum: ['sem_limpeza', 'limpeza_leve', 'ultra_clean', 'humanizador'],
      default: 'limpeza_leve',
    },

    /* ── De onde esta publicação veio ─────────────────────────────────────

       O Post não sabia dizer a que envio pertencia. Quem olhava a fila via
       trinta linhas iguais, todas de contas diferentes, sem como agrupar por
       "aquele lote que eu disparei ontem" — a informação existia no Job e
       nunca descia para cá.

       `jobName` é copiado, não só referenciado: o nome é o que a fila mostra,
       e um `populate` por linha para buscar uma string seria uma consulta por
       linha. O `jobId` fica para o filtro e para o vínculo continuar válido se
       o nome mudar. */
    jobId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null, index: true },
    jobName: { type: String, default: '' },

    /* ── O id da mídia no Instagram ───────────────────────────────────────

       O elo que faltava. A publicação SEMPRE devolveu este id — as duas vias
       o retornam, e a campanha já o usava para comentar — e o Post nunca o
       guardava. Sem ele não havia como ligar uma linha da fila às métricas:
       `Insight` guarda `igMediaId` e `videoViews`, e os dois lados existiam
       sem nada no meio.

       Não é `unique`: a mesma conta republicando o mesmo conteúdo é caso
       normal, e um índice único transformaria isso em erro de gravação. */
    igMediaId: { type: String, default: '', index: true },

    /* Marca d'água com o @ de cada conta.
       Só COMO desenhar — o texto é o @ de quem publica, resolvido na hora.
       Guardá-lo aqui faria a marca de uma conta aparecer no vídeo de outra.

       Declarado no schema porque o Mongoose descarta em silêncio o que não
       está: foi assim que `processMode` sumia entre o clique e o banco no Loop,
       e a escolha de humanização virava decoração. */
    marcaDagua: {
      ativa:     { type: Boolean, default: false },
      opacidade: { type: Number, default: 40, min: 5, max: 100 },
      posicao:   { type: String, enum: ['superior', 'centro', 'inferior'], default: 'centro' },
      tamanho:   { type: String, enum: ['pequena', 'media', 'grande'], default: 'pequena' },
    },

    engageComment: {
      type: String,
      default: '',
    },

    accounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],

    scheduledAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      default: 'pendente',
    },

    error: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

postSchema.index({ status: 1 });
postSchema.index({ accounts: 1, status: 1 });
postSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Post', postSchema);
