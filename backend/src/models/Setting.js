const mongoose = require('mongoose');

/**
 * Store chave/valor global do SaaS.
 *
 * Fica no MongoDB (e não em data/settings.json) porque precisa ser compartilhado
 * entre containers — backend, worker e jobs leem a mesma configuração.
 */
const settingSchema = new mongoose.Schema(
  {
    key:   { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
