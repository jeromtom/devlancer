import { db, getSetting } from './db.js'
import type { FeedEvent } from './bus.js'

/** Everything the dashboard shows that comes from the database. Imports nothing but the db, so it can be served without WhatsApp or Devin.
    Leads injected by test scripts (src_msg_id 'test-…') and archived projects stay off the dashboard; only real WhatsApp activity shows. */
const realLead = (t = '') => `coalesce(${t}src_msg_id, '') not like 'test-%'`

type DealRow = {
  lead_id: number | null; project_id: number | null; lead_status: string | null; project_status: string | null; title: string; client: string
  budget: string | null; preview_url: string | null; autopilot: number | null; unpaid: number; paid: number; overdue: number; created_at: number
}

const realUrl = (u: string | null) => (u && /^https?:\/\//.test(u) ? u : '')

/** Where a deal sits on the pipeline. A project counts as paid only once it is finished and nothing is owed. */
function stageOf(d: DealRow): string {
  if (d.project_id == null) return ({ new: 'gig', pitched: 'pitched', proposal_sent: 'proposal', won: 'building' } as Record<string, string>)[d.lead_status ?? ''] ?? 'gig'
  if (d.project_status === 'active') {
    if (!realUrl(d.preview_url)) return 'building'
    return d.unpaid > 0 ? 'invoiced' : 'live'
  }
  return d.unpaid > 0 ? 'invoiced' : 'paid'
}

const docTotal = (json: string) => {
  try {
    const items = (JSON.parse(json).items ?? []) as { qty: number; rate: number }[]
    return items.reduce((s, i) => s + i.qty * i.rate, 0)
  } catch {
    return 0
  }
}
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const money = (b: string) => (/^\d+(\.\d+)?$/.test(b.trim()) ? inr(Number(b)) : b)

export function board() {
  const one = (sql: string) => Number(db.prepare(sql).pluck().get() ?? 0)
  const live = `(select id from projects where status != 'archived')`
  const billing = `select project_id,
      sum(status in ('sent','part_paid','overdue')) unpaid, sum(status = 'paid') paid, sum(status = 'overdue') overdue
    from invoices group by project_id`
  const deals = (
    db
      .prepare(
        `select l.id lead_id, p.id project_id, l.status lead_status, p.status project_status, coalesce(p.name, l.title) title,
           coalesce(nullif(p.client_name, ''), l.poster_name, '') client, l.budget, p.preview_url, p.autopilot,
           coalesce(b.unpaid, 0) unpaid, coalesce(b.paid, 0) paid, coalesce(b.overdue, 0) overdue, coalesce(p.created_at, l.created_at) created_at
         from leads l left join projects p on p.lead_id = l.id left join (${billing}) b on b.project_id = p.id
         where l.status != 'skipped' and coalesce(p.status, '') != 'archived' and ${realLead('l.')}
         union all
         select null, p.id, null, p.status, p.name, p.client_name, null, p.preview_url, p.autopilot,
           coalesce(b.unpaid, 0), coalesce(b.paid, 0), coalesce(b.overdue, 0), p.created_at
         from projects p left join (${billing}) b on b.project_id = p.id
         where p.lead_id is null and p.status != 'archived'
         order by created_at desc limit 60`,
      )
      .all() as DealRow[]
  ).map(d => ({
    id: d.project_id ? `p${d.project_id}` : `l${d.lead_id}`,
    title: d.title, client: d.client, budget: money(d.budget ?? ''), stage: stageOf(d),
    overdue: d.overdue > 0, autopilot: !!d.autopilot, preview_url: realUrl(d.preview_url),
  }))
  const open = `status in ('sent','part_paid','overdue') and project_id in ${live}`
  return {
    deals,
    scopeCaught: Number(getSetting('scope_caught', '0')),
    changeOrders: one(`select count(*) from documents where kind = 'change_order' and status = 'accepted' and project_id in ${live}`),
    outstanding: one(`select coalesce(sum(amount - paid_amount), 0) from invoices where ${open}`),
    outstandingCount: one(`select count(*) from invoices where ${open}`),
    overdueCount: one(`select count(*) from invoices where status = 'overdue' and project_id in ${live}`),
    collected: one(`select coalesce(sum(amount), 0) from payments`),
    payments: one(`select count(*) from payments`),
    tasksRunning: one(`select count(*) from tasks where status in ('running','running_local') and project_id in ${live}`),
    tasks: db
      .prepare(
        `select t.id, t.request, t.route, t.status, t.devin_url, t.pr_url, t.preview_url, p.name project
         from tasks t join projects p on p.id = t.project_id
         where p.status != 'archived' and t.status != 'cancelled'
         order by t.status in ('running','running_local','queued','blocked') desc, t.id desc limit 50`,
      )
      .all(),
    projects: db
      .prepare(`select id, slug, name, client_name, preview_url, autopilot from projects where status != 'archived' order by id desc limit 50`)
      .all()
      .map(p => ({ ...(p as Record<string, unknown>), preview_url: realUrl((p as { preview_url: string | null }).preview_url) })),
    invoices: db
      .prepare(
        `select d.number, p.name, i.amount, i.paid_amount, i.status from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id
         where p.status != 'archived' order by i.id desc limit 50`,
      )
      .all(),
  }
}

/** Activity rebuilt from the database, so the feed survives restarts. Oldest first, like the live feed. */
export function history(before = Date.now(), limit = 100): FeedEvent[] {
  const ev: FeedEvent[] = []
  const groups = new Map((db.prepare(`select jid, name from chats`).all() as { jid: string; name: string }[]).map(c => [c.jid, c.name]))
  for (const l of db.prepare(`select * from leads where created_at < ? and ${realLead()}`).all(before) as Record<string, any>[]) {
    const fit = l.fit != null ? `, fit ${Math.round(l.fit * 100)}%` : ''
    ev.push({ ts: l.created_at, kind: 'gig', text: `Gig in ${groups.get(l.chat_jid) || 'a marketplace group'}: ${l.title}${l.budget ? `, ${money(l.budget)}` : ''}${fit}` })
  }
  for (const d of db
    .prepare(
      `select d.*, p.name project, i.status inv_status from documents d left join projects p on p.id = d.project_id left join invoices i on i.document_id = d.id
       where d.created_at < ? and coalesce(p.status, '') != 'archived'`,
    )
    .all(before) as Record<string, any>[]) {
    const total = docTotal(d.data_json)
    const amt = total ? `: ${inr(total)}` : ''
    if (d.kind === 'proposal') ev.push({ ts: d.created_at, kind: 'proposal', text: `Proposal ${d.number} drafted${amt}` })
    else if (d.kind === 'change_order') ev.push({ ts: d.created_at, kind: 'scope', text: `Out-of-scope request on ${d.project ?? 'a project'} priced as ${d.number}${amt}${d.status === 'void' ? ' (withdrawn)' : ''}` })
    else {
      const state = ({ draft: 'drafted', sent: 'sent', part_paid: 'sent, part paid', paid: 'sent and paid', overdue: 'overdue' } as Record<string, string>)[d.inv_status ?? d.status] ?? 'drafted'
      ev.push({ ts: d.created_at, kind: 'invoice', text: `Invoice ${d.number} for ${d.project ?? 'a project'}${amt}, ${state}` })
    }
  }
  const routeName: Record<string, string> = { cloud: 'Devin Cloud', cli: 'Devin CLI', queued: 'Queued for you' }
  for (const t of db
    .prepare(
      `select t.*, p.name project from tasks t join projects p on p.id = t.project_id
       where t.created_at < ? and p.status != 'archived' and t.status != 'cancelled'`,
    )
    .all(before) as Record<string, any>[]) {
    ev.push({
      ts: t.created_at, kind: t.kind === 'kickoff' || /^build first version$/i.test(t.request) ? 'devin' : 'task',
      text: /^build first version$/i.test(t.request) ? `Devin started the first version of ${t.project}` : `Request on ${t.project}: "${t.request}"`,
      route: routeName[t.route] ?? t.route ?? undefined, url: t.pr_url || t.devin_url || undefined,
    })
  }
  for (const p of db.prepare(`select * from payments where ts < ?`).all(before) as Record<string, any>[])
    ev.push({ ts: p.ts, kind: 'payment', text: `Payment of ${inr(p.amount)} recorded from ${p.source}${p.ref ? `: "${p.ref}"` : ''}` })
  return ev.filter(e => e.ts).sort((a, b) => a.ts - b.ts).slice(-limit)
}
