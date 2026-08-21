'use strict';

const mongoose = require('mongoose');

const Campaign            = require('../models/Campaign');
const CampaignPublication = require('../models/CampaignPublication');
const Account             = require('../models/Account');
const Media               = require('../models/Media');
const { generatePlan, PlannerError } = require('./publicationPlanner');
const { resolveTemplate } = require('./templateResolver');

/**
 * Regra de negócio da campanha: validar, planejar e persistir.
 *
 * O controller fica só com HTTP. O planner continua puro — quem toca o banco é
 * este módulo.
 */

class CampaignError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'CampaignError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ── Validação ─────────────────────────────────────────────────────────────── */

const ESTRATEGIAS_VALIDAS = ['interleaved_random', 'sequential', 'round_robin', 'account_first', 'manual'];
const MODOS_LEGENDA       = ['global', 'per_account', 'per_content', 'per_account_content'];
const MODOS_COMENTARIO    = ['disabled', 'global', 'per_account', 'per_content', 'per_account_content', 'per_publication'];

function _idsValidos(lista, campo) {
  const invalidos = (lista || []).filter(id => !mongoose.Types.ObjectId.isValid(String(id)));
  if (invalidos.length) {
    throw new CampaignError('INVALID_ID', `${campo} contém identificadores inválidos.`, { invalidos });
  }
}

/**
 * Confere que todas as contas existem e podem participar.
 *
 * Conta banida é recusada: agendar publicação para ela cria trabalho que já
 * nasce condenado a falhar. Os demais estados (restrita, sessão expirada) passam
 * — podem se resolver antes do horário agendado, e a execução revalida.
 */
async function validarContas(accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new CampaignError('NO_ACCOUNTS', 'Selecione ao menos uma conta.');
  }
  _idsValidos(accountIds, 'accountIds');

  const unicos = [...new Set(accountIds.map(String))];
  const contas = await Account.find({ _id: { $in: unicos } })
    .select('_id username provider healthStatus postsToday dailyPostLimit')
    .lean();

  if (contas.length !== unicos.length) {
    const encontrados = new Set(contas.map(c => String(c._id)));
    const faltando    = unicos.filter(id => !encontrados.has(id));
    throw new CampaignError(
      'ACCOUNT_NOT_FOUND',
      `${faltando.length} conta(s) não foram encontradas.`,
      { missingIds: faltando }
    );
  }

  const banidas = contas.filter(c => c.healthStatus === 'banida');
  if (banidas.length) {
    throw new CampaignError(
      'ACCOUNT_NOT_ELIGIBLE',
      `Conta(s) banida(s) não podem participar: ${banidas.map(c => '@' + c.username).join(', ')}.`,
      { accounts: banidas.map(c => ({ id: String(c._id), username: c.username })) }
    );
  }

  return contas;
}

/** Confere que todas as mídias existem — campanha parcial nunca é criada. */
async function validarConteudos(contentIds) {
  if (!Array.isArray(contentIds) || contentIds.length === 0) {
    throw new CampaignError('NO_CONTENTS', 'Selecione ao menos um conteúdo.');
  }
  _idsValidos(contentIds, 'contentIds');

  const unicos = [...new Set(contentIds.map(String))];
  const midias = await Media.find({ _id: { $in: unicos } })
    .select('_id filename originalName url type folder')
    .lean();

  if (midias.length !== unicos.length) {
    const encontrados = new Set(midias.map(m => String(m._id)));
    const faltando    = unicos.filter(id => !encontrados.has(id));
    throw new CampaignError(
      'CONTENT_NOT_FOUND',
      `${faltando.length} conteúdo(s) não foram encontrados.`,
      { missingIds: faltando }
    );
  }

  return midias;
}

