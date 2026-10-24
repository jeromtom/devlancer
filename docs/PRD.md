# Devlancer PRD

> Devlancer: your freelance dev that finds the gig, builds it, and keeps the client happy.

**Event:** Devin Hacks Kochi, 24-25 October 2026 (solo, 12 hours, ends 06:00)
**Primary track:** 1. Kill the Busywork. **Secondary hook:** 2. Make the Invisible Visible (scope creep and unpaid invoices).
**Status:** Draft v0.2

---

## 1. Problem

Freelance developers in India find, run, bill and maintain client work almost entirely inside WhatsApp, with email on the side.

- Gig leads get lost in busy multi-business groups with hundreds of messages a day, and the first freelancer to reply usually wins.
- Writing proposals and invoices is slow, repetitive admin.
- Client change requests arrive at all hours, mixed with chatter, sometimes for several projects in one group.
- Scope creep goes unbilled and invoices go unchased.
- When the freelancer is asleep or busy, clients wait.

## 2. Solution

Devlancer runs **as the freelancer, on the freelancer's own WhatsApp number**, invisibly (ghost mode). Devin does the engineering. The freelancer's **"Message yourself" chat** is the control panel.

1. **Onboard:** on first connect, scan recent group history, find gigs that fit, and report them in the self-chat.
2. **Scout:** detect new gigs in marketplace groups, react or reply "Check DM" in the group, and send the full pitch privately to the poster.
3. **Propose:** generate a proposal PDF in the freelancer's format, send it on WhatsApp and/or Gmail.
4. **Kickoff and build:** turn the agreed chat into a spec, Devin builds, and the preview goes to the client.
5. **Maintain:** client messages become classified tasks, routed to the right Devin surface depending on presence and how much human judgement the task needs.
6. **Bill:** change orders and milestones become invoices; payments are tracked and chased.

## 3. Users

| User | Needs |
|---|---|
| **Freelancer** (one per install) | More gigs won, less admin, control over anything sent in their name |
| **Client** | Fast replies, professional documents, visible progress, no new app. Should feel they are talking to the freelancer. |
| **Gig poster** in marketplace groups | A quick, relevant, private response |

## 4. Goals, non-goals, anti-goals

**Goals (tonight)**
- One end-to-end live demo: gig post, "Check DM" plus private pitch, proposal PDF, Devin build, preview link in the client group, change request, Devin fix, change order, invoice PDF.
- Show surface routing: the same kind of request handled differently when the freelancer is online versus offline.
- Show the Gmail link: proposal or invoice emailed with the PDF attached.

**Non-goals**
- Multiple freelancers, online payment collection, GST filing, the official WhatsApp Cloud API, production hardening.

**Anti-goals (a failure even if it works)**
- **Breaking ghost mode:** anything that reveals a bot (signatures, "As an AI", instant replies at 3 AM, robotic tone).
- Sending anything that commits money, scope or deadlines without the freelancer's approval.
- Spamming marketplace groups with long pitches (only a reaction or a short "Check DM").
- Leaking one client's details into another client's chat.
- Getting the freelancer's real number banned.

## 5. Core concepts

| Concept | Definition |
|---|---|
| **Self-chat** | The freelancer's "Message yourself" chat. Devlancer posts notifications and approval cards here; the freelancer replies with numbers or commands. Devlancer tracks the IDs of messages it sent, so it never treats its own messages as commands. |
| **Marketplace group** | A group with many businesses where gigs are posted. Devlancer never posts pitches here; it only reacts or replies "Check DM". |
| **Client group / client DM** | Where project work happens. Devlancer writes as the freelancer. |
| **Lead** | A detected gig: source message, poster, extracted details, fit score, status (new, pitched, proposal_sent, won, lost). |
| **Project** | Client work with repo, spec, preview URL, proposal, invoices and Devin knowledge. **One chat can hold many projects; a project belongs to one chat.** |
| **Task** | An actionable request with a route and a status. |
| **Presence** | `online` or `offline`, set from the self-chat or by schedule (for example offline 23:00-08:00). |
| **Voice profile** | A short style guide built from the freelancer's past sent messages (language mix, greetings, emoji use, length), used for every draft so ghost replies sound like them. |

### Chat to project attribution

1. Explicit tag (`#bakery`) or reply to a message already linked to a project wins.
2. Otherwise a Laya choice question over the chat's active projects plus `none`.
3. If the top probability is under **0.7** [tune], ask the freelancer in the self-chat rather than the client, to keep ghost mode intact.

## 6. Functional requirements

