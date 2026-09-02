#!/usr/bin/env bash
#
# Por onde cada conta sai — o que o SISTEMA vai usar, não o que a tela mostra.
#
# ── O que este script responde
#
# "A conta está no proxy global" e "a conta tem proxy próprio" são duas
# afirmações sobre o mesmo registro, e é fácil discordarem: a tela de Proxies
# mostra uma coisa, o log do login mostra outra, e a conversa vira palpite
# contra palpite.
#
# A causa dessa confusão é real e tem nome: quando uma conta reserva um proxy
# do POOL, a URL é gravada em `account.proxy` — vira proxy próprio dali em
# diante. A pessoa lembra "veio do pool", o sistema lê "é dela", e a tela
# mostra sob "Proxies por conta". Todo mundo certo, todo mundo falando de
# coisas diferentes.
#
# ── Por que ele chama a função do produto
#
# `resolverComOrigem` é o funil por onde TODA saída passa — login, publicação,
# sincronização, health check. Um script que reimplementasse a regra poderia
# dizer "global" enquanto o login usa o da conta, que é exatamente o defeito
# que se está tentando enxergar.
#
# Aqui ele chama a mesma função, com `contabilizar: false` para a conferência
# não engordar a métrica de consumo que ela ajuda a interpretar.
#
# ── O que sai
#
#   @conta            origem     host:porta        parâmetros do usuário
#
# Nunca a senha, e nunca o usuário completo do proxy: os dois são credencial.
# Os parâmetros (`;state.x;city.y`) saem porque são o que costuma quebrar, e
# não identificam ninguém sozinhos.
#
#   ./scripts/por-onde-a-conta-sai.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════════════"
echo " POR ONDE CADA CONTA SAI"
echo "════════════════════════════════════════════════════════════════"
echo

docker compose exec -T backend node -e '
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://mongo:27017/instaflow");

  const Account = require("/app/src/models/Account");
  const { resolverComOrigem, getGlobalProxyUrl } = require("/app/src/services/globalProxy");

  const global = await getGlobalProxyUrl().catch(() => "");
  console.log("Proxy global: " + (global ? mascarar(global) : "(nenhum)"));
  console.log("");

  const contas = await Account.find({}, "username proxy proxyStatus").sort({ username: 1 }).lean();
  if (!contas.length) { console.log("Nenhuma conta cadastrada."); return; }

  const larg = Math.max(...contas.map(c => (c.username || "").length)) + 2;
  console.log(
    "CONTA".padEnd(larg) + "ORIGEM".padEnd(10) + "SAÍDA".padEnd(26) + "PARÂMETROS"
  );
  console.log("─".repeat(larg + 10 + 26 + 30));

  let proprios = 0;
  for (const c of contas) {
    /* A MESMA função que o login chama. `contabilizar: false` porque isto é
       conferência, não operação — contar aqui inflaria o consumo do dia. */
    const { url, origem } = await resolverComOrigem(c, { contabilizar: false });
    if (origem === "conta") proprios++;

    console.log(
      ("@" + (c.username || "?")).padEnd(larg) +
      String(origem).padEnd(10) +
      hostPorta(url).padEnd(26) +
      parametros(url)
    );
  }

  console.log("");
  if (proprios) {
    console.log(proprios + " conta(s) com proxy PRÓPRIO — elas NÃO usam o global.");
    console.log("Se a intenção era usarem o global, apague o proxy delas em Contas → Proxy.");
  } else {
    console.log("Nenhuma conta tem proxy próprio: todas saem pelo global.");
  }

  await mongoose.disconnect();
})().catch(e => { console.error("Erro:", e.message); process.exit(1); });

function partes(u) {
  try { return new URL(u); } catch { return null; }
}
function hostPorta(u) {
  const p = partes(u);
  return p ? (p.hostname + ":" + (p.port || "")) : (u ? "(ilegível)" : "— direto —");
}
/* Só os parâmetros do usuário, nunca o identificador nem a senha. É neles que
   mora a diferença que costuma quebrar (`;city.x` que o fornecedor não atende),
   e sozinhos eles não identificam credencial nenhuma. */
function parametros(u) {
  const p = partes(u);
  if (!p || !p.username) return "";
  const usuario = decodeURIComponent(p.username);
  const corpo = usuario.includes("__") ? usuario.split("__")[1] : "";
  return corpo || "(sem parâmetros)";
}
function mascarar(u) {
  return hostPorta(u) + " " + parametros(u);
}
'

echo
echo "════════════════════════════════════════════════════════════════"
echo " Origem 'conta' = proxy gravado no registro da conta (inclusive o"
echo " que veio do pool). Origem 'global' = o proxy da tela de Proxies."
echo "════════════════════════════════════════════════════════════════"
