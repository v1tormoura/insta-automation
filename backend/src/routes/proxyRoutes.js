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

    // Segunda medição: o login do Instagram são 4 requisições em sequência
    // (launcher/sync → accounts/login/ → two_factor_login → login_flow). Se o
    // proxy troca de IP entre elas, o Instagram vê a sessão nascendo espalhada
    // e recusa o login mesmo com credencial correta. Medir duas vezes revela
    // isso de forma objetiva, em vez de deixar como suspeita.
    let rotating = false;
    let ipSegundo = '';
    if (result.ok) {
      const segundo = await testProxy(url);
      ipSegundo = segundo.ip || '';
      rotating = !!(segundo.ok && ipSegundo && ipSegundo !== result.ip);
    }

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
      ip2:       ipSegundo,
      rotating,
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

/* ── Distribuição em massa ──────────────────────────────────────────────────
 *
 * O proxy global resolve "sair da VPS", mas não resolve "cada conta num IP" —
 * com ele, todas as contas passam a compartilhar o IP do proxy, que é o mesmo
 * problema de novo. Estas rotas atribuem UM proxy por conta.
 */

const {
  distribuirProxies, listarAtribuicoes,
} = require('../services/proxyAssignment');

/**
 * GET /proxy/atribuicoes — quem sai por onde.
 * Aponta explicitamente as contas ainda sem proxy e os IPs compartilhados.
 */
router.get('/atribuicoes', async (req, res) => {
  try {
    res.json(await listarAtribuicoes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /proxy/distribuir — cola a lista, testa e atribui uma por conta.
 * Body: { texto, accountIds?, substituir?, permitirRotativo? }
 *
 * Cada proxy é testado antes: atribuir um proxy morto troca "conta saindo pelo
 * IP errado" por "conta que não publica". O relatório devolve o que sobrou e o
 * que foi reprovado, em vez de dizer só quantos entraram.
 */
router.post('/distribuir', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Cole a lista de proxies.' });

    const relatorio = await distribuirProxies({
      texto,
      accountIds:       Array.isArray(req.body?.accountIds) ? req.body.accountIds : null,
      substituir:       !!req.body?.substituir,
      permitirRotativo: !!req.body?.permitirRotativo,
    });

    if (relatorio.erro && !relatorio.atribuidos) {
      return res.status(422).json(relatorio);
    }
    res.json({ ok: true, ...relatorio });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pool de proxies ──────────────────────────────────────────────────────────
//
// O proxy global é UM só: todas as contas saem pelo mesmo IP. O pool resolve
// isso reservando um proxy por conta no instante da conexão, sem ninguém ter
// de lembrar de atribuir.

router.get('/pool', async (req, res) => {
  try {
    const { listar, resumo, recuperarOrfaos } = require('../services/proxyPool');

    /* Recupera reservas órfãs ANTES de contar.

       Sem isto, a tela se contradizia: o resumo somava como "em uso" um proxy
       cuja conta não existe mais, enquanto a tabela o mostrava como "livre" —
       porque o `populate` de uma referência morta devolve null. Três reservas
       fantasma num banco sem conta nenhuma foi como o defeito apareceu.

       Aqui é barato e idempotente: abrir a página conserta o estado. */
    await recuperarOrfaos().catch(() => { /* pool indisponível não derruba a tela */ });

    const [itens, contagem] = await Promise.all([listar(), resumo()]);
    res.json({
      resumo: contagem,
      // Só host e porta: usuário e senha do proxy são credenciais e não
      // precisam trafegar para a tela.
      itens: itens.map(i => ({
        url: i.url,
        endereco: String(i.url).replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/^.*@/, ''),
        conta: i.contaId?.username || null,
        ip: i.ip || '',
        ok: i.ok,
        rotativo: !!i.rotativo,
        erro: i.erro || '',
        ultimoTeste: i.ultimoTeste,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível ler o pool', detalhe: err.message });
  }
});

router.post('/pool/importar', async (req, res) => {
  const texto = String(req.body?.texto || req.body?.lista || '');
  if (!texto.trim()) {
    return res.status(400).json({ error: 'Cole a lista de proxies.' });
  }
  try {
    const { importar, resumo } = require('../services/proxyPool');
    const r = await importar(texto);
    res.json({ ...r, resumo: await resumo() });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível importar', detalhe: err.message });
  }
});

router.post('/pool/testar', async (req, res) => {
  try {
    const { testarTodos, resumo } = require('../services/proxyPool');
    const r = await testarTodos();
    res.json({ ...r, resumo: await resumo() });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível testar', detalhe: err.message });
  }
});

router.delete('/pool', async (req, res) => {
  const url = String(req.body?.url || req.query?.url || '');
  if (!url) return res.status(400).json({ error: 'Informe a url do proxy.' });
  try {
    const { remover, resumo } = require('../services/proxyPool');
    const removido = await remover(url);
    res.json({ removido, resumo: await resumo() });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível remover', detalhe: err.message });
  }
});

module.exports = router;
