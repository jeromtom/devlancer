# Devlancer

> Your freelance dev that finds the gig, builds it, and keeps the client happy.

Built solo at **Devin Hacks Kochi** (24-25 October 2026). Track 1: Kill the Busywork, with a Track 2 hook (scope creep made visible).

Freelancers in India find, run and bill client work inside WhatsApp. Devlancer runs on the freelancer's own WhatsApp number, invisibly. It spots gigs in busy business groups, pitches privately, sends proposals and invoices, hands the engineering to **Devin**, and keeps every client request moving, whether the freelancer is at the keyboard or asleep.

## What it does

| Stage | What happens |
|---|---|
| **Scout** | Watches marketplace groups. When a real gig fits, it reacts 👍 and replies "Check DM 🙂" in the group, then sends a tailored pitch as a **private reply** quoting the post. |
| **Propose** | Generates a proposal PDF (scope, out-of-scope, milestones, pricing, terms) and sends it in the DM. |
| **Kick off** | When the client accepts, it creates the project, drafts the 50% advance invoice with a UPI QR code, saves the spec to **Devin Knowledge**, starts a **Devin Cloud** build, and schedules weekly upkeep on **Devin Schedules**. |
| **Deliver** | When Devin finishes, the preview link and a mobile screenshot go to the client in the freelancer's voice. |
| **Maintain** | Every client message is classified (intent, scope, clarity, how checkable, human dependence, size) and routed to the right Devin surface (below). |
| **Protect** | Out-of-scope requests are never built for free: a change order PDF is drafted, and the client's "ok" turns it into an invoice. The dashboard tracks **scope creep caught (₹)**. |
| **Get paid** | Invoices are tracked through sent, part-paid, paid and overdue. "Sent the advance" in chat proposes a payment match; overdue invoices get polite reminders. |

### Routing: which Devin surface does the work

Based on Cognition's [When to use Devin](https://docs.devin.ai/essential-guidelines/when-to-use-devin): clear, checkable work under about 3 hours goes to the cloud; ambiguous or taste-heavy work needs a human.

| | Clear, checkable, small | Needs taste, access or judgement |
|---|---|---|
| **Freelancer offline** | **Devin Cloud** session on its own; client gets a natural holding reply, then the preview | **Ask Devin** (repo Q&A) writes a brief; queued for the morning; client gets an honest ETA |
| **Freelancer online** | **Devin Cloud** in parallel; freelancer reviews | **Devin CLI** opens locally with the brief on the clipboard; `/handoff` to cloud once direction is set |

## Ghost mode and control

- Runs as a **linked device** on the freelancer's number; never shows "online", types and paces like a person, writes in the freelancer's voice (learned from their sent messages), and never signs as a bot.
- The freelancer's **"Message yourself" chat is the control panel**: approval cards (`1` send, `2` edit, `0` skip) and commands. Nothing that commits money, scope or deadlines reaches a client without approval. Autopilot is opt-in per project.

### Self-chat commands

```
/groups [search]        list groups (30 most active, or matching a name)
/m 1,4   /c 2           mark marketplace groups / client groups
/scan    /gigs          rescan marketplaces / list leads
/won <lead#>            start a project from a lead
/projects   /link <slug> <group#>   /autopilot on|off <slug>
/invoice <slug> <amount> <note>     /invoices
/online   /offline   /status   /speed on|off <group#>   /help
```

## Always on

Every dependency has a fallback, so Devlancer keeps working when something is down or rate limited:

| Layer | Primary | Fallback |
|---|---|---|
| Decisions | **Laya** (`convaiinnovations/laya`, typed answers with probabilities) voting with a text model | Text model alone, then keyword rules |
| Writing | `openai/gpt-4.1-mini` via Vercel AI Gateway | Gemini 2.5 Flash Lite, gpt-5-mini, gpt-4o-mini, Llama 3.3, Mistral, then templates |
| Devin | MCP session | Auto-reconnect; tasks queue and retry every 45 seconds |
| Documents | PDF (Playwright) | Formatted WhatsApp text |
| WhatsApp | Quoted send | Plain send retry |

## Devin surfaces used

`devin_session_create` (with structured output for preview, repo and PR URLs), `devin_session_interact`, `devin_session_gather`, `devin_knowledge_manage`, `devin_schedule_manage`, `ask_wiki_question`, plus Devin CLI for hands-on work, all over the **Devin MCP server** (`https://mcp.devin.ai/mcp`).

## Stack

TypeScript on Node 22, [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp, Vercel AI SDK 7 and AI Gateway (`experimental_decide` for Laya), MCP TypeScript SDK, SQLite, Playwright for PDFs and screenshots, Hono for the live dashboard.

## Run it

```bash
npm install
npx playwright install chromium
cp .env.example .env    # add AI_GATEWAY_API_KEY, DEVIN_API_KEY (cog_ service user key), DEVIN_ORG_ID, UPI_ID
npm start               # scan the QR (terminal or http://localhost:4000/qr) with the freelancer's phone
```

Then send `/groups` in your "Message yourself" chat. The live dashboard is at http://localhost:4000.

To work on the dashboard UI without starting WhatsApp or Devin, run `npm run preview` and open http://localhost:4100. It reads the real database and never sends anything. The brand and design system live in `design/` (see `design/DESIGN.md`) and are synced to Claude Design.

For Devin to deploy previews, add a `VERCEL_TOKEN` secret in Devin (Settings > Secrets).

## Honest limits

- Baileys uses WhatsApp's unofficial web protocol; use a spare number and low volumes.
- Gmail (send documents, read payment alerts) is built in `src/gmail.ts` but switched off for the MVP.
- Laya's free tier allows 5 requests a minute, so live messages get Laya first and history scans use the fallback.
