'use strict';

/**
 * Vigia do sistema: a cada 10 minutos confere o que costuma parar em silêncio
 * e avisa na Central (e no push) — uma vez, e de novo só depois de 6h. Quando
 * o problema passa, avisa que voltou ao normal.
 *
 *   sessoes — metade ou mais das contas sem conseguir publicar (token inválido)
 *   fila    — publicação "processando" há mais de uma hora
 *   erros   — 20 ou mais erros de publicação no dia
 *
 * Cada verificação devolve `null` (tudo bem) ou `{ vars, prioridade }`; o texto
 * vem dos modelos editáveis da Central (templates.PADRAO).
 *
 * Roda por usuário: cada um é avisado sobre as próprias contas e a própria
 * fila, com a própria configuração, e o estado ("já avisei") é de cada um.
 */

const { sql } = require('../db');
const settings = require('../repos/settings');

const CHAVE = 'vigiaDoSistema';
const REAVISO_MS = 6 * 60 * 60 * 1000;
const FILA_PARADA_MS = 60 * 60 * 1000;
const ERROS_PARA_ALERTAR = 20;

async function _sessoes(usuarioId) {
  const [{ total, ruins }] = await sql`
    select count(*) as total, count(*) filter (where health_status = 'token_invalido') as ruins
    from accounts where usuario_id = ${usuarioId}`;
  // Uma conta com problema é rotina. Metade delas é um evento.
  if (!total || !ruins || ruins * 2 < total) return null;
  return { vars: { contasRuins: ruins, contasTotal: total }, prioridade: 'alta' };
}

async function _fila(usuarioId) {
  const [{ presas }] = await sql`
    select count(*) as presas from posts
    where usuario_id = ${usuarioId} and status = 'processando' and updated_at < ${new Date(Date.now() - FILA_PARADA_MS)}`;
  return presas ? { vars: { presas }, prioridade: 'normal' } : null;
}

async function _erros(usuarioId) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [{ erros }] = await sql`
    select count(*) as erros from posts where usuario_id = ${usuarioId} and status = 'erro' and updated_at >= ${hoje}`;
  return erros >= ERROS_PARA_ALERTAR ? { vars: { errosHoje: erros }, prioridade: 'normal' } : null;
}

const VERIFICACOES = Object.freeze({ sessoes: _sessoes, fila: _fila, erros: _erros });

const NOMES = Object.freeze({
  sessoes: 'contas sem conectar',
  fila: 'fila de publicação',
  erros: 'erros de publicação',
});

async function _avisar({ usuarioId, chave, titulo, mensagem, vars, prioridade, recuperacao, mensagens = {} }) {
  const { notificacoes } = require('../repos');
  const t = require('./smartActivity/templates');

  // Texto pronto vence o modelo: é a verificação dizendo "esta frase já é final".
  const tipo = recuperacao ? 'normalizado' : chave;
  let saida = { titulo, mensagem };
  if (!titulo && !mensagem) {
    const modelo = t.modeloDe(tipo, mensagens);
    saida = { titulo: t.render(modelo.titulo, vars || {}), mensagem: t.render(modelo.mensagem, vars || {}) };
  }

  const nova = await notificacoes.insert({
    usuarioId,
    eventType: 'sistema',
    tema: mensagens?.[tipo]?.tema || (recuperacao ? 'success' : (prioridade === 'alta' ? 'warning' : 'info')),
    prioridade: recuperacao ? 'baixa' : (prioridade || 'normal'),
    titulo: saida.titulo,
    mensagem: saida.mensagem,
    metadados: { vigia: chave, recuperacao: !!recuperacao },
  });

  // Push sem await: a entrega é um extra e não pode derrubar o registro.
  require('./smartActivity/webPush').enviar(nova).catch(() => {});
  require('../events/broadcaster').broadcast('notificacoes', { novas: 1 }, usuarioId);
  return nova;
}

/** Sem `usuarioId`, confere todos os usuários ativos, um de cada vez. */
async function verificar({ verificacoes = VERIFICACOES, usuarioId = null } = {}) {
  if (!usuarioId) {
    const usuarios = await sql`select id from usuarios where status = 'ativo'`;
    const total = { avisos: 0, ativos: [] };
    for (const { id } of usuarios) {
      const r = await verificar({ verificacoes, usuarioId: id }).catch(err => {
        console.warn(`[Vigia] ${id}: ${err.message}`);
        return { avisos: 0, ativos: [] };
      });
      total.avisos += r.avisos;
      total.ativos.push(...r.ativos);
    }
    return total;
  }

  const chaveDoEstado = `${CHAVE}:${usuarioId}`;
  const estado = (await settings.ler(chaveDoEstado)) || {};
  const cfg = await require('./smartActivity/thresholds').carregar(usuarioId).catch(() => null);
  const mensagens = cfg?.mensagens || {};
  const agora = Date.now();
  let avisos = 0;

  for (const [chave, fn] of Object.entries(verificacoes)) {
    if (cfg && cfg.ativos[chave] === false) continue;

    let problema = null;
    try {
      problema = await fn(usuarioId);
    } catch (err) {
      // Verificação quebrada não pode cegar as outras.
      console.warn(`[Vigia] ${chave} falhou:`, err.message);
      continue;
    }

    const anterior = estado[chave];
    if (problema) {
      if (!anterior || agora - anterior.ultimoAviso > REAVISO_MS) {
        await _avisar({ usuarioId, chave, mensagens, ...problema });
        avisos++;
        estado[chave] = { desde: anterior?.desde || agora, ultimoAviso: agora };
      }
    } else if (anterior) {
      const horas = Math.max(1, Math.round((agora - anterior.desde) / 3.6e6));
      await _avisar({ usuarioId, chave, recuperacao: true, mensagens, vars: { aviso: NOMES[chave] || chave, horas } });
      avisos++;
      delete estado[chave];
    }
  }

  await settings.gravar(chaveDoEstado, estado);
  return { avisos, ativos: Object.keys(estado) };
}

function iniciar(intervaloMs = 10 * 60 * 1000) {
  setTimeout(() => verificar().catch(() => {}), 90_000);
  setInterval(() => verificar().catch(() => {}), intervaloMs);
}

module.exports = { verificar, iniciar, CHAVE, VERIFICACOES };
