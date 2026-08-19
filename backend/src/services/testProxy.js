const https = require('https');

/**
 * Carrega HttpsProxyAgent sob demanda.
 *
 * O pacote é ESM e, exigido no topo do módulo, quebra qualquer suíte Jest que
 * importe este arquivo indiretamente — hoje a cadeia é
 * ProviderFactory → InstagrapiHttpClient → globalProxy → testProxy.
 * O require preguiçoso mantém o comportamento idêntico em produção (o agente é
 * criado exatamente quando um proxy vai ser usado) sem arrastar o pacote para o
 * carregamento de quem só precisa de normalizeProxy.
 */
function _carregarProxyAgent() {
  return require('https-proxy-agent').HttpsProxyAgent;
}

const IP_ENDPOINT  = 'https://api.ipify.org?format=json';
const TEST_TIMEOUT = 15_000; // ms

/**
 * Normaliza a URL do proxy — aceita "host:porta" e "user:pass@host:porta"
 * sem esquema, prefixando http:// (formato aceito pelo HttpsProxyAgent).
 */
function normalizeProxy(proxy) {
  const raw = String(proxy || '').trim();
  if (!raw) return '';
  return /^[a-z0-9+.-]+:\/\//i.test(raw) ? raw : `http://${raw}`;
}

/**
 * Testa um proxy fazendo uma requisição real através dele e devolvendo o IP
 * de saída visto pela internet.
 *
 * IMPORTANTE: usa o módulo https nativo, NÃO o fetch global. O fetch do Node 18+
 * (undici) ignora silenciosamente a opção `agent` — a requisição sairia sem
 * proxy e devolveria o IP do próprio servidor como se o proxy funcionasse.
 *
 * @param {string} proxy — ex.: http://user:pass@host:porta
 * @returns {Promise<{ok: boolean, ip: string, error: string, latencyMs: number}>}
 */
async function testProxy(proxy) {
  const url = normalizeProxy(proxy);
  if (!url) return { ok: false, ip: '', error: 'Proxy vazio', latencyMs: 0 };

  let agent;
  try {
    const HttpsProxyAgent = _carregarProxyAgent();
    agent = new HttpsProxyAgent(url);
  } catch (err) {
    return { ok: false, ip: '', error: `URL de proxy inválida: ${err.message}`, latencyMs: 0 };
  }

  const started = Date.now();

  return new Promise(resolve => {
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      resolve({ ...result, latencyMs: Date.now() - started });
    };

    const req = https.get(IP_ENDPOINT, { agent, timeout: TEST_TIMEOUT }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return done({ ok: false, ip: '', error: `Proxy respondeu HTTP ${res.statusCode}` });
        }
        try {
          const ip = JSON.parse(body).ip || '';
          if (!ip) return done({ ok: false, ip: '', error: 'Resposta sem IP' });
          done({ ok: true, ip, error: '' });
        } catch {
          done({ ok: false, ip: '', error: 'Resposta inválida do serviço de IP' });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, ip: '', error: `Timeout de ${TEST_TIMEOUT / 1000}s — proxy não respondeu` });
    });

    req.on('error', err => done({ ok: false, ip: '', error: err.message }));
  });
}

/** IP de saída do servidor SEM proxy — usado para comparar com o IP do proxy. */
async function getDirectIp() {
  return new Promise(resolve => {
    const req = https.get(IP_ENDPOINT, { timeout: 8000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).ip || ''); } catch { resolve(''); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

module.exports = testProxy;
module.exports.testProxy      = testProxy;
module.exports.getDirectIp    = getDirectIp;
module.exports.normalizeProxy = normalizeProxy;
