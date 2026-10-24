#!/usr/bin/env bash
# Deploy main to the VM: pull, rebuild, restart. Usage: deploy/deploy.sh
set -euo pipefail
PROJECT=devlancer-rexin ZONE=us-central1-a VM=devlancer ACCOUNT=${GCP_ACCOUNT:-rexindynamics@gmail.com}
gcloud compute ssh "$VM" --project=$PROJECT --zone=$ZONE --account="$ACCOUNT" --command '
  set -e
  cd /opt/devlancer
  sudo git fetch -q origin main && sudo git reset -q --hard origin/main
  cd deploy && sudo docker compose up -d --build devlancer tunnel
  sudo docker image prune -f >/dev/null
  sleep 5; sudo docker compose ps
'
