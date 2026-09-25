'use strict';

/**
 * Convites de testador do app.
 *
 * A Meta não convida testador do Instagram por API — é clique no painel dela.
 * Estas rotas cuidam do que é nosso: a fila de @ que faltam, o link direto
 * para a página certa do painel e o estado "conectado", deduzido das contas
 * em vez de marcado à mão.
 */

const router = require('express').Router();
const { sql } = require('../db');
const { convites } = require('../repos');
const { normalizarArroba } = require('../services/arrobaDoInstagram');

/** O app que recebe o testador e a página de papéis do painel da Meta. */
async function painelDaMeta(metaAppId) {
  const [app] = metaAppId
    ? await sql`select app_id from meta_apps where id::text = ${String(metaAppId)}`
    : await sql`select app_id from meta_apps where is_default`;
  const appId = app?.appId || '';
  return { appId, url: appId ? `https://developers.facebook.com/apps/${appId}/roles/roles/` : null };
}

/** Os @ que já têm conta conectada (o @ do Instagram não diferencia maiúscula). */
async function jaConectados() {
  const linhas = await sql`select username from accounts where access_token <> '' and ig_user_id <> ''`;
  return new Set(linhas.map(l => normalizarArroba(l.username)).filter(Boolean));
}

const comEstado = (c, vinculadas) => ({ ...c, conectado: vinculadas.has(c.username) });

router.get('/', async (req, res) => {
  const [lista, vinculadas, painel] = await Promise.all([
    convites.findMany(), jaConectados(), painelDaMeta(req.query.metaAppId || null),
  ]);
  res.json({ convites: lista.map(c => comEstado(c, vinculadas)), painel });
});

router.post('/', async (req, res) => {
  const username = normalizarArroba(req.body?.username);
  if (!username) {
    return res.status(400).json({ error: 'Informe um @ válido do Instagram (letras, números, ponto e sublinhado, até 30 caracteres).' });
  }
  const metaAppId = typeof req.body?.metaAppId === 'string' ? req.body.metaAppId : '';
  const observacao = typeof req.body?.observacao === 'string' ? req.body.observacao.slice(0, 280) : '';
  // Pedir de novo o mesmo @ atualiza, sem rebaixar para pendente um convite já enviado.
  const [convite] = await sql`
    insert into convites_de_acesso (username, meta_app_id, observacao)
    values (${username}, ${metaAppId}, ${observacao})
    on conflict (username) do update set
      meta_app_id = excluded.meta_app_id,
      observacao = coalesce(nullif(excluded.observacao, ''), convites_de_acesso.observacao)
    returning *`;
  const [vinculadas, painel] = await Promise.all([jaConectados(), painelDaMeta(metaAppId || null)]);
  res.status(201).json({ convite: comEstado(convite, vinculadas), painel });
});

router.patch('/:id/enviado', async (req, res) => {
  const convite = await convites.update(req.params.id, { estado: 'enviado', enviadoEm: new Date() });
  if (!convite) return res.status(404).json({ error: 'Convite não encontrado' });
  res.json({ convite: comEstado(convite, await jaConectados()) });
});

router.delete('/:id', async (req, res) => {
  if (!(await convites.remove(req.params.id))) return res.status(404).json({ error: 'Convite não encontrado' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.painelDaMeta = painelDaMeta;
module.exports.jaConectados = jaConectados;
