#!/usr/bin/env bash
#
# Descobre POR QUE o proxy responde 407, testando a credencial por partes.
#
# ── O problema que isto resolve
#
# 407 quer dizer "credencial recusada" e nada mais. Ele é a mesma resposta para
# senha errada, usuário inexistente, assinatura vencida, saldo zerado e opção de
# geolocalização inválida. Cinco causas, cinco soluções diferentes, um único
# número na tela.
#
# Fornecedores modernos põem opções DENTRO do nome de usuário:
#
#     59c3e4...07e__cr.br;state.bahia
#     └─ a chave ─┘  └── as opções ──┘
#
# E aqui está a armadilha: se UMA opção estiver malformada — um estado que não
# existe naquele fornecedor, um separador diferente do esperado — ele recusa a
# credencial INTEIRA. O 407 então acusa a senha, que está perfeita.
#
# Este script separa as duas coisas: testa a chave sozinha, a chave com o país,
# e a credencial completa. Onde parar de funcionar é onde está o defeito.
#
# Nada é colado no terminal e a senha nunca é impressa.
#
#   ./scripts/sondar-credencial-proxy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo " POR QUE O PROXY RECUSA"
echo "════════════════════════════════════════════════════════"
echo

# Global primeiro: é o que a tela de Contas usa quando a conta não tem o seu.
PROXY=$(docker compose exec -T mongo mongosh insta-automation --quiet --eval '
  const g = db.settings.findOne({ key: "globalProxy" });
  if (g && g.value && g.value.url) { print(g.value.url); }
  else {
    const p = db.proxypool.findOne({}, { url: 1 });
    print(p && p.url ? p.url : "");
  }
' 2>/dev/null | tr -d '\r' | tail -1)

if [ -z "$PROXY" ]; then
  echo "Nenhum proxy configurado. Cadastre o global ou importe no pool."
  exit 1
fi

docker compose exec -T -e PROXY="$PROXY" backend node -e '
const http = require("http");

const bruto = process.env.PROXY.trim();
const url = /^[a-z0-9+.-]+:\/\//i.test(bruto) ? bruto : "http://" + bruto;
let u;
try { u = new URL(url); } catch (e) { console.log("URL de proxy inválida."); process.exit(1); }

// `new URL` percent-codifica a userinfo: um usuário com ";" vira "%3B" e o
// proxy não reconheceria. Aqui trabalhamos sempre com a forma decodificada.
const usuario = decodeURIComponent(u.username);
const senha   = decodeURIComponent(u.password);

const corte = usuario.indexOf("__");
const chave = corte >= 0 ? usuario.slice(0, corte) : usuario;
const opcoes = corte >= 0 ? usuario.slice(corte + 2) : "";

console.log("── O que está guardado ───────────────────────");
console.log("  servidor : " + u.hostname + ":" + u.port);
console.log("  chave    : " + chave.slice(0, 6) + "…" + chave.slice(-4) + "  (" + chave.length + " caracteres)");
console.log("  opções   : " + (opcoes || "(nenhuma)"));
console.log("  senha    : " + (senha ? senha.length + " caracteres" : "AUSENTE"));
console.log("");

if (!senha) {
  console.log("A senha está vazia. O 407 é consequência disso — não há o que sondar.");
  process.exit(0);
}

function tentar(nomeDeUsuario) {
  return new Promise(resolve => {
    const cred = Buffer.from(nomeDeUsuario + ":" + senha).toString("base64");
    const req = http.request({
      host: u.hostname, port: u.port, method: "GET",
      path: "http://api.ipify.org?format=json",
      headers: { Host: "api.ipify.org", "Proxy-Authorization": "Basic " + cred },
      timeout: 12000,
    }, res => {
      let corpo = "";
      res.on("data", c => corpo += c);
      res.on("end", () => resolve({
        codigo: res.statusCode,
        corpo: String(corpo).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
      }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ codigo: 0, corpo: "sem resposta em 12s" }); });
    req.on("error", e => resolve({ codigo: 0, corpo: e.message.slice(0, 80) }));
    req.end();
  });
}

// As partes vão da mais simples para a mais completa. A primeira que falhar
// aponta o pedaço defeituoso.
const partes = opcoes.split(";").filter(Boolean);
const candidatos = [["só a chave, sem opções", chave]];
for (let i = 1; i <= partes.length; i++) {
  candidatos.push(["chave + " + partes.slice(0, i).join(";"), chave + "__" + partes.slice(0, i).join(";")]);
}
if (!opcoes) candidatos.length = 1;

(async () => {
  console.log("── Testando por partes ───────────────────────");
  const res = [];
  for (const [rotulo, nome] of candidatos) {
    const r = await tentar(nome);
    const marca = r.codigo === 200 ? "FUNCIONA"
                : r.codigo === 407 ? "recusada (407)"
                : r.codigo ? "HTTP " + r.codigo : "sem resposta";
    console.log("  " + rotulo.padEnd(34) + marca + (r.corpo && r.codigo !== 200 ? "  \"" + r.corpo + "\"" : ""));
    res.push({ rotulo, nome, ...r });
  }

  console.log("");
  console.log("── Conclusão ─────────────────────────────────");
  const base = res[0];
  const completo = res[res.length - 1];

  if (completo.codigo === 200) {
    console.log("  A credencial completa funciona. Se a tela ainda acusa erro, o");
    console.log("  problema não é a credencial — é o destino HTTPS ou o serviço Python.");
  } else if (base.codigo === 200) {
    const ultimoBom = res.filter(r => r.codigo === 200).pop();
    const primeiroRuim = res.find(r => r.codigo !== 200);
    console.log("  A chave e a senha estão CORRETAS — funcionam sozinhas.");
    console.log("  O que o fornecedor recusa é a opção: " + primeiroRuim.rotulo.replace("chave + ", ""));
    console.log("");
    console.log("  Último formato que funcionou: " + ultimoBom.rotulo);
    console.log("  Corrija ou remova essa opção no proxy cadastrado.");
  } else if (base.codigo === 407) {
    console.log("  A chave sozinha já é recusada, então não é a opção de geolocalização.");
    console.log("  Sobra: senha trocada no fornecedor, assinatura vencida ou saldo zerado.");
    if (base.corpo) console.log("  O fornecedor disse: \"" + base.corpo + "\"");
    console.log("  Confira no painel do fornecedor e atualize aqui.");
  } else {
    console.log("  O proxy não respondeu. Servidor ou porta errados, ou o fornecedor fora.");
    if (base.corpo) console.log("  Detalhe: " + base.corpo);
  }
})();
' 2>/dev/null || {
  echo "  Não foi possível sondar. O contêiner do backend está de pé?"
  echo "    docker compose ps backend"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
