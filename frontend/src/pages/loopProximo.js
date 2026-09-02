/**
 * O que acontece a seguir neste loop.
 *
 * ── A pergunta que a tela não respondia
 *
 * O cartão mostrava cinco selos de peso igual — `30m`, `FILA: 28, 1
 * processando`, `0 ciclos`, `em —`, `5min atrás` — e o mais importante deles
 * era um traço. Quem olha quer saber uma coisa: o que vai ser postado, e
 * quando. Estava tudo no banco (`currentIndex` e `nextRunAt`) e nada na tela.
 *
 * ── Por que é um módulo
 *
 * Porque tem casos, e caso não testado é caso que só aparece na tela de
 * alguém: loop pausado, loop ativo sem horário marcado, horário no passado,
 * fila vazia, índice além do fim da lista. Cada um deles quer uma frase
 * diferente, e "—" para todos é o que havia antes.
 */

/** Quanto falta, em partes — para a tela escolher como escrever. */
export function faltam(nextRunAt, agora = Date.now()) {
  if (!nextRunAt) return null;
  const ms = new Date(nextRunAt).getTime() - agora;
  if (Number.isNaN(ms)) return null;
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    total: s,
    passou: ms <= 0,
    h: Math.floor(s / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/**
 * A contagem escrita.
 *
 * Os segundos aparecem só no último minuto. Antes disso eles mudam o texto
 * inteiro a cada tick sem acrescentar nada — e um número que pisca o tempo
 * todo é ruído; um que começa a piscar quando falta pouco é aviso.
 */
export function contagem(nextRunAt, agora = Date.now()) {
  const f = faltam(nextRunAt, agora);
  if (!f) return null;
  if (f.passou) return 'agora';
  if (f.h > 0) return `${f.h}h ${String(f.m).padStart(2, '0')}min`;
  if (f.m > 0) return `${f.m}min ${String(f.s).padStart(2, '0')}s`;
  return `${f.s}s`;
}

/**
 * O estado do loop, dito como uma frase — e o que fazer com ele.
 *
 * @returns {{tom, titulo, detalhe}} tom: 'conta'|'espera'|'parado'|'atencao'
 */
export function proximoPasso(loop, agora = Date.now()) {
  const ativo = loop?.status === 'ativo';
  const midias = loop?.mediaFiles?.length || 0;

  if (!ativo) {
    return { tom: 'parado', titulo: 'Pausado',
             detalhe: 'Nada será publicado até você retomar.' };
  }

  if (!midias) {
    /* Ativo e sem mídia é um estado que só se descobre esperando — o loop
       parece funcionando e nunca publica. */
    return { tom: 'atencao', titulo: 'Sem mídias na fila',
             detalhe: 'O loop está ativo, mas não há o que publicar.' };
  }

  const c = contagem(loop.nextRunAt, agora);

  if (!c) {
    /* `nextRunAt` nulo com o loop ativo: ou ele nunca rodou, ou a última
       tentativa não conseguiu marcar a próxima. As duas parecem "ativo" na
       tela, e nenhuma vai publicar sozinha. */
    return {
      tom: 'atencao',
      titulo: 'Sem próximo horário definido',
      detalhe: loop.postsCount
        ? 'A última execução não agendou a seguinte — veja o histórico.'
        : 'O loop ainda não rodou nenhuma vez.',
    };
  }

  if (c === 'agora') {
    return { tom: 'conta', titulo: 'Publicando agora',
             detalhe: 'A próxima mídia está sendo enviada.' };
  }

  return { tom: 'espera', titulo: c, detalhe: 'até a próxima publicação' };
}

/**
 * Qual mídia sai na próxima.
 *
 * `currentIndex` é o ponteiro da fila e pode passar do fim quando a lista
 * encolhe entre um ciclo e outro — o loop volta ao começo, e a tela precisa
 * mostrar a mesma que ele vai usar, não um vazio.
 */
export function proximaMidia(loop) {
  const lista = loop?.mediaFiles || [];
  if (!lista.length) return null;
  const i = ((Number(loop.currentIndex) || 0) % lista.length + lista.length) % lista.length;
  return { indice: i, arquivo: lista[i], total: lista.length };
}
