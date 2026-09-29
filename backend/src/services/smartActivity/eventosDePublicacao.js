'use strict';

/**
 * Avisos que nascem de um acontecimento, não de uma métrica: publicou, falhou,
 * envio disparado e concluído, conta caiu, cota da API cheia. Cada um obedece ao seu
 * interruptor na Central e usa o modelo editável do tipo. Os que se repetiriam
 * a cada ciclo só saem de novo depois de uma janela.
 */

const { sql } = require('../../db');
const thresholds = require('./thresholds');
const templates = require('./templates');

async function _gravar(doc) {
  const { notificacoes } = require('../../repos');
  const nova = await notificacoes.insert(doc);
  const webPush = require('./webPush');
  if (webPush.disponivel()) webPush.enviar(nova).catch(err => console.warn('[WebPush] envio falhou:', err.message));
  require('../../events/broadcaster').broadcast('notificacoes', { novas: 1 }, nova.usuarioId);
  return nova;
}

/** O dono da conta — as linhas do banco já trazem; objeto montado à mão, não. */
async function _donoDa(conta) {
  if (conta.usuarioId) return conta.usuarioId;
  if (!conta.id) return null;
  const [c] = await sql`select usuario_id from accounts where id = ${conta.id}`.catch(() => []);
  return c?.usuarioId || null;
}

function _tipoDeConteudo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'STORY') return 'Story';
  if (t === 'VIDEO' || t === 'REELS' || t === 'REEL') return 'Reel';
  if (t === 'CAROUSEL_ALBUM' || t === 'CAROUSEL') return 'Carrossel';
  return 'post';
}

async function _repetidoRecentemente(eventType, accountId, horas) {
  const [achou] = await sql`
    select 1 from notificacoes
    where event_type = ${eventType} and account_id is not distinct from ${accountId || null}
      and criada_em >= ${new Date(Date.now() - horas * 3_600_000)}
    limit 1`.catch(() => []);
  return !!achou;
}

/**
 * Monta e grava um aviso do tipo `eventType` para a conta, se o tipo estiver
 * ligado e (com `janelaHoras`) não tiver saído recentemente para ela.
 */
async function _avisar(eventType, conta, { vars = {}, prioridade = 'normal', metadados = {}, janelaHoras = 0 } = {}) {
  if (!conta) return null;
  const usuarioId = await _donoDa(conta);
  if (!usuarioId) return null;
  const cfg = await thresholds.carregar(usuarioId).catch(() => null);
  if (!cfg || cfg.ativos[eventType] === false) return null;
  if (janelaHoras && await _repetidoRecentemente(eventType, conta.id, janelaHoras)) return null;

  const valores = templates.discretas({
    username: conta.username || '',
    account: conta.username ? `@${conta.username}` : 'a conta',
    ...vars,
  }, cfg.privacidade || {});
  const modelo = templates.modeloDe(eventType, cfg.mensagens);

  return _gravar({
    usuarioId,
    accountId: conta.id || null,
    username: conta.username || '',
    avatar: conta.avatar || '',
    eventType,
    tema: modelo.tema,
    prioridade,
    titulo: templates.render(modelo.titulo, valores),
    mensagem: templates.render(modelo.mensagem, valores),
    metadados,
  });
}

function notificarPublicado({ conta, contentType } = {}) {
  const tipo = _tipoDeConteudo(contentType);
  return _avisar('postPublicado', conta, { vars: { contentType: tipo, time: 'agora' }, metadados: { contentType: tipo } });
}

function notificarErro({ conta, contentType, erro } = {}) {
  const tipo = _tipoDeConteudo(contentType);
  return _avisar('erroPublicacao', conta, {
    vars: { contentType: tipo, time: 'agora', erro: String(erro || 'Falha desconhecida.').slice(0, 200) },
    prioridade: 'alta',
    metadados: { contentType: tipo, erro: String(erro || '').slice(0, 500) },
  });
}

