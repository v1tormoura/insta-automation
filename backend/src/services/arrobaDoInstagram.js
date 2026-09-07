'use strict';

/**
 * O @ do Instagram, normalizado.
 *
 * Este valor entra em três lugares onde texto solto causa dano diferente:
 * numa URL (o link do painel da Meta), num índice único do Mongo, e na
 * comparação com `Account.username`. Se cada um normalizasse à sua maneira,
 * "@Fulano" e "fulano" seriam dois convites para a mesma conta, e o convite
 * jamais fecharia como conectado.
 *
 * Regras do Instagram: 1 a 30 caracteres, apenas letras, números, ponto e
 * sublinhado. Não diferencia maiúscula de minúscula — por isso guardamos em
 * minúscula, e é a forma minúscula que compara.
 */

const MAX = 30;

/**
 * @param {unknown} valor
 * @returns {string} o @ sem arroba, em minúscula — ou '' se não for um @ válido.
 */
function normalizarArroba(valor) {
  /* `String(valor)` transformaria null em "null" e [1,2] em "1,2" — dois @
     inválidos que passariam a parecer válidos. Só texto entra. */
  if (typeof valor !== 'string') return '';

  let s = valor.trim().toLowerCase();

  /* O usuário cola de todo jeito: "@fulano", "instagram.com/fulano",
     "https://www.instagram.com/fulano/?hl=pt". Aceitar as três é mais barato
     que ensinar a colar de uma só. */
  const comoUrl = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/);
  if (comoUrl) s = comoUrl[1];

  s = s.replace(/^@+/, '');

  if (!s || s.length > MAX) return '';
  /* Ponto no fim é recusado pelo próprio Instagram; deixá-lo passar geraria um
     convite que nunca casa com conta nenhuma. */
  if (!/^[a-z0-9._]+$/.test(s) || s.endsWith('.')) return '';

  return s;
}

module.exports = { normalizarArroba, MAX };
