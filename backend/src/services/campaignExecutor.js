'use strict';

/**
 * Motor de execução da campanha.
 *
 * A unidade de execução é UMA CampaignPublication = UM job do BullMQ. Não existe
 * job guarda-chuva da campanha: é isso que permite retry individual, cancelar
 * uma publicação sem tocar nas outras e sobreviver a um restart sem reprocessar
 * o que já saiu.
 *
 * ── Por que a publicação é injetada ─────────────────────────────────────────
 *
 * `publicarNaConta` chega por parâmetro em vez de ser importada. O único caminho
 * seguro de publicação do projeto — com lock atômico de `isBusy`, verificação de
 * limite diário e classificação de saúde da conta — é `publishOneAccount`, que
 * vive dentro de `queue/worker.js`. Esse arquivo é um ponto de entrada: ao ser
 * importado ele conecta no Mongo, instancia um Worker e registra intervalos.
 * Importá-lo daqui subiria um segundo worker; reescrever o caminho aqui criaria
 * uma SEGUNDA implementação do lock de conta — e duas implementações de lock
 * significam, na prática, duas publicações simultâneas na mesma conta.
 *
 * A injeção resolve os dois: o worker (que é o composition root) passa a função
 * que já usa, nada muda para Postar/Loop, e o executor fica testável.
 */

const mongoose = require('mongoose');

const Campaign             = require('../models/Campaign');
const CampaignPublication  = require('../models/CampaignPublication');
const Account              = require('../models/Account');
const Media                = require('../models/Media');
const Post                 = require('../models/Post');

const fila = require('./campaignQueue');
const { resolveTemplate } = require('./templateResolver');

/* ── Erros ─────────────────────────────────────────────────────────────────── */

class ExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
  }
}

/** Estados dos quais uma publicação não deve mais sair sozinha. */
const TERMINAIS = new Set(['published', 'cancelled']);

/** Estados que ainda podem ser enfileirados. */
const AGENDAVEIS = ['pending', 'scheduled'];

/* ── Classificação de erro ─────────────────────────────────────────────────── */

/**
 * Traduz a falha em uma categoria estável.
 *
 * O painel filtra e agrupa por este código, então ele não pode depender de
 * texto livre da mensagem, que muda a cada versão da biblioteca. Erros do
 * provider instagrapi já chegam com `code`; o resto é reconhecido por padrão.
 */
function classificarErro(err) {
  const code = String(err?.code || '');
  const msg  = String(err?.message || '').toLowerCase();

  // Códigos que o provider/instagrapi já emite — mapeamento direto.
  const DIRETOS = {
    SESSION_EXPIRED:                'SESSION_EXPIRED',
    NO_INSTAGRAPI_SESSION:          'SESSION_EXPIRED',
    CHALLENGE_REQUIRED:             'ACCOUNT_CHALLENGE',
    FEEDBACK_REQUIRED:              'ACCOUNT_RESTRICTED',
    RATE_LIMITED:                   'RATE_LIMITED',
    INSTAGRAPI_SERVICE_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
    UNSUPPORTED_TYPE:               'UNSUPPORTED_TYPE',
  };
  if (DIRETOS[code]) return DIRETOS[code];

  if (/limite diário|daily limit/.test(msg))                  return 'DAILY_LIMIT';
  if (/conta em uso|tempo de espera esgotado/.test(msg))      return 'ACCOUNT_BUSY';
  if (/banida|banned|disabled/.test(msg))                     return 'ACCOUNT_UNAVAILABLE';
  if (/não encontrada|not found/.test(msg))                   return 'ACCOUNT_UNAVAILABLE';
  if (/rate.?limit|too many/.test(msg))                       return 'RATE_LIMITED';
  if (/proxy|econnrefused|etimedout|enotfound|socket|network/.test(msg)) return 'NETWORK_ERROR';

  return 'PUBLISH_ERROR';
}

/**
 * Classificação específica do comentário.
 *
 * Compartilha a base com a publicação — sessão expirada é sessão expirada nas
 * duas — mas tem categorias próprias: a mídia pode ter sido apagada entre
 * publicar e comentar, e a conta pode simplesmente não ter via de comentário.
 *
 * O padrão é COMMENT_FAILED, nunca UNKNOWN_ERROR: um balde chamado "erro
 * desconhecido" esconde exatamente os casos que precisam ser investigados.
 */
