'use strict';

/** Roda `fn` sobre os itens com no máximo `limite` ao mesmo tempo, na ordem. */
async function emParalelo(itens, limite, fn) {
  let proximo = 0;
  const trabalhador = async () => { while (proximo < itens.length) { const i = proximo++; await fn(itens[i], i); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), itens.length) }, trabalhador));
}

module.exports = { emParalelo };
