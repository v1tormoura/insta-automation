'use strict';

/**
 * Distribuição de proxies entre as contas.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * Todas as contas saindo pelo mesmo IP é um dos sinais mais óbvios de automação
 * que o Instagram tem — e, na prática, o que faz login de várias contas falhar
 * com `bad_password` mesmo com a senha correta. A correção é uma conta por
 * proxy; o que faltava era um jeito de aplicar isso sem editar conta a conta.
 *
 * ── Regras que não são negociáveis ──────────────────────────────────────────
 *
 * 1. UM proxy por conta, nunca compartilhado. Repetir o mesmo proxy em duas
 *    contas recria exatamente o problema que se está tentando resolver, só que
 *    com um IP diferente do da VPS. Se faltar proxy, sobra conta sem — e isso é
 *    dito com todas as letras em vez de dividir o que existe.
 *
 * 2. Proxy morto NÃO é atribuído. Gravar um proxy que não responde troca "conta
 *    saindo pelo IP errado" por "conta que não publica" — pior.
 *
 * 3. Proxy que troca de IP entre requisições é recusado. O login do Instagram
 *    são 4 requisições em sequência; se o IP muda no meio, ele vê a sessão
 *    nascendo espalhada e recusa mesmo com credencial correta. `testProxy` já
 *    mede duas vezes justamente para detectar isso.
 */

const Account = require('../models/Account');
const testProxy = require('../services/testProxy');
const { normalizeProxy } = require('../services/testProxy');

/** Quantos proxies testar ao mesmo tempo. */
const CONCORRENCIA = 6;

/**
 * Interpreta uma lista colada pelo usuário.
 *
 * Os provedores entregam em formatos bem diferentes, e o mais comum
 * (`host:porta:usuario:senha`) não é URL nenhuma — colado cru, viraria
 * `http://host:porta:usuario:senha` e falharia sem explicação. Aqui cada linha
 * é reconhecida e convertida para URL:
 *
 *   host:porta
 *   host:porta:usuario:senha
 *   usuario:senha@host:porta
 *   http://usuario:senha@host:porta
 *   socks5://host:porta
 *
 * @returns {{urls: string[], invalidas: string[]}}
 */
function parseLista(texto) {
  const linhas = String(texto || '')
    // Separa por quebra de linha e por vírgula — NUNCA por ponto-e-vírgula.
    //
    // O ponto-e-vírgula é caractere legítimo dentro do nome de usuário de
    // proxy, e vários fornecedores o usam para passar parâmetros de
    // geolocalização. Um usuário como
    //
    //     cliente__cr.br;state.saopaulo;city.adamantina
    //
    // era quebrado em três "linhas" inválidas, e a lista inteira do
    // fornecedor era recusada sem que a mensagem dissesse por quê. A vírgula
    // fica porque não aparece em URL de proxy e é como algumas listas vêm.
    .split(/[\r\n,]+/)
    .map(l => l.trim())
    .filter(Boolean);

  const urls = [];
  const invalidas = [];
  const vistos = new Set();

  for (const linha of linhas) {
    const url = _linhaParaUrl(linha);
    if (!url) { invalidas.push(linha); continue; }
    // Duplicata na lista é erro de digitação do provedor, não intenção — e
    // atribuir o mesmo proxy a duas contas é justamente o que não pode.
    if (vistos.has(url)) continue;
    vistos.add(url);
    urls.push(url);
  }

  return { urls, invalidas };
}

/**
 * Escapa apenas o que realmente quebraria a URL.
 *
 * `encodeURIComponent` é agressivo demais aqui: ele codifica caracteres que a
 * RFC 3986 permite em `userinfo`, entre eles o ponto-e-vírgula. Vários
 * fornecedores de proxy usam `;` para passar geolocalização no nome de
 * usuário —
 *
 *     cliente__cr.br;state.saopaulo;city.adamantina
 *
 * — e transformá-lo em `%3B` faz o fornecedor deixar de reconhecer o
 * parâmetro. O proxy conecta, e o IP sai de outro lugar: falha silenciosa,
 * do pior tipo.
 *
 * Escapamos então só o que é estrutural na URL: a arroba (separa credencial
 * de host), as barras, `?` e `#` (encerram a autoridade), colchetes
 * (delimitam IPv6) e espaços. Os dois-pontos entram só no nome de usuário,
 * onde separam usuário de senha — na senha eles são inofensivos.
 */
