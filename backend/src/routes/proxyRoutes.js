const router = require('express').Router();

const testProxy = require('../services/testProxy');
const { getDirectIp, normalizeProxy } = require('../services/testProxy');
const {
  getGlobalProxyConfig,
  saveGlobalProxyConfig,
} = require('../services/globalProxy');

/**
 * Rotas do proxy global — protegidas por JWT (montadas com `auth` no app.js).
 *
 * O proxy global vale para toda a automação: qualquer conta sem proxy próprio
 * passa a sair por ele em login, publicação e sincronização.
 */

/** GET /proxy/status — estado atual + resultado do último teste. */
router.get('/status', async (req, res) => {
  try {
    const cfg = await getGlobalProxyConfig();
    res.json({
      ativo:     cfg.ativo,
      proxy_url: cfg.url,
      ip:        cfg.ip,
      ok:        cfg.ok,
      error:     cfg.error,
      lastCheck: cfg.lastCheck,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /proxy/ip-direto — IP de saída do servidor sem proxy (para comparação). */
router.get('/ip-direto', async (req, res) => {
  try {
    const ip = await getDirectIp();
    res.json({ ip, ok: !!ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /proxy/test — testa uma URL de proxy sem ativá-la.
 * Body: { proxy_url } — se omitido, testa o proxy global já salvo.
 * Quando o proxy testado é o que está ativo, o resultado é persistido para
 * que o card mostre o mesmo status em qualquer navegador.
 */
router.post('/test', async (req, res) => {
  try {
    const cfg = await getGlobalProxyConfig();
    const url = normalizeProxy(req.body?.proxy_url || cfg.url);

    if (!url) return res.status(400).json({ error: 'proxy_url é obrigatório' });

    const result = await testProxy(url);

    if (cfg.ativo && normalizeProxy(cfg.url) === url) {
      await saveGlobalProxyConfig({
        ip:        result.ip,
        ok:        result.ok,
        error:     result.error,
        lastCheck: new Date(),
      });
    }

    if (!result.ok) {
      return res.status(502).json({ ok: false, error: result.error, proxy_url: url });
    }
    res.json({
      ok:        true,
      ip:        result.ip,
      latencyMs: result.latencyMs,
      proxy_url: url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /proxy/configure — ativa ou desativa o proxy global.
 * Body: { proxy_url } para ativar | { action: 'desativar' } para desligar.
 *
 * A ativação só é gravada se o proxy passar no teste — evita deixar toda a
 * automação apontando para um proxy morto.
 */
router.post('/configure', async (req, res) => {
  try {
    if (req.body?.action === 'desativar') {
      const value = await saveGlobalProxyConfig({
        url: '', ativo: false, ip: '', ok: false, error: '', lastCheck: new Date(),
      });
      return res.json({ ok: true, ativo: false, message: 'Proxy global desativado', config: value });
    }

    const url = normalizeProxy(req.body?.proxy_url);
    if (!url) return res.status(400).json({ error: 'proxy_url é obrigatório' });

    const result = await testProxy(url);
    if (!result.ok) {
      return res.status(502).json({
        ok:    false,
        error: `Proxy não passou no teste: ${result.error}`,
      });
    }

    const value = await saveGlobalProxyConfig({
      url,
      ativo:     true,
      ip:        result.ip,
      ok:        true,
      error:     '',
      lastCheck: new Date(),
    });

    res.json({
      ok:      true,
      ativo:   true,
      ip:      result.ip,
      message: 'Proxy global ativado para toda a automação',
      config:  value,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
