'use strict';

/**
 * Camada HTTP das campanhas. Regra de negócio vive em campaignService,
 * transição de estado em campaignState, execução em campaignExecutor.
 */

const { sql } = require('../db');
const { campaigns, campaignPublications } = require('../repos');
const svc = require('../services/campaignService');
const { CampaignError } = svc;
const { garantirTransicao, CampaignStateError } = require('../services/campaignState');
const { campanhaSegura, publicacaoSegura, comDetalhes } = require('../utils/campaignSerializer');
const executor = require('../services/campaignExecutor');
const campaignQueue = require('../services/campaignQueue');

const STATUS_HTTP = {
  NAME_REQUIRED: 400, NO_ACCOUNTS: 400, NO_CONTENTS: 400, INVALID_ID: 400, INVALID_STRATEGY: 400,
  INVALID_CAPTION_MODE: 400, INVALID_COMMENT_MODE: 400, INVALID_INTERVAL: 400, INVALID_WINDOW: 400,
  INVALID_WEEKDAYS: 400, INVALID_START_AT: 400, EMPTY_PLAN: 400,
  ACCOUNT_NOT_FOUND: 404, CONTENT_NOT_FOUND: 404, CAMPAIGN_NOT_FOUND: 404, PUBLICATION_NOT_FOUND: 404,
  ACCOUNT_NOT_ELIGIBLE: 409, INVALID_CAMPAIGN_STATE: 409, INVALID_PUBLICATION_STATE: 409,
  ALREADY_PUBLISHED: 409, PUBLICATION_RUNNING: 409, ALREADY_POSTED: 409, NOT_PUBLISHED: 409,
  COMMENT_MEDIA_NOT_FOUND: 409, PLAN_PERSIST_FAILED: 500, MISSING_PUBLISHER: 500,
};

/** Erro de domínio vira resposta com código; o resto, 500. */
function responderErro(res, err) {
  const dominio = err instanceof CampaignError || err instanceof CampaignStateError || err instanceof executor.ExecutionError;
  if (dominio) {
    const corpo = { code: err.code, message: err.message };
    for (const extra of ['missingIds', 'accounts', 'invalidos', 'fora', 'from', 'to']) {
      if (err[extra] !== undefined) corpo[extra] = err[extra];
    }
    return res.status(STATUS_HTTP[err.code] || 400).json(corpo);
  }
  console.error('[Campaign] erro inesperado:', err);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
}

/** Envolve o handler: todo erro passa por `responderErro`. */
const rota = fn => async (req, res) => {
  try { await fn(req, res); } catch (err) { responderErro(res, err); }
};

async function buscarCampanha(id) {
  const campanha = await campaigns.findById(id);
  if (!campanha) throw new CampaignError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
  return campanha;
}

async function transicionar(campanha, novoStatus, extra = {}) {
  garantirTransicao(campanha.status, novoStatus);
  return campaigns.update(campanha.id, { status: novoStatus, ...extra });
}

async function buscarPublicacao(campaignId, publicationId) {
  const pub = await campaignPublications.findById(publicationId);
  if (!pub || pub.campaignId !== campaignId) {
    throw new CampaignError('PUBLICATION_NOT_FOUND', 'Publicação não encontrada nesta campanha.');
  }
  return (await comDetalhes([pub]))[0];
}

/**
 * POST /campaigns — `Idempotency-Key` opcional: reenvio por timeout devolve a
 * campanha já criada. A reserva da chave é um insert com chave primária.
 */
