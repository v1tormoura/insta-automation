'use strict';
const mongoose = require('mongoose');

/**
 * Quantos seguidores cada conta tinha em cada dia.
 *
 * ── Por que este modelo precisou existir
 *
 * `Account.followers` guarda UM número: o de agora. Ele é sobrescrito a cada
 * sincronização, então "quantos seguidores eu ganhei hoje" não tinha resposta
 * possível — não havia com o que comparar.
 *
 * Sem isso, um cartão de "novos seguidores" só poderia mostrar zero ou um
 * número inventado. Preferi construir a série antes da tela: o número na tela
 * tem de sair de uma medição, não de uma suposição.
 *
 * ── O que ele NÃO recupera
 *
 * O passado. A série começa no dia em que este código entra em produção, e
 * crescimento de dias anteriores não existe em lugar nenhum — o valor antigo
 * foi sobrescrito a cada sync desde sempre. A tela precisa dizer isso em vez
 * de mostrar "+0" como se fosse um fato.
 *
 * ── Por que um documento por conta e por dia
 *
 * O par (conta, dia) é único, e `upsert` sobre ele deixa o job idempotente:
 * rodar dez vezes no mesmo dia atualiza a mesma linha em vez de criar dez.
 * O sync roda a cada 30 minutos — sem a chave única, um mês daria 1.440
 * documentos por conta.
 *
 * `dia` é texto `YYYY-MM-DD` e não Date: o dia é uma etiqueta de calendário
 * local, não um instante. Guardado como Date, a virada de dia em Brasília cai
 * no dia anterior em UTC, e o crescimento apareceria no dia errado por três
 * horas todas as noites.
 */
const seguidoresDoDiaSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  username:  { type: String, default: '' },

  /* `YYYY-MM-DD` no fuso do servidor (America/Sao_Paulo no compose). */
  dia: { type: String, required: true },

  seguidores: { type: Number, default: 0 },
  seguindo:   { type: Number, default: 0 },
  publicacoes: { type: Number, default: 0 },

  /* Quantos entraram em relação ao dia anterior REGISTRADO.
     Calculado na gravação e guardado, em vez de derivado na leitura: a leitura
     precisaria buscar o dia anterior para cada conta em cada consulta, e a
     tela mostra cinco períodos diferentes. `null` quando não há dia anterior —
     que é diferente de zero: "não sei" e "não ganhou nenhum" são respostas
     distintas, e a tela mostra as duas de formas diferentes. */
  novos: { type: Number, default: null },
}, { timestamps: true });

/* Um documento por conta por dia. É o que torna o job idempotente. */
seguidoresDoDiaSchema.index({ accountId: 1, dia: 1 }, { unique: true });
/* Para a consulta por período, que é o uso principal da tela. */
seguidoresDoDiaSchema.index({ dia: -1 });

module.exports = mongoose.model('SeguidoresDoDia', seguidoresDoDiaSchema);
