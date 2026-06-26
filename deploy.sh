#!/usr/bin/env bash
# Деплой календаря на существующий vibecode-server.
# Использование:  ./deploy.sh           (IP из terraform output)
#                 ./deploy.sh 1.2.3.4   (IP вручную)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$HERE/../Server"
KEY="$SERVER_DIR/vibecode-server-key.pem"
SSH_USER="vahan"

[ -f "$KEY" ] || { echo "SSH-ключ не найден: $KEY"; exit 1; }

if [ "${1:-}" != "" ]; then
  IP="$1"
else
  echo "Получаю external_ip из terraform (Server/)..."
  IP="$(terraform -chdir="$SERVER_DIR" output -raw external_ip)"
fi
echo "==> Деплой на $SSH_USER@$IP (порт сайта 8088)"

TAR="$(mktemp -t calendar.XXXX.tar.gz)"
tar --exclude='node_modules' --exclude='.git' --exclude='*.pem' --exclude='.env' \
    -czf "$TAR" -C "$HERE" .

scp -i "$KEY" -o StrictHostKeyChecking=no "$TAR" "$SSH_USER@$IP:/home/$SSH_USER/calendar.tar.gz"

ssh -i "$KEY" -o StrictHostKeyChecking=no "$SSH_USER@$IP" bash -s <<'EOF'
set -e
command -v docker >/dev/null 2>&1 || { curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker "$USER"; }
[ -f ~/calendar/.env ] && cp ~/calendar/.env ~/.calendar.env.bak || true
rm -rf ~/calendar && mkdir -p ~/calendar
tar -xzf ~/calendar.tar.gz -C ~/calendar
cd ~/calendar
if [ -f ~/.calendar.env.bak ]; then
  mv ~/.calendar.env.bak .env
else
  cat > .env <<ENV
DB_USER=calendar
DB_PASSWORD=$(openssl rand -hex 16)
DB_NAME=calendar
JWT_SECRET=$(openssl rand -hex 32)
HTTP_PORT=8088
ENV
fi
sudo docker compose up -d --build
sudo docker compose ps
EOF

echo ""
echo "Готово. Открой:  http://$IP:8088"
