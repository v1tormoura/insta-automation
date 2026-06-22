const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const Account = require('../models/Account');
const { extractInstagramProfileStats } = require('../utils/instagramProfileStats');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function clickLoginIfNeeded(page) {
  const clicked = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('a, button')];

    const loginBtn = elements.find((el) => {
      const txt = (el.innerText || '').trim().toLowerCase();

      return txt === 'log in' || txt === 'login' || txt === 'entrar';
    });

    if (loginBtn) {
      loginBtn.click();
      return true;
    }

    return false;
  });

  if (clicked) {
    console.log('✅ Cliquei em Log In');
    await delay(5000);
  }

  return clicked;
}

async function getUsernameFromPage(page) {
  return await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];

    const ignored = [
      'explore',
      'reels',
      'direct',
      'accounts',
      'p',
      'about',
      'developer',
      'privacy',
      'terms',
      'popular',
    ];

    const candidates = links
      .map((a) => a.getAttribute('href') || '')
      .filter((href) => /^\/[A-Za-z0-9._]+\/$/.test(href))
      .map((href) => href.replaceAll('/', ''))
      .filter((username) => !ignored.includes(username.toLowerCase()));

    return candidates[0] || '';
  });
}

async function connectAccount() {
  const tempProfile = path.resolve(__dirname, '../../sessions/_connect_temp_' + Date.now());

  ensureDir(tempProfile);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    userDataDir: tempProfile,
    args: ['--start-maximized'],
  });

  const page = await browser.newPage();

  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'domcontentloaded',
  });

  await delay(8000);

  if (page.url().includes('/popular')) {
    console.log('⚠️ Caiu na página popular, clicando em Log In...');
    await clickLoginIfNeeded(page);
  }

  console.log('👉 Faça login manualmente...');

  console.log('⏳ Aguardando login completo, código e verificação...');

  await page.waitForFunction(
    () => {
      const body = document.body.innerText || '';
      const url = window.location.href;

      const aindaLogin =
        url.includes('/accounts/login') ||
        body.toLowerCase().includes('confirmation code') ||
        body.toLowerCase().includes('security code') ||
        body.toLowerCase().includes('código') ||
        body.toLowerCase().includes('codigo') ||
        body.toLowerCase().includes('two-factor') ||
        body.toLowerCase().includes('2-factor');

      const logado =
        body.toLowerCase().includes('profile') ||
        body.toLowerCase().includes('perfil') ||
        body.toLowerCase().includes('home') ||
        body.toLowerCase().includes('messages') ||
        body.toLowerCase().includes('reels');

      return !aindaLogin && logado;
    },
    {
      timeout: 600000,
    }
  );

  await delay(7000);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
  });

  await delay(7000);

  console.log('🔍 Obtendo username pelo link Profile...');

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
  });

  await delay(10000);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await delay(10000);

  const username = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];

    const profileLink = links.find((a) => {
      const href = a.getAttribute('href') || '';
      const text = (a.innerText || '').toLowerCase();

      return (
        (text.includes('profile') || text.includes('perfil')) && /^\/[A-Za-z0-9._]+\/$/.test(href)
      );
    });

    if (profileLink) {
      return profileLink.getAttribute('href').replaceAll('/', '');
    }

    const validLinks = links
      .map((a) => a.getAttribute('href') || '')
      .filter((href) => /^\/[A-Za-z0-9._]+\/$/.test(href))
      .map((href) => href.replaceAll('/', ''))
      .filter(
        (u) => !['explore', 'reels', 'direct', 'accounts', 'popular', 'p'].includes(u.toLowerCase())
      );

    return validLinks[0] || '';
  });

  if (!username) {
    throw new Error('Não consegui pegar o username real');
  }

  const userData = {
    username,
    name: username,
  };

  console.log('✅ USERNAME REAL:', userData.username);

  await page.goto(`https://www.instagram.com/${userData.username}/`, {
    waitUntil: 'networkidle2',
  });

  await delay(8000);

  const profile = await page.evaluate(() => {
    const profileImages = [...document.querySelectorAll('header img, img')]
      .map((img) => ({
        src: img.src,
        alt: img.alt || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        clientWidth: img.clientWidth || 0,
        clientHeight: img.clientHeight || 0,
      }))
      .filter(
        (img) =>
          img.src && /profile picture|profile photo|foto do perfil|alterar foto/i.test(img.alt)
      );

    const avatar =
      profileImages.sort(
        (a, b) =>
          b.width * b.height +
          b.clientWidth * b.clientHeight -
          (a.width * a.height + a.clientWidth * a.clientHeight)
      )[0]?.src ||
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('header img')?.src ||
      '';

    const stats = [...document.querySelectorAll('header li')].map((li) => li.innerText);

    const title = document.querySelector('meta[property="og:title"]')?.content || '';

    const description =
      document.querySelector('meta[name="description"]')?.content ||
      document.querySelector('meta[property="og:description"]')?.content ||
      '';

    const bodyText = document.body.innerText || '';

    return {
      avatar,
      title,
      description,
      stats,
      bodyText,
    };
  });

  const { followers, following, postsCount } = extractInstagramProfileStats(profile);

  const sessionsRoot = path.resolve(__dirname, '../../sessions');
  const accountSessionDir = path.join(sessionsRoot, userData.username);

  ensureDir(accountSessionDir);
  ensureDir(path.join(accountSessionDir, 'profile'));

  const cookies = await page.cookies();

  fs.writeFileSync(path.join(accountSessionDir, 'cookies.json'), JSON.stringify(cookies, null, 2));

  const account = await Account.findOneAndUpdate(
    { username: userData.username },
    {
      username: userData.username,
      name: profile.title.split('(')[0].trim() || userData.name,
      avatar: profile.avatar,
      followers,
      following,
      postsCount,
      status: 'ativa',
      lastSync: new Date(),
    },
    {
      upsert: true,
      new: true,
    }
  );

  console.log('✅ CONTA SALVA COM SESSÃO SEPARADA:', account.username);

  await browser.close();

  return account;
}

module.exports = connectAccount;
