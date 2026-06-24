const { HttpsProxyAgent } = require('https-proxy-agent');

async function testProxy(proxy) {
  if (!proxy) return { ok: false, ip: '', error: 'Proxy vazio' };

  try {
    const agent = new HttpsProxyAgent(proxy);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('https://api.ipify.org?format=json', {
      agent,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    return { ok: true, ip: data.ip || '', error: '' };
  } catch (err) {
    return { ok: false, ip: '', error: err.message };
  }
}

module.exports = testProxy;
