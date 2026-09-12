'use strict';

/**
 * Auditoria de isolamento por conta — o "Teste de 100 contas".
 *
 * Responde, com os dados reais do banco, à única pergunta que decide o
 * diagnóstico: cada conta sai por um IP próprio, ou várias dividem o mesmo?
 *
 * Lê o que o sistema JÁ mede e grava em cada conta:
 *   loginIp      — de qual IP o Instagram viu o último login (medido pelo
 *                  serviço Python no ato, não deduzido da config)
 *   publishIp    — de qual IP saiu a última publicação
 *   proxy        — o proxy resolvido para a conta (próprio, do pool, ou vazio
 *                  = caiu no global)
 *   device       — derivado do _id da conta pelo MESMO hash do serviço Python,
 *                  para provar que dois device_ids nunca coincidem
 *
 * Não altera nada. Não fala com o Instagram. Só lê o Mongo e cruza.
 *
 * Uso, no VPS a partir de /root/insta-automation:
 *   node backend/scripts/auditar-isolamento.js
 *   node backend/scripts/auditar-isolamento.js --json > auditoria.json
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://mongo:27017/instaflow';
const COMO_JSON = process.argv.includes('--json');

/* O MESMO device_id que o serviço Python deriva (session_pool._device_uuids):
   "android-" + sha256("<account_id>:android_device_id")[:16]. Reproduzido aqui
   para a auditoria provar unicidade sem depender do Python — se dois baterem,
   o bug é no hash, não no proxy. */
function deviceIdDe(accountId) {
  const h = crypto.createHash('sha256').update(`${accountId}:android_device_id`).digest('hex');
  return 'android-' + h.slice(0, 16);
}

/** host:porta de uma URL de proxy — o que identifica o IP, sem expor credencial. */
function fornecedorDe(url) {
  if (!url) return '(sem proxy — IP do servidor)';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`);
    return `${u.hostname}:${u.port || 80}`;
  } catch { return '(url inválida)'; }
}

async function main() {
  await mongoose.connect(MONGO_URI);
  const Account = require('../src/models/Account');

  const contas = await Account.find({})
    .select('username _id provider loginIp loginIpVia loginIpEm publishIp publishIpEm proxy healthStatus status')
    .sort({ createdAt: 1 })
    .lean();

  const linhas = contas.map(c => ({
    account_id: String(c._id),
    username:   c.username || '(sem @)',
    provider:   c.provider || 'official',
    saude:      c.status === 'banida' ? 'BANIDA' : (c.healthStatus || 'ativa'),
    device_id:  deviceIdDe(String(c._id)),
    proxy:      fornecedorDe(c.proxy),
    ip_login:   c.loginIp || '—',
    ip_via:     c.loginIpVia || '—',
    ip_post:    c.publishIp || '—',
  }));

  /* ── As três colisões que importam ──────────────────────────────────────── */

  // 1. IPs de login repetidos entre contas (o problema nº 1 da auditoria).
  const porIpLogin = new Map();
  for (const l of linhas) {
    if (!l.ip_login || l.ip_login === '—') continue;
    if (!porIpLogin.has(l.ip_login)) porIpLogin.set(l.ip_login, []);
    porIpLogin.get(l.ip_login).push(l.username);
  }
  const colisoesIp = [...porIpLogin.entries()].filter(([, us]) => us.length > 1);

  // 2. Login e publicação de IPs diferentes NA MESMA conta (sessão sticky
  //    expirou entre um e outro — o Instagram lê como sequestro).
  const derivaLoginPost = linhas.filter(
    l => l.ip_login !== '—' && l.ip_post !== '—' && l.ip_login !== l.ip_post);

  // 3. device_id repetido — nunca deve acontecer; se acontecer, é bug de hash.
  const porDevice = new Map();
  for (const l of linhas) {
    if (!porDevice.has(l.device_id)) porDevice.set(l.device_id, []);
    porDevice.get(l.device_id).push(l.username);
  }
  const colisoesDevice = [...porDevice.entries()].filter(([, us]) => us.length > 1);

  const resumo = {
    total: linhas.length,
    comIpMedido: linhas.filter(l => l.ip_login !== '—').length,
    ipsDistintos: porIpLogin.size,
    colisoesDeIp: colisoesIp.length,
    contasComLoginPostDivergente: derivaLoginPost.length,
    colisoesDeDevice: colisoesDevice.length,
  };

  if (COMO_JSON) {
    console.log(JSON.stringify({ resumo, linhas, colisoesIp, derivaLoginPost, colisoesDevice }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const p = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log('\n═══ AUDITORIA DE ISOLAMENTO POR CONTA ═══\n');
  console.log(p('CONTA', 20), p('SAÚDE', 16), p('PROXY (host:porta)', 26), p('IP LOGIN', 16), p('VIA', 8), p('IP POST', 16));
  console.log('─'.repeat(102));
  for (const l of linhas) {
    console.log(p('@' + l.username, 20), p(l.saude, 16), p(l.proxy, 26), p(l.ip_login, 16), p(l.ip_via, 8), p(l.ip_post, 16));
  }

  console.log('\n═══ RESUMO ═══');
  console.log(`Contas: ${resumo.total}  ·  com IP medido: ${resumo.comIpMedido}  ·  IPs distintos: ${resumo.ipsDistintos}`);

  console.log('\n═══ COLISÕES ═══');
  if (colisoesIp.length) {
    console.log(`\n⚠ ${colisoesIp.length} IP(s) de login COMPARTILHADO(s) entre contas — este é o problema nº 1:`);
    for (const [ip, us] of colisoesIp) console.log(`   ${ip}  →  ${us.length} contas: ${us.map(u => '@' + u).join(', ')}`);
  } else if (resumo.comIpMedido > 1) {
    console.log('\n✓ Nenhum IP de login compartilhado — cada conta sai por um IP próprio.');
  } else {
    console.log('\n… Poucas contas com IP medido ainda. Conecte mais e rode de novo.');
  }

  if (derivaLoginPost.length) {
    console.log(`\n⚠ ${derivaLoginPost.length} conta(s) com login e publicação de IPs DIFERENTES (sticky expirou):`);
    for (const l of derivaLoginPost) console.log(`   @${l.username}:  login ${l.ip_login}  ≠  post ${l.ip_post}`);
  }

  if (colisoesDevice.length) {
    console.log(`\n✗ ${colisoesDevice.length} device_id REPETIDO — isto é bug de código, avise:`);
    for (const [dev, us] of colisoesDevice) console.log(`   ${dev}  →  ${us.map(u => '@' + u).join(', ')}`);
  } else {
    console.log('\n✓ Nenhum device_id repetido — aparelho único por conta, como deve ser.');
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('Falha na auditoria:', err.message);
  try { await mongoose.disconnect(); } catch { /* ok */ }
  process.exit(1);
});
