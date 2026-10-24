# Devlancer architecture

One Node process (`src/index.ts`) holds a WhatsApp Web session, a Devin MCP client, a SQLite database, a PDF renderer and a small dashboard server. All message handling is serialised through one job queue, with a 2-minute timeout per job, so approvals and classifications never interleave.

## Diagram

```
  Marketplace groups     Client DMs / groups      "Message yourself"        Gmail
          |                      |                  (control panel)            |
          +----------------------+-----------------------+                    |
                                 |                                            |
                    WhatsApp Web (Baileys)  src/wa.ts               poll 60s  src/gmail.ts
                    store every message in SQLite                             |
                                 |                                            |
                         route()  src/index.ts  <-----------------------------+
          +----------------------+-----------------------+
          |                      |                       |
   marketplace msg        lead DM / client msg      self-chat
   src/scout.ts           src/scout.ts              src/control.ts
          |               src/projects.ts           (commands, approval cards)
          |                      |                       |
          +-----------+----------+                       |
                      v                                  |
          AI layer  src/ai.ts                            |
          Laya (experimental_decide) + text model        |
          ensemble -> fallback chain -> rules            |
                      |                                  |
                      v                                  |
          Router (presence x human dependence)           |
          +-----------+-------------+--------------+     |
          |           |             |              |     |
     Devin Cloud   Devin CLI    Queued brief   Documents |
     src/devin.ts  (brief +     (for morning)  src/billing.ts
     MCP sessions  clipboard)                  src/docs/ (Playwright PDFs)
          |                                        |     |
          v                                        v     v
     watcher (45s): status, structured output    Outbox: approval card in self-chat
     -> screenshot -> deliver card               -> on "1": send to client (WhatsApp, Gmail)
          |
          v
     SQLite  data/devlancer.db  <---  feed() events on an EventEmitter  src/bus.ts
          |                                  |
          v                                  v
     Dashboard  src/dashboard.ts, src/board.ts, web/   (Hono, basic auth)
     /api/state (board + history)   /events (SSE live feed)   /qr   /healthz
```

## Components

| File | Role |
|---|---|
| `src/index.ts` | Boot, single-instance takeover (pid file), message router, job queue, timers (Devin watcher 45s, Gmail 60s, overdue chase 6h, local upkeep 15 min) |
| `src/wa.ts` | Baileys connection, QR, history sync (last 7 days), message storage, human-paced sending, reactions, PDFs to chats, `notify()` to the self-chat |
| `src/control.ts` | Approval cards (`ask`), reply parsing (number, quote, `#id n`, edit mode), command registry (`onCommand`), presence |
| `src/scout.ts` | Gig detection, pitch drafting, ghost pitch (react + "Check DM" + private reply), lead DMs, history scan, group commands |
| `src/projects.ts` | Project start, GitHub repo via `gh`, Devin kickoff, session watcher, delivery with screenshot, client message classification and routing, briefs, Devin CLI launch |
| `src/billing.ts` | Proposals, invoices (UPI QR), change orders, payment matching, overdue reminders |
| `src/docs/` | HTML templates and Playwright PDF rendering |
| `src/ai.ts` | Laya decisions, ensemble merge, text model chain, voice guide, rules |
| `src/devin.ts` | Devin MCP client: sessions, Knowledge, Schedules, `ask_wiki_question`; reconnects once on transport errors |
| `src/gmail.ts` | Gmail OAuth, reading new mail, sending PDFs by email |
| `src/bus.ts` | In-memory live feed (last 200 events) on an EventEmitter |
| `src/board.ts` | Dashboard data from SQLite only: pipeline deals, KPIs, tasks, invoices, history feed |
| `src/dashboard.ts`, `src/ui.ts`, `web/` | Hono server, basic auth, SSE, static UI using `design/` tokens and components |

## Data flow in brief

1. **Ingest.** Every WhatsApp message (and new Gmail message) is stored in `messages`. Messages Devlancer sent itself are never treated as commands.
2. **Route.** Self-chat goes to the control panel. Marketplace groups go to the scout. DMs and groups linked to an active project go to project handling. DMs from pitched leads go to lead handling.
3. **Decide.** `src/ai.ts` returns typed scores. Laya is tried first within its rate budget, with the text model in parallel for the ensemble; on failure, the text model, then rules.
4. **Act.** The router picks a Devin surface or a document. Anything client-facing is drafted and placed as an approval card in the self-chat (the outbox), except holding replies when offline and autopilot deliveries.
5. **Watch.** The watcher retries queued Devin tasks and polls running sessions. Finished sessions produce a delivery card with preview, PR and screenshot; sessions without a deliverable are marked blocked.
6. **Show.** Each step calls `feed()`, which logs, keeps the last 200 events and pushes them over SSE to the dashboard.

## SQLite tables

| Table | Holds |
|---|---|
| `chats` | Every group and chat: name, kind (`marketplace`, `client`, `ignore`, `unknown`), speed mode |
| `leads` | Detected gigs: source message, poster, title, budget, deadline, category, fit, pitch, status (`new`, `pitched`, `proposal_sent`, `won`, `skipped`) |
| `projects` | Slug, client, chat, repo and preview URLs, spec, autopilot, local upkeep flags, status |
| `messages` | All stored WhatsApp and Gmail messages, with intent and scores once classified |
| `tasks` | Work items: kind (`kickoff`, `change`, `upkeep`), route (`cloud`, `cli`, `queued`), Devin session and URLs, PR, preview, status, prompt, attempts |
| `documents` | Proposals (`PR-`), change orders (`CO-`), invoices (`INV-`): data JSON, PDF path, status, sent via |
| `invoices` | Amount, due date, paid amount, status (`draft`, `sent`, `part_paid`, `paid`, `overdue`) |
| `payments` | Recorded payments with source and reference |
| `approvals` | Approval cards: kind, payload, status, self-chat message id |
| `settings` | Presence, onboarding, document number sequences, group listing, scope creep total, Gmail cursor |

## Dashboard

- `GET /` serves `web/index.html` and `web/app.js`, styled with `design/tokens.css`, `fonts.css` and `components.css`.
- `GET /api/state` returns stats (presence, Devin and Gmail status, pipeline, KPIs, tasks, projects, invoices) and the feed (history rebuilt from the database plus live events since boot).
- `GET /events` is a Server-Sent Events stream: each `feed` event carries the event and fresh stats; a ping every 15 seconds keeps it open.
- `GET /qr` shows the WhatsApp link code; `GET /healthz` returns `{ ok, whatsapp, devin }` without auth.
- When `DASHBOARD_PASSWORD` is set, everything except `/healthz` and the Google OAuth callback sits behind basic auth.
