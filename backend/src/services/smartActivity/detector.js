'use strict';

/**
 * Detector de marcos.
 *
 * ── O que ele NÃO faz
 *
 * Não consulta o Instagram. Não altera o caminho de escrita das métricas. Não
 * sabe quando um ciclo de sincronização começou. Ele lê `Insight` — que o
 * sincronizador acabou de gravar — compara com o teto já notificado e decide.
 *
 * Essa separação é o ponto: a notificação é CONSEQUÊNCIA da métrica ter subido,
 * não uma segunda rotina correndo atrás dela. Nenhuma chamada adicional à API,
 * nenhum acoplamento com fila, publicação ou provider.
 *
 * ── A primeira execução
 *
 * Uma conta com meses de histórico tem posts que já passaram de todos os
 * marcos. Sem cuidado, a estreia do módulo despejaria centenas de notificações
 * de uma vez — e a primeira impressão do recurso seria uma avalanche de coisas
 * que aconteceram semanas atrás.
 *
 * `semear()` resolve: grava o teto no valor atual SEM notificar. A partir dali
 * só o que crescer de verdade dispara. É chamado uma vez, e o próprio ato de
 * semear fica registrado para não repetir.
 */

const Insight = require('../../models/Insight');
const Milestone = require('../../models/Milestone');
const Notificacao = require('../../models/Notificacao');
const thresholds = require('./thresholds');
const templates = require('./templates');

const CHAVE_SEMEADO = 'smartActivitySemeado';

/**
 * Grava a notificação. Devolve `null` quando o marco já tinha sido notificado
 * — o índice único é a segunda barreira contra duplicata, e colidir com ele é
 * resultado esperado, não erro.
 */
async function _gravar(doc) {
  let nova;
  try {
    nova = await Notificacao.create(doc);
  } catch (err) {
    if (err?.code === 11000) return null;   // outro ciclo chegou primeiro
    throw err;
  }

  /* Push depois de GRAVAR, e sem esperar.
  
     Depois porque o histórico é a fonte da verdade: uma notificação enviada e
     não gravada não existiria na Central. E sem `await` porque a entrega
     depende de um serviço externo — o servidor de push do navegador — e uma
     lentidão dele não pode segurar a varredura das outras contas.

     Falha aqui é silenciosa de propósito: o aviso interno já está gravado e
     vai aparecer assim que o painel abrir. Push é o extra. */
  try {
    const webPush = require('./webPush');
    if (webPush.disponivel()) {
      webPush.enviar(nova).catch(err =>
        console.warn('[WebPush] envio falhou:', err.message));
    }
  } catch { /* módulo indisponível não derruba a detecção */ }

  return nova;
}

/**
 * Processa UM insight e devolve as notificações criadas.
 *
 * @param {object} insight  documento de Insight (lean)
 * @param {object} conta    { _id, username, avatar }
 * @param {object} cfg      configuração já carregada
 */
async function processarInsight(insight, conta, cfg) {
  const criadas = [];
  const ehStory = insight.mediaType === 'STORY';
  const metricas = ehStory ? ['storyViews'] : ['contentViews', 'reach'];

  for (const metricType of metricas) {
    if (!cfg.ativos[metricType]) continue;

    const marcos = cfg.thresholds[metricType] || [];
    if (!marcos.length) continue;

    const valor = thresholds.valorDaMetrica(insight, metricType);
    if (!valor) continue;

    const contentId = String(insight.igMediaId);
    const chave = { accountId: conta._id, contentId, metricType };

    const marco = await Milestone.findOne(chave).lean();
    const teto = marco?.maiorDisparado || 0;

    const cruzados = thresholds.marcosCruzados(teto, valor, marcos);

    /* Mesmo sem marco novo, o último valor é atualizado: serve de diagnóstico
       e cria o documento na primeira passagem, o que evita `findOne` inútil
       nas próximas. */
    if (!cruzados.length) {
      await Milestone.updateOne(chave, { $set: { ultimoValor: valor } }, { upsert: true });
      continue;
    }

    /* SOBE O TETO ANTES DE NOTIFICAR.

       Se a gravação da notificação falhar depois disto, perde-se um aviso. Na
       ordem inversa, uma falha ao subir o teto faria o MESMO marco disparar de
       novo no ciclo seguinte — e de novo, e de novo. Entre perder uma
       notificação e repetir a mesma para sempre, perder é o erro menor. */
    const maior = cruzados[cruzados.length - 1];
    await Milestone.updateOne(
      chave,
      { $max: { maiorDisparado: maior }, $set: { ultimoValor: valor } },
      { upsert: true }
    );

    const modelo = templates.modeloDe(metricType, cfg.mensagens);

    for (const threshold of cruzados) {
      const vars = templates.contexto({ conta, insight, threshold, valor, metricType });
      const nova = await _gravar({
        accountId: conta._id,
        username: conta.username || '',
        avatar: conta.avatar || '',
        contentId,
        eventType: 'milestone',
        metricType,
        threshold,
        tema: modelo.tema,
        prioridade: threshold >= 10000 ? 'alta' : 'normal',
        titulo: templates.render(modelo.titulo, vars),
        mensagem: templates.render(modelo.mensagem, vars),
        metadados: {
          valor,
          mediaType: insight.mediaType || '',
          permalink: insight.permalink || '',
          thumbnailUrl: insight.thumbnailUrl || '',
          postedAt: insight.postedAt || null,
        },
      });
      if (nova) criadas.push(nova);
    }
  }

  return criadas;
}

