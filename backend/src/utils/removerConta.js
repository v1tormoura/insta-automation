'use strict';

/**
 * Remoção de conta — o único caminho que apaga um documento de Account.
 *
 * ── Por que isto é uma função e não `Account.findByIdAndDelete` na mão
 *
 * Apagar a conta é a parte fácil. A parte que se esquece é devolver o proxy:
 * quando uma conta usa o pool, o proxy é RESERVADO para ela e o endereço fica
 * gravado em `account.proxy`. Apagar a conta sem liberar deixa a reserva
 * apontando para um dono que não existe mais, e essa entrada nunca mais é
 * oferecida a ninguém.
 *
 * O vazamento não faz barulho. O pool encolhe de um em um, e o sintoma só
 * aparece muito depois: sem proxy livre, as contas caem no proxy global e
 * várias passam a sair pelo mesmo IP — que é o padrão que o Instagram lê como
 * automação. A causa (uma tentativa de login que falhou semanas antes) não se
 * parece em nada com o efeito (contas sinalizadas).
 *
 * ── Onde isso mordeu
 *
 * Duas rotas de conexão criam uma conta temporária, tentam o login e apagam a
 * conta se ele falhar. O login, para acontecer, já tinha reservado um proxy.
 * Ou seja: cada tentativa de conexão malsucedida custava um proxy permanente.
 * Um pool com três entradas presas, num banco sem conta nenhuma, foi como o
 * problema apareceu.
 *
 * A ordem importa: liberar ANTES de apagar. Depois de apagada, não há mais
 * como saber qual proxy era dela — a reserva só guarda o id da conta.
 */

const Account = require('../models/Account');

async function removerConta(accountId) {
  if (!accountId) return { removida: false, motivo: 'sem id' };

  /* Falha ao liberar não impede a remoção: uma conta que o usuário mandou
     apagar precisa sumir mesmo que o pool esteja fora do ar. A reserva órfã
     que sobrar é recuperada depois, ao abrir a tela de Proxies. */
  let proxiesLiberados = 0;
  try {
    proxiesLiberados = await require('../services/proxyPool').liberar(accountId);
  } catch (err) {
    console.warn('[removerConta] proxy não liberado —', err.message);
  }

  const r = await Account.deleteOne({ _id: accountId });
  return { removida: (r.deletedCount || 0) > 0, proxiesLiberados };
}

module.exports = removerConta;
