#!/usr/bin/env bash
#
# Empacota e restaura os volumes do Docker — backup e migração de servidor.
#
# ── Por que um script e não uma linha de comando colada
#
# A migração tem cinco volumes, e a linha que os empacota tem noventa
# caracteres de `docker run` com dois `-v` e um `tar`. Colar isso no terminal
# funciona uma vez; na segunda, alguém troca a ordem dos `-v` e o `tar`
# sobrescreve a origem em vez de ler dela.
#
# Aqui é um comando por lado, com o nome do volume vindo de uma lista só. E o
# script mora no repositório, então depois do `git clone` no servidor novo ele
# já está lá — não precisa ser transferido junto.
#
# ── O que ele protege, em ordem de gravidade
#
#   sessions    as sessões do Instagram. Perder é fazer todas as contas
#               relogarem ao mesmo tempo, de um IP novo — o cenário exato de
#               checkpoint em massa. É o volume mais importante da lista, e
#               quase ninguém pensa nele.
#   mongo_data  contas, posts, insights, agendamentos, `deviceIndex`.
#   uploads     mídias e avatares.
#   data        estado do backend.
#   redis_data  a fila BullMQ. Perder some com o que está agendado.
#
# ── Por que a pilha PARA antes de empacotar
#
# Copiar o diretório de dados do Mongo com ele escrevendo produz um arquivo que
# parece íntegro e não é: a restauração sobe, e a corrupção aparece dias depois
# numa coleção que ninguém tocou. Vale o minuto de indisponibilidade.
#
# O `--sem-parar` existe para backup de rotina, onde parar todo dia não é
# aceitável — e aí o aviso é explícito: serve para levar embora, não para
# restaurar às cegas.
#
# Uso:
#   ./scripts/volumes.sh salvar   [destino]   # padrão: /root/migra
#   ./scripts/volumes.sh restaurar [origem]   # padrão: /root/migra
#   ./scripts/volumes.sh listar
#
set -euo pipefail

VOLUMES=(sessions mongo_data uploads data redis_data)

# O prefixo que o compose dá aos volumes é o nome do projeto — que, sem um
# `name:` no docker-compose.yml, é o nome da PASTA. Descobrir em vez de fixar
# evita o erro silencioso de empacotar um volume vazio porque a pasta no
# servidor novo tem outro nome.
PROJETO="$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)")"

DESTINO="${2:-/root/migra}"
ACAO="${1:-}"
SEM_PARAR="${SEM_PARAR:-0}"

