'use strict';

/**
 * Rotas de IA — hoje só geração de texto para legenda e comentário.
 *
 * Fica separada de legendRoutes de propósito: legendas são CRUD da biblioteca
 * do usuário; isto aqui é chamada externa paga, com limite de uso próprio.
 */

const router = require('express').Router();
const ia = require('../services/aiCaptionService');

/**
 * Limite simples por processo: chamada de IA custa dinheiro por requisição, e
 * um botão clicado em sequência viraria uma conta inesperada. Não é segurança
 * (o painel já exige autenticação) — é freio de custo.
 */
const JANELA_MS = 60_000;
const MAX_NA_JANELA = 12;
let _janela = { inicio: Date.now(), contador: 0 };

function dentroDoLimite() {
  const agora = Date.now();
  if (agora - _janela.inicio > JANELA_MS) _janela = { inicio: agora, contador: 0 };
  if (_janela.contador >= MAX_NA_JANELA) return false;
  _janela.contador++;
  return true;
}

// GET /ai/status — a interface pergunta antes de mostrar o botão de IA.
router.get('/status', (req, res) => {
  res.json({
    disponivel: ia.disponivel(),
    modelo:     ia.MODELO,
    tons:       Object.keys(ia.TONS),
    marcacoes:  ia.MARCACOES,
  });
});

// POST /ai/captions — { briefing, tom?, quantidade?, limite?, exemplo?, hashtags?, publico? }
router.post('/captions', async (req, res) => {
  if (!ia.disponivel()) {
    return res.status(503).json({
      code:  'AI_NOT_CONFIGURED',
      error: 'IA não configurada — defina ANTHROPIC_API_KEY no .env do servidor e reinicie o backend.',
    });
  }
  if (!dentroDoLimite()) {
    return res.status(429).json({
      code:  'AI_LOCAL_RATE_LIMIT',
      error: `Muitas gerações seguidas. Aguarde até ${JANELA_MS / 1000}s e tente de novo.`,
    });
  }

  try {
    const resultado = await ia.gerarLegendas({
      briefing:   req.body?.briefing,
      tom:        req.body?.tom,
      quantidade: req.body?.quantidade,
      limite:     req.body?.limite,
      exemplo:    req.body?.exemplo,
      hashtags:   req.body?.hashtags,
      publico:    req.body?.publico,
    });
    res.json(resultado);
  } catch (err) {
    const codigo = err?.code || 'AI_ERROR';
    // 4xx para o que o usuário resolve reescrevendo; 502 para falha externa.
    const status = ['AI_EMPTY_BRIEF', 'AI_BRIEF_TOO_LONG', 'AI_REFUSED', 'AI_BAD_REQUEST'].includes(codigo) ? 422
                 : codigo === 'AI_RATE_LIMITED'  ? 429
                 : codigo === 'AI_UNAUTHORIZED'  ? 502
                 : codigo === 'AI_SDK_MISSING'   ? 503
                 : 502;
    res.status(status).json({ code: codigo, error: err.message });
  }
});

module.exports = router;
