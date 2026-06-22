'use strict';

/**
 * Edição de perfis em massa.
 *
 * Ordem de tentativa:
 *   1. instagram-private-api  — rápido, sem browser, resistente a mudanças de UI
 *   2. Puppeteer (browser)    — fallback quando Private API não tem sessão válida
 */

const fs      = require('fs');
const path    = require('path');
const Account = require('../models/Account');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const delay = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════════════════════
// MÉTODO 1 — Private API
// ══════════════════════════════════════════════════════════════════════════════

function getIgApiClient() {
  try {
    const { IgApiClient } = require('instagram-private-api');
    return IgApiClient;
  } catch {
    throw new Error('Pacote instagram-private-api não instalado. Execute: npm install instagram-private-api');
  }
}

async function bootstrapFromCookies(ig, account) {
  const candidates = [account.username];
  if (account.igUserId && !candidates.includes(account.igUserId)) candidates.push(account.igUserId);

  for (const uname of candidates) {
    const cookiesPath = path.join(SESSIONS_ROOT, uname, 'cookies.json');
    if (!fs.existsSync(cookiesPath)) continue;

    try {
      const browserCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      const sessionCookie  = browserCookies.find(c => c.name === 'sessionid');
      if (!sessionCookie) continue;

      const igCookies = browserCookies
        .filter(c => c.domain && c.domain.includes('instagram.com'))
        .map(c => ({
          key:          c.name,
          value:        c.value,
          domain:       c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
          path:         c.path  || '/',
          secure:       c.secure   || false,
          httpOnly:     c.httpOnly  || false,
          hostOnly:     !c.domain.startsWith('.'),
          creation:     new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        }));

      const jarJson = JSON.stringify({
        version: 'tough-cookie@4.1.2',
        storeType: 'MemoryCookieStore',
        rejectPublicSuffixes: true,
        enableLooseMode: false,
        allowSpecialUseDomain: true,
        cookies: igCookies,
      });

      await ig.state.deserializeCookieJar(jarJson);
      const me = await ig.account.currentUser();
      console.log(`✅ [BulkEdit] @${account.username} — sessão bootstrapped de cookies.json (@${me.username})`);

      const seed = `${account.username}_${String(account._id)}`;
      ig.state.generateDevice(seed);
      const serialized = await ig.state.serialize();
      delete serialized.constants;
      serialized._deviceSeed = seed;
      await Account.findByIdAndUpdate(account._id, { igSession: JSON.stringify(serialized) });
      return true;
    } catch (err) {
      console.log(`⚠️ [BulkEdit] bootstrap de @${uname} falhou: ${err.message}`);
    }
  }
  return false;
}

async function getPrivateClient(account) {
  const IgApiClient = getIgApiClient();
  const ig = new IgApiClient();
  const seed = `${account.username}_${String(account._id)}`;
  ig.state.generateDevice(seed);

  // 1. igSession salvo
  if (account.igSession) {
    try {
      const saved = typeof account.igSession === 'string' ? JSON.parse(account.igSession) : account.igSession;
      ig.state.generateDevice(saved._deviceSeed || seed);
      await ig.state.deserialize(saved);
      await ig.account.currentUser();
      console.log(`✅ [BulkEdit] Sessão privada restaurada para @${account.username}`);
      return ig;
    } catch {
      ig.state.generateDevice(seed);
    }
  }

  // 2. Bootstrap de cookies.json
  if (await bootstrapFromCookies(ig, account)) return ig;

  // 3. Login direto com senha (pode falhar com 400 em novos dispositivos)
  if (account.password) {
    try { await ig.simulate.preLoginFlow(); } catch {}
    const loginId = account.loginEmail?.trim() || account.username;
    await ig.account.login(loginId, account.password);
    const serialized = await ig.state.serialize();
    delete serialized.constants;
    serialized._deviceSeed = seed;
    await Account.findByIdAndUpdate(account._id, { igSession: JSON.stringify(serialized) });
    return ig;
  }

  throw new Error('NO_SESSION'); // sinal para tentar Puppeteer
}

