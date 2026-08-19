'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/campaignController');

/**
 * Campaign API.
 *
 * Montada com o middleware `auth` no app.js, como as demais rotas do painel.
 * As rotas são finas por escolha: validação e regra vivem em campaignService,
 * transição de estado em campaignState.
 *
 * Nenhum endpoint desta fase envia publicação ao Instagram — a execução é da
 * fase 8. `start` apenas prepara o estado.
 */

/* ── Auxiliares do wizard ──────────────────────────────────────────────────── */
// Antes das rotas com :id — senão "variables" e "preview" seriam lidos como id.
router.get ('/variables', ctrl.variables);
router.post('/preview',   ctrl.preview);

/* ── CRUD ──────────────────────────────────────────────────────────────────── */
// POST aceita o header opcional `Idempotency-Key` para reenvio seguro.
router.post  ('/',    ctrl.create);
router.get   ('/',    ctrl.list);
router.get   ('/:id', ctrl.get);
router.patch ('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

/* ── Controle de estado ────────────────────────────────────────────────────── */
router.post('/:id/start',  ctrl.start);
router.post('/:id/pause',  ctrl.pause);
router.post('/:id/resume', ctrl.resume);
router.post('/:id/cancel', ctrl.cancel);

/* ── Execução ──────────────────────────────────────────────────────────────── */
router.post('/:id/retry-failed', ctrl.retryFailed);

/* ── Publicações ───────────────────────────────────────────────────────────── */
router.get ('/:id/publications',                       ctrl.listPublications);
router.get ('/:id/publications/:publicationId',        ctrl.getPublication);
router.post('/:id/publications/:publicationId/retry',  ctrl.retryPublication);
router.post('/:id/publications/:publicationId/retry-comment', ctrl.retryComment);
router.post('/:id/publications/:publicationId/cancel', ctrl.cancelPublication);

module.exports = router;
