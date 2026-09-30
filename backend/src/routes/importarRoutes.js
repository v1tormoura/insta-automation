'use strict';

/**
 * Importar para a Biblioteca o que as contas conectadas do usuário publicaram.
 *
 *   GET  /importar/:accountId?depois=   uma página das publicações da conta
 *   POST /importar                      { accountId, ids[], qualidade, formato, pasta }
 *                                        → roda na fila; progresso pelo SSE 'media'
 */

const router = require('express').Router();
const { accounts } = require('../repos');
const fila = require('../queue');
const importar = require('../services/importarDoInstagram');

router.get('/:accountId', async (req, res) => {
  const conta = await accounts.de(req.user.id).findById(req.params.accountId).catch(() => null);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  try {
    res.json(await importar.listar(conta, { depois: req.query.depois || null, limite: req.query.limite }));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { accountId, ids, qualidade, formato, pasta } = req.body || {};
  const conta = await accounts.de(req.user.id).findById(accountId).catch(() => null);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Escolha ao menos uma publicação' });
  if (ids.length > importar.MAX_POR_IMPORTACAO) {
    return res.status(400).json({ error: `No máximo ${importar.MAX_POR_IMPORTACAO} publicações por importação` });
  }
  await fila.enfileirar('importar_midias', {
    usuarioId: req.user.id, accountId: conta.id, ids: ids.map(String),
    qualidade: String(qualidade || 'original'), formato: String(formato || 'mp4'), pasta: String(pasta || 'Importados'),
  });
  res.json({ ok: true, total: ids.length });
});

module.exports = router;
