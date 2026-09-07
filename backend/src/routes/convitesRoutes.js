'use strict';

/**
 * Convites de testador do app.
 *
 * O que a Meta permite e o que não permite está escrito no modelo
 * (`ConviteDeAcesso`): convidar um testador do Instagram é ação de painel, não
 * existe endpoint. Estas rotas cuidam da parte que é nossa — a fila de @ que
 * precisam entrar, o link direto para a página certa do painel, e o estado
 * conectado, que é lido das contas em vez de gravado aqui.
 */

const router  = require('express').Router();
const Convite = require('../models/ConviteDeAcesso');
const Account = require('../models/Account');
const MetaApp = require('../models/MetaApp');
const { normalizarArroba } = require('../services/arrobaDoInstagram');

/**
 * O App ID que vai receber o testador, e a página do painel onde se convida.
 *
 * Devolve `null` no link quando não há app configurado: um link para
 * `/apps/undefined/` levaria a uma página de erro da Meta, o que é pior do que
 * a tela dizer que falta configurar o app.
 */
async function painelDaMeta(metaAppId) {
  let appId = '';
  try {
    const doc = metaAppId
      ? await MetaApp.findById(metaAppId).lean()
      : await MetaApp.findOne({ isDefault: true }).lean();
    appId = doc?.appId || '';
  } catch { /* sem banco ou id inválido: cai nas env vars abaixo */ }

  appId = appId || process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || '';
  return {
    appId,
    /* `roles/roles` é a página que tem a seção "Testadores do Instagram".
       O painel abre nela e o @ já está na área de transferência. */
    url: appId ? `https://developers.facebook.com/apps/${appId}/roles/roles/` : null,
  };
}

/**
 * Quais @ já têm conta vinculada no sistema.
 *
 * Buscar todas as contas e comparar em memória, em vez de uma consulta por
 * convite: são dezenas de contas, e o Mongo não sabe comparar em minúscula num
 * `find` simples — o @ do Instagram não diferencia caixa, e um convite para
 * "@Fulano" precisa casar com a conta "fulano".
 */
async function jaConectados() {
  const contas = await Account.find({})
    .select('username accessToken igUserId instagrapiSession igSession rawWebSessionid')
    .lean();

  const vinculadas = new Set();
  for (const c of contas) {
    const u = normalizarArroba(c.username);
    if (!u) continue;
    /* Mesmo critério que a tela de contas usa para dizer "conectada": token da
       API oficial, sessão mobile ou sessão web. `healthStatus` não serve — ele
       nasce saudável numa conta que nunca conectou. */
    const ligada = !!((c.igUserId && c.accessToken) || c.instagrapiSession || c.igSession || c.rawWebSessionid);
    if (ligada) vinculadas.add(u);
  }
  return vinculadas;
}

/** Acrescenta ao convite o que não está guardado nele. */
function comEstadoDerivado(doc, vinculadas) {
  const o = doc.toObject ? doc.toObject() : doc;
  return { ...o, conectado: vinculadas.has(o.username) };
}

// ── GET /convites ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [convites, vinculadas, painel] = await Promise.all([
      Convite.find().sort({ createdAt: -1 }).lean(),
      jaConectados(),
      painelDaMeta(req.query.metaAppId || null),
    ]);
    res.json({
      convites: convites.map(c => comEstadoDerivado(c, vinculadas)),
      painel,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /convites ───────────────────────────────────────────────────────────
// Body: { username, metaAppId?, observacao? }
router.post('/', async (req, res) => {
  try {
    const username = normalizarArroba(req.body?.username);
    if (!username) {
      return res.status(400).json({
        error: 'Informe um @ válido do Instagram (letras, números, ponto e sublinhado, até 30 caracteres).',
      });
    }

    const metaAppId  = typeof req.body?.metaAppId === 'string' ? req.body.metaAppId : '';
    const observacao = typeof req.body?.observacao === 'string' ? req.body.observacao.slice(0, 280) : '';

    /* Upsert em vez de create: pedir duas vezes o mesmo @ é o gesto natural de
       quem não lembra se já pediu, e não deve virar erro de índice único.
       `$setOnInsert` no estado para não rebaixar para pendente um convite que
       já foi enviado. */
    const doc = await Convite.findOneAndUpdate(
      { username },
      { $set: { metaAppId, ...(observacao ? { observacao } : {}) }, $setOnInsert: { estado: 'pendente' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const [vinculadas, painel] = await Promise.all([jaConectados(), painelDaMeta(metaAppId || null)]);
    res.status(201).json({ convite: comEstadoDerivado(doc, vinculadas), painel });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PATCH /convites/:id/enviado ──────────────────────────────────────────────
// O administrador confirma que disparou o convite no painel da Meta.
router.patch('/:id/enviado', async (req, res) => {
  try {
    const doc = await Convite.findByIdAndUpdate(
      req.params.id,
      { estado: 'enviado', enviadoEm: new Date() },
      { new: true },
    );
    if (!doc) return res.status(404).json({ error: 'Convite não encontrado' });
    const vinculadas = await jaConectados();
    res.json({ convite: comEstadoDerivado(doc, vinculadas) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /convites/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const doc = await Convite.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Convite não encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
module.exports.painelDaMeta  = painelDaMeta;
module.exports.jaConectados  = jaConectados;
