# Devlancer

> **Devlancer: your freelance dev that finds the gig, builds it, and keeps the client happy.**

Devlancer runs on a freelancer's own WhatsApp number, quietly (ghost mode). It spots gigs in marketplace groups, pitches privately, sends proposals, kicks off the build on Devin, delivers previews to the client, routes change requests to the right Devin surface, catches scope creep as priced change orders, and tracks invoices and payments. The freelancer approves everything from their own "Message yourself" chat.

Built for **Devin Hacks Kochi** (24-25 October 2026). Live dashboard: **https://devlancer.rexindynamics.com** (password-protected login).

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, SQLite tables, dashboard |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Production VM, tunnel, edge worker, env vars, relinking WhatsApp |
| [docs/DEMO.md](docs/DEMO.md) | 4-minute judge demo script and checklist |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [design/DESIGN.md](design/DESIGN.md) | Design system |
| [AGENTS.md](AGENTS.md) | Rules for the multi-agent workflow |

## The problem

Freelance developers in India find, run, bill and maintain client work almost entirely inside WhatsApp.

- Gig leads vanish in busy business groups, and the first reply usually wins.
- Proposals and invoices are slow, repetitive admin.
- Change requests arrive at all hours, mixed with chatter, sometimes for several projects in one group.
- Scope creep goes unbilled, invoices go unchased, and clients wait when the freelancer is asleep.

## End-to-end flow

| # | Stage | What Devlancer does |
|---|---|---|
| 1 | **Scout** | Watches groups marked as marketplaces. A regex prefilter, then a Laya classification (is it a gig, how well does it fit, which category). Gigs above 60% probability and 35% fit become a card in the self-chat with a drafted pitch. |
| 2 | **Pitch** | On approval: 👍 reaction on the post, a short "Check DM 🙂" reply in the group, and the full pitch sent as a private reply quoting the group post. Option 3 also sends a proposal PDF. |
| 3 | **Proposal** | When the lead asks for details, a proposal PDF (scope, deliverables, out of scope, milestones, priced items in INR, 50/50 terms) is drafted and offered for approval. |
| 4 | **Acceptance** | When the lead accepts in DM, an approval card offers "start project + advance invoice + Devin build". |
| 5 | **Kickoff** | Creates the project, saves the spec to Devin Knowledge, drafts a 50% advance invoice, creates a private GitHub repo with `gh`, and starts a Devin Cloud session to build and deploy to Vercel. Schedules weekly upkeep. |
| 6 | **Delivery** | A watcher polls Devin every 45 seconds. On finish it reads the structured output (preview, repo, PR), takes a mobile screenshot of the preview, drafts a client message, and asks to send (or sends straight away on autopilot, except for the first build). |
| 7 | **Change requests** | Client messages are classified (intent, scope, clarity, verifiability, human dependence, size) and routed by presence x human dependence (table below). |
| 8 | **Scope creep** | An out-of-scope change request gets a holding reply and a change order PDF priced at the hourly rate. When the client says "ok", the change order is accepted, the spec is updated, an invoice is drafted, and the work is routed to Devin. |
| 9 | **Invoices** | Invoice PDFs carry a UPI QR code ("Scan to pay with any UPI app"). Overdue invoices get a gentle reminder draft every 6 hours. |
| 10 | **Payments** | Payment claims in WhatsApp and payment alerts in Gmail are matched to open invoices and offered as "mark paid". On approval the client gets a short thank-you. For the demo, `/paid` marks invoices paid directly. |

### Change request routing

"High" means human dependence of at least 0.55, or likely more than 3 hours, or hard to verify. Requests about logos, brand, look and feel, credentials, domains or payment gateways are always treated as high.

| | Freelancer `/online` | Freelancer `/offline` |
|---|---|---|
| **Low human dependence** | Devin Cloud session (PR + Vercel preview), freelancer notified | Natural holding reply to the client, then Devin Cloud session |
| **High human dependence** | Engineering brief written (with `ask_wiki_question` repo context) and Devin CLI opened with the brief on the clipboard (on the server: a ready-to-paste `devin` command) | Brief queued for the morning, holding reply ("first thing tomorrow") |

Before routing: unclear requests get a drafted clarifying question, questions get a drafted answer grounded in the repo via `ask_wiki_question`, and payment claims go to payment matching.

## Ghost mode

Devlancer acts as the freelancer, never as a bot.

- Messages are written in the freelancer's voice, learnt from their last 25 sent WhatsApp messages. No bot names, no "As an AI", no em dashes.
- Human pacing: typing indicator and a delay proportional to length, a global send gap, and it does not mark itself online on connect.
- In groups it only reacts and says "Check DM"; the pitch goes privately.
- Anything that commits money, scope or deadlines waits for approval. Doubts (for example, which project a message is about) go to the freelancer, never to the client.

## Self-chat control panel

The freelancer's "Message yourself" chat is the control panel. Approval cards end with numbered choices: reply `1`, `2` (edit, then send the new text), `3` or `0`, quote a card to answer that one, or use `#12 1` to answer card 12.

