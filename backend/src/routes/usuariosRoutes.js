'use strict';

/**
 * Usuários da plataforma — só o admin.
 *
 *   GET    /usuarios?status=       lista (pendentes primeiro), com contas e publicações
 *   POST   /usuarios/:id/aprovar   pendente/recusado → ativo
 *   POST   /usuarios/:id/recusar   pendente → recusado
 *   POST   /usuarios/:id/bloquear  ativo → bloqueado; pausa envios e campanhas dele
 *   POST   /usuarios/:id/reativar  bloqueado → ativo (o que foi pausado continua pausado)
 *   DELETE /usuarios/:id           apaga o usuário e tudo que é dele
 *
 * O admin não pode mexer em si mesmo por aqui — nem se trancar para fora.
 */

const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const { sql, ehUuid } = require('../db');
const usuarios = require('../repos/usuario');
const { broadcast } = require('../events/broadcaster');

const UPLOADS = path.resolve(__dirname, '../../uploads');

function linha(u) {
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel, status: u.status, avatar: u.avatar || '',
    criadoEm: u.createdAt, aprovadoEm: u.aprovadoEm || null, ultimoLogin: u.ultimoLogin || null,
    contas: u.contas ?? 0, publicacoes: u.publicacoes ?? 0,
  };
}

/** O alvo, se existir e não for admin. Responde o erro e devolve null. */
async function alvo(req, res) {
  const u = ehUuid(req.params.id) ? await usuarios.porId(req.params.id) : null;
  if (!u) { res.status(404).json({ error: 'Usuário não encontrado' }); return null; }
  if (u.papel === 'admin') { res.status(400).json({ error: 'O administrador não pode ser alterado por aqui', code: 'ALVO_ADMIN' }); return null; }
  return u;
}

async function mudarStatus(req, res, de, para, extra = {}) {
  const u = await alvo(req, res);
  if (!u) return null;
  if (!de.includes(u.status)) {
    res.status(409).json({ error: `Não é possível passar de "${u.status}" para "${para}"`, code: 'STATUS_INVALIDO' });
    return null;
  }
  const novo = await usuarios.atualizar(u.id, { status: para, ...extra });
  console.log(`👤 [Usuários] ${u.email}: ${u.status} → ${para}`);
  broadcast('usuarios', { action: 'atualizado', id: u.id }, req.user.id);
  return novo;
}

/** Tira de circulação o trabalho de um usuário: envios e campanhas pausados, fila limpa. */
async function pausarTudo(usuarioId) {
  const envios = await sql`
    update jobs set status = 'paused'
    where usuario_id = ${usuarioId} and status in ('queued', 'running', 'waiting_interval')
    returning id`;
  if (envios.length) {
    await sql`delete from queue_jobs where status = 'queued' and name = 'job_round'
              and data->>'jobId' = any(${envios.map(e => e.id)})`;
  }
  const campanhas = await sql`
    update campaigns set status = 'paused'
    where usuario_id = ${usuarioId} and status in ('scheduled', 'running')
    returning id`;
  const executor = require('../services/campaignExecutor');
  for (const c of campanhas) await executor.pausarCampanha(c.id).catch(() => {});
  await sql`delete from queue_jobs where status = 'queued' and name = 'story' and data->>'usuarioId' = ${usuarioId}`;
  return { envios: envios.length, campanhas: campanhas.length };
}

router.get('/', async (req, res) => {
  const status = usuarios.STATUS.includes(req.query.status) ? req.query.status : null;
  const [lista, pendentes] = await Promise.all([usuarios.listar({ status }), usuarios.contarPendentes()]);
  res.json({ usuarios: lista.map(linha), pendentes });
});

router.post('/:id/aprovar', async (req, res) => {
  const u = await mudarStatus(req, res, ['pendente', 'recusado'], 'ativo', { aprovadoEm: new Date() });
  if (u) res.json({ usuario: linha(u) });
});

router.post('/:id/recusar', async (req, res) => {
  const u = await mudarStatus(req, res, ['pendente'], 'recusado');
  if (u) res.json({ usuario: linha(u) });
});

router.post('/:id/bloquear', async (req, res) => {
  const u = await mudarStatus(req, res, ['ativo'], 'bloqueado');
  if (!u) return;
  const pausados = await pausarTudo(u.id);
  res.json({ usuario: linha(u), pausados });
});

router.post('/:id/reativar', async (req, res) => {
  const u = await mudarStatus(req, res, ['bloqueado'], 'ativo');
  if (u) res.json({ usuario: linha(u) });
});

/**
 * Apaga o usuário. As linhas dele saem em cascata (contas, envios, campanhas,
 * métricas…); os arquivos da biblioteca saem do disco.
 */
router.delete('/:id', async (req, res) => {
  const u = await alvo(req, res);
  if (!u) return;
  if (req.body?.confirmacao !== u.email) {
    return res.status(400).json({ error: 'Digite o e-mail do usuário para confirmar', code: 'CONFIRMACAO' });
  }

  await pausarTudo(u.id);
  const midias = await sql`select filename from media where usuario_id = ${u.id} and filename not like '\\_\\_folder\\_%'`;
  await sql`delete from usuarios where id = ${u.id}`;

  const { nomeDaMiniatura } = require('../services/miniaturaDeVideo');
  const apagar = rel => {
    const alvoArq = path.resolve(UPLOADS, rel);
    if (alvoArq.startsWith(UPLOADS + path.sep)) fs.rmSync(alvoArq, { force: true });
  };
  for (const { filename } of midias) { apagar(filename); apagar(nomeDaMiniatura(filename)); }

  console.log(`🗑️  [Usuários] ${u.email} apagado (${midias.length} mídia(s))`);
  broadcast('usuarios', { action: 'apagado', id: u.id }, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
