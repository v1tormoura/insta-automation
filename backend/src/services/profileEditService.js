'use strict';

/**
 * Edição de perfil via Private API (nome, bio, gênero, foto).
 * Funciona apenas para contas com igSession ou password.
 *
 * Gênero: 1 = Masculino, 2 = Feminino, 3 = Não-binário/Personalizado, 4 = Prefiro não dizer
 */

const fs   = require('fs');
const path = require('path');
const Account = require('../models/Account');
const { createClient } = require('./instagramPrivateService');
const { broadcast }    = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');

async function editProfile(account, { fullName, biography, gender, profilePicUrl, profilePicBuffer, customGender }) {
  // Se há challenge pendente, limpa e tenta login fresh com TOTP automático
  let ig;
  try {
    ig = await createClient(account);
  } catch (firstErr) {
    if (firstErr.code !== 'CHALLENGE_REQUIRED' && firstErr.code !== 'TOTP_REQUIRED') throw firstErr;
    // Sessão expirada ou challenge — limpa estado e tenta login fresco (senha + TOTP automático)
    await Account.findByIdAndUpdate(account._id, { challengeState: null, igSession: '' });
    const fresh = await Account.findById(account._id);
    try {
      ig = await createClient(fresh);
    } catch (retryErr) {
      throw retryErr;
    }
  }

  const results = {};
  const dbUpdate = { healthStatus: 'ativa', lastError: '' };

  // ── 1. Editar nome / bio / gênero ─────────────────────────────────────────
  if (fullName !== undefined || biography !== undefined || gender !== undefined) {
    const current = await ig.account.currentUser();

    const payload = {
      username:      current.username,
      full_name:     fullName    !== undefined ? fullName    : (current.full_name || ''),
      biography:     biography   !== undefined ? biography   : (current.biography || ''),
      external_url:  current.external_url || '',
      email:         current.email        || '',
      phone_number:  current.phone_number || '',
      gender:        gender      !== undefined ? Number(gender) : (current.gender ?? 4),
      custom_gender: customGender !== undefined ? customGender : (current.custom_gender || ''),
    };

    await ig.account.editProfile(payload);
    results.profileEdited = true;
    console.log(`[EditProfile] @${account.username} — nome/bio/genero atualizados`);

    if (fullName  !== undefined) dbUpdate.name = fullName;
    if (biography !== undefined) dbUpdate.bio  = biography;

    await delay(1500);
  }

  // ── 2. Trocar foto de perfil ──────────────────────────────────────────────
  let picBuffer = profilePicBuffer || null;

  if (!picBuffer && profilePicUrl) {
    const res = await fetch(profilePicUrl);
    if (!res.ok) throw new Error(`Nao foi possivel baixar a foto: HTTP ${res.status}`);
    picBuffer = Buffer.from(await res.arrayBuffer());
  }

  if (picBuffer) {
    await ig.account.changeProfilePicture(picBuffer);
    results.pictureChanged = true;
    console.log(`[EditProfile] @${account.username} — foto de perfil trocada`);

    // Salva avatar localmente e atualiza o campo no banco
    try {
      if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
      const avatarFile = path.join(AVATARS_DIR, `${account.username}.jpg`);
      fs.writeFileSync(avatarFile, picBuffer);
      dbUpdate.avatar = `/uploads/avatars/${account.username}.jpg`;
    } catch (saveErr) {
      console.log(`[EditProfile] Nao salvou avatar local: ${saveErr.message}`);
    }
  }

  // ── 3. Persiste mudancas no banco e notifica clientes ─────────────────────
  await Account.findByIdAndUpdate(account._id, dbUpdate);
  broadcast('accounts', { action: 'synced' });

  return results;
}

/**
 * Processa uma fila de edições em background.
 * edits = [{ accountId, fullName?, biography?, gender?, profilePicUrl?, customGender? }]
 * delayBetween = ms entre cada conta (padrão: 5s para não parecer bot)
 * jobId = identificador do job para broadcast de progresso
 */
async function bulkEditProfiles(edits, { delayBetween = 5000, jobId } = {}) {
  const results = [];
  const total   = edits.length;

  for (let i = 0; i < edits.length; i++) {
    const edit    = edits[i];
    const account = await Account.findById(edit.accountId);
    if (!account) {
      results.push({ accountId: edit.accountId, status: 'error', error: 'Conta nao encontrada' });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, status: 'error' } });
      continue;
    }

    if (!account.igSession && !account.password) {
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: 'Sem sessao ou senha — nao e possivel editar via Private API' });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'error' } });
      continue;
    }

    try {
      const r = await editProfile(account, edit);
      results.push({ accountId: edit.accountId, username: account.username, status: 'ok', ...r });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'ok' } });
    } catch (err) {
      console.error(`[EditProfile] @${account.username}:`, err.message);
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: err.message });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'error', error: err.message } });
    }

    if (delayBetween > 0) await delay(delayBetween);
  }

  return results;
}

module.exports = { editProfile, bulkEditProfiles };
