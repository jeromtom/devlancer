#!/usr/bin/env bash
# One-time VM setup (Debian 12, run as root): Node 22, Chromium deps, gh, cloudflared, systemd units.
# Docker is not used on the e2-micro: exporting image layers is too slow on a throttled shared core.
set -euo pipefail
apt-get update -q
apt-get install -y -q curl git ca-certificates gnupg python3 make g++
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
apt-get install -y -q nodejs
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli.gpg
echo "deb [signed-by=/usr/share/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
apt-get update -q && apt-get install -y -q gh /tmp/cloudflared.deb

mkdir -p /var/lib/devlancer/{auth,db,out}
cd /opt/devlancer
npm ci --include=dev --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx playwright install --with-deps chromium

cat > /etc/systemd/system/devlancer.service <<'UNIT'
[Unit]
Description=Devlancer (WhatsApp + Devin agent)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/devlancer
EnvironmentFile=/opt/devlancer/.env
Environment=NODE_ENV=production DATA_DIR=/var/lib/devlancer/db AUTH_DIR=/var/lib/devlancer/auth OUT_DIR=/var/lib/devlancer/out HOST=127.0.0.1 PORT=4000 TZ=Asia/Kolkata PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright NODE_OPTIONS=--max-old-space-size=512
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/devlancer-tunnel.service <<'UNIT'
[Unit]
Description=Cloudflare Tunnel for Devlancer
After=network-online.target devlancer.service

[Service]
EnvironmentFile=/opt/devlancer/.env
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4000 run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable devlancer devlancer-tunnel
