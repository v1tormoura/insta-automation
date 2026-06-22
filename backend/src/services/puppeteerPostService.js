'use strict';

/**
 * Posta Reels via Puppeteer headless usando cookies do Multilogin.
 * Sem janela visível — roda 100% em background.
 * Usado quando Graph API e web API direta falham.
 */

const fs   = require('fs');
const path = require('path');
const { convertToReelFormat } = require('./videoProcessor');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const delay = ms => new Promise(r => setTimeout(r, ms));

async function getLaunchOpts() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
  } catch {
    puppeteer = require('puppeteer');
  }
  return puppeteer;
}

async function postReelViaPuppeteer(account, post) {
  const cookiesPath = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
  if (!fs.existsSync(cookiesPath)) {
    throw new Error('cookies.json não encontrado para @' + account.username);
  }

  const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  const rawPath    = path.resolve(__dirname, '../../uploads', post.media);

  console.log('[PuppeteerPost] @' + account.username + ' — convertendo vídeo...');
  const videoPath = await convertToReelFormat(rawPath);
  console.log('[PuppeteerPost] Vídeo pronto: ' + path.basename(videoPath));

  const puppeteer = await getLaunchOpts();
  const browser   = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = (await browser.pages())[0];

    // Injeta cookies
    const puppeteerCookies = rawCookies
      .filter(c => (c.domain || '').includes('instagram.com'))
      .map(c => ({
        name:     c.name  || c.key,
        value:    c.value,
        domain:   c.domain || '.instagram.com',
        path:     c.path   || '/',
        secure:   c.secure   ?? false,
        httpOnly: c.httpOnly ?? false,
        sameSite: 'Lax',
      }));
    await page.setCookie(...puppeteerCookies);
    console.log('[PuppeteerPost] ' + puppeteerCookies.length + ' cookies injetados');

    // Navega para o Instagram
    console.log('[PuppeteerPost] Abrindo instagram.com...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await delay(3000);

    // Verifica se está logado
    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') || currentUrl.includes('login_required')) {
      throw new Error('Sessão expirada — reimporte os cookies do Multilogin (botão 🍪)');
    }
    console.log('[PuppeteerPost] Logado ✓');

    // Clica no botão Criar (+) — tenta vários seletores
    console.log('[PuppeteerPost] Procurando botão Criar...');
    const createClicked = await page.evaluate(() => {
      const selectors = [
        'svg[aria-label="New post"]',
        'svg[aria-label="Nova publicação"]',
        'svg[aria-label="Criar"]',
        'svg[aria-label="Create"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const btn = el.closest('[role="link"], a, button, div[tabindex]');
          if (btn) { btn.click(); return sel; }
        }
      }
      // Fallback: botão por texto
      const items = [...document.querySelectorAll('span, div[role="menuitem"]')];
      const create = items.find(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        return t === 'create' || t === 'criar' || t === 'new post' || t === 'nova publicação';
      });
      if (create) {
        const btn = create.closest('[role="link"], a, button, div[tabindex]');
        if (btn) { btn.click(); return 'text:' + create.textContent.trim(); }
      }
      return null;
    });
    console.log('[PuppeteerPost] Botão criar: ' + (createClicked || 'não encontrado'));
    await delay(3000);

    // Aguarda o input de arquivo aparecer (Instagram abre um seletor de tipo)
    console.log('[PuppeteerPost] Aguardando input de arquivo...');
    let fileInput = null;
    for (let i = 0; i < 20; i++) {
      await delay(1500);
      fileInput = await page.$('input[type=file]');
      if (fileInput) { console.log('[PuppeteerPost] Input encontrado na tentativa ' + (i+1)); break; }

      // Log periódico dos elementos presentes
      if (i % 3 === 0) {
        const els = await page.evaluate(() => ({
          inputs: [...document.querySelectorAll('input')].map(i => i.type).join(','),
          btns: [...document.querySelectorAll('button,[role="button"]')]
            .map(b => b.textContent.trim().slice(0,20)).filter(t=>t).slice(0,5).join(' | '),
        }));
        console.log('[PuppeteerPost] [' + i + '] inputs=' + els.inputs + ' btns=' + els.btns);
      }

      // Na tentativa 4: tenta clicar "Post" no menu de tipo se aparecer
      if (i === 4) {
        await page.evaluate(() => {
          const els = [...document.querySelectorAll('a, [role="link"], [role="button"], span')];
          const post = els.find(el => {
            const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
            return t === 'post' || t === 'publicação' || t === 'publication';
          });
          if (post) { post.click(); }
        });
      }

      // Na tentativa 8: tenta clicar "Reel"
      if (i === 8) {
        await page.evaluate(() => {
          const els = [...document.querySelectorAll('a, [role="link"], [role="button"], span')];
          const reel = els.find(el => {
            const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
            return t === 'reel' || t === 'reels';
          });
          if (reel) { reel.click(); }
        });
      }
    }

    if (!fileInput) {
      // Salva screenshot na pasta do projeto para acesso fácil
      const ss = path.resolve(__dirname, '../../uploads/ig_post_debug_' + account.username + '.png');
      await page.screenshot({ path: ss, fullPage: true });
      console.log('[PuppeteerPost] Screenshot salvo em uploads/: ig_post_debug_' + account.username + '.png');

      // Log do HTML visível para diagnosticar
      const pageInfo = await page.evaluate(() => ({
        url:     location.href,
        title:   document.title,
        buttons: [...document.querySelectorAll('button, [role="button"]')]
          .map(b => b.textContent.trim().slice(0, 30))
          .filter(t => t)
          .slice(0, 10),
        inputs: [...document.querySelectorAll('input')]
          .map(i => i.type + (i.accept ? ' accept=' + i.accept : '')),
        dialogs: [...document.querySelectorAll('[role="dialog"], [aria-modal]')]
          .map(d => d.getAttribute('aria-label') || d.className.slice(0, 50)),
      }));
      console.log('[PuppeteerPost] URL:', pageInfo.url);
      console.log('[PuppeteerPost] Botões:', pageInfo.buttons);
      console.log('[PuppeteerPost] Inputs:', pageInfo.inputs);
      console.log('[PuppeteerPost] Dialogs:', pageInfo.dialogs);

      throw new Error('Input de arquivo não encontrado. Screenshot salvo em uploads/ig_post_debug_' + account.username + '.png');
    }

    // Envia o arquivo de vídeo
    console.log('[PuppeteerPost] Enviando arquivo de vídeo...');
    await fileInput.uploadFile(videoPath);
    await delay(4000);

    // Screenshot logo após upload para ver qual tela apareceu
    const ssUpload = path.resolve(__dirname, '../../uploads/ig_after_upload_' + account.username + '.png');
    await page.screenshot({ path: ssUpload, fullPage: false });
    const afterUploadInfo = await page.evaluate(() => ({
      url: location.href,
      btns: [...document.querySelectorAll('button,[role="button"],[aria-label]')]
        .map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30))
        .filter(t => t).slice(0, 15),
    }));
    console.log('[PuppeteerPost] Após upload — URL: ' + afterUploadInfo.url);
    console.log('[PuppeteerPost] Após upload — Botões/Labels: ' + afterUploadInfo.btns.join(' | '));

    // Pode aparecer um seletor de tipo "Post/Reel/Story" — clica em Reel se aparecer
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, [role="button"], span, div[role="menuitem"]')];
      const reel = els.find(el => {
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'reel' || t === 'reels';
      });
      if (reel) { reel.click(); return true; }
    });
    await delay(2000);

    // Função helper para detectar "Next" em todos os formatos que Instagram usa
    const findNextBtn = () => page.evaluate(() => {
      const terms = ['next', 'próximo', 'proximo', 'avançar', 'avancar', 'continue', 'continuar'];
      const btns = [...document.querySelectorAll('button, [role="button"], div[tabindex="0"]')];
      // Por texto
      let btn = btns.find(b => {
        const t = (b.textContent || '').trim().toLowerCase();
        return terms.some(term => t === term) && !b.disabled && !b.getAttribute('aria-disabled');
      });
      if (btn) return (btn.textContent || '').trim();
      // Por aria-label
      btn = btns.find(b => {
        const t = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        return terms.some(term => t.includes(term)) && !b.disabled;
      });
      if (btn) return btn.getAttribute('aria-label');
      // Por classe/texto parcial (Instagram às vezes usa texto dentro de span)
      const spans = [...document.querySelectorAll('span')];
      const span = spans.find(s => {
        const t = (s.textContent || '').trim().toLowerCase();
        return terms.some(term => t === term);
      });
      if (span) {
        const parent = span.closest('button, [role="button"]');
        if (parent && !parent.disabled) return (parent.textContent || '').trim();
      }
      return null;
    });

    const clickNextBtn = () => page.evaluate(() => {
      const terms = ['next', 'próximo', 'proximo', 'avançar', 'avancar', 'continue', 'continuar'];
      const btns = [...document.querySelectorAll('button, [role="button"]')];
      let btn = btns.find(b => {
        const t = (b.textContent || '').trim().toLowerCase();
        return terms.some(term => t === term) && !b.disabled;
      });
      if (!btn) {
        btn = btns.find(b => {
          const t = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          return terms.some(term => t.includes(term)) && !b.disabled;
        });
      }
      if (!btn) {
        const spans = [...document.querySelectorAll('span')];
        const span = spans.find(s => terms.some(term => (s.textContent || '').trim().toLowerCase() === term));
        if (span) btn = span.closest('button, [role="button"]');
      }
      if (btn && !btn.disabled) { btn.click(); return (btn.textContent || btn.getAttribute('aria-label') || '').trim(); }
      return null;
    });

    // Aguarda o vídeo processar — procura "Next" até aparecer
    console.log('[PuppeteerPost] Aguardando processamento do vídeo...');
    let videoReady = false;
    for (let i = 0; i < 40; i++) {
      await delay(3000);
      const nextLabel = await findNextBtn();
      if (nextLabel) {
        videoReady = true;
        console.log('[PuppeteerPost] Vídeo processado ✓ (botão: "' + nextLabel + '")');
        break;
      }
      // Log periódico
      if (i % 4 === 0) {
        const info = await page.evaluate(() => ({
          btns: [...document.querySelectorAll('button,[role="button"]')]
            .map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 25))
            .filter(t => t).slice(0, 8),
        }));
        console.log('[PuppeteerPost] Processando... (' + (i + 1) * 3 + 's) btns=' + info.btns.join(' | '));
      }
    }

    if (!videoReady) {
      const ss2 = path.resolve(__dirname, '../../uploads/ig_timeout_' + account.username + '.png');
      await page.screenshot({ path: ss2 });
      console.log('[PuppeteerPost] Screenshot timeout: uploads/ig_timeout_' + account.username + '.png');
      throw new Error('Timeout aguardando processamento do vídeo no Instagram');
    }

    // Clica em Próximo até chegar na tela de caption (máx 4 cliques)
    for (let step = 0; step < 4; step++) {
      const clicked = await clickNextBtn();
      if (!clicked) break;
      console.log('[PuppeteerPost] Clicado: "' + clicked + '"');
      await delay(2500);

      const onCaptionScreen = await page.evaluate(() => {
        const hasCaption = !!document.querySelector('textarea, div[contenteditable]');
        const hasShare   = [...document.querySelectorAll('button,[role="button"]')].some(b => {
          const t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return t === 'share' || t === 'compartilhar' || t === 'publicar';
        });
        return hasCaption || hasShare;
      });
      if (onCaptionScreen) break;
    }

    // Preenche a legenda
    if (post.caption) {
      console.log('[PuppeteerPost] Inserindo legenda...');
      // Tenta vários seletores de campo de texto
      const captionInserted = await page.evaluate((caption) => {
        const selectors = [
          'textarea[aria-label]',
          'div[contenteditable][aria-label]',
          'textarea',
          'div[contenteditable="true"]',
          '[placeholder]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            el.focus();
            el.click();
            document.execCommand('selectAll', false);
            document.execCommand('insertText', false, caption);
            return sel;
          }
        }
        return null;
      }, post.caption);
      console.log('[PuppeteerPost] Caption inserida via: ' + (captionInserted || 'não inserida'));

      if (!captionInserted) {
        const captionEl = await page.$('textarea, div[contenteditable="true"]');
        if (captionEl) await captionEl.type(post.caption, { delay: 10 });
      }
      await delay(1000);
    }

    // Clica em Share/Publicar
    console.log('[PuppeteerPost] Publicando...');
    const shareClicked = await page.evaluate(() => {
      const shareTerms = ['share', 'compartilhar', 'publicar', 'post', 'publish'];
      const btns = [...document.querySelectorAll('button, [role="button"]')];
      const share = btns.find(b => {
        const t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return shareTerms.some(term => t === term) && !b.disabled;
      });
      if (share) { share.click(); return (share.textContent || share.getAttribute('aria-label') || '').trim(); }
      return null;
    });

    if (!shareClicked) {
      const ss = path.join(require('os').tmpdir(), 'ig_share_debug_' + account.username + '.png');
      await page.screenshot({ path: ss, fullPage: true });
      console.log('[PuppeteerPost] Screenshot: ' + ss);
      throw new Error('Botão de publicar não encontrado. Verifique a screenshot.');
    }

    console.log('[PuppeteerPost] Botão publicar clicado: "' + shareClicked + '"');

    // Aguarda confirmação de publicação
    console.log('[PuppeteerPost] Aguardando confirmação...');
    let published = false;
    for (let i = 0; i < 20; i++) {
      await delay(3000);
      published = await page.evaluate(() => {
        const body = document.body.textContent.toLowerCase();
        return body.includes('reel shared') || body.includes('reel compartilhado')
            || body.includes('your reel') || body.includes('seu reel')
            || body.includes('publicado') || body.includes('published')
            || body.includes('post shared') || body.includes('publicação compartilhada');
      });
      if (published) break;

      // Verifica se voltou para o feed (sucesso silencioso)
      const url = page.url();
      if (url === 'https://www.instagram.com/' || url.includes('/reels/')) {
        published = true;
        break;
      }
      console.log('[PuppeteerPost] Aguardando publicação... (' + (i + 1) * 3 + 's)');
    }

    if (!published) {
      const ss = path.join(require('os').tmpdir(), 'ig_confirm_debug_' + account.username + '.png');
      await page.screenshot({ path: ss, fullPage: true });
      console.log('[PuppeteerPost] Screenshot final: ' + ss);
      throw new Error('Não foi possível confirmar a publicação. Verifique a screenshot.');
    }

    console.log('[PuppeteerPost] ✅ REEL PUBLICADO para @' + account.username);
    return 'puppeteer_post_ok'; // ID simbólico (não temos media_id via UI)

  } finally {
    await browser.close();
  }
}

module.exports = { postReelViaPuppeteer };
