#!/usr/bin/env bash
#
# De qual IP o Instagram enxerga a automação.
#
# Lê o proxy configurado direto do MongoDB e mede o IP de saída por ele. Não
# recebe argumento e não pede nada colado: as duas vezes que pedi uma URL de
# proxy num comando de exemplo, o marcador foi executado literalmente — e a
# credencial do proxy não deveria passar pelo histórico do shell de qualquer
# forma.
#
#   ./scripts/conferir-ip-de-saida.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── IP do servidor (sem proxy) ──"
IP_DIRETO=$(docker compose exec -T instagrapi-svc python -c \
  "import requests;print(requests.get('https://api.ipify.org',timeout=15).text)" 2>/dev/null || echo "(falhou)")
echo "   $IP_DIRETO"
echo

echo "── proxy configurado no painel ──"
PROXY=$(docker compose exec -T mongo mongosh insta-automation --quiet --eval \
  'const d=db.settings.findOne({key:"globalProxy"}); print(d && d.value && d.value.ativo ? d.value.url : "")' \
  2>/dev/null | tr -d '\r' | tail -1)

if [ -z "$PROXY" ]; then
  echo "   nenhum proxy global ativo."
  echo
  echo "Conclusão: a automação sai por $IP_DIRETO, o IP do servidor."
  exit 0
fi

# Só host e porta na tela. Usuário e senha do proxy são credenciais.
MASCARA=$(printf '%s' "$PROXY" | sed -E 's#^[a-z]+://##; s#^.*@##')
echo "   $MASCARA"
echo

echo "── IP de saída atravessando o proxy ──"
IP_PROXY=$(PROXY="$PROXY" docker compose exec -T -e PROXY instagrapi-svc python -c "
import os, requests
p = os.environ['PROXY']
try:
    print(requests.get('https://api.ipify.org', proxies={'http': p, 'https': p}, timeout=25).text)
except Exception as e:
    print('ERRO: ' + type(e).__name__)
" 2>/dev/null | tr -d '\r' | tail -1)
echo "   $IP_PROXY"
echo

echo "── veredito ──"
if [ "${IP_PROXY:0:4}" = "ERRO" ]; then
  echo "   O proxy não respondeu. Enquanto isso, tudo sai por $IP_DIRETO."
  echo "   Verifique credenciais e saldo com o fornecedor."
elif [ "$IP_PROXY" = "$IP_DIRETO" ]; then
  echo "   O proxy responde mas NÃO troca o IP — sai pelo mesmo endereço do"
  echo "   servidor. Para o Instagram, é como não ter proxy nenhum."
else
  echo "   O Instagram vê $IP_PROXY, não $IP_DIRETO. O proxy está fazendo efeito."
  echo "   Se o login ainda falhar, o problema é esse IP ou a conta, não a rota."
fi
