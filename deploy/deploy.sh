#!/usr/bin/env bash
# Deploy main to the VM: pull, install deps if the lockfile changed, restart. Usage: deploy/deploy.sh
set -euo pipefail
gcloud compute ssh devlancer --project=devlancer-rexin --zone=us-central1-a --account="${GCP_ACCOUNT:-rexindynamics@gmail.com}" --quiet --ssh-flag="-o ConnectTimeout=60" --command '
  set -e
  cd /opt/devlancer
  before=$(sudo git rev-parse HEAD:package-lock.json)
  sudo git fetch -q origin main && sudo git reset -q --hard origin/main
  [ "$before" = "$(sudo git rev-parse HEAD:package-lock.json)" ] || sudo npm ci --include=dev --no-audit --no-fund
  sudo systemctl restart devlancer
  sleep 8; systemctl is-active devlancer devlancer-tunnel; git log --oneline -1
  curl -fs http://127.0.0.1:4000/healthz || true
'
