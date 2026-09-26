#!/usr/bin/env bash
# Confere o GitHub e, se houver versão nova na branch atual, roda o deploy.
# Chamado a cada 5 min pelo timer instalado com ./instalar-atualizacao-automatica.sh.
# Log: journalctl -u insta-nova-atualizacao -n 50
set -euo pipefail
cd "$(dirname "$0")"

# Uma atualização por vez: um build demorado não pode ser atropelado pelo próximo ciclo.
exec 9>/tmp/insta-nova-atualizacao.lock
flock -n 9 || exit 0

RAMO=$(git rev-parse --abbrev-ref HEAD)
git fetch --quiet origin "$RAMO"
LOCAL=$(git rev-parse HEAD)
REMOTO=$(git rev-parse "origin/$RAMO")
[ "$LOCAL" = "$REMOTO" ] && exit 0

# Só avança (fast-forward). Mudança feita à mão no servidor não é atropelada.
if ! git merge-base --is-ancestor HEAD "origin/$RAMO"; then
  echo "O servidor tem commits que o GitHub não tem — não atualizo sozinho. Rode ./deploy.sh à mão."
  exit 1
fi

echo "Nova versão: ${LOCAL:0:7} → ${REMOTO:0:7}"
# O deploy avança o código antes do build: se o build falhar, os containers
# antigos continuam no ar e a versão não é tentada de novo — a próxima correção
# enviada ao GitHub dispara outra tentativa.
./deploy.sh || { echo "Deploy falhou — a versão anterior continua no ar."; exit 1; }