async function editProfileViaPrivateApi(account, options) {
  const ig = await getPrivateClient(account);
  const me = await ig.account.currentUser();

  const hasChanges = options.name || options.bio !== undefined || options.setGender;
  if (hasChanges) {
    await ig.account.editProfile({
      first_name:   options.name        || me.full_name      || '',
      biography:    options.bio !== undefined ? options.bio  : (me.biography || ''),
      external_url: options.externalLink || me.external_url  || '',
      email:        me.email        || '',
      phone_number: me.phone_number || '',
      username:     me.username,
      // "1"=feminino, "2"=masculino, "3"=prefiro não informar
      gender:       options.setGender ? '1' : String(me.gender || '3'),
    });
    console.log(`✅ [BulkEdit] @${account.username} — perfil (nome/bio/gênero) atualizado via API privada`);
    await delay(2000);
  }

  let newAvatar = '';
  if (options.photoPath && fs.existsSync(options.photoPath)) {
    await ig.account.changeProfilePicture(fs.readFileSync(options.photoPath));
    console.log(`✅ [BulkEdit] @${account.username} — foto alterada via API privada`);
    await delay(2000);
    // Busca a nova URL de avatar imediatamente
    try {
      const updatedMe = await ig.account.currentUser();
      newAvatar = updatedMe.hd_profile_pic_url_info?.url || updatedMe.profile_pic_url || '';
      if (newAvatar) console.log(`🖼️ [BulkEdit] @${account.username} — nova URL de avatar capturada`);
    } catch {}
  }

  return { username: account.username, success: true, via: 'private_api', newAvatar };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÉTODO 2 — Puppeteer (fallback quando Private API falha)
// ══════════════════════════════════════════════════════════════════════════════

async function setReactValue(page, selector, value) {
  return page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
}

async function setBioViaBrowser(page, bio) {
  const selectors = [
    'textarea[name="biography"]',
    'textarea[aria-label="Bio"]',
    'textarea[aria-label="Biografia"]',
    'textarea[placeholder*="Bio"]',
    'textarea[placeholder*="bio"]',
    'textarea',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    try {
      // Limpa via React setter
      await setReactValue(page, sel, '');
      await delay(300);
      // Cola via clipboard para evitar dropdown de @menção
      await page.evaluate(val => navigator.clipboard?.writeText(val).catch(() => {}), bio);
      await el.click();
      await delay(200);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await delay(200);
      // Digita em partes para lidar com @mentions
      const parts = bio.split(/(@\w+)/g);
      for (const part of parts) {
        if (!part) continue;
        await page.keyboard.type(part, { delay: 20 });
        if (part.startsWith('@')) { await delay(500); await page.keyboard.press('Escape'); await delay(200); }
      }
      const filled = await page.evaluate(s => document.querySelector(s)?.value || '', sel);
      if (filled.trim()) { console.log(`✅ [BulkEdit] Bio definida via browser`); return true; }
    } catch {}
  }
  return false;
}

async function setGenderFemaleViaBrowser(page) {
  // Todos os possíveis valores atuais do dropdown de gênero (PT e EN)
  const genderValues = [
    'Prefiro não informar', 'Prefer not to say',
    'Masculino', 'Male',
    'Feminino', 'Female',
    'Personalizado', 'Custom',
  ];

  // Clica no trigger do dropdown (o elemento que mostra o valor atual)
  const opened = await page.evaluate(values => {
    // Tenta qualquer elemento clicável cujo texto seja um dos valores de gênero
    const all = [...document.querySelectorAll('button, [role="button"], [role="combobox"], div[tabindex="0"], span[tabindex="0"]')];
    const btn = all.find(el => values.some(v => el.textContent?.trim() === v));
    if (btn) { btn.click(); return btn.textContent?.trim(); }

    // Fallback: clica no próximo elemento após a label "Gênero"
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if ((node.textContent?.trim() === 'Gênero' || node.textContent?.trim() === 'Gender') &&
          node.children.length === 0) {
        let candidate = node.parentElement;
        for (let i = 0; i < 5 && candidate; i++) {
          const found = candidate.querySelector('button, [role="button"]');
          if (found) { found.click(); return found.textContent?.trim(); }
          candidate = candidate.parentElement;
        }
      }
    }
    return null;
  }, genderValues);

  if (!opened) { console.log('⚠️ [BulkEdit] Dropdown de gênero não encontrado'); return false; }
  console.log(`🔽 [BulkEdit] Dropdown de gênero aberto (era: "${opened}")`);

  // Aguarda as opções aparecerem no DOM (são renderizadas num portal/overlay)
  try {
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('*')].some(el =>
        (el.textContent?.trim() === 'Feminino' || el.textContent?.trim() === 'Female') &&
        el.children.length <= 1
      );
    }, { timeout: 4000 });
  } catch {
    console.log('⚠️ [BulkEdit] Timeout aguardando opções de gênero');
  }

  // Clica em "Feminino" — procura em TODO o document (pode estar num portal)
  const clicked = await page.evaluate(() => {
    const targets = ['Feminino', 'Female'];
    // Filtra elementos "folha" (sem filhos de texto) para evitar containers
    const all = [...document.querySelectorAll('*')];
    const candidates = all.filter(el => {
      const t = el.textContent?.trim();
      return targets.includes(t) && el.children.length <= 1;
    });
    if (!candidates.length) return false;
    // Clica no mais interno (último da lista = mais profundo na árvore DOM)
    candidates[candidates.length - 1].click();
    return true;
  });

  if (clicked) console.log('✅ [BulkEdit] Gênero Feminino selecionado via browser');
  else console.log('⚠️ [BulkEdit] Opção Feminino não encontrada no portal');
  return clicked;
}

