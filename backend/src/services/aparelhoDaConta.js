'use strict';

/**
 * O aparelho virtual de cada conta.
 *
 * ── O vazamento que isto fecha
 *
 * O serviço Python escolhia o modelo por `sha256(account_id) % N`. Determinístico
 * — o que é certo, porque um celular que troca de modelo entre dois logins é por
 * si só um sinal — mas hash não garante DISTINÇÃO.
 *
 * Com o pool de 5 modelos que existia e 5 contas, a chance de todas ficarem
 * distintas era de 3,8%. Medido com os usernames reais: três aparelhos para
 * cinco contas. Dois pares anunciavam o MESMO modelo, resolução, dpi e cpu,
 * com a mesma build do app, a mesma região e o mesmo IP.
 *
 * Isso é exatamente a correlação que o isolamento existe para evitar: não é
 * preciso analisar conteúdo para juntar duas contas que se apresentam como o
 * mesmo telefone.
 *
 * ── Por que alocar em vez de sortear
 *
 * Mesmo com o pool expandido para 23, cinco contas sorteadas colidem em ~40%
 * das vezes (problema do aniversário). Alocação garante o que o sorteio só
 * torna provável: aqui o Node tem o banco na mão e sabe quais índices já estão
 * em uso, então escolhe o MENOS usado.
 *
 * ── Por que é imutável depois de escolhido
 *
 * O aparelho é gravado na conta e nunca reatribuído. Trocar significaria a
 * mesma conta entrando de um Samsung hoje e de um Xiaomi amanhã — que é pior
 * do que duas contas compartilharem um modelo.
 *
 * ── O que este módulo NÃO isola
 *
 * O IP. Sem proxy por conta, todas saem pelo mesmo endereço, e isso é
 * observável. O aparelho distinto não esconde o IP comum — ele remove UM eixo
 * de correlação, não todos. Ver o relatório da auditoria para a lista do que
 * já era isolado (sessão, UUIDs, trava, mídia, ritmo, falha) e do que não é.
 */

const Account = require('../models/Account');

/* Quantos modelos o serviço Python tem no pool.

   Repetido aqui e não importado porque são processos separados — mas com o
   nome do total exposto lá (`total_de_aparelhos()`) para a divergência ser
   detectável em vez de silenciosa. Um índice além do fim é ignorado pelo
   Python, que cai no hash: degrada, não quebra. */
const TOTAL_DE_APARELHOS = 23;

/**
 * O índice do aparelho desta conta, alocando um se ela ainda não tem.
 *
 * Nunca lança: uma falha aqui não pode impedir um login. Sem índice, o Python
 * usa o hash — o comportamento anterior, que funcionava.
 *
 * @returns {Promise<number|null>}
 */
async function indiceDaConta(account) {
  if (!account?._id) return null;

  const guardado = Number(account.deviceIndex);
  if (Number.isInteger(guardado) && guardado >= 0 && guardado < TOTAL_DE_APARELHOS) {
    return guardado;
  }

  /* Sem banco conectado, não aloca — e não espera.

     O Mongoose ENFILEIRA consultas quando a conexão não está pronta, em vez
     de rejeitar: um `find` aqui ficaria pendurado até o timeout do buffer, e
     com ele o login inteiro. Um aparelho não alocado custa a distinção desta
     conta; um login pendurado custa a conexão.

     `readyState === 1` é "conectado". Qualquer outro estado devolve null e o
     Python cai no hash, que era o comportamento anterior. */
  if (require('mongoose').connection?.readyState !== 1) return null;

  try {
    /* Conta o uso de cada índice entre as contas que já têm um. Só o campo:
       trazer os documentos inteiros para contar um número seria buscar o balde
       para medir a alça.

       `maxTimeMS` para o pior caso do banco lento não virar login lento. */
    const usados = await Account.find({ deviceIndex: { $ne: null } })
      .select('deviceIndex')
      .maxTimeMS(3000)
      .lean();

    const contagem = new Array(TOTAL_DE_APARELHOS).fill(0);
    for (const u of usados) {
      const i = Number(u.deviceIndex);
      if (Number.isInteger(i) && i >= 0 && i < TOTAL_DE_APARELHOS) contagem[i]++;
    }

    const escolhido = menosUsado(contagem, String(account._id));

    await Account.findByIdAndUpdate(account._id, { deviceIndex: escolhido });
    // Reflete no documento em memória: quem chamou costuma usá-lo em seguida.
    account.deviceIndex = escolhido;

    console.log(`📱 [Aparelho] @${account.username || account._id} → índice ${escolhido}`);
    return escolhido;
  } catch (err) {
    console.log(`⚠️ [Aparelho] não deu para alocar: ${err.message} — o Python usa o hash`);
    return null;
  }
}

/**
 * O índice menos usado; empate desfeito pelo id da conta.
 *
 * O desempate é estável e não sequencial de propósito. Pegando sempre o
 * primeiro índice livre, as contas criadas em sequência receberiam aparelhos
 * em ordem — Samsung, Samsung, Samsung, porque o pool está agrupado por
 * fabricante. Espalhar pelo id evita isso sem sacrificar a distinção.
 */
function menosUsado(contagem, chave) {
  const minimo = Math.min(...contagem);
  const candidatos = contagem
    .map((n, i) => (n === minimo ? i : -1))
    .filter(i => i >= 0);

  const crypto = require('crypto');
  const d = crypto.createHash('sha256').update(String(chave)).digest();
  return candidatos[d.readUInt32BE(0) % candidatos.length];
}

module.exports = { indiceDaConta, menosUsado, TOTAL_DE_APARELHOS };