cor()  { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { cor '0;36' "  $1"; }
ok()   { cor '0;32' "✓ $1"; }
erro() { cor '0;31' "✗ $1" >&2; }

existe_volume() {
  docker volume inspect "${PROJETO}_$1" >/dev/null 2>&1
}

listar() {
  echo "Projeto: ${PROJETO}"
  echo
  printf '%-14s %-10s %s\n' VOLUME ESTADO TAMANHO
  for v in "${VOLUMES[@]}"; do
    if existe_volume "$v"; then
      # `du` de dentro de um contêiner: o caminho do volume no host varia por
      # instalação, e um `du /var/lib/docker/...` chutado falharia em qualquer
      # máquina com storage driver diferente.
      local tam
      tam="$(docker run --rm -v "${PROJETO}_$v":/v alpine du -sh /v 2>/dev/null | cut -f1 || echo '?')"
      printf '%-14s %-10s %s\n' "$v" "existe" "$tam"
    else
      printf '%-14s %-10s %s\n' "$v" "AUSENTE" "-"
    fi
  done
}

salvar() {
  mkdir -p "$DESTINO"
  echo "Projeto: ${PROJETO}  →  ${DESTINO}"
  echo

  if [ "$SEM_PARAR" = "1" ]; then
    cor '1;33' "AVISO: empacotando com a pilha NO AR."
    cor '1;33' "O Mongo pode gerar um arquivo que parece íntegro e não é."
    cor '1;33' "Use para levar cópia embora — não para restaurar sem conferir."
    echo
  else
    info "parando a pilha…"
    docker compose stop
  fi

  local faltando=0
  for v in "${VOLUMES[@]}"; do
    if ! existe_volume "$v"; then
      erro "volume ${PROJETO}_$v não existe — pulando"
      faltando=1
      continue
    fi
    info "empacotando $v…"
    # `-C /origem .` e não `/origem`: sem isso o tar guarda o caminho absoluto
    # dentro do arquivo, e a restauração recria `/origem` dentro do volume em
    # vez de despejar o conteúdo nele.
    docker run --rm \
      -v "${PROJETO}_$v":/origem:ro \
      -v "$DESTINO":/destino \
      alpine tar czf "/destino/$v.tgz" -C /origem .
  done

  # O `.env` não está no git — `git clone` no servidor novo não o traz, e sem
  # ele nada sobe. É o esquecimento mais comum desta migração.
  if [ -f .env ]; then
    cp .env "$DESTINO/env.backup"
    ok ".env copiado como env.backup"
  else
    erro ".env não encontrado — confira antes de migrar"
  fi

  # Certificados: o compose monta /etc/letsencrypt do HOST, então eles não
  # estão em volume nenhum. Copiar evita reemitir com o DNS ainda apontando
  # para o servidor antigo, o que falharia e gastaria tentativa no limite.
  if [ -d /etc/letsencrypt ]; then
    tar czf "$DESTINO/letsencrypt.tgz" -C /etc letsencrypt
    ok "certificados TLS empacotados"
  fi

  echo
  ls -lh "$DESTINO"
  echo
  [ "$faltando" = "1" ] && erro "algum volume faltou — leia acima antes de seguir"
  ok "pronto. Transfira $DESTINO para o servidor novo."
  [ "$SEM_PARAR" = "1" ] || info "a pilha está PARADA — suba com: docker compose up -d"
}

restaurar() {
  [ -d "$DESTINO" ] || { erro "não achei $DESTINO"; exit 1; }
  echo "Projeto: ${PROJETO}  ←  ${DESTINO}"
  echo

  # Confere ANTES de mexer em qualquer coisa. Restaurar três volumes e
  # descobrir que o quarto não veio deixa a máquina num estado misto, que é
  # pior que não ter começado.
  local faltando=()
  for v in "${VOLUMES[@]}"; do
    [ -f "$DESTINO/$v.tgz" ] || faltando+=("$v")
  done
  if [ ${#faltando[@]} -gt 0 ]; then
    erro "faltam pacotes: ${faltando[*]}"
    erro "restauração abortada — nada foi tocado"
    exit 1
  fi

  info "parando a pilha…"
  docker compose stop 2>/dev/null || true

  # `create` sem `up`: faz o compose criar os volumes vazios sem subir os
  # serviços. Restaurar com o Mongo rodando por cima do próprio diretório de
  # dados é como trocar o pneu com o carro andando.
  info "criando os volumes…"
  docker compose create >/dev/null 2>&1 || true

  for v in "${VOLUMES[@]}"; do
    info "restaurando $v…"
    docker run --rm \
      -v "${PROJETO}_$v":/destino \
      -v "$DESTINO":/origem:ro \
      alpine sh -c "cd /destino && tar xzf /origem/$v.tgz"
  done

  if [ -f "$DESTINO/env.backup" ] && [ ! -f .env ]; then
    cp "$DESTINO/env.backup" .env
    ok ".env restaurado"
  elif [ -f .env ]; then
    info ".env já existe aqui — mantido, não sobrescrevi"
  fi

  if [ -f "$DESTINO/letsencrypt.tgz" ]; then
    tar xzf "$DESTINO/letsencrypt.tgz" -C /etc
    ok "certificados TLS restaurados"
  fi

  echo
  ok "restaurado. Suba com: docker compose up -d"
  info "depois confira: docker compose ps && curl -s localhost:3000/health"
}

case "$ACAO" in
  salvar)    salvar ;;
  restaurar) restaurar ;;
  listar)    listar ;;
  *)
    echo "uso: $0 {salvar|restaurar|listar} [pasta]"
    echo
    echo "  salvar     empacota os volumes (para a pilha antes)"
    echo "  restaurar  despeja os pacotes nos volumes deste servidor"
    echo "  listar     mostra quais volumes existem e o tamanho de cada um"
    echo
    echo "  SEM_PARAR=1 $0 salvar    # backup de rotina, sem derrubar a pilha"
    exit 1
    ;;
esac