function _escaparUserinfo(valor, ehUsuario = false) {
  const perigosos = ehUsuario ? /[@/\?#\[\]\s:]/g : /[@/\?#\[\]\s]/g;
  return String(valor).replace(perigosos, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

function _linhaParaUrl(linha) {
  const bruta = linha.trim();
  if (!bruta) return '';

  // Já tem esquema (http://, socks5://…): só normaliza.
  if (/^[a-z0-9+.-]+:\/\//i.test(bruta)) {
    return _valida(bruta) ? bruta : '';
  }

  const partes = bruta.split(':');

  // host:porta:usuario:senha — o formato que a maioria dos provedores entrega.
  //
  // Este teste vem ANTES do caminho com '@' de propósito: senha de proxy com
  // arroba é comum, e `se@nha` faria a linha inteira ser lida como
  // "usuario:senha@host:porta", produzindo uma URL sem sentido. O segundo campo
  // ser só dígitos (a porta) é o que identifica o formato com segurança.
  // A senha pode conter ':', então o resto é rejuntado em vez de descartado.
  if (partes.length >= 4 && /^\d+$/.test(partes[1])) {
    const [host, porta, usuario, ...restoSenha] = partes;
    const senha = restoSenha.join(':');
    const url = `http://${_escaparUserinfo(usuario, true)}:${_escaparUserinfo(senha)}@${host}:${porta}`;
    return _valida(url) ? url : '';
  }

  // usuario:senha@host:porta
  if (bruta.includes('@')) {
    const url = `http://${bruta}`;
    return _valida(url) ? url : '';
  }

  // host:porta
  if (partes.length === 2) {
    const url = `http://${bruta}`;
    return _valida(url) ? url : '';
  }

  return '';
}

function _valida(url) {
  try {
    const u = new URL(url);
    if (!u.hostname) return false;

    // Porta é obrigatória: proxy sem porta explícita quase sempre é linha
    // truncada, e cairia na porta padrão do esquema sem ninguém perceber.
    //
    // A checagem é feita no TEXTO, não em `u.port`: a API de URL devolve porta
    // vazia quando ela é a padrão do esquema, então `http://1.2.3.4:80` — porta
    // perfeitamente comum em proxy — seria recusado como se não tivesse porta.
    const autoridade = url.slice(url.indexOf('://') + 3).split('/')[0];
    const hostPorta = autoridade.includes('@')
      ? autoridade.slice(autoridade.lastIndexOf('@') + 1)
      : autoridade;

    return /:\d+$/.test(hostPorta);
  } catch {
    return false;
  }
}

/** Testa vários proxies em paralelo, com teto de concorrência. */
async function testarLote(urls, concorrencia = CONCORRENCIA) {
  const resultados = [];

  for (let i = 0; i < urls.length; i += concorrencia) {
    const fatia = urls.slice(i, i + concorrencia);
    const lote = await Promise.all(fatia.map(async (url) => {
      const primeiro = await testProxy(url);
      if (!primeiro.ok) {
        return { url, ok: false, ip: '', erro: primeiro.error, rotativo: false };
      }
      // Segunda medição: revela proxy rotativo, que quebra o login.
      const segundo = await testProxy(url);
      const rotativo = !!(segundo.ok && segundo.ip && segundo.ip !== primeiro.ip);
      return {
        url,
        ok: true,
        ip: primeiro.ip,
        latencyMs: primeiro.latencyMs,
        rotativo,
        erro: '',
      };
    }));
    resultados.push(...lote);
  }

  return resultados;
}

/**
 * Distribui a lista entre as contas, uma por conta.
 *
 * @param {Object}  opcoes
 * @param {string}  opcoes.texto        lista colada pelo usuário
 * @param {string[]} [opcoes.accountIds] limita a estas contas; padrão = todas
 * @param {boolean} [opcoes.substituir]  também troca o proxy de quem já tem
 * @param {boolean} [opcoes.permitirRotativo] aceita proxy que troca de IP
 * @returns {Promise<Object>} relatório completo, sem esconder o que sobrou
 */
async function distribuirProxies({
  texto,
  accountIds = null,
  substituir = false,
  permitirRotativo = false,
} = {}) {
  const { urls, invalidas } = parseLista(texto);
  if (!urls.length) {
    return {
      atribuidos: 0,
      contasSemProxy: 0,
      invalidas,
      erro: 'Nenhum proxy válido na lista.',
      detalhes: [],
    };
  }

  const filtro = accountIds?.length ? { _id: { $in: accountIds } } : {};
  const contas = await Account.find(filtro).select('_id username proxy').lean();

  // Quem já tem proxy fica de fora, a menos que o usuário peça a troca.
  const alvo = substituir ? contas : contas.filter(c => !String(c.proxy || '').trim());

  const testes = await testarLote(urls);
  const usaveis = testes.filter(t => t.ok && (permitirRotativo || !t.rotativo));

  // Proxy já usado por outra conta não entra na fila: dois donos para o mesmo
  // IP é o problema original de volta.
  const jaEmUso = new Set(
    contas.map(c => normalizeProxy(c.proxy || '')).filter(Boolean)
  );
  const fila = usaveis.filter(t => substituir || !jaEmUso.has(t.url));

  const detalhes = [];
  let atribuidos = 0;

  for (let i = 0; i < alvo.length; i++) {
    const conta = alvo[i];
    const proxy = fila[i];
    if (!proxy) {
      detalhes.push({ username: conta.username, status: 'sem_proxy_disponivel' });
      continue;
    }

    await Account.updateOne(
      { _id: conta._id },
      {
        $set: {
          proxy:          proxy.url,
          proxyStatus:    'ok',
          proxyIp:        proxy.ip,
          proxyLastCheck: new Date(),
        },
      },
    );
    atribuidos++;
    detalhes.push({ username: conta.username, status: 'atribuido', ip: proxy.ip });
  }

  const reprovados = testes.filter(t => !t.ok)
    .map(t => ({ url: _mascarar(t.url), erro: t.erro }));
  const rotativos = testes.filter(t => t.ok && t.rotativo)
    .map(t => ({ url: _mascarar(t.url), ip: t.ip }));

  return {
    atribuidos,
    contasAvaliadas:  alvo.length,
    contasSemProxy:   detalhes.filter(d => d.status === 'sem_proxy_disponivel').length,
    proxiesNaLista:   urls.length,
    proxiesUsaveis:   usaveis.length,
    proxiesSobrando:  Math.max(0, fila.length - atribuidos),
    reprovados,
    rotativos,
    invalidas,
    detalhes,
  };
}

/**
 * Esconde a senha ao devolver a URL para a tela ou para o log.
 *
 * Sem senha, a string original é devolvida intacta: `new URL().toString()`
 * normaliza a porta padrão para fora e acrescenta barra no fim, de modo que
 * `http://1.2.3.4:80` viraria `http://1.2.3.4/` — some justamente a porta, que
 * é o que a pessoa precisa conferir na tela.
 */
function _mascarar(url) {
  const bruta = String(url || '');
  if (!bruta.includes('@')) return bruta;
  try {
    const u = new URL(bruta);
    if (!u.password) return bruta;
    return bruta.replace(`:${u.password}@`, ':***@');
  } catch {
    return bruta;
  }
}

/** Panorama de quem sai por onde — inclusive quem ainda sai pelo IP da VPS. */
async function listarAtribuicoes() {
  const contas = await Account.find({})
    .select('_id username proxy proxyStatus proxyIp proxyLastCheck healthStatus')
    .lean();

  const porIp = new Map();
  for (const c of contas) {
    const ip = c.proxyIp || '(direto)';
    porIp.set(ip, (porIp.get(ip) || 0) + 1);
  }

  return {
    contas: contas.map(c => ({
      id:        String(c._id),
      username:  c.username,
      proxy:     c.proxy ? _mascarar(c.proxy) : '',
      proxyIp:   c.proxyIp || '',
      status:    c.proxyStatus || 'nao_testado',
      ultimoTeste: c.proxyLastCheck,
      healthStatus: c.healthStatus,
    })),
    semProxy: contas.filter(c => !String(c.proxy || '').trim()).length,
    // Mais de uma conta no mesmo IP é o alerta que importa nesta tela.
    ipsCompartilhados: [...porIp.entries()]
      .filter(([, n]) => n > 1)
      .map(([ip, n]) => ({ ip, contas: n })),
  };
}

module.exports = {
  distribuirProxies,
  listarAtribuicoes,
  parseLista,
  testarLote,
  _mascarar,
};