/** Valida os campos de configuração antes de chegar ao Mongoose. */
function validarConfiguracao({ name, strategy = {}, schedule = {}, captionMode, commentMode }) {
  if (!name || !String(name).trim()) {
    throw new CampaignError('NAME_REQUIRED', 'A campanha precisa de um nome.');
  }

  if (strategy.mode && !ESTRATEGIAS_VALIDAS.includes(strategy.mode)) {
    throw new CampaignError(
      'INVALID_STRATEGY',
      `Estratégia "${strategy.mode}" não existe. Use uma de: ${ESTRATEGIAS_VALIDAS.join(', ')}.`
    );
  }
  if (captionMode && !MODOS_LEGENDA.includes(captionMode)) {
    throw new CampaignError('INVALID_CAPTION_MODE', `Modo de legenda "${captionMode}" não existe.`);
  }
  if (commentMode && !MODOS_COMENTARIO.includes(commentMode)) {
    throw new CampaignError('INVALID_COMMENT_MODE', `Modo de comentário "${commentMode}" não existe.`);
  }

  const min = Number(schedule.intervalMinMinutes ?? schedule.intervalMin ?? 0);
  const max = Number(schedule.intervalMaxMinutes ?? schedule.intervalMax ?? min);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
    throw new CampaignError('INVALID_INTERVAL', 'Intervalos precisam ser números não negativos.');
  }
  if (max < min) {
    throw new CampaignError('INVALID_INTERVAL', 'O intervalo máximo não pode ser menor que o mínimo.');
  }

  const horario = /^([01]?\d|2[0-3]):[0-5]\d$/;
  for (const campo of ['windowStart', 'windowEnd']) {
    const v = schedule[campo];
    if (v && !horario.test(String(v))) {
      throw new CampaignError('INVALID_WINDOW', `${campo} precisa estar no formato HH:MM.`);
    }
  }
  if (schedule.windowStart && schedule.windowEnd) {
    const [hi, mi] = String(schedule.windowStart).split(':').map(Number);
    const [hf, mf] = String(schedule.windowEnd).split(':').map(Number);
    if (hf * 60 + mf <= hi * 60 + mi) {
      throw new CampaignError('INVALID_WINDOW', 'O fim da janela precisa ser depois do início.');
    }
  }

  if (schedule.weekdays !== undefined) {
    if (!Array.isArray(schedule.weekdays)) {
      throw new CampaignError('INVALID_WEEKDAYS', 'weekdays precisa ser uma lista.');
    }
    const fora = schedule.weekdays.filter(d => !(Number.isInteger(d) && d >= 0 && d <= 6));
    if (fora.length) {
      throw new CampaignError('INVALID_WEEKDAYS', 'weekdays aceita apenas números de 0 (domingo) a 6 (sábado).', { fora });
    }
  }

  if (schedule.startAt) {
    const d = new Date(schedule.startAt);
    if (Number.isNaN(d.getTime())) {
      throw new CampaignError('INVALID_START_AT', 'startAt não é uma data válida.');
    }
  }
}

/* ── Criação ───────────────────────────────────────────────────────────────── */

/**
 * Valida a entrada e gera o plano — sem tocar no banco.
 *
 * Compartilhado por criarCampanha e preverCampanha: a prévia precisa ser
 * EXATAMENTE o que será criado, e duplicar a montagem faria as duas divergirem
 * na primeira alteração.
 */
/**
 * Mantém só as capas cujo conteúdo continua na campanha.
 *
 * Sem esta limpeza, tirar um vídeo da seleção deixaria a capa dele gravada — e
 * ela voltaria a valer se o mesmo vídeo fosse re-selecionado depois, sem que
 * ninguém tivesse pedido.
 */
function _filtrarCapas(covers = {}, contentIds = []) {
  const fonte = covers?.byContent || {};
  const validos = new Set(contentIds.map(String));
  const saida = {};

  const entradas = typeof fonte.entries === 'function'
    ? [...fonte.entries()]
    : Object.entries(fonte);

  for (const [contentId, mediaId] of entradas) {
    if (validos.has(String(contentId)) && mediaId) saida[String(contentId)] = String(mediaId);
  }
  return saida;
}

async function montarPlano(dados, agora = new Date()) {
  const {
    name,
    accountIds = [], contentIds = [],
    strategy = {}, schedule = {}, settings = {},
    captions = {}, comments = {},
    captionMode = 'global', commentMode = 'disabled',
  } = dados;

  validarConfiguracao({ name, strategy, schedule, captionMode, commentMode });
  const contas = await validarContas(accountIds);
  const midias = await validarConteudos(contentIds);

  // Seed fixa desde a criação: sem ela o plano deixaria de ser reproduzível
  // entre uma pré-visualização e a criação definitiva.
  const seed    = strategy.seed || `${String(name).trim()}-${agora.getTime()}`;
  const startAt = schedule.startAt ? new Date(schedule.startAt) : agora;

  let plano;
  try {
    plano = generatePlan({
      accounts: contas.map(c => ({
        id:         String(c._id),
        dailyLimit: c.dailyPostLimit,
        postsToday: c.postsToday,
      })),
      contents: midias.map(m => ({ id: String(m._id), name: m.originalName || m.filename })),
      strategy: { ...strategy, seed },
      schedule,
      settings,
      captions,
      comments,
      captionMode,
      commentMode,
      startAt,
    });
  } catch (err) {
    if (err instanceof PlannerError) throw new CampaignError(err.code, err.message);
    throw err;
  }

  if (!plano.length) {
    throw new CampaignError(
      'EMPTY_PLAN',
      'O plano ficou vazio — todas as contas já atingiram o limite diário. Ajuste o limite ou aguarde.'
    );
  }

  return { contas, midias, plano, seed };
}

