'use strict';

const Setting = require('../models/Setting');
const { normalizeProxy } = require('./testProxy');

const KEY = 'globalProxy';

/**
 * Proxy global do SaaS — aplicado a TODA a automação (login, publicação,
 * sync, warmup) para qualquer conta que não tenha proxy próprio.
 *
 * Persistido no MongoDB para sobreviver a restart e ser visível ao worker,
 * que roda em outro container. `process.env.GLOBAL_PROXY` continua sendo
 * aceito como fallback (definido no docker-compose), mas a configuração
 * feita pelo painel tem prioridade.
 *
 * Formato do documento:
 *   { url, ativo, ip, ok, error, lastCheck }
 */

const EMPTY = { url: '', ativo: false, ip: '', ok: false, error: '', lastCheck: null };

// Cache curto — evita uma query por publicação sem atrasar a propagação
// de uma mudança feita no painel.
let _cache   = null;
let _cacheAt = 0;
const CACHE_TTL = 5_000; // ms

function _fromEnv() {
  const envUrl = normalizeProxy(process.env.GLOBAL_PROXY || '');
  if (!envUrl) return { ...EMPTY };
  return { ...EMPTY, url: envUrl, ativo: true };
}

/** Configuração completa do proxy global (com status do último teste). */
async function getGlobalProxyConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;

  // Sem conexão ativa o Mongoose ENFILEIRA a query em vez de falhar, e só
  // desiste após bufferTimeoutMS (10s por padrão). Como esta função está no
  // caminho de todo login e publicação, isso significaria travar cada operação
  // por 10s durante uma instabilidade do Mongo. Aqui a ausência de conexão é
  // tratada como "sem configuração": cai no cache ou na variável de ambiente.
  const mongoose = require('mongoose');
  if (mongoose.connection?.readyState !== 1) {
    return _cache || _fromEnv();
  }

  let doc = null;
  try {
    doc = await Setting.findOne({ key: KEY }).lean();
  } catch (err) {
    console.error('[globalProxy] falha ao ler config:', err.message);
    return _cache || _fromEnv();
  }

  _cache   = doc?.value ? { ...EMPTY, ...doc.value } : _fromEnv();
  _cacheAt = Date.now();
  return _cache;
}

/**
 * URL do proxy global se — e somente se — estiver ativo.
 * É esta função que a automação consome.
 * @returns {Promise<string>} URL do proxy, ou '' quando não há proxy ativo.
 */
async function getGlobalProxyUrl() {
  const cfg = await getGlobalProxyConfig();
  return cfg.ativo && cfg.url ? cfg.url : '';
}

/** Grava a configuração (merge com a atual) e invalida o cache. */
async function saveGlobalProxyConfig(patch) {
  const current = await getGlobalProxyConfig();
  const value   = { ...current, ...patch };

  await Setting.findOneAndUpdate(
    { key: KEY },
    { key: KEY, value },
    { upsert: true, returnDocument: 'after' }
  );

  _cache   = value;
  _cacheAt = Date.now();
  return value;
}

/**
 * Proxy efetivo de uma conta: o proxy próprio da conta tem prioridade;
 * sem ele, cai no proxy global (se ativo); sem nenhum, string vazia.
 */
/**
 * Proxy desta conta, em ordem de precedência.
 *
 *   1. o que já está gravado na conta
 *   2. um reservado do pool, se houver pool
 *   3. o proxy global
 *
 * A reserva do pool acontece aqui, e não no fluxo de conexão, porque este é o
 * único ponto por onde TODO login e TODA publicação passam. Reservar no
 * cadastro deixaria de fora as contas que já existem, e reservar em cada
 * chamador seriam quinze lugares para esquecer um.
 *
 * A conta reservada tem o proxy GRAVADO nela na mesma operação. Sem isso a
 * reserva viveria só no pool, e uma conta cujo proxy fosse removido do pool
 * cairia no global sem aviso — voltando a dividir IP com todas as outras.
 */
async function resolveProxyFor(account) {
  return (await resolverComOrigem(account)).url;
}

/* Contabiliza a saída. Registrado AQUI, no funil, e não em cada consumidor:
   publicação, sincronização, login e health check passam todos por
   `resolverComOrigem`, e espalhar a chamada seria quatro chances de esquecer
   uma — com o sintoma de a projeção de consumo ficar otimista sem ninguém
   entender por quê.

   Sem `await` de propósito: contabilidade não pode atrasar publicação. */
function _contabilizar(origem, ligado = true) {
  /* A conferência de ambiente resolve o proxy só para TESTÁ-LO. Contar ali
     inflaria a métrica que ela mesma ajuda a interpretar: abrir o modal de
     conectar várias vezes engordaria o consumo do dia sem nenhuma operação
     ter saído. */
  if (!ligado || origem === 'nenhum') return;
  try {
    require('./consumoDeProxy').registrar(origem).catch(() => {});
  } catch { /* módulo indisponível não derruba a resolução */ }
}

