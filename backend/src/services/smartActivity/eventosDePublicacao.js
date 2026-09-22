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

/**
 * Já existe aviso IGUAL para esta conta há pouco tempo?
 *
 * Sem isto, "token vence em 6 dias" sairia a cada sincronização — uma vez a
 * cada 5 minutos, por seis dias. O aviso que se repete demais deixa de ser
 * lido, e aí o dia em que ele importa passa batido junto com os outros.
 */
async function _repetidoRecentemente(eventType, accountId, horas = 24) {
  try {
    const desde = new Date(Date.now() - horas * 3600_000);
    /* `criadaEm`, não `createdAt`: o schema renomeia o timestamp
       (`timestamps: { createdAt: 'criadaEm' }`). Com o nome errado a consulta
       nunca achava nada, e "conta caiu", "token vencendo" e "cota cheia"
       repetiam a cada chamada. */
    const achou = await Notificacao.exists({
      eventType, accountId: accountId || null, criadaEm: { $gte: desde },
    });
    return !!achou;
  } catch { return false; }
}

/**
 * O token da conta está perto de vencer.
 *
 * Nasceu de um caso real: o token saiu com 1 hora de validade em vez de 60
 * dias, a conta caiu sozinha e ninguém soube até tentar publicar. Avisar ANTES
 * é a diferença entre reconectar com calma e descobrir com a fila parada.
 *
 * Um aviso por conta a cada 24h — ver `_repetidoRecentemente`.
 */
async function notificarTokenExpirando({ conta, dias } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.tokenExpirando === false) return null;
  if (await _repetidoRecentemente('tokenExpirando', conta._id)) return null;

  const vars = templates.discretas({
    username: conta.username || '',
    account:  conta.username ? `@${conta.username}` : 'a conta',
    dias:     String(Math.max(0, Math.round(Number(dias) || 0))),
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('tokenExpirando', cfg.mensagens);
  return _gravar({
    accountId: conta._id || null,
    username:  conta.username || '',
    avatar:    conta.avatar || '',
    eventType: 'tokenExpirando',
    tema:      modelo.tema,
    prioridade: 'alta',
    titulo:    templates.render(modelo.titulo, vars),
    mensagem:  templates.render(modelo.mensagem, vars),
    metadados: { dias: Number(dias) || 0 },
  });
}

/**
 * A conta saiu do ar (sessão expirada, token inválido, banida).
 *
 * Quem chama só dispara na TRANSIÇÃO para o estado ruim — uma conta que já
 * estava caída não gera aviso novo a cada tentativa de publicar, senão um lote
 * de 20 mídias viraria 20 avisos da mesma conta.
 */
async function notificarContaCaiu({ conta, motivo } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.contaCaiu === false) return null;
  if (await _repetidoRecentemente('contaCaiu', conta._id, 6)) return null;

  const vars = templates.discretas({
    username: conta.username || '',
    account:  conta.username ? `@${conta.username}` : 'a conta',
    motivo:   String(motivo || 'parou de responder').slice(0, 200),
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('contaCaiu', cfg.mensagens);
  return _gravar({
    accountId: conta._id || null,
    username:  conta.username || '',
    avatar:    conta.avatar || '',
    eventType: 'contaCaiu',
    tema:      modelo.tema,
    prioridade: 'alta',
    titulo:    templates.render(modelo.titulo, vars),
    mensagem:  templates.render(modelo.mensagem, vars),
    metadados: { motivo: String(motivo || '').slice(0, 300) },
  });
}

/**
 * A conta voltou (verificação concluída, sessão refeita, token válido de novo).
 *
 * Fecha o ciclo de "conta parou": sem isto a pessoa fica recarregando o
 * painel para saber se o que fez no Instagram pegou. Um por conta por hora.
 */
async function notificarContaVoltou({ conta, motivo } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.contaVoltou === false) return null;
  if (await _repetidoRecentemente('contaVoltou', conta._id, 1)) return null;

  const vars = templates.discretas({
    username: conta.username || '',
    account:  conta.username ? `@${conta.username}` : 'a conta',
    motivo:   String(motivo || 'voltou a responder').slice(0, 200),
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('contaVoltou', cfg.mensagens);
  return _gravar({
    accountId: conta._id || null,
    username:  conta.username || '',
    avatar:    conta.avatar || '',
    eventType: 'contaVoltou',
    tema:      modelo.tema,
    prioridade: 'normal',
    titulo:    templates.render(modelo.titulo, vars),
    mensagem:  templates.render(modelo.mensagem, vars),
    metadados: { motivo: String(motivo || '').slice(0, 300) },
  });
}

/**
 * Uma rodada de envio terminou, com o placar.
 *
 * Não é por conta: é o fechamento do lote. Sem ele, saber se o envio deu certo
 * exigia abrir a fila e contar linha por linha.
 */
/**
 * A cota da API do Meta encheu para uma conta (50 publicações em 24h).
 *
 * Um aviso por conta por janela — a rodada é adiada e re-checada; sem o
 * dedupe, cada re-checagem repetiria o aviso. 20h e não 24h: a janela é
 * deslizante e a conta pode encher de novo antes de completar um dia.
 */
async function notificarCotaDaApi({ conta, motivo, ate } = {}) {
  if (!thresholds.bancoConectado() || !conta) return null;

  const cfg = await thresholds.carregar().catch(() => null);
  if (!cfg || cfg.ativos.cotaApi === false) return null;
  if (await _repetidoRecentemente('cotaApi', conta._id, 20)) return null;

  const m = /\((\d+)\/(\d+)/.exec(String(motivo || ''));
  const vars = templates.discretas({
    username: conta.username || '',
    account:  conta.username ? `@${conta.username}` : 'a conta',
    usado:    m ? m[1] : '50',
    limite:   m ? m[2] : '50',
    libera:   ate ? new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'em até 24h',
  }, cfg.privacidade || {});

  const modelo = templates.modeloDe('cotaApi', cfg.mensagens);
  return _gravar({
    accountId: conta._id || null,
    username:  conta.username || '',
    avatar:    conta.avatar || '',
    eventType: 'cotaApi',
    tema:      modelo.tema,
    prioridade: 'media',
    titulo:    templates.render(modelo.titulo, vars),
    mensagem:  templates.render(modelo.mensagem, vars),
    metadados: { motivo: String(motivo || '').slice(0, 300), libera: ate || null },
  });
}

module.exports = {
  notificarContaVoltou,
  notificarCotaDaApi,
  notificarPublicado, notificarErro,
  notificarTokenExpirando, notificarContaCaiu,
};
