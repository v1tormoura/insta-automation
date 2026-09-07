'use strict';

/**
 * A ordem em que as mídias entram na fila.
 *
 * ── O defeito que existia antes de haver opção
 *
 * A biblioteca é lida com `Media.find({ _id: { $in: ids } })`, e o Mongo NÃO
 * devolve na ordem dos ids — devolve na ordem que achar. Quem subia 400 vídeos
 * e escolhia quarenta deles numa ordem específica via a fila sair em outra, sem
 * nada na tela que explicasse. Ordenar por escolha, então, começa por
 * restaurar a escolha: é o que `naOrdemDosIds` faz.
 *
 * ── Por que a aleatória é semeada
 *
 * `Math.random()` no lugar disto daria uma ordem impossível de reproduzir: o
 * mesmo job reexecutado embaralharia diferente, e um relatório de "em que ordem
 * isso foi postado" não fecharia com o que aconteceu. Com semente, a ordem é
 * sorteada uma vez, gravada no job, e continua a mesma para sempre — inclusive
 * nos testes, que é o que permite verificar que ela embaralha de verdade.
 *
 * ── O que este módulo NÃO decide
 *
 * Quando cada mídia sai. Isso é do intervalo e do ritmo por conta
 * (`ritmoHumano.js`, `ritmoDaConta.js`). Aqui é só a ordem da fila.
 */

const crypto = require('crypto');

/** As ordens que a tela oferece. `selecao` é a ordem em que foram escolhidas. */
const ORDENS = ['antigos_primeiro', 'recentes_primeiro', 'selecao'];
const ORDEM_PADRAO = 'antigos_primeiro';

/**
 * Reordena os documentos na ordem dos ids pedidos.
 *
 * Existe porque o `$in` do Mongo ignora a ordem dos ids. Documento que não veio
 * (id inválido, mídia apagada entre a escolha e o envio) simplesmente não
 * aparece — some da fila em vez de virar um item quebrado nela.
 *
 * @param {Array<{_id: any}>} docs
 * @param {Array<string>} ids
 */
function naOrdemDosIds(docs, ids) {
  const porId = new Map((docs || []).map(d => [String(d._id), d]));
  return (ids || [])
    .map(id => porId.get(String(id)))
    .filter(Boolean);
}

/* PRNG semeado — o mesmo mulberry32 de `midiaPorConta.js`. Repetido e não
   importado porque são propósitos diferentes: lá a semente é (post, conta) para
   variar o arquivo; aqui é do job, para fixar a ordem. Unir os dois amarraria
   duas decisões que não têm razão para mudar juntas. */
function criarAleatorio(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uma semente estável a partir de qualquer texto. */
function sementeDe(texto) {
  return crypto.createHash('sha256').update(String(texto ?? '')).digest().readUInt32BE(0);
}

/**
 * Embaralha uma cópia, com Fisher-Yates semeado.
 *
 * Fisher-Yates e não `sort(() => Math.random() - 0.5)`: o segundo não produz
 * uma permutação uniforme — dá viés forte para posições próximas da original, e
 * "embaralhado" que mantém os primeiros quase nos primeiros não é embaralhado.
 */
function embaralhar(itens, semente) {
  const r = criarAleatorio(semente);
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * A fila, na ordem pedida.
 *
 * @param {Array<{filename: string, quando?: Date|number|null}>} itens
 *   `quando` é a data de envio da mídia. Ausente ou nulo significa "acabou de
 *   ser enviada": arquivo que subiu agora não tem histórico, e tratá-lo como o
 *   mais recente é o que corresponde ao fato.
 * @param {object} [opcoes]
 * @param {string} [opcoes.ordem] — uma de {@link ORDENS}
 * @param {boolean} [opcoes.aleatoria] — embaralha e ignora `ordem`
 * @param {string} [opcoes.semente] — texto que fixa o embaralhamento
 * @returns {Array} os mesmos itens, reordenados (nunca o mesmo array)
 */
function ordenar(itens, opcoes = {}) {
  const lista = Array.isArray(itens) ? itens.filter(Boolean) : [];
  if (lista.length < 2) return [...lista];

  /* Aleatória manda. É o que a tela promete: "sem marcar, segue a ordem
     escolhida acima" — logo, marcada, a ordem acima não vale. */
  if (opcoes.aleatoria) {
    return embaralhar(lista, sementeDe(opcoes.semente ?? Date.now()));
  }

  const ordem = ORDENS.includes(opcoes.ordem) ? opcoes.ordem : ORDEM_PADRAO;
  if (ordem === 'selecao') return [...lista];

  /* `map` com o índice antes de ordenar torna a ordenação estável: duas mídias
     enviadas no mesmo segundo — o que acontece num envio em lote — mantêm entre
     si a ordem da escolha, em vez de trocarem de lugar a cada execução.
     `Array.sort` só passou a ser estável por especificação no ES2019, e mesmo
     estável ela não define nada sobre empates vindos de chaves iguais. */
  const comIndice = lista.map((item, i) => ({ item, i, q: instanteDe(item) }));
  const sinal = ordem === 'recentes_primeiro' ? -1 : 1;
  comIndice.sort((a, b) => (a.q - b.q) * sinal || a.i - b.i);
  return comIndice.map(x => x.item);
}

/**
 * O instante de uma mídia, em número.
 *
 * Data inválida ou ausente vira "agora": é o caso do upload direto, que não tem
 * registro na biblioteca. Devolver NaN aqui envenenaria a comparação inteira —
 * qualquer conta com NaN é falsa, e a ordenação sairia arbitrária.
 */
function instanteDe(item) {
  const q = item?.quando;
  if (q === null || q === undefined || q === '') return Date.now();
  const n = q instanceof Date ? q.getTime() : Number(new Date(q).getTime());
  return Number.isFinite(n) ? n : Date.now();
}

module.exports = {
  ordenar, naOrdemDosIds, embaralhar, sementeDe,
  ORDENS, ORDEM_PADRAO,
};
