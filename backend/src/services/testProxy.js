const puppeteer = require('puppeteer-extra');

async function testProxy(proxy) {
  if (!proxy) {
    return {
      ok: false,
      ip: '',
      error: 'Proxy vazio',
    };
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      defaultViewport: {
        width: 1200,
        height: 800,
      },
      args: ['--no-sandbox', '--disable-setuid-sandbox', `--proxy-server=${proxy}`],
    });

    const page = await browser.newPage();

    await page.goto('https://api.ipify.org?format=json', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    const body = await page.evaluate(() => document.body.innerText);

    await browser.close();

    const data = JSON.parse(body);

    return {
      ok: true,
      ip: data.ip || '',
      error: '',
    };
  } catch (err) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    return {
      ok: false,
      ip: '',
      error: err.message,
    };
  }
}

module.exports = testProxy;
