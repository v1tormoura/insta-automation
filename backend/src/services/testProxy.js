const https = require('https');
const http  = require('http');

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
const IP_ENDPOINT_HTTP = 'http://api.ipify.org?format=json';
const TEST_TIMEOUT = 15_000; // ms

/**
 * Lê a explicação que o próprio proxy dá ao recusar.
 *
 * Por HTTPS o tráfego vai num túnel CONNECT, e a recusa chega como um código
 * seco — foi por isso que a tela mostrava só "HTTP 407" durante horas de
 * tentativa e erro. Por HTTP simples o proxy responde com CORPO, e fornecedores
 * põem ali o motivo: usuário inexistente, senha errada, saldo zerado, opção de
 * geolocalização inválida. São quatro problemas diferentes com quatro soluções
 * diferentes, e o 407 sozinho não separa nenhum deles.
 *
 * Só roda quando o teste principal já falhou, então não custa nada no caminho
 * feliz.
 */
function _motivoDaRecusa(proxyUrl) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(proxyUrl); } catch { return resolve(''); }

    const cabecalhos = { Host: 'api.ipify.org' };
    if (u.username || u.password) {
      // decodeURIComponent porque `new URL` percent-codifica a userinfo: um
      // usuário com ';' — comum em proxy com opção de geolocalização — vira
      // '%3B' e o proxy não reconheceria.
      const cred = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
      cabecalhos['Proxy-Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`;
    }

    const req = http.request({
      host: u.hostname, port: u.port, method: 'GET',
      path: IP_ENDPOINT_HTTP, headers: cabecalhos, timeout: 8000,
    }, res => {
      let corpo = '';
      res.on('data', c => { corpo += c; });
      res.on('end', () => resolve(String(corpo).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)));
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.end();
  });
}

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

  const bruto = await new Promise(resolve => {
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
          return done({ ok: false, ip: '', status: res.statusCode, error: '' });
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

    req.on('error', err => done({ ok: false, ip: '', status: _codigoNoErro(err), error: err.message }));
  });

  if (bruto.ok) return bruto;

  /* Falhou. Antes de responder, pergunta ao proxy POR QUÊ — a resposta dele é
     a única fonte que separa senha errada de saldo zerado de opção de
     geolocalização inválida. "HTTP 407" sozinho manda a pessoa trocar a senha
     quando o problema pode ser outro. */
  const motivo = await _motivoDaRecusa(url);
  const codigo = bruto.status || 0;

  let texto;
  if (codigo === 407) {
    texto = 'O proxy recusou a credencial (407)';
  } else if (codigo) {
    texto = `Proxy respondeu HTTP ${codigo}`;
  } else {
    texto = bruto.error || 'Falha desconhecida';
  }
  if (motivo) texto += ` — o proxy respondeu: "${motivo}"`;

  return { ...bruto, error: texto };
}

/* O 407 do túnel CONNECT chega dentro da mensagem de erro, não como resposta. */
function _codigoNoErro(err) {
  const m = /statusCode=(\d{3})|(4\d\d|5\d\d)/.exec(String(err?.message || ''));
  return m ? Number(m[1] || m[2]) : 0;
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