### 6.1 WhatsApp layer (Baileys, freelancer's own number)

- Link as a companion device via QR (the phone keeps working normally). Persist auth state and auto-reconnect.
- Receive group and private messages, including the history sync on first link.
- Send text, images, documents (PDF), reactions and quoted replies, including **private replies** (a DM that quotes the original group message, like WhatsApp's "Reply privately").
- **Human pacing:** typing indicator, delay proportional to message length, and queueing of non-urgent replies outside the freelancer's usual hours.
- Global outbound rate limit.

### 6.2 Onboarding (first connect)

1. Freelancer scans the QR code.
2. Devlancer greets them in the self-chat and asks three things: skills, typical rates, and which groups are marketplaces versus clients (it lists groups as a numbered menu).
3. It scans the last [7] days of marketplace history and posts the matching gigs to the self-chat, ranked by fit, with links to the original messages.
4. It builds the voice profile from the freelancer's recent sent messages.
5. Optional: upload a proposal template (PDF or DOCX sample) and a logo in the self-chat; otherwise the default template is used.

### 6.3 Scout

- For each marketplace message, Laya decides `is_gig`, `fit` (0-1 against skills) and `category`.
- If it's a gig with `fit` over 0.6, the text model extracts title, budget, deadline and poster, and drafts:
  - a **group action**: a reaction (👍) or a short reply ("Check DM 🙂") quoting the post;
  - a **private pitch**: a private reply to the poster with a tailored pitch plus 1-2 relevant past works.
- Self-chat card: "Gig: Bakery website, ₹15k, 1 week, fit 0.82. `1` send, `2` edit, `3` send plus proposal PDF, `0` skip."
- **Speed mode** (optional, per marketplace group): auto-send the reaction plus pitch for fit over 0.85, because the first reply often wins.

### 6.4 Proposal PDF

- Generated from the lead plus the conversation with the poster.
- **Format:** the freelancer's own template if provided; otherwise a default with cover, understanding of the need, scope and deliverables, out-of-scope list, timeline with milestones, pricing table, payment terms (for example 50% advance, 50% on delivery), validity, and contact plus signature.
- The text model fills structured JSON, which is rendered with an HTML template and turned into a PDF (headless Chromium).
- Approval card in the self-chat with the PDF attached. On approval, send via WhatsApp DM and/or Gmail.
- The accepted proposal becomes the project **spec baseline** for scope checks.

### 6.5 Kickoff and build

- Triggered when Laya detects acceptance ("ok let's go", "done, sending advance") or by the self-chat command `/won <lead>`.
- Project created; spec and client preferences written to Devin Knowledge; **advance invoice** drafted (6.8).
- Devin Cloud session with the **Kickoff playbook**: create repo from template, build, deploy a Vercel preview, open a PR, report the URL.
- Preview link plus screenshot sent to the client in the freelancer's voice after approval.

### 6.6 Maintain (change requests)

For each client message attributed to a project, Laya decides:

| Question | Type |
|---|---|
| `intent` | choice: change_request, bug_report, question, approval, payment_claim, chatter |
| `in_scope` | boolean against the accepted proposal |
| `clarity` | score |
| `verifiable` | score |
| `human_dependence` | score: taste, negotiation, credentials, prod data, missing context |
| `size_ok` | boolean: under ~3 hours |

- `chatter` is ignored. `approval` closes the task and merges after self-chat confirmation.
- `question` is answered via Devin `ask_question` on the repo; the draft goes to the self-chat.
- `payment_claim` ("sent the advance", payment screenshot) goes to invoice matching (6.8).
- `change_request` / `bug_report` goes to scope check, then routing.
- Unclear requests get a drafted clarifying question in the freelancer's voice.

### 6.7 Surface routing

| | **Low human dependence** (clear, verifiable, small) | **High human dependence** |
|---|---|---|
| **Offline** | **Devin Cloud session** runs on its own. The client gets a natural holding reply at a plausible time; the PR plus preview wait in the self-chat (or are auto-shared if the project has autopilot on). | **Ask Devin** scopes it and writes a brief. Queued for the morning; the self-chat gets the brief; the client gets a holding reply. |
| **Online** | **Devin Cloud session** in parallel; the freelancer reviews from the self-chat. | **Devin CLI** opens on the freelancer's machine with the brief preloaded; `/handoff` to cloud once the direction is clear. |

- Oversized tasks are split by Ask Devin into parallel sessions (`devin_session_gather`).
- Every PR goes through **Devin Review with Auto-Fix**.

### 6.8 Scope protection and invoices

**Scope:** if `in_scope` is false, nothing is built. A **change order** (description, estimate, price at the freelancer's rate) is drafted to the self-chat and, once approved, sent to the client. Client acceptance adds it to the spec and to the next invoice.

**Invoices:**
- Types: advance, milestone, change order, final, and monthly maintenance retainer.
- PDF from the same render pipeline: invoice number (`DL-2026-001`), freelancer and client details, line items, total, due date, **UPI QR code and payment link**, bank details. GST fields only if the freelancer is registered [confirm].
- Sent through WhatsApp and/or Gmail after approval.
- Status: draft, sent, part-paid, paid, overdue.
- **Payment matching:** a client `payment_claim` on WhatsApp, or a bank/UPI credit alert in Gmail, is matched by amount and client to an open invoice and proposed as paid in the self-chat.
- **Chasing:** polite reminders at due date, plus 3 and plus 7 days, in the freelancer's voice, each needing approval (or auto-sent if enabled).
- Self-chat command `/invoices` lists outstanding amounts by client.

### 6.9 Gmail

- OAuth connect (Gmail API, scopes `gmail.send` and `gmail.readonly`) from the onboarding link.
- **Send:** proposals, invoices and change orders from the freelancer's Gmail with the PDF attached, threaded per client.
- **Read:**
  - client emails from known client addresses go through the same classifier and project attribution as WhatsApp;
  - payment alerts (bank, UPI apps, Razorpay) feed invoice matching;
  - gig leads from email (Upwork or job-board alerts) go through Scout [stretch].
- Every inbound email that needs attention is summarised in the self-chat.

### 6.10 Upkeep

- Per-project **Devin Schedule**: weekly dependency update, broken-link check, Lighthouse run, and a short client update drafted to the self-chat.
- A daily 9 AM self-chat digest: new gigs, overnight Devin work, PRs waiting, invoices outstanding and overdue, scope creep caught.

### 6.11 Self-chat commands

`/online`, `/offline`, `/status`, `/gigs`, `/won <lead>`, `/project list`, `/invoice <project> <amount> <note>`, `/invoices`, `/autopilot on|off <project>`, `/speed on|off <group>`, numeric replies to cards, and free text ("send Ravi the final invoice"), which the text model parses into a command.

### 6.12 Dashboard (minimal, for the demo)

A single page with leads, projects, a live task feed with route badges (Cloud / CLI / Queued / Blocked-scope), invoices with status, and counters: **gigs pitched, scope creep caught (₹), outstanding (₹), collected (₹)**.

## 7. Devin surface map

| Surface | Used for |
|---|---|
| **Devin MCP** (`mcp.devin.ai/mcp`) | Single integration point |
| `devin_session_create` / `interact` / `events` / `gather` | Kickoff builds, change requests, parallel sub-tasks, progress |
| `devin_playbook_manage` | `Kickoff`, `ChangeRequest`, `Upkeep` playbooks |
| `devin_knowledge_manage` | Per-project spec, accepted proposal, change orders, client preferences |
| `devin_schedule_manage` | Weekly upkeep per project |
| `ask_question` | Answering client questions from the repo; estimating change orders |
| **Ask Devin** | Briefs for high-human-dependence and oversized tasks |
| **Devin CLI** | Online plus high-human-dependence work, `/handoff` to cloud |
| **Devin Review + Auto-Fix** | Every PR |

## 8. AI models

| Model | Role |
|---|---|
| **Laya** (`convaiinnovations/laya`, `experimental_decide`) | All decisions: is_gig, fit, category, intent, attribution, in_scope, clarity, verifiable, human_dependence, size_ok, acceptance, payment-claim and email triage. 8K context, so send the spec summary plus recent messages only. |
| **Text model** via AI Gateway [choose] | Pitches, proposals (JSON), change orders, invoices' line text, client replies in the voice profile, command parsing, email summaries. |

## 9. Architecture

```
WhatsApp (Baileys, own number) ─┐                         ┌─> Devin MCP client
Gmail API ──────────────────────┼─> Ingest ─> Laya ─> Router ─┤
                                │                         ├─> Docs (proposal / invoice PDF)
                                │                         └─> Drafts (text model, voice profile)
Self-chat <─── Outbox (human pacing, approvals) <───────────┘
                         │
          SQLite (chats, leads, projects, messages, tasks, invoices, approvals)
                         │
                Dashboard (single page, SSE)
```

- **Runtime:** Node 20+, TypeScript, one process.
- **Packages:** `baileys` [confirm current package name], `ai`, `@modelcontextprotocol/sdk`, `googleapis`, `playwright` (HTML to PDF), `qrcode` (UPI QR), `better-sqlite3`, `hono`.
- **Secrets:** `AI_GATEWAY_API_KEY`, `DEVIN_API_KEY` (`cog_` service user key), Google OAuth client ID and secret.

## 10. Data model (SQLite)

- `chats(id, wa_jid, name, kind[marketplace|client|self], speed_mode)`
- `leads(id, chat_id, src_msg_id, poster_jid, title, budget, deadline, fit, status)`
- `projects(id, chat_id, lead_id, slug, name, client_name, client_email, repo_url, preview_url, spec, autopilot, status)`
- `messages(id, source[wa|gmail], ext_id, chat_id, sender, text, ts, project_id, intent, scores_json)`
- `tasks(id, project_id, source_msg_ids, kind, in_scope, route, devin_session_id, pr_url, status)`
- `documents(id, project_id, kind[proposal|change_order|invoice], number, data_json, pdf_path, status, sent_via)`
- `invoices(id, document_id, amount, due_date, paid_amount, status)`
- `payments(id, invoice_id, source[wa|gmail|manual], amount, ref, ts)`
- `approvals(id, kind, payload_json, status, self_msg_id)`
- `settings(presence, schedule, skills_profile, rates, voice_profile, business_details, upi_id)`

## 11. Demo script (about 4 minutes)

Two phones: the **freelancer** (Devlancer linked) and a **client**.

1. **Onboard (30s):** show the self-chat after linking: "Found 3 gigs that fit you in the last 7 days."
2. **Scout (40s):** the client phone posts in "Kochi Business Network": "Need a website for my bakery, ₹15k." Within seconds the post gets a 👍 and "Check DM 🙂"; the client's DM receives a private reply with a tailored pitch.
3. **Proposal (30s):** tap `3`, a proposal PDF lands in the client's DM and in their Gmail.
4. **Kickoff (45s):** the client replies "Let's do it." The advance invoice PDF with UPI QR is sent; Devin Cloud builds (pre-warmed); the preview link arrives in the client group.
5. **Offline change (30s):** `/offline`. "Can you make the button green and add our number?" Cloud session, holding reply, then the updated preview.
6. **Scope creep (30s):** "Also add online payments and delivery tracking." Flagged; change order PDF for ₹8,000 [example]; dashboard counter goes up.
7. **Close (15s):** dashboard: pitched, won, collected, outstanding, scope creep caught.

Online plus Devin CLI routing is shown as a 10-second clip if time is short.

## 12. Build plan (from about 00:30 to 06:00)

| Time | Milestone |
|---|---|
| 00:30-01:15 | Scaffold, Baileys link, receive/send, self-chat command loop, SQLite |
| 01:15-02:00 | Laya classifiers plus text drafts; Scout with reaction, "Check DM" and private reply |
| 02:00-02:45 | PDF pipeline (proposal plus invoice with UPI QR), send as WhatsApp document |
| 02:45-03:45 | Devin MCP: Kickoff session, watch, PR plus preview back to the group; change-request routing |
| 03:45-04:15 | Scope check plus change order plus invoice status |
| 04:15-04:45 | Gmail send with attachment (read and payment matching as stretch) |
| 04:45-05:15 | Dashboard, onboarding history scan |
| 05:15-06:00 | Rehearse, record backup video, README, submit |

**Cut order if late:** Devin Schedules, Gmail reading and payment matching, Devin CLI launch (show as a clip), voice profile (use a fixed style prompt), dashboard (use the self-chat as the visible feed).

## 13. Risks and open questions

| Item | Note |
|---|---|
| **Ban risk on the real number** | Unofficial protocol on the freelancer's own number is riskier than a spare SIM. For the demo, use a secondary number acting as "the freelancer". Human pacing and low volume in production. |
| **Ghost mode ethics** | Clients do not know an AI drafts the replies. Mitigated by approval-first defaults; autopilot is opt-in per project. [Decide how to present this to judges.] |
| Proposal format | [Share your own proposal template, or use the default.] |
| Invoice details | [Business name, address, UPI ID, GST registered or not.] |
| Google OAuth | Unverified app works for your own account as a test user; set up the consent screen early. |
| Devin session latency | Pre-warm, tiny demo app, backup video. |
| Laya pricing and limits | [Check Boundless pricing.] 8K context. |
| Devin CLI automation | [Verify how to start it with a preloaded prompt.] |
| Hackathon rules | [Check submission format and judging criteria.] |
| "Devin" in the product name | [Check with organisers.] |
