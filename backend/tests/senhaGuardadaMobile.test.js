'use strict';

/**
 * A senha guardada, e o laço que ela quebra.
 *
 * ── O laço
 *
 * O botão "Mobile" existe para entrar em um clique. Ele só consegue isso se
 * houver senha guardada, e a senha só era guardada quando o login DAVA CERTO.
 *
 * Com o proxy fora, isso vira um laço fechado: o botão não acha senha, abre o
 * modal; a pessoa digita; o proxy derruba antes de chegar ao Instagram; nada é
 * guardado; e no próximo clique o modal abre de novo. Para sempre — sem que
 * nada esteja errado além do proxy, e sem que consertar o proxy resolva,
 * porque a senha continuaria não estando lá.
 *
 * ── A distinção que resolve
 *
 * Falha de AMBIENTE (proxy, serviço fora, tempo esgotado) não julgou a senha:
 * a requisição nem chegou ao Instagram. Guardá-la é uma aposta razoável.
 *
 * Falha de CREDENCIAL é o contrário: o Instagram olhou e recusou. Aí a senha
 * guardada precisa sair, ou o botão de um clique falharia sozinho para sempre
 * sem nunca pedir a certa — o mesmo laço, ao contrário.
 */

const { falhaDeAmbiente: _falhaDeAmbiente } = require('../src/utils/falhaDeAmbiente');

describe('o que conta como falha de ambiente', () => {
  test('proxy, serviço fora e tempo esgotado — a senha não foi julgada', () => {
    for (const code of ['PROXY_ERROR', 'INSTAGRAPI_SERVICE_UNAVAILABLE',
                        'TIMEOUT', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE']) {
      expect(_falhaDeAmbiente(code)).toBe(true);
    }
  });

  test('senha errada NÃO é falha de ambiente', () => {
    /* Este é o par que importa. Tratar BAD_PASSWORD como ambiente guardaria uma
       senha que o Instagram acabou de recusar, e o botão de um clique passaria
       a falhar sozinho toda vez. */
    for (const code of ['BAD_PASSWORD', 'INVALID_USER', 'CHALLENGE_REQUIRED',
                        'TWO_FACTOR_REQUIRED', 'ACCOUNT_SUSPENDED', 'RATE_LIMITED']) {
      expect(_falhaDeAmbiente(code)).toBe(false);
    }
  });

  test('código ausente não é ambiente', () => {
    /* Erro sem código é erro que ninguém classificou. Na dúvida, não guarda:
       o custo de não guardar é um modal a mais; o de guardar errado é um botão
       que mente. */
    expect(_falhaDeAmbiente(undefined)).toBe(false);
    expect(_falhaDeAmbiente('')).toBe(false);
    expect(_falhaDeAmbiente('UNKNOWN_ERROR')).toBe(false);
  });
});
