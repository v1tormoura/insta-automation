'use strict';
const mongoose = require('mongoose');

/**
 * Convite de testador do app — o pedido, não o convite em si.
 *
 * ── Por que este documento existe, e o que ele NÃO faz
 *
 * A Meta não tem endpoint para convidar um testador do Instagram. O
 * `POST /{app-id}/roles` da Graph API é explicitamente indisponível ("não é
 * possível executar essa operação neste ponto de extremidade"), os papéis que
 * ela conhece são administrators/developers/testers/insights users — nenhum
 * deles é o testador do Instagram — e o campo `user` exige o ID numérico de um
 * usuário do Facebook, não um @ do Instagram. Convidar é ação de painel.
 *
 * Então este modelo guarda o PEDIDO: o @ que precisa entrar como testador e se
 * o convite já foi disparado no painel. O que ele elimina é a parte que de fato
 * dava trabalho — lembrar quais @ faltam, achar a página certa e digitar o @ à
 * mão a cada um.
 *
 * ── Por que "conectado" não é campo
 *
 * Se fosse, precisaria de um gancho no caminho de login para gravá-lo — e um
 * gancho que falhe deixa o convite mentindo para sempre. O estado conectado é
 * derivado na leitura, olhando se existe conta com aquele @ já vinculada. Sem
 * gancho, sem risco de regressão no login, e sempre verdadeiro.
 */
const conviteDeAcessoSchema = new mongoose.Schema({
  /* Já normalizado por `normalizarArroba` antes de chegar aqui: minúscula, sem
     arroba. O índice único é o que impede dois pedidos para a mesma conta. */
  username: { type: String, required: true, unique: true, trim: true },

  /* O que o administrador fez, e só isso. */
  estado: { type: String, enum: ['pendente', 'enviado'], default: 'pendente' },

  /* Qual app da Meta vai receber o testador. Vazio = o app padrão do servidor.
     Guardado porque quem tem mais de um app precisa saber em qual painel o
     convite foi disparado. */
  metaAppId: { type: String, default: '' },

  observacao: { type: String, default: '', trim: true, maxlength: 280 },
  enviadoEm:  { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ConviteDeAcesso', conviteDeAcessoSchema);
