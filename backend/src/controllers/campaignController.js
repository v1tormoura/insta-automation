'use strict';

const Campaign            = require('../models/Campaign');
const CampaignPublication = require('../models/CampaignPublication');
const Setting             = require('../models/Setting');

const svc = require('../services/campaignService');
const { CampaignError } = svc;
const { garantirTransicao, CampaignStateError } = require('../services/campaignState');
const { campanhaSegura, publicacaoSegura } = require('../utils/campaignSerializer');
const executor = require('../services/campaignExecutor');

/**
 * Camada HTTP da Campaign API. Regra de negócio vive em campaignService;
 * transição de estado, em campaignState. Aqui só entra tradução
 * requisição → serviço → resposta.
 */

/* ── Utilidades ────────────────────────────────────────────────────────────── */

const STATUS_HTTP = {
  NAME_REQUIRED:         400,
  NO_ACCOUNTS:           400,
  NO_CONTENTS:           400,
  INVALID_ID:            400,
  INVALID_STRATEGY:      400,
  INVALID_CAPTION_MODE:  400,
  INVALID_COMMENT_MODE:  400,
  INVALID_INTERVAL:      400,
  INVALID_WINDOW:        400,
  INVALID_WEEKDAYS:      400,
  INVALID_START_AT:      400,
  EMPTY_PLAN:            400,
  ACCOUNT_NOT_FOUND:     404,
  CONTENT_NOT_FOUND:     404,
  CAMPAIGN_NOT_FOUND:    404,
  PUBLICATION_NOT_FOUND: 404,
  ACCOUNT_NOT_ELIGIBLE:  409,
  INVALID_CAMPAIGN_STATE:409,
  INVALID_PUBLICATION_STATE: 409,
  ALREADY_PUBLISHED:     409,
  PUBLICATION_RUNNING:   409,
  ALREADY_POSTED:        409,
  NOT_PUBLISHED:         409,
  COMMENT_MEDIA_NOT_FOUND: 409,
  PLAN_PERSIST_FAILED:   500,
  MISSING_PUBLISHER:     500,
};

/** Converte erro de domínio em resposta HTTP; o resto vira 500 genérico. */
function _responderErro(res, err) {
  if (err instanceof CampaignError || err instanceof CampaignStateError) {
    const status = STATUS_HTTP[err.code] || 400;
    const corpo  = { code: err.code, message: err.message };
    for (const extra of ['missingIds', 'accounts', 'invalidos', 'fora', 'from', 'to']) {
      if (err[extra] !== undefined) corpo[extra] = err[extra];
    }
    return res.status(status).json(corpo);
  }
  console.error('[Campaign] erro inesperado:', err);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
}

async function _buscarCampanha(id) {
  const campanha = await Campaign.findById(id);
  if (!campanha) {
    throw new CampaignError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
  }
  return campanha;
}

/** Muda o status validando a transição na máquina de estados. */
async function _transicionar(campanha, novoStatus, camposExtra = {}) {
  garantirTransicao(campanha.status, novoStatus);
  campanha.status = novoStatus;
  Object.assign(campanha, camposExtra);
  await campanha.save();
  return campanha;
}

/* ── Criação ───────────────────────────────────────────────────────────────── */

/**
 * POST /campaigns
 *
 * Idempotência opcional pelo header `Idempotency-Key`: um reenvio por timeout
 * de rede devolve a campanha já criada em vez de criar outra. Sem o header o
 * comportamento é o de sempre, preservando clientes antigos.
 */
