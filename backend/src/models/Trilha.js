'use strict';
const mongoose = require('mongoose');

/**
 * Uma trilha de áudio da biblioteca.
 *
 * Existe para o Postar poder trocar ou misturar o áudio dos vídeos na hora de
 * publicar — sem passar cada lote pelo editor. O arquivo fica em
 * `uploads/trilhas/`; aqui vai o nome que a pessoa reconhece, porque em disco
 * ele vira `aud_1758…_x9k2.mp3` e isso não diz nada a quem escolheu.
 *
 * `arquivo` é relativo à raiz de uploads (o volume que todos os serviços
 * montam em `/app/uploads`), nunca absoluto: o caminho absoluto muda entre o
 * container e a máquina de quem desenvolve, e o relativo não.
 */
const trilhaSchema = new mongoose.Schema({
  nome:    { type: String, required: true, trim: true },
  arquivo: { type: String, required: true },
  tamanho: { type: Number, default: 0 },
}, { timestamps: true });

trilhaSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Trilha', trilhaSchema);
