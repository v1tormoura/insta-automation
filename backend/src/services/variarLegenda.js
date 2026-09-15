'use strict';

/**
 * Variação de legenda por conta — spintax.
 *
 * ── O problema
 *
 * A mesma campanha manda a MESMA legenda para N contas. Legenda idêntica em
 * várias contas, no mesmo intervalo, é um dos sinais mais fáceis de o Instagram
 * casar — não precisa olhar o vídeo, basta comparar o texto. O hash único por
 * publicação já cuida dos bytes do vídeo ([[project_dois_429]] não, mas
 * midiaPorConta sim); a legenda faltava.
 *
 * ── A sintaxe
 *
 * Chaves com opções separadas por `|`: `{Bom dia|Oi|E aí} pessoal`. Cada grupo
 * é resolvido para UMA das opções, escolhida de forma determinística pela
 * semente (conta + post). Determinístico de propósito: a MESMA conta,
 * reprocessando a MESMA publicação (um retry), recebe a MESMA legenda — não
 * gera duas legendas diferentes para o que é uma publicação só. Contas
 * diferentes recebem combinações diferentes.
 *
 * Sem chaves, devolve o texto intacto — então aplicar isto sempre é seguro:
 * quem não usa spintax não vê diferença.
 *
 * Grupos não aninham: `{a|{b|c}}` não é suportado de propósito — legenda de
 * Instagram não precisa disso, e o aninhamento troca clareza por um recurso que
 * ninguém pediu. Um `{` sem `}` (ou vazio) fica como está.
 */

const crypto = require('crypto');

/** Hash estável de 32 bits a partir da semente. */
function _semente(seed) {
  return crypto.createHash('sha256').update(String(seed || '')).digest().readUInt32BE(0);
}

/* Um grupo `{a|b|c}` tem pelo menos um `|`. `{só isto}` não é escolha — fica.
   A fonte é uma string, não um literal `/…/g`: um regex global guarda
   `lastIndex` entre chamadas, e `temVariacao` (que usa `.test`) devolveria
   resultados alternados para a MESMA entrada. Cada uso cria o seu. */
const GRUPO_SRC = '\\{([^{}]*\\|[^{}]*)\\}';

/**
 * Resolve o spintax de `template` para esta semente.
 * @param {string} template  a legenda, com ou sem `{a|b}`
 * @param {string} seed      identificador estável (ex.: `${postId}:${accountId}`)
 * @returns {string}
 */
function resolverLegenda(template, seed) {
  const texto = String(template == null ? '' : template);
  if (texto.indexOf('{') === -1) return texto;   // atalho: nada a variar

  const base = _semente(seed);
  let i = 0;
  return texto.replace(new RegExp(GRUPO_SRC, 'g'), (_todo, corpo) => {
    const opcoes = corpo.split('|');
    // Cada grupo usa um passo diferente da semente para não escolher sempre a
    // mesma posição em todos os grupos.
    const escolha = ((base + i * 2654435761) >>> 0) % opcoes.length;
    i += 1;
    return opcoes[escolha].trim();
  });
}

/** Há pelo menos um grupo de variação no texto? (para a UI decidir se mostra a prévia) */
function temVariacao(template) {
  return new RegExp(GRUPO_SRC).test(String(template || ''));
}

module.exports = { resolverLegenda, temVariacao };