function classificarErroComentario(err) {
  const code = String(err?.code || '');
  const msg  = String(err?.message || '').toLowerCase();

  const DIRETOS = {
    COMMENT_NOT_SUPPORTED:    'COMMENT_NOT_SUPPORTED',
    COMMENT_MEDIA_NOT_FOUND:  'COMMENT_MEDIA_NOT_FOUND',
    COMMENT_EMPTY:            'COMMENT_FAILED',
    SESSION_NOT_LOADED:       'SESSION_EXPIRED',
    NO_INSTAGRAPI_SESSION:    'SESSION_EXPIRED',
    SESSION_EXPIRED:          'SESSION_EXPIRED',
    RATE_LIMITED:             'RATE_LIMITED',
    FEEDBACK_REQUIRED:        'RATE_LIMITED',
    CHALLENGE_REQUIRED:       'ACCOUNT_CHALLENGE',
    ACCOUNT_SUSPENDED:        'ACCOUNT_UNAVAILABLE',
    PROXY_ERROR:              'NETWORK_ERROR',
    NETWORK_ERROR:            'NETWORK_ERROR',
    INSTAGRAPI_SERVICE_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  };
  if (DIRETOS[code]) return DIRETOS[code];

  // Timeout é separado de rede: a requisição chegou, a resposta é que demorou.
  // Reagendar um timeout é seguro só depois de conferir se o comentário saiu.
  if (/timeout|timed out|abort/.test(msg) || err?.name === 'TimeoutError') return 'TIMEOUT';
  if (/media not found|does not exist|invalid media/.test(msg))            return 'COMMENT_MEDIA_NOT_FOUND';
  if (/login required|session/.test(msg))                                  return 'SESSION_EXPIRED';
  if (/rate.?limit|too many|please wait|429/.test(msg))                    return 'RATE_LIMITED';
  if (/proxy|econnrefused|etimedout|enotfound|socket|network/.test(msg))   return 'NETWORK_ERROR';

  return 'COMMENT_FAILED';
}

/* ── Log ───────────────────────────────────────────────────────────────────── */

/**
 * Log estruturado de um evento de publicação.
 *
 * Só entram identificadores e metadados. Senha, sessão, token e proxy nunca
 * aparecem aqui — a publicação carrega a conta inteira em memória, e um
 * `JSON.stringify(account)` num log vazaria credenciais.
 */
function registrarEvento(evento, dados = {}) {
  const linha = {
    evento,
    campaignId:    dados.campaignId    ? String(dados.campaignId)    : undefined,
    publicationId: dados.publicationId ? String(dados.publicationId) : undefined,
    accountId:     dados.accountId     ? String(dados.accountId)     : undefined,
    contentId:     dados.contentId     ? String(dados.contentId)     : undefined,
    // Id da mídia: identificador público do post, não é segredo. Entra no log
    // porque é o que permite conferir manualmente onde o comentário caiu.
    mediaId:       dados.mediaId       ? String(dados.mediaId)       : undefined,
    attempt:       dados.attempt,
    durationMs:    dados.durationMs,
    errorCode:     dados.errorCode,
    error:         dados.error ? String(dados.error).slice(0, 300) : undefined,
    at:            new Date().toISOString(),
  };
  for (const k of Object.keys(linha)) if (linha[k] === undefined) delete linha[k];
  console.log(`[Campaign] ${evento}`, JSON.stringify(linha));
  return linha;
}

/** Emite evento SSE reusando o broadcaster existente — sem segundo mecanismo. */
function emitir(broadcast, acao, dados) {
  if (typeof broadcast !== 'function') return;
  try {
    broadcast('campaigns', { action: acao, ...dados });
  } catch { /* SSE não pode derrubar a execução */ }
}

/* ── Contadores ────────────────────────────────────────────────────────────── */

/**
 * Recalcula os contadores da campanha CONTANDO as publicações.
 *
 * Deliberadamente não usa `$inc`. Incremento acumulativo diverge assim que um
 * processo morre entre a publicação e o incremento — e campanha grande com
 * restart no meio é justamente o cenário desta fase. Contar é O(n) no banco mas
 * roda em índice e é sempre verdade.
 *
 * @returns {Object} contagem por status, com `total`
 */
