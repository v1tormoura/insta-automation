'use strict';

const fs   = require('fs');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/stories');

async function generateStoryCard({ username, botLink, botName }) {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const displayLink = (botLink || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\?.*$/, '');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: 1080px; height: 1920px; overflow: hidden;
  background: linear-gradient(160deg, #0d0d1a 0%, #1a0a2e 40%, #0f1a3d 100%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: -apple-system, "Segoe UI", Arial, sans-serif;
  color: #fff;
}
.glow-ring {
  width: 220px; height: 220px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 80px rgba(139,92,246,.6), 0 0 160px rgba(99,102,241,.3);
  margin-bottom: 60px;
  font-size: 100px; line-height: 1;
}
.badge {
  background: rgba(99,102,241,.18);
  border: 2px solid rgba(99,102,241,.5);
  border-radius: 100px;
  padding: 16px 48px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: .1em;
  color: #a5b4fc;
  text-transform: uppercase;
  margin-bottom: 56px;
}
.headline {
  font-size: 88px;
  font-weight: 900;
  line-height: 1.05;
  text-align: center;
  letter-spacing: -.02em;
  margin-bottom: 24px;
  text-shadow: 0 4px 40px rgba(0,0,0,.4);
}
.sub {
  font-size: 40px;
  color: rgba(255,255,255,.65);
  text-align: center;
  margin-bottom: 72px;
  line-height: 1.4;
  max-width: 840px;
}
.link-card {
  background: rgba(255,255,255,.07);
  border: 2px solid rgba(255,255,255,.15);
  border-radius: 28px;
  padding: 36px 60px;
  display: flex; align-items: center; gap: 24px;
  max-width: 900px; width: 900px;
  margin-bottom: 56px;
  backdrop-filter: blur(10px);
}
.link-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; flex-shrink: 0;
}
.link-text {
  font-size: 38px;
  font-weight: 700;
  color: #c4b5fd;
  word-break: break-all;
  letter-spacing: -.01em;
}
.cta {
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
  border-radius: 100px;
  padding: 40px 100px;
  font-size: 46px;
  font-weight: 900;
  letter-spacing: .02em;
  text-transform: uppercase;
  box-shadow: 0 16px 60px rgba(99,102,241,.5);
  margin-bottom: 60px;
}
.account {
  font-size: 34px;
  color: rgba(255,255,255,.4);
  letter-spacing: .04em;
}
</style>
</head>
<body>
  <div class="glow-ring">🤖</div>
  <div class="badge">Bot Gratuito no Telegram</div>
  <div class="headline">Acesse agora<br>sem custo!</div>
  <div class="sub">Conteúdos exclusivos, novidades<br>e muito mais te esperando</div>
  <div class="link-card">
    <div class="link-icon">🔗</div>
    <div class="link-text">${displayLink}</div>
  </div>
  <div class="cta">Entrar no Bot →</div>
  <div class="account">@${username || ''}</div>
</body>
</html>`;

  const filename = `story-${Date.now()}.jpg`;
  const outPath  = path.join(UPLOADS_DIR, filename);

  let puppeteer;
  try { puppeteer = require('puppeteer-extra'); }
  catch { puppeteer = require('puppeteer'); }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1080,1920',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 92 });
  } finally {
    await browser.close();
  }

  return { filename, filePath: outPath };
}

module.exports = { generateStoryCard, UPLOADS_DIR };
