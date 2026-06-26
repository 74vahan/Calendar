# Деплой календаря на существующий vibecode-server (Server/ terraform).
# Использование:  .\deploy.ps1            (IP возьмётся из terraform output)
#                 .\deploy.ps1 1.2.3.4    (IP задан вручную)
$ErrorActionPreference = 'Stop'

$here      = $PSScriptRoot
$serverDir = Join-Path $here '..\Server'
$key       = Join-Path $serverDir 'vibecode-server-key.pem'
$sshUser   = 'vahan'

if (-not (Test-Path $key)) { throw "SSH-ключ не найден: $key (сначала примени terraform в Server/)" }

if ($args.Count -ge 1) {
  $ip = $args[0]
} else {
  Write-Host "Получаю external_ip из terraform (Server/)..."
  $ip = (terraform -chdir="$serverDir" output -raw external_ip)
}
Write-Host "==> Деплой на $sshUser@$ip (порт сайта 8088)"

# Архив без node_modules / .git / ключей
$tar = Join-Path $env:TEMP 'calendar.tar.gz'
if (Test-Path $tar) { Remove-Item $tar -Force }
tar --exclude='node_modules' --exclude='.git' --exclude='*.pem' --exclude='.env' -czf $tar -C $here .

scp -i $key -o StrictHostKeyChecking=no $tar "${sshUser}@${ip}:/home/$sshUser/calendar.tar.gz"

$remote = @'
set -e
command -v docker >/dev/null 2>&1 || { curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker $USER; }
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
'@
ssh -i $key -o StrictHostKeyChecking=no "${sshUser}@${ip}" $remote

Write-Host ""
Write-Host "Готово. Открой:  http://${ip}:8088"
