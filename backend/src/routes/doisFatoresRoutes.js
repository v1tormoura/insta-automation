'use strict';

/**
 * Minha Conta → Login em dois fatores.
 *
 *   GET  /conta/2fa             — ligado? quantos códigos de reserva sobram
 *   POST /conta/2fa/iniciar     — segredo novo + QR para o app autenticador
 *   POST /conta/2fa/ativar      — confere o 1º código e liga; devolve os códigos de reserva (uma vez)
 *   POST /conta/2fa/desativar   — pede senha + código (ou de reserva)
 *   POST /conta/2fa/reserva     — códigos de reserva novos (os antigos param de valer)
 *
 * Ligar é em dois passos de propósito: só liga depois de a pessoa provar que
 * o app gera o código certo. Ligar sem conferir trancaria fora quem leu o QR
 * errado.
 */

const router = require('express').Router();
const config = require('../config');
const usuarios = require('../repos/usuario');
const senhas = require('../services/senhaDoPainel');
const dois = require('../services/doisFatores');
const atividade = require('../services/registroDeAtividade');

const estado = u => ({
  ativo: !!u.totpAtivo,
  ativadoEm: u.totpAtivadoEm || null,
  reservaRestante: (u.totpReserva || []).length,
});

/** Código do app OU de reserva. Devolve os campos a gravar, ou null. */
function conferirCodigo(u, codigo) {
  const passo = dois.conferir(dois.abrir(u.totpSegredo), codigo, { ultimoPasso: u.totpUltimoPasso });
  if (passo != null) return { campos: { totpUltimoPasso: passo }, reserva: false };
  const sobra = dois.usarReserva(u.totpReserva, codigo);
  if (sobra) return { campos: { totpReserva: sobra }, reserva: true };
  return null;
}

function senhaConfere(u, senha) {
  if (typeof senha !== 'string' || !senha) return false;
  if (u.senhaHash && senhas.conferir(senha, u.senhaHash)) return true;
  return u.papel === 'admin' && !!config.authPassword && senha === config.authPassword;
}

router.get('/', async (req, res) => {
  res.json(estado(await usuarios.porId(req.user.id)));
});

router.post('/iniciar', async (req, res) => {
  const u = await usuarios.porId(req.user.id);
  if (u.totpAtivo) return res.status(409).json({ error: 'O login em dois fatores já está ligado.', code: 'JA_ATIVO' });
  const segredo = dois.gerarSegredo();
  await usuarios.atualizar(u.id, { totpSegredo: dois.guardar(segredo), totpUltimoPasso: null });
  const url = dois.otpauth(segredo, u.email || config.authUsername);
  res.json({ segredo, otpauth: url, qr: await dois.qrDe(url) });
});

router.post('/ativar', async (req, res) => {
  const u = await usuarios.porId(req.user.id);
  if (u.totpAtivo) return res.status(409).json({ error: 'O login em dois fatores já está ligado.', code: 'JA_ATIVO' });
  if (!u.totpSegredo) return res.status(400).json({ error: 'Comece lendo o QR code.', code: 'SEM_SEGREDO' });
  const passo = dois.conferir(dois.abrir(u.totpSegredo), req.body?.codigo);
  if (passo == null) {
    return res.status(400).json({ error: 'Código incorreto. Confira se o relógio do celular está certo e use o código atual.', code: 'CODIGO_ERRADO' });
  }
  const { codigos, hashes } = dois.gerarReserva();
  const novo = await usuarios.atualizar(u.id, {
    totpAtivo: true, totpUltimoPasso: passo, totpReserva: hashes, totpAtivadoEm: new Date(),
  });
  await atividade.registrar({ usuarioId: u.id, acao: 'Ligou o login em dois fatores', req });
  res.json({ ...estado(novo), codigos });
});

router.post('/desativar', async (req, res) => {
  const u = await usuarios.porId(req.user.id);
  if (!u.totpAtivo) return res.json(estado(u));
  if (!senhaConfere(u, req.body?.senha)) {
    return res.status(401).json({ error: 'Senha incorreta.', code: 'SENHA_ERRADA' });
  }
  if (!conferirCodigo(u, req.body?.codigo)) {
    return res.status(400).json({ error: 'Código incorreto.', code: 'CODIGO_ERRADO' });
  }
  const novo = await usuarios.atualizar(u.id, {
    totpAtivo: false, totpSegredo: null, totpUltimoPasso: null, totpReserva: [], totpAtivadoEm: null,
  });
  await atividade.registrar({ usuarioId: u.id, acao: 'Desligou o login em dois fatores', req });
  res.json(estado(novo));
});

router.post('/reserva', async (req, res) => {
  const u = await usuarios.porId(req.user.id);
  if (!u.totpAtivo) return res.status(400).json({ error: 'Ligue o login em dois fatores primeiro.', code: 'NAO_ATIVO' });
  const ok = conferirCodigo(u, req.body?.codigo);
  if (!ok || ok.reserva) return res.status(400).json({ error: 'Use o código atual do app autenticador.', code: 'CODIGO_ERRADO' });
  const { codigos, hashes } = dois.gerarReserva();
  const novo = await usuarios.atualizar(u.id, { ...ok.campos, totpReserva: hashes });
  await atividade.registrar({ usuarioId: u.id, acao: 'Gerou códigos de reserva novos', req });
  res.json({ ...estado(novo), codigos });
});

module.exports = router;
module.exports.conferirCodigo = conferirCodigo;
