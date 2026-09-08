'use strict';

/**
 * A senha do painel: guardar e conferir.
 *
 * ── Por que scrypt e não bcrypt
 *
 * bcrypt é a escolha óbvia e exigiria uma dependência nova — o que significa
 * reconstruir a imagem do backend para subir. `crypto.scrypt` vem no Node, é
 * uma KDF com custo de memória (a propriedade que o bcrypt tem e o PBKDF2 não)
 * e resolve exatamente este caso: um hash, conferido algumas vezes por dia.
 *
 * ── Por que os parâmetros vão dentro do hash
 *
 * `scrypt$N$r$p$salt$hash`. Guardar só o hash obriga o código de verificação a
 * conhecer os parâmetros de quando ele foi criado — e no dia em que o custo
 * subir, toda senha antiga passa a falhar sem que ninguém entenda por quê.
 * Com os parâmetros no texto, um hash antigo continua conferindo com os
 * parâmetros dele.
 *
 * ── Por que a comparação é em tempo constante
 *
 * `a === b` em string sai no primeiro byte diferente, e o tempo da resposta
 * vaza quantos bytes iniciais estavam certos. `timingSafeEqual` compara os
 * buffers inteiros sempre.
 */

const crypto = require('crypto');

/* Custo medido: 34 ms por verificação nesta máquina. Alto o bastante para
   tornar força bruta caro, baixo o bastante para o login não parecer travado. */
const N = 16384;   // 2^14
const R = 8;
const P = 1;
const TAMANHO = 32;

/** Requisito mínimo — dito na tela antes de a pessoa digitar, não depois. */
const MINIMO = 8;

/** @returns {string} `scrypt$N$r$p$salt$hash`, em base64url. */
function gerar(senha) {
  if (typeof senha !== 'string' || senha.length < MINIMO) {
    const erro = new Error(`A senha precisa de pelo menos ${MINIMO} caracteres.`);
    erro.code = 'SENHA_CURTA';
    throw erro;
  }
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha.normalize('NFKC'), sal, TAMANHO, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('base64url'), hash.toString('base64url')].join('$');
}

/**
 * Confere uma senha contra um hash gravado.
 *
 * Nunca lança: hash corrompido, formato de outra versão, string vazia — tudo
 * isso é `false`. Uma exceção aqui viraria erro 500 no login, e um erro 500 no
 * login é indistinguível de "o servidor caiu" para quem está tentando entrar.
 */
function conferir(senha, guardado) {
  try {
    if (typeof senha !== 'string' || !senha || typeof guardado !== 'string') return false;

    const partes = guardado.split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

    const [, n, r, p, sal, hash] = partes;
    const esperado = Buffer.from(hash, 'base64url');
    const calculado = crypto.scryptSync(
      senha.normalize('NFKC'),
      Buffer.from(sal, 'base64url'),
      esperado.length,
      { N: Number(n), r: Number(r), p: Number(p) },
    );

    /* `timingSafeEqual` lança se os tamanhos diferem — e o tamanho não é
       segredo, então conferir antes não vaza nada. */
    if (calculado.length !== esperado.length) return false;
    return crypto.timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

module.exports = { gerar, conferir, MINIMO };
