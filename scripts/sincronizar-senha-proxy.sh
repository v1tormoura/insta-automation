#!/usr/bin/env bash
#
# Alinha a senha dos proxies do pool e das contas com a do proxy global.
#
# ── O problema que isto resolve
#
# O proxy global foi corrigido no painel e passou no teste. As contas
# continuaram falhando com PROXY_ERROR. Não é contradição: elas não usam o
# global.
#
# Quando uma conta reserva um proxy do pool, a URL é COPIADA para o campo
# `proxy` da conta, e a resolução prefere esse campo a tudo mais:
#
#     conta.proxy  ->  pool  ->  global
#
# Então uma senha trocada no fornecedor invalida, de uma vez, todas as cópias
# já espalhadas — e corrigir o global não alcança nenhuma delas. O painel diz
# que está tudo bem porque testa o único que foi consertado.
#
# ── O que este script faz
#
# Troca SÓ a senha, preservando o usuário byte a byte. Isso importa: com esses
# fornecedores o usuário carrega a sessão fixa e a geolocalização
# (`chave__cr.br;state.bahia`), e reescrevê-lo trocaria o IP de saída de cada
# conta — que é exatamente o que faz o Instagram sinalizar.
#
# Por padrão só mostra o que faria. Para alterar de verdade:
#
#   ./scripts/sincronizar-senha-proxy.sh --aplicar
#
set -euo pipefail
cd "$(dirname "$0")/.."

APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

echo "════════════════════════════════════════════════════════"
if [ "$APLICAR" = "1" ]; then
  echo " SINCRONIZAR SENHA DOS PROXIES  (vai alterar o banco)"
else
  echo " SINCRONIZAR SENHA DOS PROXIES  (simulação)"
fi
echo "════════════════════════════════════════════════════════"
echo

docker compose exec -T -e APLICAR="$APLICAR" backend node -e '
const crypto = require("crypto");
const mongoose = require("mongoose");

/* userinfo vai até o ÚLTIMO "@": senha de proxy com "@" dentro é comum, e
   parar no primeiro partiria a URL no lugar errado. */
const PARTES = /^([a-z0-9+.-]+:\/\/)(.*)@([^@]*)$/i;

function separar(url) {
  const m = PARTES.exec(String(url || "").trim());
  if (!m) return null;
  const [, esquema, userinfo, host] = m;
  const i = userinfo.indexOf(":");
  return {
    esquema,
    usuario: i >= 0 ? userinfo.slice(0, i) : userinfo,
    senha:   i >= 0 ? userinfo.slice(i + 1) : "",
    host,
  };
}

/* Reconstrói por concatenação, nunca por `new URL`: a classe re-codifica a
   userinfo e um usuário com ";" viraria "%3B", que o fornecedor não reconhece. */
function comSenha(p, nova) {
  return p.esquema + p.usuario + ":" + nova + "@" + p.host;
}

