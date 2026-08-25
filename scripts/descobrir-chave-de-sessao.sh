#!/usr/bin/env bash
#
# Qual parâmetro o fornecedor usa para fixar o IP?
#
# Um proxy "sticky" que ainda troca de IP entre requisições quase sempre está
# esperando um identificador de sessão no nome de usuário. O nome do parâmetro
# muda por fornecedor — session, sessid, sid, sticky — e a documentação nem
# sempre diz.
#
# Este script descobre por medição: para cada chave candidata, pede o IP duas
# vezes pelo mesmo identificador. Se as duas respostas forem iguais, a chave é
# aceita e o IP ficou fixo. Se diferirem, o fornecedor ignorou o parâmetro.
#
# Lê o proxy do banco: nada para colar, e a credencial não passa pelo
# histórico do shell.
#
#   ./scripts/descobrir-chave-de-sessao.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

PROXY=$(docker compose exec -T mongo mongosh insta-automation --quiet --eval \
  'const d=db.settings.findOne({key:"globalProxy"}); print(d && d.value ? d.value.url : "")' \
  2>/dev/null | tr -d '\r' | tail -1)

if [ -z "$PROXY" ]; then
  echo "Nenhum proxy configurado no painel. Configure em Proxies antes de rodar."
  exit 1
fi

echo "Testando as chaves de sessão mais comuns."
echo "Cada uma é medida duas vezes: IP igual = fixou, IP diferente = ignorada."
echo

PROXY="$PROXY" docker compose exec -T -e PROXY instagrapi-svc python - <<'PY'
import os, re, requests

base = os.environ["PROXY"]

def com_sessao(url, sufixo):
    """Insere o sufixo no nome de usuário, preservando o resto da URL."""
    esquema, resto = url.split("://", 1)
    credenciais, destino = resto.rsplit("@", 1)
    usuario, senha = credenciais.split(":", 1)
    return f"{esquema}://{usuario}{sufixo}:{senha}@{destino}"

def ip_por(url):
    p = {"http": url, "https": url}
    return requests.get("https://api.ipify.org", proxies=p, timeout=25).text.strip()

# Sem parâmetro nenhum: a linha de base contra a qual comparar.
try:
    a, b = ip_por(base), ip_por(base)
    print(f"  {'(sem parâmetro)':<22} {a:<16} {b:<16} " +
          ("FIXO" if a == b else "rotaciona"))
except Exception as e:
    print(f"  (sem parâmetro)        erro: {type(e).__name__}")

print()

CANDIDATAS = [
    ";session.mf01", ";sessid.mf01", ";sid.mf01", ";sticky.mf01",
    "-session-mf01", "-sessid-mf01", "_session-mf01",
]

achadas = []
for sufixo in CANDIDATAS:
    url = com_sessao(base, sufixo)
    try:
        a = ip_por(url)
        b = ip_por(url)
        fixou = a == b
        print(f"  {sufixo:<22} {a:<16} {b:<16} " + ("FIXO" if fixou else "rotaciona"))
        if fixou:
            achadas.append(sufixo)
    except Exception as e:
        # Recusa é informação: o fornecedor validou o parâmetro e não gostou.
        print(f"  {sufixo:<22} recusado ({type(e).__name__})")

print()
if achadas:
    chave = re.sub(r"mf01$", "{sessao}", achadas[0])
    print("Chave aceita. Ponha isto no .env e reinicie o instagrapi-svc:")
    print()
    print(f"    PROXY_SESSAO_MOLDE={chave}")
    print()
    print("A partir daí cada conta recebe um identificador próprio e um IP fixo só dela.")
else:
    print("Nenhuma das chaves comuns fixou o IP.")
    print("Pergunte ao fornecedor qual parâmetro ativa a sessão fixa — o formato")
    print("é um sufixo no nome de usuário, e é só pôr no PROXY_SESSAO_MOLDE com")
    print("{sessao} no lugar do valor.")
PY
