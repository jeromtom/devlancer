# Devlancer: 4-minute demo script

**Cast.** Phone A is the freelancer (Devlancer is linked to it; the self-chat is the control panel). Phone B is the client. A laptop shows the dashboard at https://devlancer.rexindynamics.com and a Devin session tab.

**One-line pitch.** "Devlancer is your freelance dev that finds the gig, builds it, and keeps the client happy, all inside WhatsApp, with Devin doing the engineering."

## Pre-demo checklist

| Check | How |
|---|---|
| Health green | `https://devlancer.rexindynamics.com/healthz` shows `"ok": true, "whatsapp": true, "devin": true` |
| Both phones in the group | Phone A and Phone B are members of "Gig Posting Group", and it is marked as a marketplace (`/groups`, then `/m <n>`) |
| Presence | Send `/online` from Phone A; `/status` shows Devin connected |
| Devin credits | Enough session credits in the Devin organisation for 2-3 sessions |
| Vercel | `VERCEL_TOKEN` secret is set in Devin, so sessions can deploy |
| GitHub | `gh` is authenticated on the VM (repo creation) |
| Dashboard | Logged in on the laptop, live feed open |
| Gig text ready | The client message below copied on Phone B |
| Backup | Backup screen recording of the full flow on the laptop |

## Script

| Time | On screen | Say |
|---|---|---|
| **0:00** | Dashboard | "Freelancers in India run their whole business in WhatsApp groups. Leads get buried, admin piles up, scope creep goes unbilled. Devlancer runs on my own number, invisibly." |
| **0:20** | Phone B posts in "Gig Posting Group": *"Need a simple website for my bakery in Kochi, menu, location and WhatsApp order button. Budget 15k, 1 week."* | "A client posts a gig in a marketplace group." |
| **0:35** | Phone A self-chat: gig card with fit score and drafted pitch. Dashboard feed: "Gig in Gig Posting Group". | "Laya classified it as a gig that fits my skills and drafted a pitch in my voice. Nothing goes out without me." |
| **0:50** | Reply `3` on Phone A. Group shows 👍 and "Check DM 🙂"; Phone B gets the private pitch quoting the post, then the proposal PDF. | "One tap: a reaction and 'Check DM' in the group, the real pitch privately, plus a proposal PDF with scope, milestones and a 50/50 split." |
| **1:15** | Phone B replies in DM: *"Looks good, let's start."* Phone A gets the acceptance card. Reply `1`. | "The client accepts. I approve the start." |
| **1:30** | Self-chat: project created, advance invoice card (with UPI QR in the PDF). Dashboard: GitHub repo created, "Devin Cloud session started". Open the Devin session tab. | "Devlancer creates the repo with gh, saves the spec to Devin Knowledge, drafts the advance invoice, and starts a Devin Cloud session that builds and deploys to Vercel. Weekly upkeep is scheduled too." |
| **2:00** | When Devin finishes: delivery card with preview link, PR and phone screenshot. Reply `1`; Phone B receives the screenshot and link. | "Devin reports a structured preview URL. Devlancer screenshots it and sends it to the client, in my voice." |
| **2:25** | Phone A: `/offline`. Phone B: *"Can you add our opening hours, 8 am to 9 pm, to the footer?"* Phone B gets a natural holding reply; dashboard shows route "Devin Cloud". When it finishes, a delivery card arrives with the PR and preview (or it goes straight to the client with `/autopilot on <slug>`). | "I go offline. A small, clear change: Devlancer routes it to Devin Cloud on its own. Presence times human dependence decides the surface. With me online and a taste-heavy request, it would open Devin CLI with a brief instead." |
| **2:50** | Phone B: *"Also add online payments and a delivery tracking app."* Phone B gets a holding reply; Phone A gets a change order card with PDF. | "That is scope creep. Instead of doing it free, Devlancer prices it as a change order at my hourly rate. The dashboard counts scope caught." |
| **3:15** | Reply `1` to send the change order. Phone B: *"Ok, approved."* New invoice card appears. | "The client approves, the spec is updated, an invoice is drafted, and the work goes to Devin." |
| **3:30** | Phone A: `/paid INV-2026-001` (or `/paid all`). Dashboard KPIs: collected goes up. | "Payments are simulated tonight: I mark the invoice paid from the self-chat, and the client gets a thank-you." |
| **3:45** | Dashboard pipeline and feed | "Gig found, pitched, built, delivered, protected from scope creep, and billed, all from my own WhatsApp. That is Devlancer." |

Invoice numbers run in sequence (`INV-2026-001`, `INV-2026-002`, ...); check `/invoices` for the exact number before the demo.

## If Devin is slow

| Situation | Line and action |
|---|---|
| Build still running at 2:00 | "Devin is building a real app and deploying it to Vercel, that takes a few minutes. Here is the live session." Show the Devin tab, then continue with the change request and change order, and return to the delivery card at the end. |
| Session failed to start | "Devin is busy, so Devlancer queued the task and retries automatically." Point at the feed entry "Queued", carry on. |
| Devin blocked | "When Devin is stuck it tells me, never the client. I answer with /devin from WhatsApp." Show the blocked card. |
| WhatsApp disconnects | Open `/qr`, relink from Phone A, or switch to the backup recording. |
| Change routed to "Queued for human" | The message hit a human-judgement keyword (colour, logo, login, domain and so on). Say: "That one needs my taste, so it waits for me with a brief", and use a plainer request. |
| Anything else | Play the backup recording from the current step and narrate. |
