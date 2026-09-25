'use strict';

/**
 * Capa por perfil — uma capa diferente para cada conta, no mesmo envio.
 *
 * ── O problema
 *
 * O envio tinha UMA capa (`cover`) para todas as contas. Quem publica o mesmo
 * reel em dez perfis com identidade própria (a cara da dona do perfil na capa,
 * a cor da marca) tinha de criar dez envios — ou aceitar a mesma miniatura em
 * todas, que é justamente o que faz dez perfis parecerem um só.
 *
 * ── Como funciona
 *
 * `capasPorConta: [{ accountId, arquivo }]` vive no Job (e desce ao Post).
 * Na hora de publicar para uma conta, `aplicar(post, conta)` troca `cover`
 * pela capa daquela conta; conta sem capa própria segue com a capa geral (ou
 * sem capa, como sempre). Nada muda para quem não configurou.
 *
 * `arquivo` é o NOME do arquivo em `uploads/`, o mesmo formato de `cover` —
 * a publicação lê `post.cover` (vira `cover_url` na Graph), então o resto do
 * pipeline não precisa saber que a capa veio de uma escolha por conta.
 */

const path = require('path');

const MAXIMO_DE_CONTAS = 200;

/** Só o nome do arquivo, sem diretório — o campo vira caminho em `uploads/`. */
function _nomeSeguro(arquivo) {
  const base = path.basename(String(arquivo || '').trim());
  if (!base || base === '.' || base === '..' || /[\\/]/.test(base)) return '';
  return base.slice(0, 255);
}

function _idValido(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

/**
 * Normaliza a lista vinda do banco ou da tela.
 *
 * Aceita `[{ accountId, arquivo }]` e também `{ accountId: arquivo }`.
 * Entrada inválida vira lista vazia; item inválido é descartado; conta
 * repetida fica com a ÚLTIMA escolha.
 */
function normalizar(lista) {
  let entradas = [];
  if (Array.isArray(lista)) {
    entradas = lista.map(c => c && [c.accountId, c.arquivo]).filter(Boolean);
  } else if (lista && typeof lista === 'object') {
    entradas = Object.entries(lista);
  }
  const porConta = new Map();
  for (const [id, arquivo] of entradas) {
    const nome = _nomeSeguro(arquivo);
    if (!_idValido(id) || !nome) continue;
    porConta.set(String(id), nome);
    if (porConta.size > MAXIMO_DE_CONTAS) break;
  }
  return [...porConta].map(([accountId, arquivo]) => ({ accountId, arquivo }));
}

/**
 * Lê o campo do corpo da requisição.
 *
 * Vem como JSON em string (FormData) ou objeto. Cada item tem `accountId` e
 * OU `arquivo` (nome de um arquivo já em uploads/ — biblioteca) OU `indice`
 * (posição em `arquivosEnviados`, os uploads do campo `capas` desta mesma
 * requisição). Devolve `null` quando não há nada válido, para o job ficar sem
 * o campo.
 *
 * @param {string|object} raw
 * @param {Array<{filename:string}>} [arquivosEnviados]
 */
function lerDoCorpo(raw, arquivosEnviados = []) {
  if (raw == null || raw === '') return null;
  let lista = raw;
  if (typeof raw === 'string') {
    try { lista = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(lista)) return null;

  const resolvida = lista.map(item => {
    if (!item || typeof item !== 'object') return null;
    if (item.arquivo) return { accountId: item.accountId, arquivo: item.arquivo };
    const i = Number(item.indice);
    const enviado = Number.isInteger(i) && i >= 0 ? arquivosEnviados[i] : null;
    return enviado?.filename ? { accountId: item.accountId, arquivo: enviado.filename } : null;
  }).filter(Boolean);

  const capas = normalizar(resolvida);
  return capas.length ? capas : null;
}

/** A capa desta conta, ou '' se ela não tem capa própria. */
function capaDaConta(capas, accountId) {
  const id = String(accountId || '');
  if (!id) return '';
  const lista = Array.isArray(capas) ? capas : [];
  const achou = lista.find(c => c && String(c.accountId) === id);
  return achou ? _nomeSeguro(achou.arquivo) : '';
}

const PASTA_UPLOADS = path.resolve(__dirname, '../../uploads');

/** O arquivo ainda está em uploads/? Capa apagada da biblioteca não pode derrubar a publicação. */
function _existe(arquivo) {
  try { return require('fs').existsSync(path.join(PASTA_UPLOADS, arquivo)); } catch { return false; }
}

/**
 * O post como esta conta deve publicá-lo.
 *
 * Sem capa própria devolve o MESMO objeto (zero mudança para quem não usa).
 * Com capa própria devolve uma cópia plana com `cover` trocado — cópia, não
 * mutação: o mesmo Post é publicado em N contas em paralelo, e mudar
 * `post.cover` no laço vazaria a capa de uma conta para a próxima. Capa que
 * sumiu do disco cai na geral, com uma linha no log — nunca derruba o envio.
 */
function aplicar(post, account, { existe = _existe } = {}) {
  if (!post || !account) return post;
  const capa = capaDaConta(post.capasPorConta, account.id);
  if (!capa) return post;
  if (!existe(capa)) {
    console.log(`[Capa] @${account.username || account.id}: capa própria "${capa}" não está mais em uploads/ — usando a capa geral`);
    return post;
  }
  const plano = typeof post.toObject === 'function' ? post.toObject() : { ...post };
  return { ...plano, cover: capa, capaPropria: true };
}

module.exports = { normalizar, lerDoCorpo, capaDaConta, aplicar, MAXIMO_DE_CONTAS, PASTA_UPLOADS };
