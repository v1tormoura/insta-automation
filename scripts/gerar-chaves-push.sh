#!/usr/bin/env bash
#
# Gera o par de chaves VAPID do Web Push e grava no .env do backend.
#
# ── Por que um script, e não um comando para colar
#
# A chave privada assina cada notificação enviada. Colada num chat, num
# histórico de shell ou num arquivo versionado, ela deixa de ser privada — e
# quem a tiver pode enviar notificação em nome deste servidor para qualquer
# aparelho já inscrito.
#
# Aqui ela é gerada NO servidor, escrita direto no arquivo, e nunca aparece na
# tela. O que o script imprime é só a pública, que por desenho é distribuída
# aos navegadores.
#
# ── Onde ela vai parar
#
# No `.env` da RAIZ, que é o arquivo que o docker-compose entrega ao contêiner
# do backend (`env_file: .env`). Escrever em `backend/.env` seria natural e
# estaria errado: aquele arquivo existe, está no .gitignore, e o contêiner não
# o lê — as chaves ficariam gravadas sem nunca chegar ao processo.
#
# E NÃO em `.env.production`, que é rastreado pelo git: pôr a chave privada lá
# seria publicá-la no repositório.
#
#   ./scripts/gerar-chaves-push.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"   # o mesmo que o docker-compose entrega ao backend

if [ ! -f "$ENV_FILE" ]; then
  echo "Criando $ENV_FILE."
  touch "$ENV_FILE"
fi

if grep -q '^VAPID_PRIVATE_KEY=' "$ENV_FILE" 2>/dev/null; then
  echo "Já existem chaves VAPID em $ENV_FILE."
  echo
  echo "Gerar um par novo DESINSCREVE todos os aparelhos: as inscrições que já"
  echo "existem foram feitas com a chave antiga e o serviço de push vai recusá-las."
  echo "Se é isso mesmo que você quer, remova as duas linhas VAPID_ do arquivo e"
  echo "rode de novo."
  exit 0
fi

# A biblioteca vive dentro da imagem do backend. Se ela foi adicionada ao
# package.json depois do último build, a imagem em uso ainda não a tem — e
# `docker compose restart` não resolve, porque restart não reinstala nada.
# Conferir aqui evita a mensagem genérica "não foi possível gerar", que manda
# procurar no lugar errado.
if ! docker compose run --rm --no-deps -T backend node -e "require('web-push')" >/dev/null 2>&1; then
  echo "A imagem do backend não tem a biblioteca 'web-push'."
  echo
  echo "Ela é uma dependência nova: reconstrua a imagem antes de gerar as chaves."
  echo "  docker compose build backend"
  echo
  echo "Depois rode este script de novo."
  exit 1
fi

echo "Gerando o par de chaves…"

# A geração acontece dentro do contêiner do backend, onde a dependência vive.
# `--rm` para o contêiner sumir depois; nada fica para trás.
SAIDA=$(docker compose run --rm --no-deps -T backend node -e "
  const wp = require('web-push');
  const k = wp.generateVAPIDKeys();
  process.stdout.write(k.publicKey + '\n' + k.privateKey);
" 2>/dev/null | tr -d '\r')

PUBLICA=$(echo "$SAIDA" | sed -n '1p')
PRIVADA=$(echo "$SAIDA" | sed -n '2p')

if [ -z "$PUBLICA" ] || [ -z "$PRIVADA" ]; then
  echo "Não foi possível gerar as chaves."
  echo "A biblioteca existe, então o problema é outro — veja o erro completo com:"
  echo "  docker compose run --rm --no-deps backend node -e \"console.log(require('web-push').generateVAPIDKeys().publicKey)\""
  exit 1
fi

{
  echo ""
  echo "# Web Push (VAPID) — gerado em $(date '+%Y-%m-%d %H:%M')"
  echo "# A privada assina cada notificação. Não versionar, não compartilhar."
  echo "VAPID_PUBLIC_KEY=$PUBLICA"
  echo "VAPID_PRIVATE_KEY=$PRIVADA"
  echo "VAPID_SUBJECT=mailto:admin@instaflow.pro"
} >> "$ENV_FILE"

echo
echo "Gravadas em $ENV_FILE."
echo "Chave pública (esta pode ser vista por qualquer um):"
echo "  $PUBLICA"
echo
echo "Agora reinicie o backend para ele ler as chaves:"
echo "  docker compose restart backend"
echo
echo "Depois, no painel: Configuração → Notificações → ligue o aviso no aparelho."
echo "A inscrição é por APARELHO — ative também no celular."