| Command | What it does |
|---|---|
| `/online`, `/offline` | Set presence (drives routing) |
| `/status` | Presence, Devin connection, tasks running and queued, open pitches |
| `/groups [search]` | List the 30 most active groups (or name matches) with numbers |
| `/m 1,3` | Mark groups as marketplaces and scan their last 7 days |
| `/c 2` | Mark a group as a client group |
| `/speed on\|off <group#>` | Speed mode: auto-pitch gigs with fit of 85% or more in that group |
| `/scan` | Rescan marketplace history |
| `/gigs` | Last 10 leads with fit and status |
| `/won <lead#>` | Start a project from a lead manually |
| `/link <slug> <group#>` | Move a project into a client group |
| `/projects` | List projects with preview links |
| `/project email <slug> <email>` | Set the client email (for Gmail) |
| `/autopilot on\|off <slug>` | Send finished change requests to the client without asking |
| `/devin <task#> <message>` | Answer a blocked Devin session |
| `/invoice <slug> <amount> <note>` | Draft a milestone invoice |
| `/invoices` | Recent invoices and total outstanding |
| `/paid <INV-number>`, `/paid all` | Mark an invoice (or all open invoices) paid, for simulated payments |
| `/gmail` | Gmail connection status or link |
| `/help` | Command list |

## AI layer

| Layer | Used for | Details |
|---|---|---|
| **Laya** (`convaiinnovations/laya`) via Vercel AI Gateway, `experimental_decide` | Typed decisions: gig or not, fit, category, client intent, scope, clarity, human dependence, size, lead acceptance, email kind | Booleans with probabilities, 5-level scores, choices. Budget of 5 requests a minute (`LAYA_RPM`); history scans use the text model so live messages keep Laya. |
| **Ensemble** | Gig and client classification | Laya and the text model run in parallel. Scores are averaged; on client intent, the text model wins on disagreement. If the text model fails, Laya decides alone. |
| **Text model** (`TEXT_MODEL`) | Writing in the freelancer's voice, structured extraction (proposals, specs, change orders, briefs) | Fallback chain through several gateway models; rate-limited or refused models are parked for a while. |
| **Rules** | Last resort for every decision | Keyword rules, so classification never stalls. Writing falls back to safe templates. |

## Devin surfaces

| Surface | How Devlancer uses it |
|---|---|
| **Devin MCP** (`mcp.devin.ai`) | `devin_session_create` with a structured output schema (preview, repo, PR, summary); `devin_session_interact` to poll, read messages and answer blocked sessions |
| **Devin Cloud sessions** | First build and deploy to Vercel, clear change requests (branch, PR, Vercel preview), weekly upkeep |
| **Knowledge** | `devin_knowledge_manage` saves each client's spec, triggered when working on that repo |
| **Schedules** | `devin_schedule_manage` creates weekly upkeep (Mondays 9 AM). If the key lacks permission, a local scheduler runs the same upkeep as a Cloud session |
| **ask_wiki_question** | Repo-grounded answers to client questions and file hints for engineering briefs |
| **Devin CLI** | Hands-on work when the freelancer is online and the task needs judgement; `/handoff` sends it to the cloud |

## Always-on fallbacks

| Failure | Fallback |
|---|---|
| Laya rate limit or error | Text model, then keyword rules |
| Text model down | Next model in the chain, then a template |
| Devin cannot start a session | Task queued, retried every 45 seconds (up to 30 attempts), freelancer told once |
| Devin finishes without a deliverable | Task marked blocked; the freelancer sees Devin's last message and replies with `/devin` |
| Devin Schedules not permitted | Local weekly scheduler |
| `gh` repo creation fails | Devin is asked to create the repo |
| PDF rendering fails | Text summary sent instead |
| Quoted send fails | Plain send |
| Any job hangs | 2-minute timeout per job; the process never exits on errors and systemd restarts it if it does |

## Stack

Node 22 and TypeScript (run with `tsx`), Baileys (WhatsApp Web), Vercel AI SDK with AI Gateway, Model Context Protocol SDK (Devin MCP), better-sqlite3, Hono (dashboard, SSE), Playwright Chromium (PDFs and screenshots), `qrcode` (UPI QR), Google APIs (Gmail), GitHub CLI. Hosted on a GCP e2-micro behind Cloudflare Tunnel and a Cloudflare Worker.

## Local development

```bash
git clone https://github.com/jeromtom/devlancer && cd devlancer
npm install
cp .env.example .env          # fill in keys (see docs/DEPLOY.md for the list)
gh auth login                 # Devlancer creates client repos with gh
npm run dev                   # scan the QR in the terminal or at http://localhost:4000/qr
npx tsc --noEmit              # typecheck
```

Then send `/groups` in your "Message yourself" chat and mark marketplaces with `/m`. Do not run a local copy against the same WhatsApp number as production: two sessions kick each other off (error 440).

## Honest limits

- One freelancer per install; WhatsApp through Baileys (unofficial WhatsApp Web), not the Cloud API, so there is some ban risk on a real number.
- Payments are not collected online. Matching works from client messages and Gmail alerts; in the demo, payments are marked with `/paid`.
- Devin CLI opens a Terminal only on macOS; on the server it sends a paste-ready command instead.
- Devin result parsing reads the structured output text; an unusual response can leave a task marked blocked.
- Laya is limited to 5 requests a minute on our gateway tier; beyond that the text model decides.
- Gmail OAuth must be completed in a browser before email features work.
