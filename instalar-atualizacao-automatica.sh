#!/usr/bin/env bash
# Instala (uma vez) a atualização automática: a cada 5 min o servidor confere o
# GitHub e, se houver versão nova, roda ./deploy.sh sozinho.
#   sudo -i
#   cd /root/insta-nova && ./instalar-atualizacao-automatica.sh
# Para desligar:  systemctl disable --now insta-nova-atualizacao.timer
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i antes)."; exit 1; }

DIR=$(cd "$(dirname "$0")" && pwd)
chmod +x "$DIR/deploy.sh" "$DIR/atualizar-sozinho.sh"

cat > /etc/systemd/system/insta-nova-atualizacao.service <<UNIT
[Unit]
Description=Nexora — atualiza do GitHub se houver versão nova
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$DIR/atualizar-sozinho.sh
TimeoutStartSec=30min
UNIT

cat > /etc/systemd/system/insta-nova-atualizacao.timer <<UNIT
[Unit]
Description=Nexora — confere atualização a cada 5 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=insta-nova-atualizacao.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now insta-nova-atualizacao.timer
echo
echo "✅ Atualização automática ligada. Conferindo agora…"
systemctl start insta-nova-atualizacao.service || true
journalctl -u insta-nova-atualizacao -n 20 --no-pager
