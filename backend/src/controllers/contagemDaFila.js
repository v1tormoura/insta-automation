'use strict';

/**
 * Quantas publicações estão na fila, e quantas saíram hoje.
 *
 * ── O que estava faltando
 *
 * O painel somava duas origens: publicação avulsa (`Post`) e lote (`Job`). Uma
 * campanha planeja dezenas de publicações e só cria o `Post` no instante em
 * que cada uma executa — até lá elas vivem em `CampaignPublication`, e o
 * painel não olhava para lá.
 *
 * O Loop é a QUARTA origem e faltava pelo mesmo motivo, um nível acima: um
 * loop com 44 reels cria um `Post` de cada vez, quando chega a hora. As outras
 * 43 existem só como `mediaFiles` no documento do loop, e a fila do painel
 * mostrava 1 — a que está saindo agora — enquanto a tela de Loop mostrava 44.
 *
 * O efeito: subir uma campanha com trinta publicações não mudava nada na fila.
 * Quem acabou de subi-la via os mesmos zeros de antes, do lado de uma tela de
 * Campanhas que mostrava as trinta. Dois números do mesmo produto discordando
 * é pior que um número ausente — um deles está mentindo e não dá para saber
 * qual.
 *
 * ── Por que é um módulo
 *
 * A função do painel faz quinze consultas antes de chegar nesta soma. Testar a
 * aritmética por lá exigiria dublar as quinze — e foi assim que a origem que
 * faltava passou despercebida: ninguém consegue revisar uma soma que só existe
 * no meio de um `Promise.all` de quinze linhas.
 */

/**
 * A fila, somando as três origens.
 *
 * @param {{agendados, processando, pendentes}} posts       — coleção `Post`
 * @param {{esperando, rodando, enfileirados}} jobs         — coleção `Job`
 * @param {Object<string, number>} campanhas                — por status
 * @param {{pendentes}} loops                               — mídias que faltam
 */
function somarFilas(posts, jobs, campanhas, loops) {
  /* `= {}` no parâmetro não cobre `null` — ele só vale para ausente. E `null`
     é justamente o que uma consulta que falhou entrega. O painel inteiro
     lançaria por causa de uma origem que não respondeu. */
  const p = posts || {}, j = jobs || {}, c = campanhas || {}, l = loops || {};
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    agendados:   n(p.agendados)   + n(j.esperando)    + n(c.scheduled),
    processando: n(p.processando) + n(j.rodando)      + n(c.processing),
    /* O loop entra em "pendentes" e não em "agendados": as mídias dele não têm
       horário marcado, elas saem quando o ciclo chegar nelas. Chamá-las de
       agendadas prometeria um horário que não existe. */
    pendentes:   n(p.pendentes)   + n(j.enfileirados) + n(c.pending) + n(l.pendentes),
  };
}

/**
 * Quantas mídias um loop ativo ainda vai publicar no ciclo atual.
 *
 * `mediaFiles.length - currentIndex`, e não `mediaFiles.length`: o loop é
 * contínuo, então contar a lista inteira daria um número que nunca desce e
 * que, num loop rodando há uma semana, não descreve nada.
 *
 * Loop pausado não conta. Ele não vai publicar enquanto ninguém retomar, e uma
 * fila que inclui o que está parado é uma fila que não se esvazia — a pessoa
 * olha, vê 44, espera, e continua vendo 44.
 */
function pendentesDoLoop(loops) {
  if (!Array.isArray(loops)) return 0;
  return loops.reduce((soma, loop) => {
    if (!loop || loop.status !== 'ativo') return soma;
    const total = Array.isArray(loop.mediaFiles) ? loop.mediaFiles.length : 0;
    const feitas = Number(loop.currentIndex) || 0;
    return soma + Math.max(0, total - feitas);
  }, 0);
}

/**
 * Quantas publicações saíram hoje.
 *
 * ── Por que o maior, e não a soma
 *
 * As duas fontes se sobrepõem. A campanha cria um `Post` por conta ao publicar
 * — então uma publicação para três contas já aparece como três `Post`, e
 * somar `CampaignPublication` por cima contaria a mesma coisa duas vezes.
 *
 * O maior cobre as duas direções sem inflar: quando as fontes concordam, o
 * número é o mesmo; quando o `Post` não foi criado (falha ao criar, ou
 * publicação anterior a este código), a contagem da campanha sustenta o
 * número; e quando a campanha não registrou, o `Post` sustenta.
 *
 * Não é exato. Somar seria exato e errado; o maior é aproximado e nunca conta
 * duas vezes — e num painel, um número que nunca infla vale mais que um
 * preciso que às vezes dobra.
 */
function postagensDeHoje(dePosts, dePublicacoes) {
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return Math.max(n(dePosts), n(dePublicacoes));
}

/** Agrupamento `[{_id: status, n}]` → `{status: n}`. */
function porStatus(linhas) {
  return Object.fromEntries(
    (Array.isArray(linhas) ? linhas : [])
      .filter(r => r && r._id)
      .map(r => [r._id, Number(r.n) || 0])
  );
}

module.exports = { somarFilas, pendentesDoLoop, postagensDeHoje, porStatus };