exports.create = rota(async (req, res) => {
  const chave = req.get('Idempotency-Key');
  const chaveSetting = chave ? `idem:campaign:${chave}` : null;

  if (chaveSetting) {
    const [reservada] = await sql`
      insert into settings (key, value) values (${chaveSetting}, ${sql.json({ status: 'in_progress' })})
      on conflict (key) do nothing returning key`;
    if (!reservada) {
      const [existente] = await sql`select value from settings where key = ${chaveSetting}`;
      const campanha = existente?.value?.campaignId ? await campaigns.findById(existente.value.campaignId) : null;
      if (campanha) return res.status(200).json({ campaign: campanhaSegura(campanha), idempotent: true });
      return res.status(409).json({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Uma requisição com esta Idempotency-Key ainda está em processamento.' });
    }
  }

  let campanha;
  try {
    campanha = await svc.criarCampanha(req.body || {});
  } catch (err) {
    if (chaveSetting) await sql`delete from settings where key = ${chaveSetting}`.catch(() => {});
    throw err;
  }
  if (chaveSetting) {
    await sql`update settings set value = ${sql.json({ campaignId: campanha.id, at: new Date() })} where key = ${chaveSetting}`;
  }
  res.status(201).json({ campaign: campanhaSegura(campanha) });
});

/** POST /campaigns/preview — o plano com os textos já resolvidos, sem gravar nada. */
exports.preview = rota(async (req, res) => {
  res.json(await svc.preverCampanha(req.body || {}));
});

/** GET /campaigns/variables — as marcações que o templateResolver de fato resolve. */
exports.variables = (_req, res) => {
  res.json({ variables: require('../services/templateResolver').listarVariaveis() });
};

/** GET /campaigns?page&limit&status&search — com a próxima publicação de cada uma. */
exports.list = rota(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status = req.query.status ? String(req.query.status) : null;
  const busca = req.query.search ? `%${String(req.query.search).replace(/[\\%_]/g, '\\$&')}%` : null;

  const where = sql`
    where true
    ${status ? sql`and status = ${status}` : sql``}
    ${busca ? sql`and name ilike ${busca}` : sql``}`;
  const [lista, [{ total }]] = await Promise.all([
    sql`select * from campaigns ${where} order by created_at desc limit ${limit} offset ${(page - 1) * limit}`,
    sql`select count(*) as total from campaigns ${where}`,
  ]);

  // Um agregado só para todos os cards: próxima publicação e contagem por estado.
  const ids = lista.map(c => c.id);
  const resumo = ids.length ? await sql`
    select campaign_id,
      min(scheduled_at) filter (where status in ('pending', 'scheduled', 'processing')) as proxima_em,
      count(*) filter (where status in ('pending', 'scheduled')) as pendentes,
      count(*) filter (where status = 'processing') as em_curso,
      count(*) filter (where status = 'published') as publicadas,
      count(*) filter (where status = 'failed') as falhas
    from campaign_publications where campaign_id = any(${ids}::uuid[]) group by campaign_id` : [];
  const porCampanha = new Map(resumo.map(r => [r.campaignId, r]));

  res.json({
    campaigns: lista.map(c => {
      const r = porCampanha.get(c.id) || {};
      return {
        ...campanhaSegura(c),
        proximaEm: r.proximaEm || null,
        pendentes: r.pendentes || 0,
        emCurso: r.emCurso || 0,
        publicadas: r.publicadas || 0,
        falhas: r.falhas || 0,
      };
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
  });
});

/** GET /campaigns/:id */
exports.get = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const [stats, comentarios, proxima] = await Promise.all([
    svc.estatisticas(campanha.id),
    svc.estatisticasComentario(campanha.id),
    svc.proximaPublicacao(campanha.id),
  ]);
  const concluidas = stats.published + stats.failed + stats.cancelled;
  res.json({
    campaign: campanhaSegura(campanha),
    statistics: stats,
    commentStatistics: comentarios,
    nextPublication: proxima ? publicacaoSegura(proxima) : null,
    schedule: campanha.schedule,
    settings: campanha.settings,
    progress: { done: concluidas, total: stats.total, percentage: stats.total ? Math.round((concluidas / stats.total) * 100) : 0 },
  });
});

/** PATCH /campaigns/:id — só nome e descrição; o plano não é regerado. */
exports.update = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  if (['completed', 'cancelled'].includes(campanha.status)) {
    throw new CampaignError('INVALID_CAMPAIGN_STATE', `Campanha em "${campanha.status}" não pode ser editada.`);
  }
  const campos = {};
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) throw new CampaignError('NAME_REQUIRED', 'A campanha precisa de um nome.');
    campos.name = String(req.body.name).trim();
  }
  if (req.body.description !== undefined) campos.description = String(req.body.description);
  res.json({ campaign: campanhaSegura(await campaigns.update(campanha.id, campos)) });
});

