'use strict';

const router = require('express').Router();
const Notificacao = require('../models/Notificacao');
const Setting = require('../models/Setting');
const thresholds = require('../services/smartActivity/thresholds');
const templates = require('../services/smartActivity/templates');
const detector = require('../services/smartActivity/detector');

/**
 * Central de Notificações — leitura, marcação e configuração.
 *
 * Não existe rota que CRIE notificação. Elas nascem da detecção de marcos, que
 * é consequência da métrica ter subido — abrir um endpoint de criação daria a
 * qualquer chamador o poder de forjar conquista, e o histórico deixaria de ser
 * um registro do que aconteceu.
 */

/** Lista, mais recentes primeiro. */
router.get('/', async (req, res) => {
  try {
    const limite = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const apenasNaoLidas = req.query.naoLidas === '1';

    const filtro = apenasNaoLidas ? { lidaEm: null } : {};
    const [itens, naoLidas] = await Promise.all([
      Notificacao.find(filtro).sort({ criadaEm: -1 }).limit(limite).lean(),
      Notificacao.countDocuments({ lidaEm: null }),
    ]);

    res.json({ itens, naoLidas });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'NOTIFICACOES_ERRO' });
  }
});

/** Marca uma como lida. */
router.patch('/:id/lida', async (req, res) => {
  try {
    const r = await Notificacao.updateOne(
      { _id: req.params.id, lidaEm: null },
      { $set: { lidaEm: new Date() } }
    );
    res.json({ ok: true, alterou: r.modifiedCount > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'NOTIFICACAO_ERRO' });
  }
});

/** Marca todas. */
router.post('/lidas', async (_req, res) => {
  try {
    const r = await Notificacao.updateMany({ lidaEm: null }, { $set: { lidaEm: new Date() } });
    res.json({ ok: true, marcadas: r.modifiedCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'NOTIFICACAO_ERRO' });
  }
});

/** Configuração efetiva + as variáveis que o editor pode oferecer. */
router.get('/config', async (_req, res) => {
  try {
    const cfg = await thresholds.carregar();
    res.json({
      ...cfg,
      variaveis: templates.VARIAVEIS,
      modelosPadrao: templates.PADRAO,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'CONFIG_ERRO' });
  }
});

/**
 * Grava configuração.
 *
 * Os modelos são VALIDADOS aqui, não só no editor. Uma variável inexistente
 * salva por engano vira `{{typo}}` literal em toda notificação futura, e o
 * lugar de barrar isso é onde o dado entra — o editor pode ser contornado, a
 * rota não.
 */
router.put('/config', async (req, res) => {
  try {
    const { thresholds: marcos, ativos, exibicao, mensagens } = req.body || {};

    if (mensagens && typeof mensagens === 'object') {
      const invalidas = [];
      for (const [metrica, modelo] of Object.entries(mensagens)) {
        for (const campo of ['titulo', 'mensagem']) {
          const ruins = templates.validar(modelo?.[campo]);
          if (ruins.length) invalidas.push(`${metrica}.${campo}: ${ruins.join(', ')}`);
        }
      }
      if (invalidas.length) {
        return res.status(400).json({
          error: 'Variáveis desconhecidas no modelo.',
          code: 'VARIAVEL_INVALIDA',
          detalhes: invalidas,
          disponiveis: Object.keys(templates.VARIAVEIS),
        });
      }
    }

    // Marcos precisam ser números crescentes: uma lista fora de ordem faria a
    // detecção pular marcos sem que ninguém entendesse por quê.
    const marcosLimpos = {};
    for (const [k, v] of Object.entries(marcos || {})) {
      if (!Array.isArray(v)) continue;
      marcosLimpos[k] = [...new Set(v.map(Number).filter(n => Number.isFinite(n) && n > 0))]
        .sort((a, b) => a - b);
    }

    const atual = await Setting.findOne({ key: thresholds.CHAVE }).lean();
    const valor = {
      ...(atual?.value || {}),
      ...(Object.keys(marcosLimpos).length ? { thresholds: marcosLimpos } : {}),
      ...(ativos   ? { ativos }   : {}),
      ...(exibicao ? { exibicao } : {}),
      ...(mensagens ? { mensagens } : {}),
    };

    await Setting.updateOne({ key: thresholds.CHAVE }, { $set: { value: valor } }, { upsert: true });
    res.json({ ok: true, config: await thresholds.carregar() });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'CONFIG_ERRO' });
  }
});

/** Prévia do modelo com dados de exemplo — alimenta o preview ao vivo. */
router.post('/preview', (req, res) => {
  const { titulo, mensagem, metricType = 'storyViews' } = req.body || {};
  const invalidas = [...templates.validar(titulo), ...templates.validar(mensagem)];

  const vars = templates.contexto({
    conta: { username: 'oliviapaganini' },
    insight: { igMediaId: '178551331', mediaType: 'STORY', likeCount: 87,
               commentsCount: 12, shareCount: 4, reach: 940,
               postedAt: new Date(Date.now() - 2 * 3600 * 1000) },
    threshold: 1000, valor: 1024, metricType,
  });

  res.json({
    titulo: templates.render(titulo, vars),
    mensagem: templates.render(mensagem, vars),
    invalidas: [...new Set(invalidas)],
  });
});

/**
 * Semeia os tetos sem notificar.
 *
 * Existe como rota porque a primeira execução precisa acontecer uma vez, de
 * forma deliberada — e ligar o módulo numa base com histórico sem semear
 * despejaria centenas de avisos sobre coisas de semanas atrás.
 */
router.post('/semear', async (_req, res) => {
  try {
    res.json(await detector.semear());
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'SEMEAR_ERRO' });
  }
});

module.exports = router;
