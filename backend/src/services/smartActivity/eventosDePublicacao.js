'use strict';

/**
 * Notificação de publicação — sucesso e falha, na hora.
 *
 * ── Por que fica fora do detector
 *
 * `detector.js` reage a MÉTRICA: só sabe que algo aconteceu porque um insight
 * chegou do Instagram, minutos ou horas depois. Publicar é diferente — o
 * evento acontece no worker, no instante exato em que a chamada à API volta
 * (ou falha), sem métrica nenhuma envolvida. Forçar isso pelo caminho do
 * detector inventaria um insight falso só para ter algo a processar.
 *
 * ── Por que dispara incondicionalmente por chamada
 *
 * Cada publicação é um evento distinto — duas contas publicando o mesmo vídeo
 * geram DOIS avisos, de propósito. Diferente do marco (que não pode repetir
 * pelo MESMO conteúdo) e do resumo (um por dia), aqui não existe "a mesma
 * publicação de novo": cada chamada É uma publicação nova.
 */

const Notificacao = require('../../models/Notificacao');
const thresholds = require('./thresholds');
const templates = require('./templates');

/** Mesmo padrão de `detector.js`: grava, depois envia push sem bloquear. */
async function _gravar(doc) {
  const nova = await Notificacao.create(doc);

  try {
    const webPush = require('./webPush');
    if (webPush.disponivel()) {
      webPush.enviar(nova).catch(err =>
        console.warn('[WebPush] envio falhou:', err.message));
    }
  } catch { /* módulo indisponível não derruba o registro */ }

  try {
    require('../../events/broadcaster').broadcast('notificacoes', { novas: 1 });
  } catch { /* sem SSE, a Central busca no próximo ciclo */ }

  return nova;
}

/**
 * "Story", "Reel", "Carrossel", "post" — o mesmo vocabulário de
 * `templates.contexto`.
 *
 * Aceita os DOIS dialetos que chegam até aqui: o `mediaType` do Graph API
 * (STORY, VIDEO, REELS, CAROUSEL_ALBUM — maiúsculo) e o `postType` do modelo
 * Post (post, reel, story — minúsculo). São vocabulários diferentes para a
 * mesma ideia, e normalizar aqui evita que quem chama precise saber qual dos
 * dois está passando.
 */
function _tipoDeConteudo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'STORY') return 'Story';
  if (t === 'VIDEO' || t === 'REELS' || t === 'REEL') return 'Reel';
  if (t === 'CAROUSEL_ALBUM' || t === 'CAROUSEL') return 'Carrossel';
  return 'post';
}

/**
 * Uma publicação saiu com sucesso.
 *
 * @param {object} conta        { _id, username, avatar }
 * @param {string} [contentType] mediaType bruto (STORY, VIDEO…) ou já o rótulo
 */
async function notificarPublicado({ conta, contentType } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.postPublicado === false) return null;

  const tipo = _tipoDeConteudo(contentType);
  const vars = templates.discretas({
    username:    conta.username || '',
    account:     conta.username ? `@${conta.username}` : 'a conta',
    contentType: tipo,
    time:        'agora',
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('postPublicado', cfg.mensagens);
  return _gravar({
    accountId:  conta._id || null,
    username:   conta.username || '',
    avatar:     conta.avatar || '',
    eventType:  'postPublicado',
    tema:       modelo.tema,
    prioridade: 'normal',
    titulo:     templates.render(modelo.titulo, vars),
    mensagem:   templates.render(modelo.mensagem, vars),
    metadados:  { contentType: tipo },
  });
}

/**
 * Uma publicação falhou.
 *
 * @param {object} conta   { _id, username, avatar }
 * @param {string} erro    mensagem já legível — quem chama decide o que mostrar
 */
async function notificarErro({ conta, contentType, erro } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.erroPublicacao === false) return null;

  const tipo = _tipoDeConteudo(contentType);
  const vars = templates.discretas({
    username:    conta.username || '',
    account:     conta.username ? `@${conta.username}` : 'a conta',
    contentType: tipo,
    time:        'agora',
    erro:        String(erro || 'Falha desconhecida.').slice(0, 200),
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('erroPublicacao', cfg.mensagens);
  return _gravar({
    accountId:  conta._id || null,
    username:   conta.username || '',
    avatar:     conta.avatar || '',
    eventType:  'erroPublicacao',
    tema:       modelo.tema,
    prioridade: 'alta',
    titulo:     templates.render(modelo.titulo, vars),
    mensagem:   templates.render(modelo.mensagem, vars),
    metadados:  { contentType: tipo, erro: String(erro || '').slice(0, 500) },
  });
}

module.exports = { notificarPublicado, notificarErro };