/** DELETE /campaigns/:id — publicações e eventos saem junto (on delete cascade). */
exports.remove = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  await executor.cancelarCampanha(campanha.id);
  await campaigns.remove(campanha.id);
  res.json({ success: true });
});

/** GET /campaigns/:id/eventos — a linha do tempo e o resumo por código de erro. */
exports.eventos = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const limite = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
  const pub = req.query.publicationId ? String(req.query.publicationId) : null;
  const [itens, erros] = await Promise.all([
    sql`select * from campaign_events where campaign_id = ${campanha.id}
        ${pub ? sql`and publication_id::text = ${pub}` : sql``}
        order by criado_em desc limit ${limite}`,
    sql`select error_code as codigo, count(*) as ocorrencias, max(criado_em) as ultimo
        from campaign_events where campaign_id = ${campanha.id} and error_code <> ''
        group by error_code order by ocorrencias desc limit 8`,
  ]);
  res.json({ itens, erros, total: itens.length });
});

/** POST /campaigns/:id/start — enfileira. Idempotente pela chave de cada publicação. */
exports.start = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const stats = await svc.estatisticas(campanha.id);
  if (stats.total === 0) throw new CampaignError('EMPTY_PLAN', 'A campanha não possui publicações planejadas.');
  const executaveis = stats.pending + stats.scheduled;
  if (executaveis === 0) {
    throw new CampaignError('EMPTY_PLAN', 'Não há publicações pendentes — todas já foram publicadas, falharam ou foram canceladas.');
  }
  const atualizada = await transicionar(campanha, 'scheduled', { startedAt: campanha.startedAt || new Date() });
  const r = await executor.agendarCampanha(campanha.id);
  res.json({ campaign: campanhaSegura(atualizada), scheduled: r.agendadas, alreadyQueued: r.jaExistiam, total: executaveis });
});

/** POST /campaigns/:id/pause — tira da fila o que não rodou; o que está publicando termina. */
exports.pause = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const atualizada = await transicionar(campanha, 'paused');
  const r = await executor.pausarCampanha(campanha.id);
  res.json({ campaign: campanhaSegura(atualizada), dequeued: r.removidos });
});

/** POST /campaigns/:id/resume — reenfileira só o que ficou pendente. */
exports.resume = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  if (campanha.status !== 'paused') {
    throw new CampaignError('INVALID_CAMPAIGN_STATE', `Só é possível retomar uma campanha pausada — esta está em "${campanha.status}".`);
  }
  const atualizada = await transicionar(campanha, 'scheduled');
  const r = await executor.retomarCampanha(campanha.id);
  res.json({ campaign: campanhaSegura(atualizada), pending: r.total, requeued: r.agendadas });
});

/** POST /campaigns/:id/cancel — publicadas e falhadas ficam como estão. */
exports.cancel = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const atualizada = await transicionar(campanha, 'cancelled', { completedAt: new Date() });
  const r = await executor.cancelarCampanha(campanha.id);
  res.json({ campaign: campanhaSegura(atualizada), cancelled: r.canceladas });
});

