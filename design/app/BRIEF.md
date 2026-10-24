# Devlancer screens: brief for every designer

You are designing high-fidelity HTML screens for Devlancer, to live in Claude Design. Read these first, in order:

1. `../DESIGN.md` (brand), `tokens.css`, `kit.css` (every component class you should use), `shell.js` (sidebar, icons, command bar).
2. The two reference screens: `today.html` and `approvals.html`. They set the bar. Match their structure, density, tone and level of real detail.
3. `../../docs/PRD.md` for what the product does (sections 5 and 6 especially).

## What Devlancer is

A ghost freelance developer that runs on the freelancer's own WhatsApp number. It spots gigs in WhatsApp marketplace groups, pitches privately, sends proposal PDFs, hands the engineering to Devin (Cognition's AI engineer), keeps client requests moving while the freelancer sleeps, prices out-of-scope requests as change orders, and chases invoices. Nothing that commits money, scope or deadlines goes out without approval. The user is one Indian freelance developer (Jerom, Kochi). Clients never know a bot is involved.

## The standard: not "AI-made"

- Real, specific content everywhere. Names, amounts in ₹ with Indian grouping (₹1,25,000), times, WhatsApp group names, actual client wording (casual Indian English, light Manglish, emoji the way real clients use them). Never lorem ipsum, never "Project A".
- Highly usable: obvious primary action per screen, keyboard hints where the user repeats an action, dense but calm tables, filters that match real questions ("Overdue", "Waiting on client"), sensible empty and edge states.
- Avoid template tells: no row of identical KPI cards (use the `.facts` strip or a written summary), no tinted icon squares in lists, no gradient decoration, no ALL CAPS labels, no eyebrow labels above every heading, no middle-dot separators (use commas), no arrows appended to link text, no numbered 01/02/03 markers unless it is a real sequence (onboarding steps are one).
- Absolutely no em dashes or en dashes in any text. Use commas, colons, parentheses or "to". Hyphens only inside number ranges (10-15) or compound words.
- Sentence case for everything. Plain verbs on buttons ("Send change order", "Mark as paid"). An action keeps its name through the flow.
- One memorable idea per screen, the rest quiet.

## Building rules

- Each screen is one standalone HTML file in this folder (`design/app/`). Start from this skeleton exactly:

```html
<!-- @dsCard group="Screens" -->
<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gigs | Devlancer</title>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="kit.css">
<style>/* screen-specific CSS only; reuse kit classes first */</style>
</head>
<body data-page="gigs">
<div class="app"><main class="main"><div class="page">
  ...
</div></main></div>
<script src="shell.js"></script>
</body>
</html>
```

