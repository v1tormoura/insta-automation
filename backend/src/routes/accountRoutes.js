'use strict';

const router = require('express').Router();
const { sql } = require('../db');
const accounts = require('../repos/accounts');
const contas = require('../services/contas');
const cotaDaApi = require('../services/cotaDaApi');
const { broadcast } = require('../events/broadcaster');

router.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const [lista, total] = await Promise.all([
    accounts.findMany({}, { orderBy: 'created_at desc', limit, offset: (page - 1) * limit }),
    accounts.count(),
  ]);
  res.json({
    accounts: lista.map(accounts.paraApi),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/** A cota da API (publicações em 24h) de cada conta conectada. */
router.get('/cota', async (_req, res) => {
  const lista = await sql`select id from accounts where access_token <> '' and ig_user_id <> ''`;
  const resultado = await Promise.all(lista.map(async ({ id }) => {
    const c = await accounts.findById(id);
    const cota = await cotaDaApi.consultar(c);
    if (!cota) return { accountId: c.id, username: c.username, disponivel: false };
    return {
      accountId: c.id, username: c.username, disponivel: true,
      usage: cota.usage, limite: cota.limite, restante: Math.max(0, cota.limite - cota.usage),
      cheia: cota.cheia, libera: cota.cheia ? await cotaDaApi.proximaLiberacao(c) : null,
    };
  }));
  res.json({ limite: cotaDaApi.LIMITE, contas: resultado });
});

router.post('/sync-all', async (_req, res) => {
  await contas.sincronizarTodas();
  res.json({ success: true });
});

router.post('/:id/sync', async (req, res) => {
  const conta = await accounts.findById(req.params.id);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json(accounts.paraApi(await contas.sincronizar(conta)));
});

router.delete('/:id', async (req, res) => {
  if (!(await contas.remover(req.params.id))) return res.status(404).json({ error: 'Conta não encontrada' });
  broadcast('accounts', { action: 'deleted' });
  res.json({ success: true });
});

module.exports = router;
