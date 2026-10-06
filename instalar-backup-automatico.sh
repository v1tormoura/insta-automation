#!/usr/bin/env bash
# Liga o backup automático: todo dia às 03:15 roda ./backup.sh (últimos 7).
#   sudo -i
#   cd /root/insta-nova && ./instalar-backup-automatico.sh
# Desligar: systemctl disable --now insta-nova-backup.timer
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i antes)."; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd)
chmod +x "$DIR/backup.sh" "$DIR/restaurar-backup.sh"

cat > /etc/systemd/system/insta-nova-backup.service <<UNIT
[Unit]
Description=Nexora — backup do banco e das mídias
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$DIR/backup.sh
TimeoutStartSec=2h
UNIT

cat > /etc/systemd/system/insta-nova-backup.timer <<UNIT
[Unit]
Description=Nexora — backup diário às 03:15

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
Unit=insta-nova-backup.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now insta-nova-backup.timer
echo "✅ Backup automático ligado (todo dia às 03:15). Fazendo o primeiro agora…"
systemctl start insta-nova-backup.service || true
journalctl -u insta-nova-backup -n 10 --no-pager