/**
 * O mesmo que `resolveProxyFor`, mas dizendo DE ONDE o proxy veio.
 *
 * A origem importa no diagnóstico e não dá para deduzi-la depois: o serviço
 * Python recebe só a URL, e o log dele dizia "conta" para qualquer proxy que
 * chegasse — inclusive o global. Quem lesse concluiria que a conta tinha
 * proxy próprio quando não tinha, e procuraria o problema no lugar errado.
 *
 * @returns {{url: string, origem: 'conta'|'pool'|'global'|'nenhum'}}
 */
async function resolverComOrigem(account, { contabilizar = true } = {}) {
  const id = account?._id;
  const molde = await moldeConfigurado();

  /* Aplica o molde de sessão por conta ao resultado.

     O molde é o que faz o Axtron (e afins) darem um IP próprio por conta.
     Aplicado AQUI, no funil, e não em cada consumidor: login, publicação,
     sync e warmup passam todos por este ponto, então isolar por conta vira
     uma linha só. O token é derivado do id da conta — estável entre
     restarts, para a conta não saltar de IP. Quando não há molde
     configurado (nem no banco nem no env), devolve a URL crua, como antes,
     e o Python assume (retrocompatível). */
  const aplicar = (url) => (id && molde ? moldarSessao(url, molde, tokenDaConta(id)) : url);

  const own = String(account?.proxy || '').trim();
  if (own) { _contabilizar('conta', contabilizar); return { url: aplicar(normalizeProxy(own)), origem: 'conta' }; }

  if (id) {
    try {
      const { reservar } = require('./proxyPool');
      const doPool = await reservar(id);
      if (doPool) {
        // Grava na conta a URL CRUA (sem molde) — o molde é por requisição,
        // não parte da credencial guardada.
        const Account = require('../models/Account');
        await Account.updateOne({ _id: id }, { $set: { proxy: doPool } });
        _contabilizar('pool', contabilizar);
        return { url: aplicar(normalizeProxy(doPool)), origem: 'pool' };
      }
    } catch (err) {
      // Pool indisponível não pode impedir a publicação de uma conta que já
      // funciona: cai no global, que é o comportamento anterior.
      console.warn('[proxyPool] reserva falhou, usando o proxy global —', err.message);
    }
  }

  const global = await getGlobalProxyUrl();
  const origem = global ? 'global' : 'nenhum';
  _contabilizar(origem, contabilizar);
  return { url: aplicar(global), origem };
}

/**
 * O molde de sessão configurado (env), ou '' se não houver.
 *
 * O `.env` é carregado no container do backend também, então o Node vê o
 * mesmo `PROXY_SESSAO_MOLDE` que o serviço Python usa para isolar por conta.
 * Serve para o painel MEDIR e MOSTRAR o IP que as contas de fato usam, em vez
 * do gateway cru — que era o `38.211.x` de datacenter assustando à toa.
 */
function moldeDeSessao() {
  return (process.env.PROXY_SESSAO_MOLDE || '').trim();
}

/**
 * O molde efetivo: o configurado no painel (banco) tem prioridade; sem ele,
 * o do `.env`. É o que permite trocar de fornecedor pela tela, sem editar
 * arquivo nem recriar container.
 */
async function moldeConfigurado() {
  try {
    const cfg = await getGlobalProxyConfig();
    const doBanco = (cfg?.sessionMolde || '').trim();
    if (doBanco) return doBanco;
  } catch { /* sem banco: cai no env */ }
  return moldeDeSessao();
}

/** Token de sessão estável por conta — espelha `sessao_da_conta` do Python. */
function tokenDaConta(accountId) {
  return require('crypto')
    .createHash('sha256')
    .update(`proxy-sessao:${accountId}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Aplica um identificador de sessão à URL, do mesmo jeito que o Python
 * (`moldar_proxy_por_conta`): o sufixo entra no NOME DE USUÁRIO, antes da
 * senha. Usado só para amostrar o IP isolado no teste do painel — o molde de
 * produção continua sendo aplicado no Python, uma fonte só.
 */
function moldarSessao(url, molde, sessao) {
  if (!url || !molde || !molde.includes('{sessao}')) return url;
  const m = /^([a-z0-9+.-]+):\/\/(.+)$/i.exec(url);
  if (!m) return url;
  const [, esquema, resto] = m;
  const at = resto.lastIndexOf('@');
  if (at < 0) return url;                     // sem credencial, nada a moldar
  const cred = resto.slice(0, at);
  const destino = resto.slice(at + 1);
  const doisPontos = cred.indexOf(':');
  if (doisPontos < 0) return url;
  const usuario = cred.slice(0, doisPontos);
  const senha = cred.slice(doisPontos + 1);
  const sufixo = molde.replace('{sessao}', sessao);
  if (usuario.includes(sufixo)) return url;   // idempotente
  return `${esquema}://${usuario}${sufixo}:${senha}@${destino}`;
}

module.exports = {
  getGlobalProxyConfig,
  getGlobalProxyUrl,
  saveGlobalProxyConfig,
  resolveProxyFor,
  resolverComOrigem,
  moldeDeSessao,
  moldeConfigurado,
  tokenDaConta,
  moldarSessao,
};