// Nunca imprimir senha. O prefixo do hash serve só para dizer "esta é igual
// àquela" sem revelar qual é.
const marca = s => s ? crypto.createHash("sha256").update(s).digest("hex").slice(0, 8) : "(vazia)";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Account = require("/app/src/models/Account");
  const ProxyPool = require("/app/src/models/ProxyPool");
  const Setting = require("/app/src/models/Setting");
  const testProxy = require("/app/src/services/testProxy");

  const cfg = await Setting.findOne({ key: "globalProxy" }).lean();
  const globalUrl = cfg && cfg.value && cfg.value.url;
  const ref = globalUrl && separar(globalUrl);

  if (!ref || !ref.senha) {
    console.log("  Não há proxy global com senha cadastrada. Sem referência, não há");
    console.log("  o que sincronizar — cadastre e teste o global primeiro.");
    await mongoose.disconnect();
    return;
  }

  console.log("── Referência: o proxy global ────────────────");
  console.log("  host   : " + ref.host);
  console.log("  senha  : " + marca(ref.senha) + "  (" + ref.senha.length + " caracteres)");
  process.stdout.write("  teste  : ");
  const t = await testProxy(globalUrl);
  console.log(t.ok ? "FUNCIONA (saída " + t.ip + ")" : "FALHOU — " + t.error);
  console.log("");

  if (!t.ok) {
    console.log("  A referência não funciona. Espalhar esta senha só multiplicaria o");
    console.log("  problema. Conserte o global primeiro:");
    console.log("    ./scripts/sondar-credencial-proxy.sh");
    await mongoose.disconnect();
    return;
  }

  const pool = await ProxyPool.find({}).select("_id url contaId").lean();
  const contas = await Account.find({ proxy: { $nin: [null, ""] } }).select("_id username proxy").lean();

  console.log("── Senhas em uso ─────────────────────────────");
  const grupos = new Map();
  const registrar = (url, onde) => {
    const p = separar(url);
    if (!p) return;
    const chave = marca(p.senha);
    if (!grupos.has(chave)) grupos.set(chave, { pool: 0, contas: 0, host: p.host });
    grupos.get(chave)[onde]++;
  };
  pool.forEach(p => registrar(p.url, "pool"));
  contas.forEach(c => registrar(c.proxy, "contas"));

  for (const [chave, g] of grupos) {
    const igual = chave === marca(ref.senha) ? "  <- igual à do global" : "";
    console.log("  " + chave + "   pool: " + String(g.pool).padEnd(4) + "contas: " + String(g.contas).padEnd(4) + igual);
  }
  console.log("");

  const alvoPool = pool.filter(p => { const s = separar(p.url); return s && s.senha !== ref.senha; });
  const alvoContas = contas.filter(c => { const s = separar(c.proxy); return s && s.senha !== ref.senha; });

  if (!alvoPool.length && !alvoContas.length) {
    console.log("  Todas as senhas já batem com a do global. O PROXY_ERROR das contas");
    console.log("  tem outra causa — rode ./scripts/sondar-credencial-proxy.sh.");
    await mongoose.disconnect();
    return;
  }

  console.log("── O que seria alterado ──────────────────────");
  console.log("  entradas do pool : " + alvoPool.length);
  console.log("  contas           : " + alvoContas.length);
  console.log("  o USUÁRIO de cada uma fica intacto — só a senha muda");
  console.log("");

  // Antes de espalhar, prova em UMA. Se a senha nova não servir para o
  // endereço do pool, aplicar em tudo trocaria um erro por outro.
  const amostra = alvoPool[0] || alvoContas[0];
  const urlAmostra = amostra.url || amostra.proxy;
  const corrigida = comSenha(separar(urlAmostra), ref.senha);
  process.stdout.write("  provando numa amostra: ");
  const ta = await testProxy(corrigida);
  console.log(ta.ok ? "FUNCIONA (saída " + ta.ip + ")" : "FALHOU — " + ta.error);
  console.log("");

  if (!ta.ok) {
    console.log("  A senha do global não serve para o endereço do pool. São credenciais");
    console.log("  diferentes, não uma senha desatualizada — sincronizar não resolve.");
    console.log("  Reimporte os proxies do painel do fornecedor.");
    await mongoose.disconnect();
    return;
  }

  if (process.env.APLICAR !== "1") {
    console.log("  Simulação. Para aplicar de verdade:");
    console.log("    ./scripts/sincronizar-senha-proxy.sh --aplicar");
    await mongoose.disconnect();
    return;
  }

  let n = 0;
  for (const p of alvoPool) {
    await ProxyPool.updateOne({ _id: p._id }, { $set: { url: comSenha(separar(p.url), ref.senha), ok: null } });
    n++;
  }
  let m = 0;
  for (const c of alvoContas) {
    await Account.updateOne({ _id: c._id }, { $set: { proxy: comSenha(separar(c.proxy), ref.senha) } });
    m++;
  }

  console.log("  " + n + " entrada(s) do pool e " + m + " conta(s) atualizadas.");
  console.log("  As do pool voltaram a \"não testado\" para o próximo teste reavaliá-las.");

  await mongoose.disconnect();
})().catch(e => { console.log("Falhou: " + e.message); process.exit(1); });
' || {
  echo
  echo "  Não foi possível executar. O backend está de pé?"
  echo "    docker compose ps backend"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
if [ "$APLICAR" = "1" ]; then
  echo "Agora confira se as sessões voltaram:"
  echo "  ./scripts/conferir-sessoes.sh"
fi