async function setNameViaBrowser(page, name) {
  const selectors = [
    'input[name="fullName"]',
    'input[name="first_name"]',
    'input[autocomplete="name"]',
    'input[aria-label="Nome"]',
    'input[aria-label="Name"]',
  ];
  for (const sel of selectors) {
    const ok = await setReactValue(page, sel, name).catch(() => false);
    if (ok) { console.log(`✅ [BulkEdit] Nome definido via browser`); return true; }
  }
  return false;
}

async function uploadPhotoViaBrowser(page, photoPath) {
  if (!photoPath || !fs.existsSync(photoPath)) return false;

  // Procura o input[type="file"] diretamente (pode estar oculto)
  let fileInput = await page.$('input[type="file"]').catch(() => null);

  if (!fileInput) {
    // Clica no avatar para revelar o input de arquivo
    const clickedAvatar = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      const avatar = imgs.find(img =>
        img.closest('button') || img.closest('[role="button"]') ||
        img.src?.includes('profile') || img.alt?.toLowerCase().includes('foto')
      );
      if (avatar) {
        const btn = avatar.closest('button') || avatar.closest('[role="button"]');
        (btn || avatar).click();
        return true;
      }
      return false;
    });
    if (clickedAvatar) await delay(2000);
    fileInput = await page.$('input[type="file"]').catch(() => null);
  }

  if (!fileInput) {
    // Clica em "Alterar foto" ou "Change photo" se aparecer
    const texts = ['alterar foto', 'change photo', 'upload photo', 'fazer upload', 'choose'];
    await page.evaluate(txts => {
      const all = [...document.querySelectorAll('button, [role="button"], a, div')];
      const btn = all.find(el => txts.some(t => (el.textContent || '').toLowerCase().includes(t)));
      if (btn) btn.click();
    }, texts);
    await delay(2000);
    fileInput = await page.$('input[type="file"]').catch(() => null);
  }

  if (!fileInput) { console.log('⚠️ [BulkEdit] Input de foto não encontrado'); return false; }

  await fileInput.uploadFile(photoPath);
  await delay(5000);
  // Confirma crop se aparecer
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const confirm = btns.find(b => /aplicar|apply|done|concluir|save|salvar|next|próximo/i.test(b.textContent || ''));
    if (confirm) confirm.click();
  });
  await delay(3000);
  console.log('✅ [BulkEdit] Foto enviada via browser');
  return true;
}

async function clickSaveViaBrowser(page) {
  const clicked = await page.evaluate(() => {
    const saveTexts = ['salvar', 'save', 'enviar', 'submit', 'done', 'concluir', 'aplicar', 'ok'];

    // Tenta button[type="submit"] direto primeiro
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn && !submitBtn.disabled) { submitBtn.scrollIntoView(); submitBtn.click(); return 'submit-btn'; }

    // Procura qualquer botão/div cujo texto inclua uma palavra de salvar
    const all = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
    const btn = all.find(b => {
      const t = (b.textContent || b.value || '').trim().toLowerCase();
      return saveTexts.some(s => t === s || t === s + ' ');
    });
    if (btn) { btn.scrollIntoView(); btn.click(); return btn.textContent?.trim(); }

    // Último recurso: submete o form diretamente
    const form = document.querySelector('form');
    if (form) { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 'form-submit'; }

    return null;
  });

  if (clicked) console.log(`✅ [BulkEdit] Salvo via: ${clicked}`);
  else console.log('⚠️ [BulkEdit] Botão salvar não encontrado');
  await delay(7000);
}

