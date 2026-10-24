# Deploying Devlancer

## Production at a glance

| Piece | Value |
|---|---|
| Host | GCP VM `devlancer`, project `devlancer-rexin`, zone `us-central1-a`, e2-micro (always-free tier), Debian 12 |
| Code | `/opt/devlancer` (a clone of `main`), secrets in `/opt/devlancer/.env` |
| State | `/var/lib/devlancer/auth` (WhatsApp session), `/var/lib/devlancer/db` (SQLite), `/var/lib/devlancer/out` (PDFs, briefs) |
| Services | systemd `devlancer` (app on `127.0.0.1:4000`) and `devlancer-tunnel` (cloudflared), both `Restart=always` |
| Origin | Cloudflare Tunnel `devlancer`, hostname `devlancer-origin.jeromtom.com`. No open inbound ports on the VM. |
| Public URL | https://devlancer.rexindynamics.com, a Cloudflare Worker (`deploy/edge`) proxying to the origin |
| Health | `GET /healthz` returns `{ ok, whatsapp, devin }` |

```
Browser -> devlancer.rexindynamics.com (Worker devlancer-edge)
        -> devlancer-origin.jeromtom.com (Cloudflare Tunnel "devlancer")
        -> cloudflared on the VM -> 127.0.0.1:4000 (devlancer.service)
```

## One-time setup: `deploy/provision.sh`

Run as root on a fresh Debian 12 VM after cloning the repo to `/opt/devlancer` and placing `.env` there. It:

1. Installs Node 22, build tools, Git, the GitHub CLI (`gh`) and `cloudflared`.
2. Creates `/var/lib/devlancer/{auth,db,out}`.
3. Runs `npm ci` and installs Playwright Chromium to `/opt/ms-playwright`.
4. Writes and enables `devlancer.service` (runs `npx tsx src/index.ts` with `DATA_DIR`, `AUTH_DIR`, `OUT_DIR`, `HOST=127.0.0.1`, `PORT=4000`, `TZ=Asia/Kolkata`, and a 512 MB Node heap cap) and `devlancer-tunnel.service` (`cloudflared tunnel run`, reading its settings from the same `.env`).

`gh` must be authenticated on the VM (`gh auth login`) so Devlancer can create client repos.

## Routine deploy: `deploy/deploy.sh`

Only the main agent deploys, after merging to `main`. From a laptop with `gcloud` access:

```bash
deploy/deploy.sh
```

It SSHes to the VM, resets `/opt/devlancer` to `origin/main`, runs `npm ci` only if `package-lock.json` changed, restarts `devlancer`, waits up to 90 seconds for `/healthz`, and prints whether both services are active. Set `GCP_ACCOUNT` to use a different Google account.

Logs on the VM:

```bash
journalctl -u devlancer -f
journalctl -u devlancer-tunnel -f
```

## Edge: Cloudflare Worker (`deploy/edge`)

`worker.js` forwards every request to `https://devlancer-origin.jeromtom.com`, streams the body (so the SSE live feed keeps working), sets `x-forwarded-host`, and rewrites redirects back to the public hostname (for Google OAuth).

`wrangler.toml` declares two routes:

- `devlancer.rexindynamics.com` as a **custom domain** (creates the DNS record), and
- `devlancer.rexindynamics.com/*` as a **specific zone route**, which beats the zone's `*.rexindynamics.com/*` client-portal wildcard route.

Deploy with `npx wrangler deploy` from `deploy/edge`.

## Why not Docker on the e2-micro

The `Dockerfile` (and `deploy/docker-compose.yml`) work on other hosts, but on the throttled shared core of an e2-micro, exporting image layers (Chromium included) was too slow to be usable. A plain systemd service with `npx tsx` starts quickly and keeps memory in budget.

## Environment variables

Names only. Values live in `/opt/devlancer/.env` on the VM and in a local `.env` for development; never commit them.

| Variable | Purpose |
|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (Laya and text models) |
| `DECIDE_MODEL` | Decision model, default `convaiinnovations/laya` |
| `TEXT_MODEL` | First model in the writing and extraction chain |
| `LAYA_RPM` | Laya requests per minute budget (default 5) |
| `ANTHROPIC_API_KEY`, `USE_ANTHROPIC_DIRECT` | Optional: call Anthropic models directly instead of through the gateway |
| `DEVIN_API_KEY`, `DEVIN_ORG_ID` | Devin MCP (service user key) |
| `GITHUB_OWNER` | Owner for client repos (default `jeromtom`) |
| `DEMO_TEMPLATE_REPO` | Optional template repo |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail OAuth |
| `FREELANCER_NAME`, `BUSINESS_NAME`, `BUSINESS_EMAIL`, `BUSINESS_ADDRESS` | Shown on documents and used in the voice prompt |
| `UPI_ID` | UPI ID and QR on invoices |
| `HOURLY_RATE` | Change order pricing (INR per hour) |
| `SKILLS` | Used for gig fit and pitches |
| `PORT`, `HOST`, `PUBLIC_URL` | Dashboard server |
| `DASHBOARD_USER`, `DASHBOARD_PASSWORD` | Basic auth for the dashboard |
| `DEV_TOKEN` | Protects the `/dev/self` test hook in production |
| `DATA_DIR`, `AUTH_DIR`, `OUT_DIR` | State locations (set by the systemd unit) |
| Tunnel token for `cloudflared` | `TUNNEL_TOKEN` read by `devlancer-tunnel.service` from `.env` |

Devin itself also needs a `VERCEL_TOKEN` secret in the Devin organisation so sessions can deploy to Vercel. That lives in Devin, not in Devlancer's `.env`.

## Relinking WhatsApp

1. If WhatsApp logged the device out, stop the service and clear the session: `sudo systemctl stop devlancer && sudo rm -rf /var/lib/devlancer/auth/*`.
2. `sudo systemctl start devlancer`.
3. Open https://devlancer.rexindynamics.com/qr (log in), then on the phone: WhatsApp, Linked devices, Link a device, scan. The page refreshes the code every 15 seconds.
4. `/healthz` shows `"whatsapp": true` once linked. Never run a second copy against the same session (error 440).

## Multi-agent workflow

Several agents work in parallel; the rules are in [AGENTS.md](../AGENTS.md). In short: each agent works in its own worktree and branch, commits only its own files, runs `npx tsc --noEmit` before pushing, never pushes `main`, never runs the app against the shared WhatsApp session, and keeps secrets out of git. The main agent merges and runs `deploy/deploy.sh`.