/**
 * Cria a campanha e materializa o plano.
 *
 * ATOMICIDADE: o MongoDB desta instalação é standalone (docker-compose sobe
 * `mongo:7` sem replica set), e transação exige replica set. Em vez de fingir
 * transação, usamos COMPENSAÇÃO: se a criação das publicações falhar, a campanha
 * recém-criada e as publicações já inseridas são removidas, restaurando o estado
 * anterior. Com replica set disponível, o mesmo fluxo pode migrar para
 * session.withTransaction sem mudar a assinatura desta função.
 */
async function criarCampanha(dados, agora = new Date()) {
  const {
    name, description = '',
    accountIds = [], contentIds = [],
    strategy = {}, schedule = {}, settings = {},
    captions = {}, comments = {}, covers = {},
    captionMode = 'global', commentMode = 'disabled',
  } = dados;

  const { plano, seed, contas, midias } = await montarPlano(dados, agora);

  // Índices por id para resolver as variáveis de cada publicação sem varrer as
  // listas a cada item.
  const porConta = new Map(contas.map(c => [String(c._id), c]));
  const porMidia = new Map(midias.map(m => [String(m._id), m]));

  const campanha = await Campaign.create({
    name: String(name).trim(),
    description,
    status: 'draft',
    accountIds,
    contentIds,
    strategy: { ...strategy, seed },
    schedule,
    settings,
    captions,
    comments,
    // Capa por conteúdo: só entra o que aponta para uma mídia da campanha, para
    // não guardar referência a arquivo que foi retirado da seleção.
    covers: { byContent: _filtrarCapas(covers, contentIds) },
    captionMode,
    commentMode,
    totalPublications:     plano.length,
    pendingPublications:   plano.length,
    publishedPublications: 0,
    failedPublications:    0,
  });

  try {
    await CampaignPublication.insertMany(
      plano.map(item => {
        const ctx = contextoDe(item, {
          conta: porConta.get(String(item.accountId)),
          midia: porMidia.get(String(item.contentId)),
          nomeCampanha: dados.name,
        });
        return {
          campaignId:      campanha._id,
          accountId:       item.accountId,
          contentId:       item.contentId,
          order:           item.order,
          scheduledAt:     item.scheduledAt,
          captionTemplate: item.captionTemplate,
          commentTemplate: item.commentTemplate,
          // Texto já materializado: sem isto o painel mostraria "{username}" no
          // lugar da legenda, e a execução — que lê resolvedCaption — publicaria
          // com legenda vazia.
          resolvedCaption: resolveTemplate(item.captionTemplate, ctx).text,
          resolvedComment: resolveTemplate(item.commentTemplate, ctx).text,
          // 'scheduled' significa "no plano, com horário definido". O envio à fila
          // é da fase 8 — por isso bullMqJobId permanece vazio.
          status:          'scheduled',
        };
      }),
      { ordered: true }
    );
  } catch (err) {
    // Compensação: desfaz tudo para não deixar campanha meio planejada.
    await CampaignPublication.deleteMany({ campaignId: campanha._id }).catch(() => {});
    await Campaign.deleteOne({ _id: campanha._id }).catch(() => {});
    throw new CampaignError(
      'PLAN_PERSIST_FAILED',
      `Falha ao gravar o plano — nenhuma campanha foi criada. Detalhe: ${err.message}`
    );
  }

  campanha.status = 'scheduled';
  await campanha.save();

  return campanha;
}

/* ── Estatísticas ──────────────────────────────────────────────────────────── */

/**
 * Conta publicações por status direto da coleção.
 *
 * Os contadores em Campaign são desnormalizados e podem divergir se a execução
 * falhar no meio de uma atualização — por isso a fonte da verdade aqui é sempre
 * a agregação.
 */
