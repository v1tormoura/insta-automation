'use strict';

const mongoose = require('mongoose');

/**
 * Quantas operações passaram pelo proxy, por dia.
 *
 * ── O que dá para medir e o que não dá
 *
 * Bytes seria a medida certa, e não temos como obtê-la: o tráfego real sai de
 * dentro do instagrapi, que usa `requests` por baixo e não expõe o tamanho das
 * respostas. A Axtron também não publica API de consumo.
 *
 * O que dá para contar com precisão é OPERAÇÃO — cada vez que uma publicação,
 * sincronização ou login monta uma saída pelo proxy. Isso não é a cota, mas é
 * proporcional a ela: dobrar as operações dobra o tráfego.
 *
 * A ponte entre os dois vem de você. Ao registrar, de vez em quando, quanto o
 * painel do fornecedor marca de consumo, o sistema calcula quantos megabytes
 * cada operação custa em média e passa a projetar sozinho. Duas leituras
 * bastam para a primeira estimativa, e ela melhora a cada nova.
 *
 * É honesto: medimos o que conseguimos, e pedimos só o que não temos como
 * saber. O contrário — inventar um número de bytes — daria uma projeção
 * convincente e errada, que é pior que não ter projeção nenhuma.
 */
const ProxyUsoSchema = new mongoose.Schema(
  {
    /** `YYYY-MM-DD` na hora local do servidor. Chave natural do dia. */
    dia: { type: String, required: true, unique: true, index: true },

    operacoes: { type: Number, default: 0 },

    /* De onde veio o proxy de cada operação. Separado porque o diagnóstico
       muda: mil operações pelo pool são mil IPs distintos; mil pelo global são
       mil saídas do mesmo endereço, que é o padrão que faz o Instagram
       sinalizar. O total sozinho não distingue as duas. */
    porOrigem: {
      conta:  { type: Number, default: 0 },
      pool:   { type: Number, default: 0 },
      global: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: 'proxyuso' }
);

module.exports = mongoose.models.ProxyUso || mongoose.model('ProxyUso', ProxyUsoSchema);
