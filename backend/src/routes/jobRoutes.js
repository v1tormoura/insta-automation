'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/jobController');

router.get   ('/',               ctrl.list);
/* ANTES de '/:id': o Express casa na ordem, e 'excluir-varios' viraria um id. */
router.post  ('/excluir-varios', ctrl.removeVarios);
router.get   ('/:id',            ctrl.get);
router.post  ('/:id/pause',      ctrl.pause);
router.post  ('/:id/resume',     ctrl.resume);
router.post  ('/:id/cancel',     ctrl.cancel);
router.post  ('/:id/rerun',      ctrl.rerun);
router.post  ('/:id/toggle',     ctrl.togglePause);
router.delete('/:id',            ctrl.remove);
/* Etiqueta do comparativo de conteúdo — dá para marcar envios antigos também. */
router.patch ('/:id/rotulo',     async (req, res) => {
  const { sql } = require('../db');
  const rotulo = String(req.body?.rotulo || '').trim().slice(0, 40);
  const [job] = await sql`update jobs set rotulo = ${rotulo} where id = ${req.params.id} and usuario_id = ${req.user.id} returning id, rotulo`;
  if (!job) return res.status(404).json({ error: 'Envio não encontrado' });
  res.json(job);
});

module.exports = router;