exports.create = async (req, res) => {
  const chave = req.get('Idempotency-Key');
  const chaveSetting = chave ? `idem:campaign:${chave}` : null;

  try {
    if (chaveSetting) {
      // O índice único de Setting.key faz a reserva ser atômica: duas
      // requisições concorrentes, só uma cria.
      try {
        await Setting.create({ key: chaveSetting, value: { status: 'in_progress' } });
      } catch (err) {
        if (err?.code === 11000) {
          const existente = await Setting.findOne({ key: chaveSetting }).lean();
          const campaignId = existente?.value?.campaignId;
          if (campaignId) {
            const campanha = await Campaign.findById(campaignId);
            if (campanha) {
              return res.status(200).json({ campaign: campanhaSegura(campanha), idempotent: true });
            }
          }
          return res.status(409).json({
            code:    'IDEMPOTENCY_IN_PROGRESS',
            message: 'Uma requisição com esta Idempotency-Key ainda está em processamento.',
          });
        }
        throw err;
      }
    }

    let campanha;
    try {
      campanha = await svc.criarCampanha(req.body || {});
    } catch (err) {
      // Libera a chave para o cliente poder corrigir e reenviar.
      if (chaveSetting) await Setting.deleteOne({ key: chaveSetting }).catch(() => {});
      throw err;
    }

    if (chaveSetting) {
      await Setting.findOneAndUpdate(
        { key: chaveSetting },
        { value: { campaignId: String(campanha._id), at: new Date() } }
      ).catch(() => {});
    }

    return res.status(201).json({ campaign: campanhaSegura(campanha) });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * POST /campaigns/preview
 *
 * Roda validação e planner e devolve o plano com os textos já materializados,
 * SEM gravar nada. Usa o mesmo templateResolver da execução, então o que a tela
 * mostra é o texto que será publicado — não uma aproximação.
 */
exports.preview = async (req, res) => {
  try {
    const previa = await svc.preverCampanha(req.body || {});
    return res.json(previa);
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * GET /campaigns/variables
 *
 * Lista as marcações que o templateResolver realmente suporta. A interface lê
 * daqui em vez de manter a própria lista — assim o botão "inserir variável"
 * nunca oferece algo que a execução não resolve.
 */
exports.variables = (req, res) => {
  const { listarVariaveis } = require('../services/templateResolver');
  return res.json({ variables: listarVariaveis() });
};

/* ── Consulta ──────────────────────────────────────────────────────────────── */

/** GET /campaigns?page&limit&status&search */
exports.list = async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const filtro = {};
    if (req.query.status) filtro.status = req.query.status;
    if (req.query.search) {
      // Escapa a busca: sem isso um "(" digitado pelo usuário quebra a regex.
      const termo = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filtro.name = { $regex: termo, $options: 'i' };
    }

    const [campanhas, total] = await Promise.all([
      Campaign.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Campaign.countDocuments(filtro),
    ]);

    /* ── O que vem a seguir, para cada card ──────────────────────────────

       O detalhe da campanha já respondia isso (`svc.proximaPublicacao`), mas a
       LISTA não — e a lista é onde se olha primeiro. O card mostrava "4 / 12" e
       "criada 31/08", dois fatos sobre o passado, e nada sobre o que vai
       acontecer.

       Um agregado só, e não uma consulta por campanha: com vinte campanhas na
       tela, o `findOne` por card seriam vinte idas ao banco a cada
       atualização da página.

       `$min` sobre as pendentes dá o horário da próxima; a contagem por status
       vem junto na mesma passagem, porque percorrer duas vezes a mesma coleção
       para responder duas perguntas sobre ela é desperdício. */
    const ids = campanhas.map(c => c._id);
    const resumo = ids.length ? await CampaignPublication.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: {
        _id: '$campaignId',
        proximaEm: {
          $min: {
            $cond: [
              { $in: ['$status', ['pending', 'scheduled', 'processing']] },
              '$scheduledAt',
              null,
            ],
          },
        },
        pendentes:  { $sum: { $cond: [{ $in: ['$status', ['pending', 'scheduled']] }, 1, 0] } },
        emCurso:    { $sum: { $cond: [{ $eq: ['$status', 'processing'] }, 1, 0] } },
        publicadas: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
        falhas:     { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      } },
    ]).catch(() => []) : [];

    const porCampanha = Object.fromEntries(
      resumo.map(r => [String(r._id), r])
    );

    return res.json({
      campaigns: campanhas.map(c => {
        const r = porCampanha[String(c._id)] || {};
        return {
          ...campanhaSegura(c),
          proximaEm:  r.proximaEm || null,
          pendentes:  r.pendentes  || 0,
          emCurso:    r.emCurso    || 0,
          publicadas: r.publicadas || 0,
          falhas:     r.falhas     || 0,
        };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/** GET /campaigns/:id */
exports.get = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);

    const [stats, comentarios, proxima] = await Promise.all([
      svc.estatisticas(campanha._id),
      svc.estatisticasComentario(campanha._id),
      svc.proximaPublicacao(campanha._id),
    ]);

    const concluidas = stats.published + stats.failed + stats.cancelled;
    const progress = {
      done:       concluidas,
      total:      stats.total,
      percentage: stats.total ? Math.round((concluidas / stats.total) * 100) : 0,
    };

    return res.json({
      campaign:   campanhaSegura(campanha),
      statistics: stats,
      // Contagem de comentários: o ciclo do comentário é separado do da
      // publicação e não sai de `statistics`, que agrupa por status do post.
      commentStatistics: comentarios,
      // A próxima a sair, resolvida no banco — a listagem é paginada e deduzir
      // isso de uma página daria resposta errada em campanha grande.
      nextPublication: proxima ? publicacaoSegura(proxima) : null,
      schedule:   campanha.schedule,
      settings:   campanha.settings,
      progress,
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/** PATCH /campaigns/:id — edita apenas metadados; plano não é regerado aqui. */
exports.update = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);

    if (['completed', 'cancelled'].includes(campanha.status)) {
      throw new CampaignError(
        'INVALID_CAMPAIGN_STATE',
        `Campanha em "${campanha.status}" não pode ser editada.`
      );
    }

    // Só nome e descrição: mudar contas, conteúdos ou agenda exigiria replanejar
    // e invalidaria publicações já materializadas. Isso é escopo de outra fase.
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) {
        throw new CampaignError('NAME_REQUIRED', 'A campanha precisa de um nome.');
      }
      campanha.name = String(req.body.name).trim();
    }
    if (req.body.description !== undefined) campanha.description = req.body.description;

    await campanha.save();
    return res.json({ campaign: campanhaSegura(campanha) });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/** DELETE /campaigns/:id — remove campanha e suas publicações. */
exports.remove = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    await CampaignPublication.deleteMany({ campaignId: campanha._id });
    await Campaign.deleteOne({ _id: campanha._id });
    return res.json({ success: true });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/* ── Controle de estado ────────────────────────────────────────────────────── */

/**
 * POST /campaigns/:id/start
 *
 * Nesta fase apenas prepara o estado — nada é enviado ao Instagram. A execução
 * é da fase 8.
 */
/**
 * GET /campaigns/:id/eventos
 *
 * A linha do tempo. Existe porque o estado final de uma campanha —
 * "falhou" — diz o resultado e esconde o caminho: não distingue "nenhuma
 * tentou" de "três publicaram e a quarta pegou 407".
 *
 * O resumo por código vem junto porque é ele que aponta a causa: quinze
 * eventos com `PROXY_ERROR` são uma frase; quinze linhas para ler, não.
 */
exports.eventos = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    const CampaignEvent = require('../models/CampaignEvent');

    const limite = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
    const filtro = { campaignId: campanha._id };
    if (req.query.publicationId) filtro.publicationId = String(req.query.publicationId);

    const [itens, porCodigo] = await Promise.all([
      CampaignEvent.find(filtro).sort({ criadoEm: -1 }).limit(limite).lean(),
      CampaignEvent.aggregate([
        { $match: { campaignId: campanha._id, errorCode: { $ne: '' } } },
        { $group: { _id: '$errorCode', n: { $sum: 1 }, ultimo: { $max: '$criadoEm' } } },
        { $sort: { n: -1 } },
        { $limit: 8 },
      ]),
    ]);

    res.json({
      itens,
      erros: porCodigo.map(e => ({ codigo: e._id, ocorrencias: e.n, ultimo: e.ultimo })),
      total: itens.length,
    });
  } catch (err) {
    const status = err.code === 'CAMPAIGN_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: err.message, code: err.code || 'EVENTOS_ERRO' });
  }
};

exports.start = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    const stats    = await svc.estatisticas(campanha._id);

    if (stats.total === 0) {
      throw new CampaignError('EMPTY_PLAN', 'A campanha não possui publicações planejadas.');
    }
    const executaveis = stats.pending + stats.scheduled;
    if (executaveis === 0) {
      throw new CampaignError(
        'EMPTY_PLAN',
        'Não há publicações pendentes — todas já foram publicadas, falharam ou foram canceladas.'
      );
    }

    await _transicionar(campanha, 'scheduled', {
      startedAt: campanha.startedAt || new Date(),
    });

    // Enfileira de fato. Idempotente pelo jobId determinístico: dois cliques em
    // "Publicar campanha" produzem 16 jobs para 16 publicações, não 32.
    const r = await executor.agendarCampanha(campanha._id);

    /* Confere o ambiente e devolve junto — sem bloquear.
    
       Subir uma campanha com o proxy fora do ar produzia dezesseis publicações
       falhando uma a uma, e só ao fim dava para entender por quê. A conferência
       custa segundos e diz de saída que nada vai passar.
       
       Não bloqueia porque agendar é reversível e a conferência pode errar: uma
       instabilidade de dez segundos não deveria impedir quem quer agendar
       mesmo assim. */
    let ambiente = null;
    try {
      ambiente = await require('../services/preflightConexao').conferir();
    } catch { /* diagnóstico não derruba o agendamento */ }

    return res.json({
      campaign:   campanhaSegura(campanha),
      scheduled:  r.agendadas,
      alreadyQueued: r.jaExistiam,
      total:      executaveis,
      ambiente,
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/** POST /campaigns/:id/pause — muda estado; não apaga nem reordena nada. */
exports.pause = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    await _transicionar(campanha, 'paused');

    // Tira da fila o que ainda não rodou. O que já está publicando termina —
    // abortar no meio deixaria o post no ar sem registro correspondente.
    const r = await executor.pausarCampanha(campanha._id);

    return res.json({ campaign: campanhaSegura(campanha), dequeued: r.removidos });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * POST /campaigns/:id/resume
 *
 * Retoma de onde parou: as publicações existentes são preservadas, nenhuma é
 * recriada — o índice único conta+conteúdo também impediria.
 */
exports.resume = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    if (campanha.status !== 'paused') {
      throw new CampaignError(
        'INVALID_CAMPAIGN_STATE',
        `Só é possível retomar uma campanha pausada — esta está em "${campanha.status}".`
      );
    }
    await _transicionar(campanha, 'scheduled');

    // Reenfileira só o que ficou pendente. Publicadas, falhadas e canceladas
    // não voltam, e o jobId determinístico impede duplicar as que já estavam.
    const r = await executor.retomarCampanha(campanha._id);

    return res.json({
      campaign: campanhaSegura(campanha),
      pending:  r.total,
      requeued: r.agendadas,
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * POST /campaigns/:id/cancel
 *
 * Cancela a campanha e as publicações ainda não executadas. Histórico,
 * tentativas e erros são preservados — publicadas e falhadas não são tocadas.
 */
exports.cancel = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    await _transicionar(campanha, 'cancelled', { completedAt: new Date() });

    // Remove da fila publicações E comentários ainda não executados, e marca as
    // linhas. Publicadas e falhadas ficam como estão — o histórico é preservado.
    const r = await executor.cancelarCampanha(campanha._id);

    return res.json({
      campaign:  campanhaSegura(campanha),
      cancelled: r.canceladas,
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * POST /campaigns/:id/retry-failed
 *
 * Devolve as falhas para 'scheduled' sem criar registros novos: a mesma linha é
 * reaproveitada e o histórico de attempts permanece. O incremento de attempts
 * acontece na execução real, não aqui.
 */
exports.retryFailed = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);

    if (campanha.status === 'cancelled') {
      throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não pode reexecutar falhas.');
    }

    const falhadas = await CampaignPublication
      .find({ campaignId: campanha._id, status: 'failed' })
      .select('_id')
      .lean();

    if (falhadas.length && ['failed', 'partial', 'completed'].includes(campanha.status)) {
      await _transicionar(campanha, 'scheduled', { completedAt: null });
    }

    // Uma a uma pelo mesmo caminho do botão Reprocessar: cada publicação tem o
    // job anterior removido antes de ser reenfileirada. Sem essa remoção o
    // jobId determinístico devolveria o job já concluído e nada rodaria.
    let reprogramadas = 0;
    for (const f of falhadas) {
      try { await executor.reprocessarPublicacao(f._id); reprogramadas++; }
      catch (e) { console.error('[Campaign] retry-failed', String(f._id), e.message); }
    }

    return res.json({ campaign: campanhaSegura(campanha), retried: reprogramadas });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/* ── Publicações ───────────────────────────────────────────────────────────── */

/** GET /campaigns/:id/publications?page&limit&status&accountId&contentId */
exports.listPublications = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);

    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip  = (page - 1) * limit;

    const filtro = { campaignId: campanha._id };
    if (req.query.status)    filtro.status    = req.query.status;
    if (req.query.accountId) filtro.accountId = req.query.accountId;
    if (req.query.contentId) filtro.contentId = req.query.contentId;

    const [publicacoes, total] = await Promise.all([
      CampaignPublication.find(filtro)
        .sort({ scheduledAt: 1, order: 1 })
        .skip(skip).limit(limit)
        .populate('accountId', 'username name avatar provider healthStatus postsToday proxy')
        .populate('contentId', 'filename originalName url type folder'),
      CampaignPublication.countDocuments(filtro),
    ]);

    return res.json({
      publications: publicacoes.map(publicacaoSegura),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

async function _buscarPublicacao(campaignId, publicationId) {
  const pub = await CampaignPublication.findOne({ _id: publicationId, campaignId })
    .populate('accountId', 'username name avatar provider healthStatus postsToday proxy')
    .populate('contentId', 'filename originalName url type folder');

  if (!pub) {
    throw new CampaignError(
      'PUBLICATION_NOT_FOUND',
      'Publicação não encontrada nesta campanha.'
    );
  }
  return pub;
}

/** GET /campaigns/:id/publications/:publicationId */
exports.getPublication = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    const pub = await _buscarPublicacao(campanha._id, req.params.publicationId);
    return res.json({
      publication: publicacaoSegura(pub),
      campaign:    campanhaSegura(campanha),
    });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/**
 * POST /campaigns/:id/publications/:publicationId/retry
 *
 * Reaproveita a linha existente — nunca cria outra CampaignPublication. attempts
 * é preservado e só cresce na execução real.
 */
exports.retryPublication = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    if (campanha.status === 'cancelled') {
      throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não permite reexecução.');
    }

    const pub = await _buscarPublicacao(campanha._id, req.params.publicationId);

    if (!['failed', 'cancelled'].includes(pub.status)) {
      throw new CampaignError(
        'INVALID_PUBLICATION_STATE',
        `Só é possível reexecutar publicação com falha ou cancelada — esta está em "${pub.status}".`
      );
    }

    // Conta e conteúdo podem ter sido removidos entre o planejamento e agora.
    if (!pub.accountId) throw new CampaignError('ACCOUNT_NOT_FOUND', 'A conta desta publicação não existe mais.');
    if (!pub.contentId) throw new CampaignError('CONTENT_NOT_FOUND', 'O conteúdo desta publicação não existe mais.');

    // Reaproveita a MESMA linha e reenfileira só ela — a campanha inteira não é
    // recriada. attempts é preservado e incrementado pela execução.
    await executor.reprocessarPublicacao(pub._id);

    const atualizada = await _buscarPublicacao(campanha._id, req.params.publicationId);
    return res.json({ publication: publicacaoSegura(atualizada) });
  } catch (err) {
    return _responderErro(res, err);
  }
};

/** POST /campaigns/:id/publications/:publicationId/cancel — só esta publicação. */
/**
 * POST /campaigns/:id/publications/:publicationId/retry-comment
 *
 * Reprocessa só o comentário. Separado do retry da publicação porque o post já
 * está no ar e não pode ser republicado — 15 comentários seguem intactos
 * enquanto o 16º volta sozinho.
 */
exports.retryComment = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    if (campanha.status === 'cancelled') {
      throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não permite reexecução.');
    }

    const pub = await _buscarPublicacao(campanha._id, req.params.publicationId);
    await executor.reprocessarComentario(pub._id);

    const atualizada = await _buscarPublicacao(campanha._id, req.params.publicationId);
    return res.json({ publication: publicacaoSegura(atualizada) });
  } catch (err) {
    return _responderErro(res, err);
  }
};

exports.cancelPublication = async (req, res) => {
  try {
    const campanha = await _buscarCampanha(req.params.id);
    const pub = await _buscarPublicacao(campanha._id, req.params.publicationId);

    if (['published', 'cancelled'].includes(pub.status)) {
      throw new CampaignError(
        'INVALID_PUBLICATION_STATE',
        `Publicação em "${pub.status}" não pode ser cancelada.`
      );
    }

    // Tira da fila antes de marcar: o job removido não chega a rodar, e se já
    // estiver ativo o estado 'cancelled' o faz desistir na reivindicação.
    const campaignQueue = require('../services/campaignQueue');
    await campaignQueue.removerPublicacao(pub._id);
    await campaignQueue.removerComentario(pub._id);

    pub.status       = 'cancelled';
    pub.bullMqJobId  = '';
    if (pub.commentStatus === 'scheduled') pub.commentStatus = 'cancelled';
    await pub.save();

    await executor.recalcularContadores(campanha._id);

    return res.json({ publication: publicacaoSegura(pub) });
  } catch (err) {
    return _responderErro(res, err);
  }
};
