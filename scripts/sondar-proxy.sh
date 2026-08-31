#!/usr/bin/env bash
#
# Descobre, por medição, qual parâmetro o fornecedor de proxy aceita para fixar
# o IP — e se o IP se mantém durante uma sequência do tamanho de um login.
#
# ── A pergunta que isto responde
#
# Proxy rotacionando no meio do login e conta sinalizada pelo Instagram
# produzem EXATAMENTE o mesmo erro na tela: `bad_password`. Olhar a tela não
# separa os dois, e depurar a hipótese errada custa horas — trocar senha,
# recriar conta, testar outro método de login, tudo sem efeito, porque a causa
# era o IP mudando.
#
# Um login não é uma requisição: são cerca de seis em sequência. Se o endereço
# muda no meio, o Instagram vê a sessão nascendo espalhada e recusa mesmo com a
# senha certa.
#
# Este script mede. Não tenta nenhum login, não lê senha de conta, e o proxy
# nunca é impresso.
#
#   ./scripts/sondar-proxy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo " SONDAGEM DE PROXY"
echo "════════════════════════════════════════════════════════"
echo
echo "Lendo o proxy do banco — nada para colar, e a credencial não passa pelo"
echo "histórico do shell."
echo

# Três origens, nesta ordem: proxy de uma conta, o POOL, e o global.
# O pool entrou depois: um diagnóstico de produção mostrou proxies
# importados vivendo só lá, e o script dizia "nenhum proxy encontrado"
# com a lista cheia na tela.
PROXY=$(docker compose exec -T mongo mongosh insta-automation --quiet --eval '
  const c = db.accounts.findOne({ proxy: { $nin: [null, ""] } }, { proxy: 1 });
  if (c && c.proxy) { print(c.proxy); }
  else {
    const p = db.proxypool.findOne({ ok: { $ne: false } }, { url: 1 });
    if (p && p.url) { print(p.url); }
    else {
      const g = db.settings.findOne({ key: "globalProxy" });
      print(g && g.value ? (g.value.url || "") : "");
    }
  }
' 2>/dev/null | tr -d '\r' | tail -1)

if [ -z "$PROXY" ]; then
  echo "Nenhum proxy encontrado — nem por conta, nem no pool, nem global."
  echo "Importe proxies em Proxies, ou atribua um a uma conta, e rode de novo."
  exit 1
fi

echo "Sondando. São duas medições por candidato, então leva um minuto."
echo

docker compose exec -T -e PROXY="$PROXY" instagrapi-svc python -c '
import json, os, sys
sys.path.insert(0, "/app")
from app.routes.session import _sondar_moldes

r = _sondar_moldes(os.environ["PROXY"])

base = r.get("linha_de_base") or {}
print("── Sem parâmetro nenhum ──────────────────────")
print("  IPs observados: " + ", ".join(base.get("ips") or ["(nenhum)"]))
print("  estável: " + ("SIM" if base.get("estavel") else "NÃO — o proxy rotaciona"))
print("")

if r.get("candidatos"):
    print("── Candidatos ────────────────────────────────")
    for c in r["candidatos"]:
        marca = "FIXOU" if c.get("fixou") else ("recusado (" + c["erro"] + ")" if c.get("erro") else "rotaciona")
        print("  " + c["molde"].ljust(24) + marca)
    print("")

pf = r.get("preflight")
if pf:
    # A linha de base falhou, então o molde não é a causa. Estas camadas
    # separam rede de credencial de tradução da URL — quatro causas que a
    # palavra "ProxyError" não distingue.
    print("── Sondagem em camadas ───────────────────────")
    print("  destino                 " + str(pf.get("destino", "?")))
    print("  1. DNS resolve          " + str(pf.get("dns", "-")))
    print("  2. porta abre           " + str(pf.get("tcp", "-")))
    print("  3. CONNECT à mão        " + str(pf.get("connect_manual", "-")))
    print("  4. requests, URL crua   " + str(pf.get("requests_cru", "-")))
    print("  5. requests, codificado " + str(pf.get("requests_codificado", "-")))
    print("")

for e in r.get("erros", []):
    print("  erro: " + e)

print("── Conclusão ─────────────────────────────────")
for linha in (r.get("conclusao") or "sem conclusão").split(". "):
    if linha.strip():
        print("  " + linha.strip().rstrip(".") + ".")
' 2>/dev/null || {
  echo "Não foi possível sondar. O serviço instagrapi-svc está de pé?"
  echo "  docker compose ps instagrapi-svc"
  exit 1
}

echo
echo "════════════════════════════════════════════════════════"
echo "Se um molde FIXOU, ponha-o no .env e recrie o serviço:"
echo "  docker compose up -d --force-recreate instagrapi-svc"
echo
echo "Depois disso, cada conta passa a ter um identificador próprio e um IP"
echo "que não muda durante o login."