async function estatisticas(campaignId) {
  const linhas = await CampaignPublication.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(String(campaignId)) } },
    { $group: { _id: '$status', total: { $sum: 1 } } },
  ]);

  const base = { total: 0, pending: 0, scheduled: 0, processing: 0, published: 0, failed: 0, cancelled: 0 };
  for (const l of linhas) {
    base[l._id] = l.total;
    base.total += l.total;
  }
  return base;
}

/**
 * Contexto de resolução de UMA publicação do plano.
 *
 * Extraído porque criação, prévia e execução precisam do MESMO contexto — com
 * três montagens diferentes, a prévia mostraria um texto e a publicação sairia
 * com outro.
 */
function contextoDe(item, { conta, midia, nomeCampanha }) {
  return {
    username:    conta?.username || '',
    name:        conta?.name || '',
    campaign:    String(nomeCampanha || '').trim(),
    contentName: midia?.originalName || midia?.filename || '',
    now:         item.scheduledAt,
  };
}

/**
 * Contagem de comentários por estado.
 *
 * `estatisticas()` agrupa por `status`, que é o estado da PUBLICAÇÃO. O
 * comentário tem ciclo próprio — um post pode estar publicado com o comentário
 * ainda agendado — e não havia como contá-lo sem carregar todas as publicações.
 *
 * `total` conta apenas as publicações que realmente têm comentário a publicar
 * ('none' fica de fora): numa campanha sem comentários, "0 de 48 publicados"
 * sugeriria 48 pendências que não existem.
 */
async function estatisticasComentario(campaignId) {
  const linhas = await CampaignPublication.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(String(campaignId)) } },
    { $group: { _id: '$commentStatus', total: { $sum: 1 } } },
  ]);

  const base = { total: 0, none: 0, scheduled: 0, posted: 0, failed: 0, cancelled: 0 };
  for (const l of linhas) {
    const chave = l._id || 'none';
    if (base[chave] !== undefined) base[chave] = l.total;
  }

  // `total` conta quem TEM comentário a publicar, olhando o template — não o
  // commentStatus. O status só sai de 'none' depois que o post vai ao ar, então
  // contar por ele daria 0 numa campanha recém-criada, e o painel anunciaria
  // "esta campanha não publica comentários" para uma campanha que publica.
  base.total = await CampaignPublication.countDocuments({
    campaignId,
    commentTemplate: { $exists: true, $nin: ['', null] },
  });

  // Ainda não agendados: configurados, mas o post não saiu.
  base.pending = Math.max(0, base.total - (base.scheduled + base.posted + base.failed + base.cancelled));

  return base;
}

/**
 * Próxima publicação a sair.
 *
 * Vem do banco em vez de ser deduzida no frontend: a listagem é paginada, e numa
 * campanha grande as primeiras 200 linhas por horário podem estar todas
 * publicadas — a tela apontaria "nenhuma pendente" com dezenas na fila.
 */
async function proximaPublicacao(campaignId) {
  return CampaignPublication
    .findOne({ campaignId, status: { $in: ['pending', 'scheduled', 'processing'] } })
    .sort({ scheduledAt: 1, order: 1 })
    .populate('accountId', 'username name avatar provider healthStatus postsToday')
    .populate('contentId', 'filename originalName url type folder');
}

/* ── Prévia ────────────────────────────────────────────────────────────────── */

// Limite de caracteres do Instagram, igual para legenda e comentário.
const LIMITE_TEXTO = 2200;

/**
 * Gera o plano e MATERIALIZA os textos, sem persistir nada.
 *
 * Roda o mesmo templateResolver que a execução usará, então o que aparece na
 * prévia é o texto que será publicado — não uma simulação aproximada. Nenhum
 * dado é inventado: conta, conteúdo e horário vêm do plano real.
 *
 * A resolução aqui é só para exibição; o que fica gravado na publicação continua
 * sendo o template bruto.
 */
