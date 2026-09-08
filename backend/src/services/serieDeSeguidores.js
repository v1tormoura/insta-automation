'use strict';

/**
 * A série diária de seguidores.
 *
 * ── O que ela existe para responder
 *
 * "Quantos seguidores eu ganhei hoje?" `Account.followers` guarda só o número
 * de agora, sobrescrito a cada sincronização — não havia com o que comparar.
 *
 * ── O que ela não pode responder
 *
 * O passado. A série começa no dia em que entra em produção. Crescimento de
 * antes não existe em lugar nenhum, porque o valor anterior foi sobrescrito a
 * cada sync desde sempre. `novos` fica `null` no primeiro dia de cada conta, e
 * a tela mostra isso como "—" em vez de "+0": as duas coisas são diferentes.
 */

const SeguidoresDoDia = require('../models/SeguidoresDoDia');

/**
 * A etiqueta do dia, no fuso do processo.
 *
 * `toISOString().slice(0,10)` daria o dia em UTC — e às 21h em Brasília isso
 * já é o dia seguinte. O crescimento apareceria no dia errado por três horas
 * todas as noites. `en-CA` porque o formato dele é exatamente `YYYY-MM-DD`.
 */
function diaDe(quando = new Date()) {
  return new Date(quando).toLocaleDateString('en-CA');
}

/** O dia anterior a uma etiqueta, como etiqueta. */
function diaAnterior(dia) {
  const d = new Date(`${dia}T12:00:00`);   // meio-dia evita a borda do fuso
  d.setDate(d.getDate() - 1);
  return diaDe(d);
}

/**
 * Grava o ponto de hoje para uma conta e calcula quantos entraram.
 *
 * Idempotente: chamada dez vezes no mesmo dia atualiza a mesma linha. O sync
 * roda a cada 30 minutos, então isso não é teoria.
 *
 * `novos` compara com o último dia REGISTRADO, não com "ontem": se o servidor
 * ficou dois dias fora, o ganho acumulado aparece no dia da volta em vez de
 * desaparecer. É menos preciso e mais honesto que perder o número.
 *
 * @returns {Promise<{dia: string, seguidores: number, novos: number|null}|null>}
 */
async function registrar(conta, quando = new Date()) {
  if (!conta?._id) return null;

  const dia = diaDe(quando);
  const seguidores = Number(conta.followers) || 0;

  try {
    /* O último ponto ANTES de hoje. `$lt` e não o dia de ontem exato para o
       caso de dias sem registro. */
    const anterior = await SeguidoresDoDia
      .findOne({ accountId: conta._id, dia: { $lt: dia } })
      .sort({ dia: -1 })
      .select('seguidores')
      .lean();

    const novos = anterior ? seguidores - (Number(anterior.seguidores) || 0) : null;

    await SeguidoresDoDia.updateOne(
      { accountId: conta._id, dia },
      {
        $set: {
          username: conta.username || '',
          seguidores,
          seguindo: Number(conta.following) || 0,
          publicacoes: Number(conta.postsCount) || 0,
          novos,
        },
      },
      { upsert: true },
    );

    return { dia, seguidores, novos };
  } catch (err) {
    /* Nunca lança: isto é um efeito colateral da sincronização, e derrubar o
       sync de métricas para gravar um histórico seria trocar o principal pelo
       acessório. */
    console.log(`⚠️ [SerieSeguidores] @${conta.username || conta._id}: ${err.message}`);
    return null;
  }
}

/**
 * Quantos seguidores entraram no período, somando todas as contas.
 *
 * Devolve `{ novos, comHistorico, contasSemHistorico }`.
 *
 * `comHistorico` é o que permite a tela distinguir "ganhou zero" de "ainda não
 * tenho série para dizer" — sem isso, o painel mostraria +0 no primeiro dia e
 * pareceria que nada aconteceu.
 *
 * @param {string} de  — etiqueta `YYYY-MM-DD` inclusive
 * @param {string} ate — etiqueta `YYYY-MM-DD` inclusive
 * @param {Array} accountIds
 */
async function novosNoPeriodo(de, ate, accountIds) {
  const ids = (accountIds || []).filter(Boolean);
  if (!ids.length) return { novos: 0, comHistorico: false, contasSemHistorico: 0 };

  try {
    const linhas = await SeguidoresDoDia.find({
      accountId: { $in: ids },
      dia: { $gte: de, $lte: ate },
    }).select('accountId novos').lean();

    /* Só os dias com `novos` numérico entram na soma. Dia com `null` é o
       primeiro registro daquela conta: não há ganho a somar, e tratá-lo como
       zero afirmaria que a conta não cresceu naquele dia. */
    let novos = 0;
    let medidos = 0;
    for (const l of linhas) {
      if (typeof l.novos === 'number') { novos += l.novos; medidos++; }
    }

    const comSerie = new Set(linhas.map(l => String(l.accountId))).size;
    return {
      novos,
      comHistorico: medidos > 0,
      contasSemHistorico: Math.max(0, ids.length - comSerie),
    };
  } catch (err) {
    console.log(`⚠️ [SerieSeguidores] período: ${err.message}`);
    return { novos: 0, comHistorico: false, contasSemHistorico: ids.length };
  }
}

module.exports = { registrar, novosNoPeriodo, diaDe, diaAnterior };
