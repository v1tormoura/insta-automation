'use strict';

const mongoose = require('mongoose');

/**
 * Pool de proxies disponíveis, um documento por proxy.
 *
 * ── Por que documento por proxy, e não uma lista num Setting
 *
 * A reserva precisa ser atômica. Conectar duas contas ao mesmo tempo — o que
 * acontece o tempo todo quando se conecta em série pelo painel — não pode
 * entregar o mesmo proxy às duas: seria recriar exatamente o problema que o
 * pool existe para resolver, com duas contas saindo pelo mesmo IP.
 *
 * Com uma lista dentro de um Setting, reservar seria ler-modificar-gravar, e
 * duas requisições simultâneas leriam o mesmo estado antes de qualquer uma
 * gravar. Com documento por proxy, `findOneAndUpdate({contaId: null})` é
 * atômico por construção: o MongoDB garante que só uma requisição vence.
 */
const ProxyPoolSchema = new mongoose.Schema(
  {
    /** URL completa, já normalizada. Única: o mesmo proxy não entra duas vezes. */
    url: { type: String, required: true, unique: true, index: true },

    /**
     * Dono atual. `null` significa livre.
     *
     * Indexado porque toda reserva consulta por este campo, e é a consulta
     * que roda no caminho de conexão de conta — onde a latência aparece.
     */
    contaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null, index: true },

    /** Último IP de saída observado. Vazio até o primeiro teste. */
    ip: { type: String, default: '' },

    /** Resultado do último teste. `null` = nunca testado. */
    ok: { type: Boolean, default: null },

    /**
     * Proxy que troca de IP entre requisições. Guardado porque o login do
     * Instagram são várias requisições em sequência: se o IP muda no meio,
     * ele vê a sessão nascendo espalhada e recusa mesmo com credencial certa.
     */
    rotativo: { type: Boolean, default: false },

    erro: { type: String, default: '' },
    ultimoTeste: { type: Date, default: null },
    reservadoEm: { type: Date, default: null },
  },
  { timestamps: true, collection: 'proxypool' }
);

module.exports = mongoose.models.ProxyPool || mongoose.model('ProxyPool', ProxyPoolSchema);
