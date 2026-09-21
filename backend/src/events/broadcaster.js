'use strict';

/**
 * SSE broadcaster — gerencia clientes conectados e envia eventos em tempo real.
 * Inclui limpeza automática de clientes zumbi (conexões mortas).
 *
 * ── A ponte entre processos
 *
 * Os navegadores ficam ligados ao BACKEND (rota /events). Mas boa parte do que
 * interessa acontece no WORKER: publicou, falhou, conta caiu, cota encheu,
 * notificação nova. `broadcast()` escrevia só nos clientes DESTE processo — e
 * no worker há zero clientes. O evento morria em silêncio, sem erro nenhum.
 *
 * O efeito visível era nas notificações: a de "Publicado" nascia no worker,
 * o push saía, mas a Central do painel só ficava sabendo quando o backend, por
 * outro motivo (a sincronização de métricas), emitia 'notificacoes' — e aí a
 * tela recarregava tudo o que acumulou e mostrava de uma vez. "Chegou tudo
 * junto" era exatamente isso.
 *
 * Agora todo broadcast também é PUBLICADO num canal do Redis (o mesmo Redis da
 * fila BullMQ). O backend assina o canal e repassa aos seus clientes o que veio
 * de OUTRO processo; o que veio dele mesmo já foi escrito localmente e é
 * reconhecido pela origem. Sem Redis, tudo segue como antes — local.
 */

const clients = new Set();

const CANAL  = 'nexora:sse';
/* Identifica ESTE processo nas mensagens do canal, para o backend não
   reentregar aos seus clientes o que ele mesmo acabou de escrever. */
const ORIGEM = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

let redis      = undefined;   // undefined = ainda não tentou; null = indisponível
let assinante  = null;
let avisouErro = false;

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function _mensagem(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
}

/** Escreve nos clientes DESTE processo, removendo os mortos. */
function _escreverLocal(message) {
  if (clients.size === 0) return;

  const dead = [];
  clients.forEach(res => {
    try {
      // Verifica se a conexão ainda está aberta antes de escrever
      if (res.writableEnded || res.destroyed || !res.writable) {
        dead.push(res);
        return;
      }
      const ok = res.write(message);
      // Back-pressure: se o buffer estiver cheio, remove cliente
      if (!ok) {
        res.once('drain', () => {});
      }
    } catch {
      dead.push(res);
    }
  });

  // Limpa conexões mortas
  for (const res of dead) clients.delete(res);
}

/**
 * A conexão com o Redis, carregada na primeira vez que for precisa.
 *
 * Nos testes (Jest) não há Redis e o ioredis ficaria tentando reconectar em
 * loop, sujando a saída — ali a ponte fica desligada, salvo se um cliente for
 * injetado com `usarRedis()`. Em produção, `REDIS_HOST` vem do compose.
 */
function _redis() {
  if (redis !== undefined) return redis;
  if (process.env.JEST_WORKER_ID || process.env.SSE_PONTE === 'off') { redis = null; return redis; }
  try {
    redis = require('../queue/connection');
  } catch (err) {
    redis = null;
    console.warn('[SSE] ponte desligada — Redis indisponível:', err.message);
  }
  return redis;
}

/** Injeta o cliente Redis (testes, ou quem já tem uma conexão). */
function usarRedis(cliente) {
  redis = cliente || null;
  assinante = null;
}

function _publicar(event, data) {
  const r = _redis();
  if (!r) return;
  try {
    const p = r.publish(CANAL, JSON.stringify({ origem: ORIGEM, event, data: data ?? {} }));
    if (p && typeof p.catch === 'function') {
      p.catch(err => {
        if (avisouErro) return;
        avisouErro = true;
        console.warn('[SSE] publicar na ponte falhou (aviso único):', err.message);
      });
    }
  } catch (err) {
    if (!avisouErro) { avisouErro = true; console.warn('[SSE] publicar na ponte falhou (aviso único):', err.message); }
  }
}

/**
 * Emite um evento SSE para todos os clientes conectados — deste processo e,
 * pela ponte, dos outros.
 *
 * @param {string} event - nome do evento (ex: 'posts', 'accounts', 'refresh')
 * @param {object} data  - payload JSON
 */
function broadcast(event, data = {}) {
  _escreverLocal(_mensagem(event, data));
  _publicar(event, data);
}

/**
 * Assina o canal e repassa aos clientes locais o que veio de outro processo.
 *
 * Só o processo que TEM clientes precisa chamar — o backend. O worker só
 * publica. Uma conexão própria para assinar: no ioredis, um cliente em modo
 * subscriber não aceita outros comandos, então não dá para reaproveitar a
 * conexão da fila.
 *
 * @returns {Promise<boolean>} true se a ponte ficou ativa
 */
async function iniciarPonte() {
  const r = _redis();
  if (!r || assinante) return !!assinante;
  try {
    assinante = typeof r.duplicate === 'function' ? r.duplicate() : r;
    if (typeof assinante.on === 'function') {
      assinante.on('error', err => {
        if (avisouErro) return;
        avisouErro = true;
        console.warn('[SSE] assinante da ponte com erro (aviso único):', err.message);
      });
      assinante.on('message', (canal, bruto) => {
        if (canal !== CANAL) return;
        receberDaPonte(bruto);
      });
    }
    await assinante.subscribe(CANAL);
    return true;
  } catch (err) {
    console.warn('[SSE] não deu para assinar a ponte:', err.message);
    assinante = null;
    return false;
  }
}

/**
 * Trata uma mensagem crua vinda do canal. Separado para ser testável sem
 * Redis: devolve true quando algo foi entregue aos clientes locais.
 */
function receberDaPonte(bruto) {
  let m;
  try { m = JSON.parse(bruto); } catch { return false; }
  if (!m || typeof m.event !== 'string' || !m.event) return false;
  if (m.origem === ORIGEM) return false;   // já escrevi isto localmente
  _escreverLocal(_mensagem(m.event, m.data));
  return true;
}

/**
 * Emite heartbeat keepalive para manter conexões SSE vivas.
 * Clientes que não conseguem receber o heartbeat são removidos.
 */
function sendHeartbeat() {
  if (clients.size === 0) return;

  const dead = [];
  clients.forEach(res => {
    try {
      if (res.writableEnded || res.destroyed || !res.writable) {
        dead.push(res);
        return;
      }
      res.write(': keepalive\n\n');
    } catch {
      dead.push(res);
    }
  });

  for (const res of dead) clients.delete(res);
}

// Heartbeat a cada 25 segundos (antes do timeout de 30s do proxy/nginx)
const heartbeatInterval = setInterval(sendHeartbeat, 25_000);
heartbeatInterval.unref(); // Não impede o processo de fechar

/**
 * Retorna o número de clientes SSE conectados.
 */
function clientCount() {
  return clients.size;
}

module.exports = {
  addClient, removeClient, broadcast, clientCount,
  iniciarPonte, receberDaPonte, usarRedis,
  CANAL, ORIGEM,
};