async function preverCampanha(dados, agora = new Date()) {
  const { contas, midias, plano } = await montarPlano(dados, agora);

  const porConta   = new Map(contas.map(c => [String(c._id), c]));
  const porMidia   = new Map(midias.map(m => [String(m._id), m]));
  const comentando = dados.commentMode && dados.commentMode !== 'disabled';

  // Capas escolhidas: uma consulta só para todas, em vez de uma por publicação.
  const capasPorConteudo = _filtrarCapas(dados.covers, dados.contentIds || []);
  const idsDasCapas = [...new Set(Object.values(capasPorConteudo))];
  const capas = idsDasCapas.length
    ? new Map((await Media.find({ _id: { $in: idsDasCapas } }).select('filename url').lean())
        .map(m => [String(m._id), m]))
    : new Map();

  const publicacoes = plano.map(item => {
    const conta = porConta.get(String(item.accountId));
    const midia = porMidia.get(String(item.contentId));

    const contexto = contextoDe(item, { conta, midia, nomeCampanha: dados.name });

    const legenda    = resolveTemplate(item.captionTemplate, contexto);
    const comentario = resolveTemplate(item.commentTemplate, contexto);

    // Problemas que impedem a publicação — cada um aponta a publicação exata,
    // para a tela conseguir listar "@conta03 → video02" em vez de um total solto.
    const problemas = [];
    if (legenda.text.length > LIMITE_TEXTO) {
      problemas.push({ tipo: 'CAPTION_TOO_LONG', detalhe: `${legenda.text.length}/${LIMITE_TEXTO}` });
    }
    if (comentando && comentario.text.length > LIMITE_TEXTO) {
      problemas.push({ tipo: 'COMMENT_TOO_LONG', detalhe: `${comentario.text.length}/${LIMITE_TEXTO}` });
    }
    if (legenda.unresolved.length) {
      problemas.push({ tipo: 'UNRESOLVED_VARIABLE', detalhe: legenda.unresolved.join(', ') });
    }
    if (comentando && comentario.unresolved.length) {
      problemas.push({ tipo: 'UNRESOLVED_COMMENT_VARIABLE', detalhe: comentario.unresolved.join(', ') });
    }

    return {
      order:       item.order,
      scheduledAt: item.scheduledAt,
      account: { id: String(item.accountId), username: conta?.username || '', name: conta?.name || '' },
      content: { id: String(item.contentId), name: midia?.originalName || midia?.filename || '', url: midia?.url || '' },
      captionTemplate: item.captionTemplate,
      resolvedCaption: legenda.text,
      // Capa só aparece onde ela vale: o Instagram ignora cover em foto.
      cover: (() => {
        const ehVideo = midia?.type === 'video'
          || /\.(mp4|mov|webm|avi|mkv)$/i.test(midia?.filename || '');
        if (!ehVideo) return null;
        const capa = capas.get(String(capasPorConteudo[String(item.contentId)] || ''));
        return capa ? { id: String(capa._id), url: capa.url || '' } : null;
      })(),
      commentTemplate: comentando ? item.commentTemplate : '',
      resolvedComment: comentando ? comentario.text : '',
      // Faixa do atraso — o valor real é sorteado na execução, então a prévia
      // mostra o intervalo em vez de um número que não vai se confirmar.
      commentDelayMinutes:    comentando ? Number(dados.comments?.delayMinutes ?? 2) : null,
      commentDelayMaxMinutes: comentando ? Number(dados.comments?.delayMaxMinutes ?? 6) : null,
      problemas,
    };
  });

  const comProblema = publicacoes.filter(p => p.problemas.length);

  return {
    summary: {
      name:        String(dados.name || '').trim(),
      accounts:    contas.length,
      contents:    midias.length,
      publications: publicacoes.length,
      strategy:    dados.strategy?.mode || 'interleaved_random',
      captionMode: dados.captionMode || 'global',
      commentMode: dados.commentMode || 'disabled',
      window: dados.schedule?.windowStart && dados.schedule?.windowEnd
        ? `${dados.schedule.windowStart} → ${dados.schedule.windowEnd}` : null,
      interval: dados.schedule?.useFixedInterval
        ? `${dados.schedule.intervalMinMinutes ?? dados.schedule.intervalMin} min (fixo)`
        : `${dados.schedule?.intervalMinMinutes ?? dados.schedule?.intervalMin}–${dados.schedule?.intervalMaxMinutes ?? dados.schedule?.intervalMax} min`,
      valid:   publicacoes.length - comProblema.length,
      invalid: comProblema.length,
    },
    publications: publicacoes,
  };
}

module.exports = {
  // Exportado para teste: a limpeza das capas decide o que é gravado.
  _filtrarCapas,

  CampaignError,
  ESTRATEGIAS_VALIDAS,
  LIMITE_TEXTO,
  validarContas,
  validarConteudos,
  validarConfiguracao,
  montarPlano,
  criarCampanha,
  preverCampanha,
  contextoDe,
  estatisticas,
  estatisticasComentario,
  proximaPublicacao,
};
