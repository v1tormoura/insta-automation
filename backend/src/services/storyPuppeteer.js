'use strict';

/**
 * Posta story usando o browser Puppeteer com a sessão existente.
 *
 * Usa user-agent MOBILE porque o Instagram web desktop não tem criação de Story.
 * O Instagram mobile web SIM tem criação de Story via câmera / "+" no topo.
 *
 * Fluxo:
 * 1. Lança browser com UA mobile
 * 2. Injeta cookies da sessão salva (cookies.json)
 * 3. Navega para home no mobile web
 * 4. Clica no ícone de câmera ou "+" para criar story
 * 5. Faz upload da imagem
 * 6. Clica "Seu story" / "Your story" para publicar
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { launchBrowser, ensureLogin } = require('./instagramBot');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MOBILE_VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true };

const delay = ms => new Promise(r => setTimeout(r, ms));

function loadCookies(username) {
  const p = path.join(SESSIONS_ROOT, username, 'cookies.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

async function postStoryPuppeteer(account, { imageUrl, imageBuffer, linkUrl, linkText }) {
  // Salva imagem em arquivo temporário
  let buffer = imageBuffer;
  if (!buffer && imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Erro ao baixar imagem: HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  if (!buffer) throw new Error('Imagem não fornecida');

  const tmpImg = path.join(os.tmpdir(), `story_${Date.now()}.jpg`);
  fs.writeFileSync(tmpImg, buffer);

  // Lança browser normal (usa sessão salva para login)
  const { browser, page } = await launchBrowser(account.proxy, account.username);

  try {
    // ── PASSO 1: Configura user-agent e viewport MOBILE ───────────────────────
    await page.setUserAgent(MOBILE_UA);
    await page.setViewport(MOBILE_VIEWPORT);

    // Injeta cookies da sessão (para não precisar fazer login de novo no mobile UA)
    const savedCookies = loadCookies(account.username);
    if (savedCookies && savedCookies.length > 0) {
      // Garante que os cookies sejam válidos para instagram.com
      const igCookies = savedCookies.map(c => ({
        ...c,
        domain: c.domain || '.instagram.com',
        sameSite: c.sameSite === 'unspecified' ? 'None' : (c.sameSite || 'None'),
      }));
      try {
        await page.setCookie(...igCookies);
        console.log(`🍪 [StoryPuppeteer] ${igCookies.length} cookies injetados`);
      } catch (e) {
        console.log(`⚠️  [StoryPuppeteer] Erro ao injetar cookies: ${e.message}`);
      }
    } else {
      // Sem cookies salvos — faz login normal e depois configura UA mobile
      await ensureLogin(page, account);
      await page.setUserAgent(MOBILE_UA);
      await page.setViewport(MOBILE_VIEWPORT);
    }

    // ── PASSO 2: Navega para home no mobile web ────────────────────────────────
    console.log(`📱 [StoryPuppeteer] @${account.username} — carregando Instagram mobile web...`);
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(3000);

    await dbgScreenshot(page, 'story_mobile_home.png');
    console.log(`🌐 [StoryPuppeteer] URL: ${page.url()}`);

    // ── PASSO 3: Clica no botão de criar story ────────────────────────────────
    // No mobile web, é o ícone de câmera (top-left) ou o "+" na tela de stories
    const storyEntrySelectors = [
      // Câmera no topo (Instagram mobile web)
      '[aria-label="Camera"]',
      '[aria-label="Câmera"]',
      '[aria-label="New story"]',
      '[aria-label="Criar story"]',
      '[aria-label="Story"]',
      // Ícone "+" no stories tray
      'a[href*="story/create"]',
      // Botão de câmera genérico no header
      'header button:first-child',
      'header a:first-child',
    ];

    let storyOpened = false;
    for (const sel of storyEntrySelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          storyOpened = true;
          console.log(`✅ [StoryPuppeteer] Clicou story entry: ${sel}`);
          break;
        }
      } catch {}
    }

    if (!storyOpened) {
      // Procura por aria-label com "story" ou "câmera"
      const found = await page.evaluate(() => {
        for (const el of document.querySelectorAll('a, button, [role="button"]')) {
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          const href  = (el.getAttribute('href') || '').toLowerCase();
          if (label.includes('story') || label.includes('câmera') || label.includes('camera')
              || href.includes('story')) {
            el.click();
            return label || href;
          }
        }
        return null;
      });
      if (found) {
        storyOpened = true;
        console.log(`✅ [StoryPuppeteer] Story entry via evaluate: "${found}"`);
      }
    }

    await delay(2500);
    await dbgScreenshot(page, 'story_entry.png');

    // Loga aria-labels para debug
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[aria-label]'))
        .map(el => el.getAttribute('aria-label'))
        .filter(Boolean)
        .slice(0, 40)
    );
    console.log(`🏷️  [StoryPuppeteer] Labels disponíveis:`, labels);

    // ── PASSO 4: Encontra o file input ────────────────────────────────────────
    let fileInput = await page.$('input[type="file"]').catch(() => null);
    if (!fileInput) {
      fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 }).catch(() => null);
    }

    if (!fileInput) {
      await dbgScreenshot(page, 'story_no_input.png');
      throw new Error(`File input não encontrado. URL: ${page.url()}\nVeja story_entry.png e story_no_input.png`);
    }

    // ── PASSO 5: Upload da imagem ──────────────────────────────────────────────
    await fileInput.uploadFile(tmpImg);
    console.log(`📎 [StoryPuppeteer] @${account.username} — imagem carregada...`);
    await delay(5000);

    await dbgScreenshot(page, 'story_after_upload.png');

    const btnsAfterUpload = await getAllButtonTexts(page);
    console.log(`🔘 [StoryPuppeteer] Botões após upload:`, btnsAfterUpload);

    // ── PASSO 6: Avança no editor (se necessário) ─────────────────────────────
    // No mobile web, pode ter "Avançar" / "Next" para sair do editor e ir para publicação
    const advanceTexts = ['Avançar', 'Next', 'Próximo', 'Continuar', 'Continue'];
    const hasAdvance = btnsAfterUpload.some(t => advanceTexts.some(a => t.toLowerCase().includes(a.toLowerCase())));

    if (hasAdvance) {
      await tryClickText(page, advanceTexts);
      console.log(`⏭️  [StoryPuppeteer] Clicou Avançar`);
      await delay(3000);
      await dbgScreenshot(page, 'story_step2.png');

      const btns2 = await getAllButtonTexts(page);
      console.log(`🔘 [StoryPuppeteer] Botões step 2:`, btns2);

      // Se ainda tem Avançar, clica mais uma vez
      if (btns2.some(t => advanceTexts.some(a => t.toLowerCase().includes(a.toLowerCase())))) {
        await tryClickText(page, advanceTexts);
        await delay(2500);
      }
    }

    // ── PASSO 7: Link sticker (se solicitado) ─────────────────────────────────
    if (linkUrl) {
      console.log(`🔗 [StoryPuppeteer] Adicionando link sticker...`);
      await dbgScreenshot(page, 'story_before_sticker.png');

      // Loga todos os botões/labels disponíveis no editor para debug
      const editorLabels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[aria-label], button, [role="button"]'))
          .map(el => el.getAttribute('aria-label') || el.innerText?.trim())
          .filter(Boolean).slice(0, 50)
      );
      console.log(`🏷️  [StoryPuppeteer] Labels no editor:`, editorLabels);

      const linkAdded = await addLinkSticker(page, linkUrl, linkText);
      if (!linkAdded) {
        console.log(`⚠️  Link sticker não disponível nesta conta/versão`);
      }
      await delay(1500);
    }

    // ── PASSO 8: Publica o Story ───────────────────────────────────────────────
    console.log(`🚀 [StoryPuppeteer] @${account.username} — publicando story...`);

    const finalBtns = await getAllButtonTexts(page);
    console.log(`🔘 [StoryPuppeteer] Botões de publicação:`, finalBtns);
    await dbgScreenshot(page, 'story_publish.png');

    const publishTexts = [
      'Seu story', 'Your story',
      'Compartilhar no story', 'Share to story',
      'Adicionar ao story', 'Add to story',
      'Compartilhar', 'Share',
      'Publicar', 'Publish',
      'Post',
    ];

    let published = false;
    for (const text of publishTexts) {
      if (await tryClickText(page, [text])) {
        console.log(`✅ [StoryPuppeteer] Publicou via: "${text}"`);
        published = true;
        break;
      }
    }

    if (!published) {
      throw new Error(
        `Não encontrou botão de publicar.\nBotões: ${finalBtns.join(', ')}\nURL: ${page.url()}`
      );
    }

    await delay(5000);
    console.log(`✅ [StoryPuppeteer] @${account.username} — story publicado! URL: ${page.url()}`);
    return { method: 'puppeteer_mobile', withLink: !!linkUrl };

  } finally {
    try { fs.unlinkSync(tmpImg); } catch {}
    try { await browser.close(); } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAllButtonTexts(page) {
  try {
    return await page.$$eval('button, [role="button"]', els =>
      els.map(el => el.innerText?.trim()).filter(Boolean)
    );
  } catch { return []; }
}

async function tryClickText(page, texts) {
  for (const text of texts) {
    try {
      const els = await page.$$('button, [role="button"], a');
      for (const el of els) {
        const t = await el.evaluate(node =>
          (node.innerText?.trim() || node.getAttribute('aria-label') || '')
        );
        if (t.toLowerCase().includes(text.toLowerCase())) {
          await el.click();
          return true;
        }
      }
    } catch {}
  }
  return false;
}

async function dbgScreenshot(page, filename) {
  try {
    await page.screenshot({ path: path.join(__dirname, '../../uploads', filename) });
    console.log(`📷 ${filename}`);
  } catch {}
}

async function addLinkSticker(page, linkUrl) {
  // Tenta abrir o painel de stickers — vários aria-labels possíveis no mobile web
  const stickerSels = [
    '[aria-label="Sticker"]',
    '[aria-label="Stickers"]',
    '[aria-label="Figurinha"]',
    '[aria-label="Figurinhas"]',
    '[aria-label="Add sticker"]',
    '[aria-label="Adicionar figurinha"]',
    '[aria-label="Add a sticker"]',
  ];

  let stickerOpened = false;
  for (const sel of stickerSels) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click(); stickerOpened = true; console.log(`🎯 Sticker btn: ${sel}`); break; }
    } catch {}
  }

  // Fallback: procura por SVG button que possa ser o de sticker (costuma ser o 2º ou 3º botão no topo)
  if (!stickerOpened) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of btns) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('sticker') || label.includes('figurin') || label.includes('adesiv')) {
          btn.click();
          return label;
        }
      }
      return null;
    });
    if (clicked) { stickerOpened = true; console.log(`🎯 Sticker via evaluate: ${clicked}`); }
  }

  if (!stickerOpened) {
    console.log(`⚠️  Painel de stickers não encontrado`);
    return false;
  }

  await delay(1500);
  await dbgScreenshot(page, 'story_sticker_panel.png');

  // Clica no sticker de Link
  const linkFound = await tryClickText(page, ['Link', 'URL', 'link sticker', 'Link sticker']);
  if (!linkFound) {
    console.log(`⚠️  Sticker de Link não encontrado no painel`);
    return false;
  }
  await delay(1000);
  await dbgScreenshot(page, 'story_link_input.png');

  // Digita a URL
  const input = await page.$(
    'input[type="url"], input[type="text"][placeholder*="URL" i], input[placeholder*="url" i], input[placeholder*="link" i]'
  );
  if (!input) {
    console.log(`⚠️  Campo de URL não encontrado`);
    return false;
  }

  await input.click({ clickCount: 3 });
  await input.type(linkUrl);
  await delay(500);
  await tryClickText(page, ['Done', 'OK', 'Concluído', 'Adicionar', 'Add', 'Confirmar']);
  console.log(`✅ Link sticker adicionado: ${linkUrl}`);
  return true;
}

module.exports = { postStoryPuppeteer };
