'use strict';

/**
 * Edição de perfil via Private API (nome, bio, gênero, foto).
 * Funciona apenas para contas com igSession ou password.
 *
 * Gênero: 1 = Masculino, 2 = Feminino, 3 = Não-binário/Personalizado, 4 = Prefiro não dizer
 */

const Account = require('../models/Account');
const { createClient, resolveChallenge } = require('./instagramPrivateService');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function editProfile(account, { fullName, biography, gender, profilePicUrl, profilePicBuffer, customGender }) {
  // Se há challenge pendente, limpa e tenta login fresh com TOTP automático
  let ig;
  try {
    ig = await createClient(account);
  } catch (err) {
    if (err.code === 'CHALLENGE_REQUIRED') {
      await Account.findByIdAndUpdate(account._id, { challengeState: null });
      const fresh = await Account.findById(account._id);
      ig = await createClient(fresh, { forcePasswordLogin: true });
    } else {
      throw err;
    }
  }

  const results = {};

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
    console.log(`✅ [EditProfile] @${account.username} — nome/bio/gênero atualizados`);

    await delay(1500);
  }

  // ── 2. Trocar foto de perfil ──────────────────────────────────────────────
  let picBuffer = profilePicBuffer || null;

  if (!picBuffer && profilePicUrl) {
    const res = await fetch(profilePicUrl);
    if (!res.ok) throw new Error(`Não foi possível baixar a foto: HTTP ${res.status}`);
    picBuffer = Buffer.from(await res.arrayBuffer());
  }

  if (picBuffer) {
    await ig.account.changeProfilePicture(picBuffer);
    results.pictureChanged = true;
    console.log(`✅ [EditProfile] @${account.username} — foto de perfil trocada`);
  }

  return results;
}

/**
 * Processa uma fila de edições em background.
 * edits = [{ accountId, fullName?, biography?, gender?, profilePicUrl?, customGender? }]
 * delayBetween = ms entre cada conta (padrão: 5s para não parecer bot)
 */
async function bulkEditProfiles(edits, { delayBetween = 5000 } = {}) {
  const results = [];

  for (const edit of edits) {
    const account = await Account.findById(edit.accountId);
    if (!account) {
      results.push({ accountId: edit.accountId, status: 'error', error: 'Conta não encontrada' });
      continue;
    }

    if (!account.igSession && !account.password) {
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: 'Sem sessão ou senha — não é possível editar via Private API' });
      continue;
    }

    try {
      const r = await editProfile(account, edit);
      results.push({ accountId: edit.accountId, username: account.username, status: 'ok', ...r });
    } catch (err) {
      console.error(`❌ [EditProfile] @${account.username}:`, err.message);
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: err.message });
    }

    if (delayBetween > 0) await delay(delayBetween);
  }

  return results;
}

module.exports = { editProfile, bulkEditProfiles };