/**
 * Varre os insights de um conjunto de contas.
 *
 * Chamado no FIM de um ciclo de sincronização, com as contas que aquele ciclo
 * tocou. Passar a lista evita varrer a base inteira a cada ciclo.
 *
 * @param {Array} contas  [{ _id, username, avatar }]
 * @param {object} opcoes { apenasStories }
 */
async function varrer(contas = [], { apenasStories = false } = {}) {
  if (!contas.length) return [];
  if (!thresholds.bancoConectado()) return [];

  const cfg = await thresholds.carregar();
  const criadas = [];

  for (const conta of contas) {
    const filtro = { accountId: conta._id };
    if (apenasStories) filtro.mediaType = 'STORY';
    else filtro.mediaType = { $ne: 'STORY' };

    /* Só o que foi sincronizado há pouco. Sem este corte, cada ciclo releria
       todo o histórico da conta para concluir que nada mudou. */
    const desde = new Date(Date.now() - 6 * 60 * 60 * 1000);
    filtro.syncedAt = { $gte: desde };

    const insights = await Insight.find(filtro)
      .select('igMediaId mediaType impressions reach videoViews likeCount commentsCount shareCount permalink thumbnailUrl postedAt')
      .limit(200)
      .lean();

    for (const insight of insights) {
      try {
        const novas = await processarInsight(insight, conta, cfg);
        criadas.push(...novas);
      } catch (err) {
        // Um insight problemático não derruba a varredura dos outros.
        console.warn(`[SmartActivity] ${insight.igMediaId}: ${err.message}`);
      }
    }
  }

  return criadas;
}

/**
 * Semeia os tetos com os valores atuais, SEM notificar.
 *
 * Roda uma vez. Sem isso, ligar o módulo numa conta com histórico dispararia
 * todos os marcos já ultrapassados de uma vez — centenas de avisos sobre
 * coisas que aconteceram semanas atrás.
 */
async function semear() {
  if (!thresholds.bancoConectado()) return { semeado: false, motivo: 'sem banco' };

  const Setting = require('../../models/Setting');
  const ja = await Setting.findOne({ key: CHAVE_SEMEADO }).lean();
  if (ja?.value?.feito) return { semeado: false, motivo: 'já feito' };

  const cfg = await thresholds.carregar();
  const insights = await Insight.find({})
    .select('accountId igMediaId mediaType impressions reach videoViews')
    .lean();

  let tetos = 0;
  for (const ins of insights) {
    if (!ins.accountId) continue;
    const ehStory = ins.mediaType === 'STORY';
    for (const metricType of (ehStory ? ['storyViews'] : ['contentViews', 'reach'])) {
      const marcos = cfg.thresholds[metricType] || [];
      const valor = thresholds.valorDaMetrica(ins, metricType);
      if (!valor || !marcos.length) continue;

      // O maior marco que este valor já ultrapassou vira o piso.
      const piso = marcos.filter(m => m <= valor).pop() || 0;
      await Milestone.updateOne(
        { accountId: ins.accountId, contentId: String(ins.igMediaId), metricType },
        { $max: { maiorDisparado: piso }, $set: { ultimoValor: valor } },
        { upsert: true }
      );
      tetos++;
    }
  }

  await Setting.updateOne(
    { key: CHAVE_SEMEADO },
    { $set: { value: { feito: true, em: new Date(), tetos } } },
    { upsert: true }
  );

  return { semeado: true, tetos };
}

/**
 * Resumo do dia — a notificação global.
 *
 * ── Por que ela é diferente das outras
 *
 * Marco é um fato pontual: aquele story passou de mil. Resumo é um retrato do
 * conjunto, e não tem "marco" para cruzar — ele acontece porque o dia passou.
 * Por isso o anti-repetição aqui não é o teto: é a data. Um resumo por dia,
 * e o próprio registro no banco é quem diz se o de hoje já saiu.
 *
 * ── Por que fica desligada por padrão
 *
 * Ela compete com os marcos pela atenção, e quem acabou de ligar o módulo
 * ainda não sabe qual dos dois quer. Ligar por padrão decidiria por ele.
 */
async function resumoDoDia() {
  if (!thresholds.bancoConectado()) return null;

  const cfg = await thresholds.carregar();
  if (!cfg.ativos.global) return null;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  /* Um por dia. A checagem é no banco e não em memória: o processo reinicia,
     a memória some, e o resumo sairia de novo. */
  const jaSaiu = await Notificacao.findOne({
    eventType: 'resumo',
    criadaEm: { $gte: inicioDoDia },
  }).lean();
  if (jaSaiu) return null;

  const [agregado] = await Insight.aggregate([
    { $match: { postedAt: { $gte: inicioDoDia } } },
    {
      $group: {
        _id: null,
        publicacoes: { $sum: 1 },
        contas: { $addToSet: '$accountId' },
        views: { $sum: { $ifNull: ['$videoViews', '$impressions'] } },
      },
    },
  ]);

  if (!agregado || !agregado.publicacoes) return null;

  const modelo = templates.modeloDe('resumo', cfg.mensagens);
  const vars = {
    publicacoes: templates.formatarNumero(agregado.publicacoes),
    contas: templates.formatarNumero((agregado.contas || []).length),
    views: templates.formatarNumero(agregado.views || 0),
  };

  return _gravar({
    accountId: null,
    eventType: 'resumo',
    tema: modelo.tema,
    prioridade: 'baixa',
    titulo: templates.render(modelo.titulo, vars),
    mensagem: templates.render(modelo.mensagem, vars),
    metadados: {
      publicacoes: agregado.publicacoes,
      contas: (agregado.contas || []).length,
      views: agregado.views || 0,
    },
  });
}

module.exports = { processarInsight, varrer, semear, resumoDoDia, CHAVE_SEMEADO };