- `data-page` must be one of: today, approvals, gigs, pipeline, projects, clients, devin (Requests), upkeep, invoices, scope, groups, settings. Detail pages use their parent (project.html uses projects, request.html uses devin, invoice.html and proposal.html use invoices, onboarding uses none). Add `data-presence="online"` on body only if the screen should show the online state.
- Icons: `<svg class="i"><use href="#i-NAME"/></svg>` (add class `sm` for 15px). Names are the keys of ICONS in `shell.js`. Do not invent icons that aren't there; add none of your own.
- Use the kit: `.page-head`, `.crumbs`, `.tabs`, `.toolbar`, `.search`, `.seg`, `.btn` variants, `.st` (hex status glyph + word: the product's status language), `.tag`, `.avatar` (hex), `.fit`, `.tbl-wrap .tbl`, `.list`, `.dl`, `.facts`, `.thread .msg` (WhatsApp messages, `.out`, `.draft`, `.quote`), `.tl` (timeline), `.note`, `.empty`, `.box`, `.with-aside` + `.aside`, `.grid2`, `.field`, `.input`, `.select`, `.textarea`, `.switch`, `.drawer`.
- Colour carries meaning, never decoration: blue = gigs, pitches, proposals, primary action; cyan = Devin, building, live; green = money in, paid; amber = waiting (owed, queued for you); coral = overdue, blocked, failed, out of scope.
- Desktop first at 1440 wide, but it must not break at 390 wide (stack columns, tables scroll inside `.tbl-wrap`).
- Links between screens use the real file names: today.html, approvals.html, gigs.html, pipeline.html, projects.html, project.html, clients.html, requests.html, request.html, upkeep.html, invoices.html, invoice.html, scope.html, proposal.html, groups.html, settings.html, onboarding.html, mobile.html, states.html.

## Shared facts (keep every screen consistent)

Freelancer: Jerom, freelance developer in Kochi. Rate ₹1,500 an hour. UPI jerom@okhdfc. Skills: web apps, WhatsApp bots, dashboards, Next.js, Supabase. Today is Saturday 25 October 2026, 8:12 am. Jerom was away 11:00 pm to 8:00 am.

Marketplace groups: Kochi Freelancers (412 members), Kochi Business Network (1,180), Kerala Startups Hub (860), Ernakulam Traders Circle (240, marked ignore). Speed mode on for Kochi Freelancers.

Projects (slug, client, status):
- `homestay` Homestay booking site, Thomas K J (Thekkady Hills Homestay), ₹48,000, building, milestone 2 due Mon 27 Oct, invoice INV-2026-002 ₹16,000 part paid ₹8,000 (₹8,000 UPI just matched, pending approval). Request running: gallery with 12 room photos (Devin Cloud, 38 min).
- `tuition` Tuition centre app, Lakshmi R (Tuition Centre Kakkanad), ₹36,000, preview live, autopilot ON. Malayalam toggle shipped 2:14 am (PR #14). Fee calculator rounding fix running in Devin CLI. Change order CO-2026-003 online fee payments ₹10,000 pending approval. INV-2026-003 ₹12,000 sent, due 30 Oct. CO-2026-001 extra report page ₹8,000 accepted and billed earlier.
- `boutique` Boutique catalogue, Fathima S (Fab by Fathima), ₹44,000, invoiced, INV-2026-004 ₹22,000 overdue 6 days (due 19 Oct), first reminder sent 22 Oct. Brand colour change request queued for Jerom (Ask Devin brief). CO-2026-002 size chart filter ₹10,000 accepted.
- `menu` Restaurant menu site, Arjun Menon (Malabar Kitchen), ₹35,000, paid in full (INV-2026-001 ₹35,000 paid 14 Oct via UPI). Weekly upkeep on.
Leads: Bakery landing page (Anu, Anu's Bakes, ₹15,000, fit 0.68, Kochi Business Network, new), WhatsApp order bot for a pharmacy (Rahul, MedPlus Edappally, ₹25,000, fit 0.86, Kochi Freelancers, pitch awaiting approval), Wedding photographer portfolio (Nikhil, ₹12,000, fit 0.71, Kerala Startups Hub, new), Clinic appointment booking site (Dr Meera, Meera's Dental Care, ₹30,000, fit 0.79, pitched), Inventory dashboard for a spice exporter (Joseph, Malabar Spice Exports, ₹60,000, fit 0.83, proposal PR-2026-005 sent, expires Wed 29 Oct), Event ticketing site (Sana, ₹40,000, fit 0.52, skipped: needs payments licence).
Money: outstanding ₹42,000 (₹22,000 overdue), collected in October ₹65,000 from 4 payments, scope creep caught ₹18,000 (CO-2026-001 ₹8,000 + CO-2026-002 ₹10,000).
Devin surfaces: Devin Cloud (clear, checkable, under ~3 h), Ask Devin (brief when it needs taste or access and Jerom is away), Devin CLI (needs judgement and Jerom is online), Knowledge (spec, accepted proposal, client preferences), Schedules (weekly upkeep). Laya is the model that reads each message (intent, in scope, clarity, checkable, needs a human, size).
Numbering: invoices INV-2026-00N, proposals PR-2026-00N, change orders CO-2026-00N.

## Check your work

A static server runs at http://localhost:4300 serving this folder. Screenshot each screen at 1440x900 (full page) and 390 wide with:

```
PW="/Volumes/Jerom SSD/Hackathon/Devin Hacks/devlancer/node_modules/playwright" node /private/tmp/claude-504/-Volumes-Jerom-SSD-Hackathon-Devin-Hacks/27a67064-3523-4d0b-9f4d-fd204573bb09/scratchpad/shot.cjs <outdir> gigs.html pipeline.html
W=390 PW=... node .../shot.cjs <outdir> gigs.html
```

It prints `ok` or the errors. Look at every screenshot, fix what is off, and look again. Before finishing, grep your files for "—", "–", " · " and fix any hit. Do not edit kit.css, shell.js, tokens.css, today.html or approvals.html; if you truly need a shared component, put it in your screen's `<style>` and mention it in your report.
