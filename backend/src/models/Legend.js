const mongoose = require('mongoose');

const legendSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      default: 'Geral',
    },

    text: {
      type: String,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    /* Favorita: a legenda que você usa toda semana não pode ficar na terceira
       página junto das que escreveu uma vez. Ordena antes de tudo na lista. */
    favorita: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Legend', legendSchema);
