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
      ativo:      cfg.ativo,
      proxy_url:  cfg.url,
      ip:         cfg.ip,
      ok:         cfg.ok,
      error:      cfg.error,
      lastCheck:  cfg.lastCheck,
      isolamento: cfg.isolamento || null,   // persistido no último teste
      molde:      cfg.sessionMolde || (process.env.PROXY_SESSAO_MOLDE || '').trim() || '',
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

    /* O IP que as CONTAS realmente usam — não o gateway cru.
     *
     * Sem molde, o proxy sai pelo gateway (no Axtron, um IP de datacenter), e
     * era esse que o painel mostrava como "IP em uso" — assustando à toa,
     * porque conta nenhuma sai por ali. Com molde, cada conta manda um
     * `__sessid.<hash>` próprio e recebe um IP residencial/móvel só dela.
     *
     * Aqui medimos DUAS sessões de amostra: se derem IPs diferentes, o
     * isolamento por conta está funcionando, e é esse IP (o de amostra) que
     * representa o que as contas usam. */
    const { moldeConfigurado, moldarSessao } = require('../services/globalProxy');
    const molde = await moldeConfigurado();
    let isolamento = null;
    if (result.ok && molde && url.includes('@')) {
      try {
        const urlA = moldarSessao(url, molde, 'amostra0a1b2c3d');
        const urlB = moldarSessao(url, molde, 'amostra9z8y7x6w');
        const [a, b] = await Promise.all([testProxy(urlA), testProxy(urlB)]);
        isolamento = {
          ativo: !!(a.ok && b.ok && a.ip && b.ip && a.ip !== b.ip),
          ipAmostra: a.ip || '',
          ipAmostra2: b.ip || '',
          molde,
        };
      } catch { /* medição de amostra falhou — segue sem ela */ }
    }

    if (cfg.ativo && normalizeProxy(cfg.url) === url) {
      await saveGlobalProxyConfig({
        ip:        result.ip,
        ok:        result.ok,
        error:     result.error,
        lastCheck: new Date(),
        /* Guarda o estado do isolamento para o card renderizar mesmo sem
           reteste — e para o vigia poder alertar se ele cair. */
        isolamento: isolamento || undefined,
      });
    }

    if (!result.ok) {
      return res.status(502).json({ ok: false, error: result.error, proxy_url: url });
    }
    res.json({
      ok:        true,
      ip:        result.ip,          // o gateway cru
      ip2:       ipSegundo,
      rotating,
      isolamento,                    // o que as contas usam, por conta
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
/**
 * POST /proxy/sondar-credencial  { proxy_url, comparar_com? }
 *
 * Qual variante desta credencial o fornecedor aceita?
 *
 * ── Por que existe
 *
 * `407 NO_USER` quer dizer "não reconheço este usuário" e mais nada. Quando um
 * proxy do mesmo fornecedor funciona e outro não, com três diferenças ao mesmo
 * tempo — usuário, porta e parâmetros de geografia — o erro não diz qual delas
 * é a culpada, e testar à mão é uma combinatória.
 *
 * O serviço Python mede: tira um parâmetro por vez, prova nas portas
 * candidatas, e devolve a primeira que atravessa — uma URL pronta, e a lista
 * do que ela deixou pelo caminho.
 *
 * `comparar_com` alimenta a hipótese mais comum: a porta. Passando o proxy que
 * FUNCIONA, a porta dele entra como candidata.
 */
router.post('/sondar-credencial', async (req, res) => {
  try {
    const url = normalizeProxy(req.body?.proxy_url || '');
    if (!url) return res.status(400).json({ error: 'proxy_url é obrigatório' });

    /* A porta do proxy que funciona entra como candidata. Sem ela, a sondagem
       só varia geografia — e a porta é a diferença que mais aparece quando um
       proxy do mesmo fornecedor funciona e outro não. */
    const portas = [];
    const referencia = req.body?.comparar_com
      || (await getGlobalProxyConfig().catch(() => null))?.url;
    if (referencia) {
      const p = String(referencia).match(/:(\d+)\s*$/);
      if (p) portas.push(p[1]);
    }

    const base = (process.env.INSTAGRAPI_SERVICE_URL || 'http://instagrapi-svc:8000').replace(/\/$/, '');
    const r = await fetch(`${base}/session/sondar-credencial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: url, portas }),
      signal: AbortSignal.timeout(120_000),
    });
    const dados = await r.json();
    res.status(r.ok ? 200 : 502).json(dados);
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'SONDAGEM_ERRO' });
  }
});

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

/* ── Consumo ────────────────────────────────────────────────────────────────
   A cota acabou sem aviso porque ninguém a media. Estas duas rotas dão o
   número e a projeção — e pedem a você a única parte que o sistema não tem
   como saber: quanto o painel do fornecedor marca. */

router.get('/consumo', async (_req, res) => {
  try {
    const consumo = require('../services/consumoDeProxy');
    const [projecao, historico, plano] = await Promise.all([
      consumo.projetar(),
      consumo.serie(14),
      consumo.lerPlano(),
    ]);
    res.json({
      projecao,
      plano: { totalGb: plano?.totalGb || 0, renovaEm: plano?.renovaEm || '' },
      historico: historico.map(d => ({
        dia: d.dia, operacoes: d.operacoes || 0, porOrigem: d.porOrigem || {},
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'CONSUMO_ERRO' });
  }
});

router.put('/plano', async (req, res) => {
  try {
    const { totalGb, usadoGb, renovaEm } = req.body || {};
    const num = v => (v === undefined || v === null || v === '' ? undefined : Number(v));

    const t = num(totalGb), u = num(usadoGb);
    if (t !== undefined && (!Number.isFinite(t) || t <= 0)) {
      return res.status(400).json({ error: 'O total do plano precisa ser um número maior que zero.', code: 'TOTAL_INVALIDO' });
    }
    if (u !== undefined && (!Number.isFinite(u) || u < 0)) {
      return res.status(400).json({ error: 'O consumo precisa ser um número.', code: 'USADO_INVALIDO' });
    }

    const consumo = require('../services/consumoDeProxy');
    await consumo.gravarPlano({ totalGb: t, usadoGb: u, renovaEm });
    res.json({ ok: true, projecao: await consumo.projetar() });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'PLANO_ERRO' });
  }
});

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

/* ── Molde de sessão: detectar e configurar pela tela ──────────────────────
 *
 * O "formato de sessão" é o sufixo que faz o fornecedor dar um IP por conta
 * (no Axtron, `__sessid.{sessao}`). Antes vivia só no `.env` e exigia SSH +
 * recriar container. Agora é configurável no painel: o botão "Detectar" mede
 * qual formato o fornecedor aceita, e o valor fica no banco — o Node passa a
 * aplicá-lo por conta na hora, sem reiniciar nada. */

// Os mesmos candidatos da sonda do Python, `__` primeiro (formato do Axtron).
const MOLDES_CANDIDATOS = [
  '__sessid.{sessao}', '__session.{sessao}', '__sess.{sessao}', '__sid.{sessao}',
  '-session-{sessao}', '_session-{sessao}', ';session.{sessao}', '-sessid-{sessao}',
  ';sid.{sessao}', ';sticky.{sessao}',
];

/**
 * POST /proxy/detectar-molde — descobre o formato de sessão do proxy atual.
 *
 * Para cada candidato, mede DUAS sessões: se derem IPs diferentes (as duas
 * válidas), o formato isola por conta. O primeiro que isolar vence, é salvo no
 * banco e passa a valer na hora.
 */
router.post('/detectar-molde', async (req, res) => {
  try {
    const cfg = await getGlobalProxyConfig();
    const url = normalizeProxy(req.body?.proxy_url || cfg.url);
    if (!url)  return res.status(400).json({ error: 'Configure o proxy global primeiro.' });
    if (!url.includes('@')) return res.status(400).json({ error: 'O proxy precisa de usuário e senha para ter sessão por conta.' });

    const { moldarSessao } = require('../services/globalProxy');
    const testados = [];
    let vencedor = null;

    for (const molde of MOLDES_CANDIDATOS) {
      const uA = moldarSessao(url, molde, 'detecta0a1b2c3d');
      const uB = moldarSessao(url, molde, 'detecta9z8y7x6w');
      let a, b;
      try {
        [a, b] = await Promise.all([testProxy(uA), testProxy(uB)]);
      } catch { testados.push({ molde, isola: false, erro: 'falha' }); continue; }
      const isola = !!(a.ok && b.ok && a.ip && b.ip && a.ip !== b.ip);
      testados.push({ molde, isola, ips: [a.ip || '—', b.ip || '—'] });
      if (isola) { vencedor = { molde, ipAmostra: a.ip, ipAmostra2: b.ip }; break; }
    }

    if (vencedor) {
      await saveGlobalProxyConfig({ sessionMolde: vencedor.molde });
      return res.json({
        ok: true, detectado: true, molde: vencedor.molde,
        ipAmostra: vencedor.ipAmostra, ipAmostra2: vencedor.ipAmostra2,
        mensagem: `Formato de sessão "${vencedor.molde}" isola por conta. Salvo — cada conta já sai por um IP próprio.`,
        testados,
      });
    }

    return res.json({
      ok: true, detectado: false, molde: '',
      mensagem: 'Nenhum formato conhecido isolou por conta neste proxy. Ele provavelmente dá um IP só — peça sessão/zona por conta ao fornecedor, ou use o pool com uma credencial por conta.',
      testados,
    });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível detectar', detalhe: err.message });
  }
});

/**
 * PUT /proxy/molde — grava (ou limpa) o formato de sessão à mão.
 * Body: { molde }  — vazio limpa. Precisa conter `{sessao}` quando não vazio.
 */
router.put('/molde', async (req, res) => {
  const molde = String(req.body?.molde || '').trim();
  if (molde && !molde.includes('{sessao}')) {
    return res.status(400).json({ error: 'O formato precisa conter {sessao} onde entra o identificador da conta.' });
  }
  try {
    await saveGlobalProxyConfig({ sessionMolde: molde });
    res.json({ ok: true, molde });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível salvar', detalhe: err.message });
  }
});

module.exports = router;