async function recalcularContadores(campaignId) {
  const linhas = await CampaignPublication.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(String(campaignId)) } },
    { $group: { _id: '$status', total: { $sum: 1 } } },
  ]);

  const c = { total: 0, pending: 0, scheduled: 0, processing: 0, published: 0, failed: 0, cancelled: 0 };
  for (const l of linhas) {
    if (c[l._id] !== undefined) c[l._id] = l.total;
    c.total += l.total;
  }

  // O model tem quatro contadores. "pending" agrega tudo que ainda não terminou,
  // que é o que a lista de campanhas mostra; a divisão fina sai de estatisticas().
  await Campaign.findByIdAndUpdate(campaignId, {
    $set: {
      totalPublications:     c.total,
      pendingPublications:   c.pending + c.scheduled + c.processing,
      publishedPublications: c.published,
      failedPublications:    c.failed,
    },
  });

  return c;
}

/**
 * Fecha a campanha quando todas as publicações chegaram a estado terminal.
 *
 * Usa os status que Campaign.js já tem: `completed` (tudo publicou),
 * `partial` (publicou parte) e `failed` (nada publicou). Nenhum estado novo.
 */
async function finalizarSeCompleta(campaignId, contadores = null) {
  const c = contadores || await recalcularContadores(campaignId);

  const emAberto = c.pending + c.scheduled + c.processing;
  if (emAberto > 0) return null;
  if (c.total === 0) return null;

  const campanha = await Campaign.findById(campaignId);
  if (!campanha) return null;
  if (['cancelled', 'completed', 'partial', 'failed'].includes(campanha.status)) return campanha.status;

  const status = c.published === 0 ? 'failed'
               : c.failed === 0 && c.cancelled === 0 ? 'completed'
               : 'partial';

  await Campaign.findByIdAndUpdate(campaignId, { $set: { status, completedAt: new Date() } });
  registrarEvento('CAMPAIGN_FINISHED', { campaignId, errorCode: status });
  return status;
}

/* ── Agendamento ───────────────────────────────────────────────────────────── */

/**
 * Enfileira todas as publicações agendáveis de uma campanha.
 *
 * Idempotente por construção: o jobId é derivado do id da publicação, então
 * chamar duas vezes (ou dois cliques simultâneos) não duplica nada — ver
 * campaignQueue.js. Também não usa Promise.all sem limite: uma campanha de
 * milhares de publicações abriria milhares de conexões ao Redis de uma vez.
 */
async function agendarCampanha(campaignId, { agora = new Date(), lote = 50 } = {}) {
  const campanha = await Campaign.findById(campaignId);
  if (!campanha) throw new ExecutionError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');

  if (['paused', 'cancelled'].includes(campanha.status)) {
    throw new ExecutionError(
      'INVALID_CAMPAIGN_STATE',
      `Campanha em "${campanha.status}" não pode agendar publicações.`,
    );
  }

  const total = await CampaignPublication.countDocuments({
    campaignId, status: { $in: AGENDAVEIS },
  });

  let agendadas = 0, jaExistiam = 0;

  // `skip` é estável aqui porque 'scheduled' continua dentro de AGENDAVEIS: o
  // conjunto filtrado não encolhe conforme as páginas são processadas. Se um dia
  // o estado de saída sair dessa lista, esta paginação precisa virar keyset.
  for (let pulados = 0; pulados < total; pulados += lote) {
    const pagina = await CampaignPublication
      .find({ campaignId, status: { $in: AGENDAVEIS } })
      .sort({ scheduledAt: 1, _id: 1 })
      .skip(pulados)
      .limit(lote);

    if (!pagina.length) break;

    let atrasadosNestaPagina = 0;
    for (const pub of pagina) {
      let calcDelay = fila.calcularDelay(pub.scheduledAt, agora);
      let novoAgendamento = pub.scheduledAt;

      // Fase 16: Anti-Burst. Se o job está atrasado (delay 0), nós o empurramos
      // para o futuro com espaçamento de segurança (5 a 10 minutos por job atrasado).
      if (calcDelay === 0) {
        const offsetMinutos = (atrasadosNestaPagina * 5) + Math.floor(Math.random() * 5);
        novoAgendamento = new Date(agora.getTime() + offsetMinutos * 60_000);
        calcDelay = fila.calcularDelay(novoAgendamento, agora);
        atrasadosNestaPagina++;
      }

      const { jobId, criado } = await fila.agendarPublicacao(
        { ...pub.toObject(), scheduledAt: novoAgendamento }, 
        agora
      );
      
      if (criado) agendadas++; else jaExistiam++;

      await CampaignPublication.updateOne(
        { _id: pub._id, status: { $in: AGENDAVEIS } },
        { $set: { status: 'scheduled', bullMqJobId: jobId, scheduledAt: novoAgendamento } },
      );

      registrarEvento('PUBLICATION_SCHEDULED', {
        campaignId, publicationId: pub._id,
        accountId: pub.accountId, contentId: pub.contentId,
      });
    }
  }

  const contadores = await recalcularContadores(campaignId);
  return { agendadas, jaExistiam, total, contadores };
}

