'use strict';

/**
 * GET /atividade?usuario=&antesDe=&limite= — o registro de atividade.
 * Cada usuário vê o próprio; o admin vê todos e pode filtrar por usuário.
 */

const router = require('express').Router();
const atividade = require('../services/registroDeAtividade');

const UUID = /^[0-9a-f-]{36}$/i;

router.get('/', async (req, res) => {
  const admin = req.user.papel === 'admin';
  const pedido = UUID.test(String(req.query.usuario || '')) ? req.query.usuario : null;
  const usuarioId = admin ? pedido : req.user.id;
  const antesDe = /^\d+$/.test(String(req.query.antesDe || '')) ? req.query.antesDe : null;
  const linhas = await atividade.listar({ usuarioId, antesDe, limite: req.query.limite });
  res.json({
    itens: linhas.map(r => ({
      id: String(r.id), quando: r.quando, acao: r.acao, detalhe: r.detalhe, ip: r.ip, aparelho: r.aparelho,
      usuario: r.usuarioId ? { id: r.usuarioId, nome: r.usuarioNome || '', email: r.usuarioEmail || '', papel: r.usuarioPapel } : null,
    })),
    retencaoDias: atividade.RETENCAO_DIAS,
  });
});

module.exports = router;
