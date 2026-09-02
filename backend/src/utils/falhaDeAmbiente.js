'use strict';

/**
 * A falha foi do AMBIENTE, e não da credencial?
 *
 * ── O que esta distinção decide
 *
 * Se vale guardar a senha que a pessoa acabou de digitar.
 *
 * Nestes códigos a requisição nem chegou ao Instagram — o proxy recusou, o
 * serviço Python estava fora, o tempo acabou. A senha não foi julgada por
 * ninguém, então não há motivo para descartá-la.
 *
 * ── O laço que isso quebra
 *
 * O botão "Mobile" entra em um clique quando há senha guardada. Guardando só
 * em caso de sucesso, um proxy fora fecha um laço: o botão não acha senha e
 * abre o modal; a pessoa digita; o proxy derruba; nada é guardado; e no
 * próximo clique o modal abre de novo. Para sempre — e consertar o proxy não
 * resolveria, porque a senha continuaria não estando lá.
 *
 * ── Por que módulo próprio
 *
 * É uma decisão pura, e testá-la de dentro da rota exigiria carregar os
 * modelos do mongoose só para chamar um `if`. Aqui ela é chamável sozinha.
 *
 * ── O outro lado
 *
 * A aposta é guardar uma senha que talvez esteja errada. O risco é coberto no
 * caminho oposto: quando o Instagram JULGA e recusa (`BAD_PASSWORD`), quem
 * chama apaga a senha guardada — senão o botão de um clique falharia sozinho
 * para sempre, sem nunca pedir a certa. O mesmo laço, ao contrário.
 */

const AMBIENTE = Object.freeze([
  'PROXY_ERROR',
  'INSTAGRAPI_SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE',
]);

/**
 * @param {string} [code] — o código do erro, como o serviço Python o classificou
 * @returns {boolean}
 */
function falhaDeAmbiente(code) {
  /* Erro sem código é erro que ninguém classificou, e na dúvida não guarda: o
     custo de não guardar é um modal a mais; o de guardar errado é um botão que
     mente. */
  return AMBIENTE.includes(String(code || ''));
}

module.exports = { falhaDeAmbiente, AMBIENTE };