/* ── Execução de uma publicação ────────────────────────────────────────────── */

/**
 * Executa UMA publicação.
 *
 * @param {string} publicationId
 * @param {Object} deps
 * @param {Function} deps.publicarNaConta  (account, post) => Promise — o
 *        `publishOneAccount` do worker, injetado (ver cabeçalho do arquivo).
 * @param {Function} [deps.broadcast]
 * @param {Date}     [deps.agora]
 */
async function processarPublicacao(publicationId, deps = {}) {
  const { publicarNaConta, broadcast, agora = new Date() } = deps;
  if (typeof publicarNaConta !== 'function') {
    throw new ExecutionError('MISSING_PUBLISHER', 'publicarNaConta não foi injetado.');
  }

  const inicio = Date.now();

  const pub = await CampaignPublication.findById(publicationId);
  if (!pub) return { skipped: true, reason: 'PUBLICATION_NOT_FOUND' };

  // Já publicada ou cancelada — nunca reexecuta. É o que protege contra job
  // duplicado sobrevivente de um restart.
  if (TERMINAIS.has(pub.status)) {
    return { skipped: true, reason: `ALREADY_${pub.status.toUpperCase()}` };
  }

  const campanha = await Campaign.findById(pub.campaignId);
  if (!campanha) return { skipped: true, reason: 'CAMPAIGN_NOT_FOUND' };

  // Campanha cancelada: a publicação acompanha e não roda.
  if (campanha.status === 'cancelled') {
    await CampaignPublication.updateOne(
      { _id: pub._id, status: { $in: [...AGENDAVEIS, 'processing'] } },
      { $set: { status: 'cancelled' } },
    );
    registrarEvento('PUBLICATION_CANCELLED', {
      campaignId: campanha._id, publicationId: pub._id, errorCode: 'CAMPAIGN_CANCELLED',
    });
    return { skipped: true, reason: 'CAMPAIGN_CANCELLED' };
  }

  // Campanha pausada: volta para 'pending' e NÃO consome tentativa. 'pending' e
  // não 'scheduled' porque a pausa já removeu o job da fila — marcá-la como
  // agendada descreveria uma fila que não existe, e o resume a ignoraria por
  // achar que já estava enfileirada.
  if (campanha.status === 'paused') {
    await CampaignPublication.updateOne(
      { _id: pub._id, status: 'scheduled' },
      { $set: { status: 'pending', bullMqJobId: '' } },
    );
    return { skipped: true, reason: 'CAMPAIGN_PAUSED' };
  }

  // Reivindicação atômica. Só um executor consegue sair de pending/scheduled
  // para processing; qualquer job duplicado que chegue depois encontra a linha
  // já tomada e desiste sem publicar.
  const tomada = await CampaignPublication.findOneAndUpdate(
    { _id: pub._id, status: { $in: AGENDAVEIS } },
    { $set: { status: 'processing', error: '', errorCode: '' }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!tomada) {
    return { skipped: true, reason: 'ALREADY_CLAIMED' };
  }

  registrarEvento('PUBLICATION_STARTED', {
    campaignId: campanha._id, publicationId: pub._id,
    accountId: pub.accountId, contentId: pub.contentId, attempt: tomada.attempts,
  });
  emitir(broadcast, 'publication_started', {
    campaignId: String(campanha._id), publicationId: String(pub._id),
  });

  /** Marca falha sem derrubar as outras publicações da campanha. */
  const falhar = async (codigo, mensagem) => {
    await CampaignPublication.updateOne(
      { _id: pub._id },
      { $set: { status: 'failed', error: String(mensagem).slice(0, 500), errorCode: codigo } },
    );
    registrarEvento('PUBLICATION_FAILED', {
      campaignId: campanha._id, publicationId: pub._id,
      accountId: pub.accountId, contentId: pub.contentId,
      attempt: tomada.attempts, durationMs: Date.now() - inicio,
      errorCode: codigo, error: mensagem,
    });
    const contadores = await recalcularContadores(campanha._id);
    await finalizarSeCompleta(campanha._id, contadores);
    emitir(broadcast, 'publication_failed', {
      campaignId: String(campanha._id), publicationId: String(pub._id), errorCode: codigo,
    });
    return { ok: false, errorCode: codigo };
  };

  // Conta e conteúdo podem ter sumido entre o planejamento e a execução.
  const conta = await Account.findById(pub.accountId).lean();
  if (!conta) return falhar('ACCOUNT_UNAVAILABLE', 'A conta desta publicação não existe mais.');
  if (conta.healthStatus === 'banida') {
    return falhar('ACCOUNT_UNAVAILABLE', `Conta @${conta.username} está banida.`);
  }

  const midia = await Media.findById(pub.contentId).lean();
  if (!midia) return falhar('CONTENT_NOT_FOUND', 'O conteúdo desta publicação não existe mais.');

  // `Post.media` guarda o NOME do arquivo, que o publicador resolve dentro de
  // uploads/. Cair para `url` aqui produziria "/uploads/x.mp4" e um caminho
  // duplicado na hora de ler o arquivo — melhor falhar de forma legível.
  const arquivo = midia.filename || '';
  if (!arquivo) return falhar('CONTENT_NOT_FOUND', 'O conteúdo não possui arquivo associado.');

  // Contexto de resolução — mesmos nomes que o templateResolver espera.
  const contexto = {
    username:    conta.username || '',
    name:        conta.name || '',
    campaign:    campanha.name || '',
    contentName: midia.originalName || midia.filename || '',
    now:         pub.scheduledAt,
  };
  // Cai para o texto já materializado na criação se o template estiver vazio —
  // campanhas criadas antes desta resolução continuam publicando corretamente.
  const legendaFinal = resolveTemplate(pub.captionTemplate, contexto).text || pub.resolvedCaption || '';

  try {
    // Um Post por publicação (decisão 2 da fase 2): preserva a tela de Posts e o
    // histórico por conta que já existem.
    const ehVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(arquivo);
    let   postType  = campanha.settings?.postType || 'reel';
    if (postType === 'reel' && !ehVideo) postType = 'post';

    const post = await Post.create({
      media:       arquivo,
      mediaType:   ehVideo ? 'video' : 'image',
      postType,
      // Legenda resolvida AGORA, a partir do template que o planner escolheu
      // para este par conta+conteúdo. A escolha de QUAL template usar continua
      // sendo só do planner — aqui só as variáveis são substituídas, pelo
      // templateResolver oficial. Resolver na execução mantém o texto fiel se o
      // username da conta mudou entre o planejamento e a publicação.
      caption:     legendaFinal,
      location:    campanha.settings?.location    || '',
      processMode: campanha.settings?.processMode || 'limpeza_leve',
      accounts:    [conta._id],
      status:      'processando',
      scheduledAt: pub.scheduledAt,
    });

    // O retorno traz o id da mídia criada. É ele que amarra o comentário a ESTA
    // publicação — sem ele o comentário teria de adivinhar qual post é o alvo.
    const resultado = await publicarNaConta(conta, post);
    const mediaId   = String(resultado?.mediaId || '');

    post.status = 'concluido';
    post.error  = '';
    await post.save();

    await CampaignPublication.updateOne(
      { _id: pub._id },
      { $set: {
        status: 'published', publishedAt: new Date(), postId: post._id,
        instagramMediaId: mediaId, error: '', errorCode: '',
        // Registra o texto que foi de fato enviado, não o template.
        resolvedCaption: legendaFinal,
      } },
    );

    registrarEvento('PUBLICATION_SUCCESS', {
      campaignId: campanha._id, publicationId: pub._id,
      accountId: conta._id, contentId: pub.contentId,
      attempt: tomada.attempts, durationMs: Date.now() - inicio,
      mediaId,
    });

    // Comentário vira job PRÓPRIO. O worker não dorme esperando o atraso.
    await agendarComentarioDe({ ...pub.toObject?.() ?? pub, instagramMediaId: mediaId }, campanha);

    const contadores = await recalcularContadores(campanha._id);
    await finalizarSeCompleta(campanha._id, contadores);

    emitir(broadcast, 'publication_success', {
      campaignId: String(campanha._id), publicationId: String(pub._id),
    });

    return { ok: true, postId: String(post._id) };
  } catch (err) {
    return falhar(classificarErro(err), err.message || 'Falha ao publicar');
  }
}

/* ── Comentário ────────────────────────────────────────────────────────────── */

/** Agenda o comentário de uma publicação recém-publicada, se houver texto. */
async function agendarComentarioDe(pub, campanha) {
  if (campanha.commentMode === 'disabled') return null;
  if (!String(pub.resolvedComment || '').trim()) return null;

  const { jobId, criado } = await fila.agendarComentario(
    pub, campanha.comments?.delayMinutes ?? 2,
  );

  await CampaignPublication.updateOne(
    { _id: pub._id, commentStatus: { $in: ['none', 'failed'] } },
    { $set: { commentStatus: 'scheduled', commentJobId: jobId } },
  );

  return { jobId, criado };
}

/**
 * Publica o comentário de uma publicação.
 *
 * O comentário vai para a mídia identificada por `instagramMediaId`, gravado no
 * momento da publicação. Não existe busca por "mídia mais recente da conta":
 * numa campanha a mesma conta publica várias vezes, e a mais recente
 * frequentemente não é o alvo pretendido.
 *
 * @param {Function} deps.comentarNaConta (account, { mediaId, text }) => Promise
 */
async function processarComentario(publicationId, deps = {}) {
  const { comentarNaConta, broadcast } = deps;
  const inicio = Date.now();

  const pub = await CampaignPublication.findById(publicationId);
  if (!pub) return { skipped: true, reason: 'PUBLICATION_NOT_FOUND' };

  // Comentar exige que o post exista. Se a publicação falhou ou foi cancelada
  // depois do agendamento, não há onde comentar.
  if (pub.status !== 'published') return { skipped: true, reason: 'NOT_PUBLISHED' };
  if (pub.commentStatus === 'posted')    return { skipped: true, reason: 'ALREADY_POSTED' };
  if (pub.commentStatus === 'cancelled') return { skipped: true, reason: 'CANCELLED' };

  const campanha = await Campaign.findById(pub.campaignId);
  if (!campanha) return { skipped: true, reason: 'CAMPAIGN_NOT_FOUND' };
  if (campanha.status === 'cancelled') {
    await CampaignPublication.updateOne({ _id: pub._id }, { $set: { commentStatus: 'cancelled' } });
    return { skipped: true, reason: 'CAMPAIGN_CANCELLED' };
  }

  /** Marca a falha do comentário sem tocar no estado da publicação. */
  const falharComentario = async (codigo, mensagem) => {
    await CampaignPublication.updateOne(
      { _id: pub._id },
      { $set: {
        commentStatus: 'failed',
        commentError:  String(mensagem || '').slice(0, 500),
        commentErrorCode: codigo,
      } },
    );
    registrarEvento('COMMENT_FAILED', {
      campaignId: pub.campaignId, publicationId: pub._id, accountId: pub.accountId,
      mediaId: pub.instagramMediaId, durationMs: Date.now() - inicio,
      errorCode: codigo, error: mensagem,
    });
    emitir(broadcast, 'comment_failed', {
      campaignId: String(pub.campaignId), publicationId: String(pub._id), errorCode: codigo,
    });
    // Falha de comentário NÃO reverte a publicação: o post já está no ar.
    return { ok: false, errorCode: codigo };
  };

  const conta = await Account.findById(pub.accountId).lean();
  if (!conta) return falharComentario('ACCOUNT_UNAVAILABLE', 'A conta desta publicação não existe mais.');

  const midiaDoComentario = await Media.findById(pub.contentId).lean();
  const texto = resolveTemplate(pub.commentTemplate, {
    username:    conta.username || '',
    name:        conta.name || '',
    campaign:    campanha.name || '',
    contentName: midiaDoComentario?.originalName || midiaDoComentario?.filename || '',
    now:         pub.scheduledAt,
  }).text.trim() || String(pub.resolvedComment || '').trim();

  if (!texto) return { skipped: true, reason: 'NO_COMMENT_TEXT' };

  // Sem o id da mídia não há como saber ONDE comentar. Falhar aqui é
  // deliberado: comentar na "mídia mais recente" acertaria por acaso e erraria
  // em silêncio no post de outra publicação da mesma conta.
  const mediaId = String(pub.instagramMediaId || '');
  if (!mediaId) {
    return falharComentario(
      'COMMENT_MEDIA_NOT_FOUND',
      'A publicação não registrou o id da mídia — a via usada não o expõe.',
    );
  }

  await CampaignPublication.updateOne({ _id: pub._id }, { $inc: { commentAttempts: 1 } });

  try {
    if (typeof comentarNaConta !== 'function') {
      throw new ExecutionError('COMMENT_NOT_SUPPORTED', 'Publicação de comentário não disponível.');
    }
    const r = await comentarNaConta(conta, { mediaId, text: texto });

    await CampaignPublication.updateOne(
      { _id: pub._id },
      { $set: {
        commentStatus: 'posted', commentPostedAt: new Date(),
        commentError: '', commentErrorCode: '',
        commentId: String(r?.commentId || ''),
        resolvedComment: texto,
      } },
    );
    registrarEvento('COMMENT_POSTED', {
      campaignId: pub.campaignId, publicationId: pub._id, accountId: conta._id,
      mediaId, durationMs: Date.now() - inicio,
    });
    emitir(broadcast, 'comment_posted', {
      campaignId: String(pub.campaignId), publicationId: String(pub._id),
    });
    return { ok: true, mediaId, commentId: String(r?.commentId || '') };
  } catch (err) {
    return falharComentario(classificarErroComentario(err), err.message || 'Falha ao comentar');
  }
}

/* ── Pausa, retomada e cancelamento ────────────────────────────────────────── */

/**
 * Pausa: remove da fila os jobs ainda não executados.
 *
 * O que já está em `processing` continua até o fim — interromper no meio
 * deixaria o post publicado no Instagram sem registro correspondente aqui.
 */
async function pausarCampanha(campaignId) {
  const pendentes = await CampaignPublication
    .find({ campaignId, status: { $in: AGENDAVEIS } })
    .select('_id commentStatus')
    .lean();

  let removidos = 0;
  for (const p of pendentes) {
    if (await fila.removerPublicacao(p._id)) removidos++;
  }

  await CampaignPublication.updateMany(
    { campaignId, status: 'scheduled' },
    { $set: { status: 'pending', bullMqJobId: '' } },
  );

  registrarEvento('CAMPAIGN_PAUSED', { campaignId });
  return { removidos, pendentes: pendentes.length };
}

/**
 * Retomada: reenfileira apenas o que ficou pendente.
 *
 * Não duplica porque `agendarCampanha` só olha pending/scheduled — publicadas,
 * falhadas e canceladas ficam de fora — e o jobId determinístico rejeitaria a
 * segunda inserção de qualquer forma.
 */
async function retomarCampanha(campaignId, { agora = new Date() } = {}) {
  const r = await agendarCampanha(campaignId, { agora });
  registrarEvento('CAMPAIGN_RESUMED', { campaignId });
  return r;
}

/** Cancelamento: tira da fila publicações E comentários ainda não executados. */
async function cancelarCampanha(campaignId) {
  const alvos = await CampaignPublication
    .find({
      campaignId,
      $or: [{ status: { $in: AGENDAVEIS } }, { commentStatus: 'scheduled' }],
    })
    .select('_id status commentStatus')
    .lean();

  for (const p of alvos) {
    if (AGENDAVEIS.includes(p.status)) await fila.removerPublicacao(p._id);
    if (p.commentStatus === 'scheduled') await fila.removerComentario(p._id);
  }

  const pubs = await CampaignPublication.updateMany(
    { campaignId, status: { $in: AGENDAVEIS } },
    { $set: { status: 'cancelled', bullMqJobId: '' } },
  );

  await CampaignPublication.updateMany(
    { campaignId, commentStatus: 'scheduled' },
    { $set: { commentStatus: 'cancelled', commentJobId: '' } },
  );

  const contadores = await recalcularContadores(campaignId);
  registrarEvento('CAMPAIGN_CANCELLED', { campaignId });
  return { canceladas: pubs.modifiedCount ?? 0, contadores };
}

/**
 * Reprocessa UMA publicação.
 *
 * Reaproveita a mesma linha — não cria CampaignPublication nova, o que também
 * violaria o índice único conta+conteúdo. `attempts` é preservado e será
 * incrementado pela execução.
 */
async function reprocessarPublicacao(publicationId, { agora = new Date() } = {}) {
  const pub = await CampaignPublication.findById(publicationId);
  if (!pub) throw new ExecutionError('PUBLICATION_NOT_FOUND', 'Publicação não encontrada.');

  if (pub.status === 'published') {
    throw new ExecutionError('ALREADY_PUBLISHED', 'Esta publicação já foi publicada.');
  }
  if (pub.status === 'processing') {
    throw new ExecutionError('PUBLICATION_RUNNING', 'Esta publicação está em execução.');
  }

  await CampaignPublication.updateOne(
    { _id: pub._id },
    { $set: { status: 'scheduled', error: '', errorCode: '' } },
  );

  // Sem remover o job anterior, o jobId determinístico devolveria o job velho.
  pub.status = 'scheduled';
  const { jobId, delay } = await fila.reagendarPublicacao(
    { _id: pub._id, campaignId: pub.campaignId, scheduledAt: agora }, agora,
  );

  await CampaignPublication.updateOne({ _id: pub._id }, { $set: { bullMqJobId: jobId } });

  registrarEvento('PUBLICATION_RETRY', {
    campaignId: pub.campaignId, publicationId: pub._id,
    accountId: pub.accountId, contentId: pub.contentId, attempt: pub.attempts,
  });

  await recalcularContadores(pub.campaignId);
  return { jobId, delay };
}

/**
 * Reprocessa UM comentário que falhou.
 *
 * Independente do retry da publicação: o post já está no ar e não pode ser
 * republicado. Reaproveita a mesma linha, não cria CampaignPublication nova.
 * Uma falha entre 16 comentários volta sozinha — as outras 15 seguem intactas.
 */
async function reprocessarComentario(publicationId, { agora = new Date() } = {}) {
  const pub = await CampaignPublication.findById(publicationId);
  if (!pub) throw new ExecutionError('PUBLICATION_NOT_FOUND', 'Publicação não encontrada.');

  if (pub.status !== 'published') {
    throw new ExecutionError('NOT_PUBLISHED', 'Só é possível comentar em publicação que saiu.');
  }
  if (pub.commentStatus === 'posted') {
    throw new ExecutionError('ALREADY_POSTED', 'Este comentário já foi publicado.');
  }
  if (!String(pub.instagramMediaId || '')) {
    throw new ExecutionError(
      'COMMENT_MEDIA_NOT_FOUND',
      'A publicação não registrou o id da mídia — não há onde comentar com segurança.',
    );
  }

  // Sem remover o job anterior, o jobId determinístico devolveria o já concluído.
  await fila.removerComentario(pub._id);
  const { jobId } = await fila.agendarComentario(pub, 0, agora);

  await CampaignPublication.updateOne(
    { _id: pub._id },
    { $set: { commentStatus: 'scheduled', commentJobId: jobId, commentError: '', commentErrorCode: '' } },
  );

  registrarEvento('COMMENT_RETRY', {
    campaignId: pub.campaignId, publicationId: pub._id,
    accountId: pub.accountId, mediaId: pub.instagramMediaId,
    attempt: pub.commentAttempts,
  });

  return { jobId };
}

module.exports = {
  ExecutionError,
  AGENDAVEIS,
  classificarErro,
  classificarErroComentario,
  reprocessarComentario,
  registrarEvento,
  recalcularContadores,
  finalizarSeCompleta,
  agendarCampanha,
  processarPublicacao,
  agendarComentarioDe,
  processarComentario,
  pausarCampanha,
  retomarCampanha,
  cancelarCampanha,
  reprocessarPublicacao,
};