async function editProfileViaBrowser(account, options) {
  const { launchBrowser, ensureLogin } = require('./instagramBot');

  console.log(`🌐 [BulkEdit] @${account.username} — usando Puppeteer como fallback...`);

  const { browser, page } = await launchBrowser(account.proxy, account.username);
  try {
    await ensureLogin(page, account);

    await page.goto('https://www.instagram.com/accounts/edit/', {
      waitUntil: 'domcontentloaded', timeout: 120000,
    });
    await delay(7000);

    // Preenche nome, bio e gênero no mesmo carregamento — salva tudo de uma vez
    if (options.name) await setNameViaBrowser(page, options.name);
    if (options.bio !== undefined) await setBioViaBrowser(page, options.bio || '');
    if (options.setGender) { await setGenderFemaleViaBrowser(page); await delay(400); }

    // Um único clique em Salvar para tudo
    if (options.name || options.bio !== undefined || options.setGender) {
      await clickSaveViaBrowser(page);
    }

    // Foto é feita em separado (requer interação diferente na UI)
    if (options.photoPath) await uploadPhotoViaBrowser(page, options.photoPath);

    return { username: account.username, success: true, via: 'browser' };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ══════════════════════════════════════════════════════════════════════════════

async function editOneProfile(account, options) {
  account.isBusy     = true;
  account.busyReason = 'Editando perfil';
  account.busySince  = new Date();
  await account.save();

  let result;

  try {
    // Tenta Private API primeiro
    result = await editProfileViaPrivateApi(account, options);
  } catch (apiErr) {
    const msg = String(apiErr.message || '');
    console.log(`⚠️ [BulkEdit] @${account.username} — Private API falhou (${msg.split('\n')[0]}), tentando browser...`);

    try {
      // Fallback: Puppeteer browser
      result = await editProfileViaBrowser(account, options);
    } catch (browserErr) {
      console.log(`❌ [BulkEdit] @${account.username} — browser também falhou: ${browserErr.message}`);
      result = { username: account.username, success: false, error: browserErr.message };
    }
  }

  if (result.success) {
    const updates = {
      isBusy: false, busyReason: '', busySince: null,
      lastSync: new Date(), healthStatus: 'ativa', lastError: '',
    };
    if (options.name)              updates.name = options.name;
    if (options.bio !== undefined) updates.bio  = options.bio;
    if (options.externalLink)      updates.externalLink = options.externalLink;
    if (result.newAvatar)          updates.avatar = result.newAvatar;
    await Account.findByIdAndUpdate(account._id, updates);

    // Se veio do browser e fez upload de foto, tenta capturar o novo avatar via Private API
    if (result.via === 'browser' && options.photoPath) {
      try {
        const { syncOneAccountFast } = require('../jobs/accountFastSync');
        await syncOneAccountFast(account);
      } catch {}
    }
  } else {
    account.isBusy = false; account.busyReason = ''; account.busySince = null;
    account.lastError = result.error;
    await account.save();
  }

  return result;
}

async function bulkEditProfiles({ accountIds, name, bio, externalLink, photo, setGender }) {
  const accounts  = await Account.find({ _id: { $in: accountIds } });
  const photoPath = photo ? path.resolve(__dirname, '../../uploads', photo.filename) : '';

  const results = [];
  for (const account of accounts) {
    if (account.isBusy) {
      results.push({ username: account.username, success: false, error: 'Conta em uso' });
      continue;
    }
    const result = await editOneProfile(account, {
      name,
      bio:          bio !== undefined ? bio : undefined,
      externalLink,
      photoPath,
      setGender:    setGender !== false,
    });
    results.push(result);
    await delay(8000); // pausa entre contas
  }

  return results;
}

module.exports = bulkEditProfiles;
