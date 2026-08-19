'use strict';

/**
 * Serialização segura das respostas da Campaign API.
 *
 * O documento Account carrega senha, token OAuth, segredo TOTP, blob de sessão
 * instagrapi e a URL do proxy — que embute usuário e senha do provedor. Devolver
 * a conta "crua" numa resposta vazaria tudo isso.
 *
 * A abordagem é lista de PERMISSÃO, não de bloqueio: só sai o que está listado
 * aqui. Um campo sensível novo no model não vaza por esquecimento.
 */

/** Campos de Account que podem ser expostos. */
function contaSegura(conta) {
  if (!conta) return null;
  const c = conta.toObject ? conta.toObject() : conta;

  return {
    _id:          c._id,
    username:     c.username,
    name:         c.name || '',
    avatar:       c.avatar || '',
    provider:     c.provider || 'official',
    healthStatus: c.healthStatus || 'ativa',
    postsToday:   c.postsToday ?? 0,
    // Nunca a URL: ela contém usuário e senha do provedor de proxy.
    hasProxy:     !!(c.proxy && String(c.proxy).trim()),
  };
}

/** Campos de Media que podem ser expostos. */
function conteudoSeguro(midia) {
  if (!midia) return null;
  const m = midia.toObject ? midia.toObject() : midia;

  return {
    _id:          m._id,
    filename:     m.filename,
    originalName: m.originalName || m.filename,
    url:          m.url || '',
    type:         m.type || 'other',
    folder:       m.folder || '',
  };
}

function campanhaSegura(campanha) {
  if (!campanha) return null;
  const c = campanha.toObject ? campanha.toObject() : campanha;

  // A campanha não guarda segredo por construção (só IDs e configuração), mas
  // accountIds/contentIds podem vir populados pelo Mongoose — nesse caso passam
  // pelos serializadores acima em vez de sair inteiros.
  const mapear = (lista, fn) => Array.isArray(lista)
    ? lista.map(item => (item && typeof item === 'object' && item._id ? fn(item) : item))
    : [];

  return {
    ...c,
    accountIds: mapear(c.accountIds, contaSegura),
    contentIds: mapear(c.contentIds, conteudoSeguro),
  };
}

/**
 * Publicação com o necessário para a tela: conta, conteúdo, horário, textos,
 * status e diagnóstico. Templates e textos resolvidos convivem — o primeiro
 * mostra o que foi configurado, o segundo o que foi publicado de fato.
 */
function publicacaoSegura(pub) {
  if (!pub) return null;
  const p = pub.toObject ? pub.toObject() : pub;

  const populado = v => v && typeof v === 'object' && v._id;

  return {
    _id:             p._id,
    campaignId:      populado(p.campaignId) ? p.campaignId._id : p.campaignId,
    order:           p.order,
    scheduledAt:     p.scheduledAt,
    status:          p.status,
    attempts:        p.attempts ?? 0,
    error:           p.error || '',
    // Categoria estável do erro (RATE_LIMITED, SESSION_EXPIRED…). A tela filtra
    // e agrupa por ela em vez de casar a mensagem, que muda a cada versão.
    errorCode:       p.errorCode || '',
    publishedAt:     p.publishedAt || null,

    // Vínculo com a mídia real. Exposto como booleano em vez do id: a tela só
    // precisa saber que o comentário tem alvo definido, e o id não acrescenta
    // nada para quem está olhando o painel.
    hasMediaLink:    !!p.instagramMediaId,

    // Estado do comentário — independente do da publicação: o post pode estar
    // no ar com o comentário ainda agendado ou falhado.
    commentStatus:    p.commentStatus || 'none',
    commentPostedAt:  p.commentPostedAt || null,
    commentError:     p.commentError || '',
    commentErrorCode: p.commentErrorCode || '',
    commentAttempts:  p.commentAttempts ?? 0,
    postId:          populado(p.postId) ? p.postId._id : p.postId,
    captionTemplate: p.captionTemplate || '',
    commentTemplate: p.commentTemplate || '',
    resolvedCaption: p.resolvedCaption || '',
    resolvedComment: p.resolvedComment || '',
    account: populado(p.accountId) ? contaSegura(p.accountId)   : p.accountId,
    content: populado(p.contentId) ? conteudoSeguro(p.contentId) : p.contentId,
  };
}

module.exports = { contaSegura, conteudoSeguro, campanhaSegura, publicacaoSegura };