/** POST /campaigns/:id/retry-failed — as falhas voltam para a fila, na mesma linha. */
exports.retryFailed = rota(async (req, res) => {
  let campanha = await buscarCampanha(req.params.id);
  if (campanha.status === 'cancelled') throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não pode reexecutar falhas.');

  const falhadas = await sql`select id from campaign_publications where campaign_id = ${campanha.id} and status = 'failed'`;
  if (falhadas.length && ['failed', 'partial', 'completed'].includes(campanha.status)) {
    campanha = await transicionar(campanha, 'scheduled', { completedAt: null });
  }
  let reprogramadas = 0;
  for (const f of falhadas) {
    try { await executor.reprocessarPublicacao(f.id); reprogramadas++; }
    catch (e) { console.error('[Campaign] retry-failed', f.id, e.message); }
  }
  res.json({ campaign: campanhaSegura(campanha), retried: reprogramadas });
});

/** GET /campaigns/:id/publications?page&limit&status&accountId&contentId */
exports.listPublications = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const where = sql`
    where campaign_id = ${campanha.id}
    ${req.query.status ? sql`and status = ${String(req.query.status)}` : sql``}
    ${req.query.accountId ? sql`and account_id::text = ${String(req.query.accountId)}` : sql``}
    ${req.query.contentId ? sql`and content_id::text = ${String(req.query.contentId)}` : sql``}`;
  const [lista, [{ total }]] = await Promise.all([
    sql`select * from campaign_publications ${where} order by scheduled_at, "order" limit ${limit} offset ${(page - 1) * limit}`,
    sql`select count(*) as total from campaign_publications ${where}`,
  ]);
  res.json({
    publications: (await comDetalhes(lista)).map(publicacaoSegura),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
  });
});

/** GET /campaigns/:id/publications/:publicationId */
exports.getPublication = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const pub = await buscarPublicacao(campanha.id, req.params.publicationId);
  res.json({ publication: publicacaoSegura(pub), campaign: campanhaSegura(campanha) });
});

/** POST .../publications/:publicationId/retry — a mesma linha volta para a fila. */
exports.retryPublication = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  if (campanha.status === 'cancelled') throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não permite reexecução.');
  const pub = await buscarPublicacao(campanha.id, req.params.publicationId);
  if (!['failed', 'cancelled'].includes(pub.status)) {
    throw new CampaignError('INVALID_PUBLICATION_STATE', `Só é possível reexecutar publicação com falha ou cancelada — esta está em "${pub.status}".`);
  }
  if (!pub.conta) throw new CampaignError('ACCOUNT_NOT_FOUND', 'A conta desta publicação não existe mais.');
  if (!pub.conteudo) throw new CampaignError('CONTENT_NOT_FOUND', 'O conteúdo desta publicação não existe mais.');
  await executor.reprocessarPublicacao(pub.id);
  res.json({ publication: publicacaoSegura(await buscarPublicacao(campanha.id, pub.id)) });
});

/** POST .../publications/:publicationId/retry-comment — só o comentário; o post já está no ar. */
exports.retryComment = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  if (campanha.status === 'cancelled') throw new CampaignError('INVALID_CAMPAIGN_STATE', 'Campanha cancelada não permite reexecução.');
  const pub = await buscarPublicacao(campanha.id, req.params.publicationId);
  await executor.reprocessarComentario(pub.id);
  res.json({ publication: publicacaoSegura(await buscarPublicacao(campanha.id, pub.id)) });
});

/** POST .../publications/:publicationId/cancel — só esta publicação. */
exports.cancelPublication = rota(async (req, res) => {
  const campanha = await buscarCampanha(req.params.id);
  const pub = await buscarPublicacao(campanha.id, req.params.publicationId);
  if (['published', 'cancelled'].includes(pub.status)) {
    throw new CampaignError('INVALID_PUBLICATION_STATE', `Publicação em "${pub.status}" não pode ser cancelada.`);
  }
  await campaignQueue.removerPublicacao(pub.id);
  await campaignQueue.removerComentario(pub.id);
  await campaignPublications.update(pub.id, {
    status: 'cancelled', queueJobId: '', ...(pub.commentStatus === 'scheduled' ? { commentStatus: 'cancelled' } : {}),
  });
  await executor.recalcularContadores(campanha.id);
  res.json({ publication: publicacaoSegura(await buscarPublicacao(campanha.id, pub.id)) });
});
