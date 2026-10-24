# Working on Devlancer with several agents

Several agents work on this repo at once before the 06:00 deadline. One **main agent** owns `main`, merges and deploys.

## Rules for every agent

1. **Never work in the shared folder `devlancer/` on `main`.** Create your own worktree and branch:
   `git worktree add ../devlancer-<topic> -b <topic> origin/main`
2. **Commit only your own files** (`git add <paths>`, never `git add -A` or `git add .`). Other agents' unfinished edits must not end up in your commits.
3. **Before pushing:** `npx tsc --noEmit` must pass. Push your branch (`git push -u origin <topic>`) and tell the main agent it is ready. Do not push to `main`.
4. **Never run the app** (`npm start`) against the shared `auth/` or `data/`: two processes on the same WhatsApp session kick each other off (error 440). Production runs on the VM.
5. Keep secrets out of git (`.env`, `auth/`, `data/`, tokens).

## Production

- Runs on GCP VM `devlancer` (project `devlancer-rexin`, us-central1-a, e2-micro always-free) with Docker Compose (`deploy/docker-compose.yml`).
- Public URL: https://devlancer.rexindynamics.com via Cloudflare Tunnel `devlancer` (no open ports). Dashboard behind basic auth.
- State lives on the VM in `/var/lib/devlancer` (`auth/` WhatsApp session, `db/` SQLite, `out/` PDFs).
- Deploy: the main agent merges to `main`, then runs `deploy/deploy.sh` (pull, rebuild, restart). Health: `/healthz`.