function notificarContaCaiu({ conta, motivo } = {}) {
  return _avisar('contaCaiu', conta, {
    vars: { motivo: String(motivo || 'parou de responder').slice(0, 200) },
    prioridade: 'alta',
    metadados: { motivo: String(motivo || '').slice(0, 300) },
    janelaHoras: 6,
  });
}

/* ── Envios (Postar, Loop, Campanha, Stories) ─────────────────────────────
   Sobre o pacote inteiro, não sobre uma conta: vão direto para o dono. */

async function _avisarUsuario(eventType, usuarioId, { vars = {}, prioridade = 'normal', metadados = {} } = {}) {
  if (!usuarioId) return null;
  const cfg = await thresholds.carregar(usuarioId).catch(() => null);
  if (!cfg || cfg.ativos[eventType] === false) return null;
  const modelo = templates.modeloDe(eventType, cfg.mensagens);
  return _gravar({
    usuarioId, eventType, tema: modelo.tema, prioridade,
    titulo: templates.render(modelo.titulo, vars),
    mensagem: templates.render(modelo.mensagem, vars),
    metadados,
  });
}

/** "reels", "fotos", "stories" — no singular quando é um só. */
function _tipoNoPlural(postType, n) {
  const t = String(postType || '').toLowerCase();
  const [um, varios] = t === 'story' ? ['story', 'stories']
    : t === 'post' || t === 'image' ? ['foto', 'fotos']
    : t === 'reel' ? ['reel', 'reels']
    : ['publicação', 'publicações'];
  return Number(n) === 1 ? um : varios;
}

/** Um pacote de publicações foi disparado: quantas contas, quantas publicações. */
function notificarEnvio({ usuarioId, origem, nome, contas, publicacoes, postType } = {}) {
  const n = Math.max(0, Number(publicacoes) || 0);
  return _avisarUsuario('envioIniciado', usuarioId, {
    vars: {
      origem: origem || 'Postar',
      nome: nome || origem || 'Envio',
      contas: String(Math.max(0, Number(contas) || 0)),
      publicacoes: String(n),
      tipo: _tipoNoPlural(postType, n),
    },
    metadados: { origem, contas: Number(contas) || 0, publicacoes: n, postType: postType || '' },
  }).catch(e => console.log('[Aviso] envio iniciado:', e.message));
}

/** Um pacote terminou: o placar. */
function notificarEnvioConcluido({ usuarioId, origem, nome, contas, publicadas, falhas, postType } = {}) {
  const ok = Math.max(0, Number(publicadas) || 0);
  const ruins = Math.max(0, Number(falhas) || 0);
  return _avisarUsuario('envioConcluido', usuarioId, {
    vars: {
      origem: origem || 'Postar',
      nome: nome || origem || 'Envio',
      contas: String(Math.max(0, Number(contas) || 0)),
      publicadas: String(ok),
      falhas: String(ruins),
      tipo: _tipoNoPlural(postType, ok),
    },
    prioridade: ruins ? 'media' : 'normal',
    metadados: { origem, publicadas: ok, falhas: ruins },
  }).catch(e => console.log('[Aviso] envio concluído:', e.message));
}

/** Cota da API cheia: o envio para por horas sem erro na fila; sem o aviso, parece travado. */
function notificarCotaDaApi({ conta, motivo, ate } = {}) {
  const m = /\((\d+)\/(\d+)/.exec(String(motivo || ''));
  return _avisar('cotaApi', conta, {
    vars: {
      usado: m ? m[1] : '50',
      limite: m ? m[2] : '50',
      libera: ate ? new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'em até 24h',
    },
    prioridade: 'media',
    metadados: { motivo: String(motivo || '').slice(0, 300), libera: ate || null },
    janelaHoras: 20,
  });
}

module.exports = {
  notificarPublicado, notificarErro, notificarContaCaiu, notificarCotaDaApi,
  notificarEnvio, notificarEnvioConcluido, _tipoNoPlural,
};
