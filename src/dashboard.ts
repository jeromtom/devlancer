import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { db, getSetting } from './db.js'
import { bus, recentFeed, type FeedEvent } from './bus.js'
import { config } from './config.js'
import { lastQr } from './wa.js'
import { gmailAuthUrl, gmailCallback, gmailReady } from './gmail.js'
import { presence } from './control.js'
import { devinReady } from './devin.js'
import { mountUi } from './ui.js'

type DealRow = {
  lead_id: number | null; project_id: number | null; lead_status: string | null; title: string; client: string
  budget: string | null; preview_url: string | null; autopilot: number | null; unpaid: number; paid: number; overdue: number; created_at: number
}

/** Where a deal sits on the dashboard pipeline. Advance invoices go out at kickoff, so billing only counts once the preview is live. */
function stageOf(d: DealRow): string {
  if (d.project_id == null) return ({ new: 'gig', pitched: 'pitched', proposal_sent: 'proposal', won: 'building' } as Record<string, string>)[d.lead_status ?? ''] ?? 'gig'
  if (!d.preview_url) return 'building'
  if (d.unpaid > 0) return 'invoiced'
  return d.paid > 0 ? 'paid' : 'live'
}

export function stats() {
  const one = (sql: string) => Number(db.prepare(sql).pluck().get() ?? 0)
  const billing = `select project_id,
      sum(status in ('sent','part_paid','overdue')) unpaid, sum(status = 'paid') paid, sum(status = 'overdue') overdue
    from invoices group by project_id`
  const deals = (
    db
      .prepare(
        `select l.id lead_id, p.id project_id, l.status lead_status, coalesce(p.name, l.title) title,
           coalesce(nullif(p.client_name, ''), l.poster_name, '') client, l.budget, p.preview_url, p.autopilot,
           coalesce(b.unpaid, 0) unpaid, coalesce(b.paid, 0) paid, coalesce(b.overdue, 0) overdue, coalesce(p.created_at, l.created_at) created_at
         from leads l left join projects p on p.lead_id = l.id left join (${billing}) b on b.project_id = p.id
         where l.status != 'skipped'
         union all
         select null, p.id, null, p.name, p.client_name, null, p.preview_url, p.autopilot,
           coalesce(b.unpaid, 0), coalesce(b.paid, 0), coalesce(b.overdue, 0), p.created_at
         from projects p left join (${billing}) b on b.project_id = p.id
         where p.lead_id is null
         order by created_at desc limit 60`,
      )
      .all() as DealRow[]
  ).map(d => ({
    id: d.project_id ? `p${d.project_id}` : `l${d.lead_id}`,
    title: d.title, client: d.client, budget: d.budget ?? '', stage: stageOf(d),
    overdue: d.overdue > 0, autopilot: !!d.autopilot, preview_url: d.preview_url ?? '',
  }))
  return {
    presence: presence(),
    devin: devinReady(),
    gmail: gmailReady(),
    deals,
    scopeCaught: Number(getSetting('scope_caught', '0')),
    changeOrders: one(`select count(*) from documents where kind = 'change_order'`),
    outstanding: one(`select coalesce(sum(amount - paid_amount), 0) from invoices where status in ('sent','part_paid','overdue')`),
    outstandingCount: one(`select count(*) from invoices where status in ('sent','part_paid','overdue')`),
    overdueCount: one(`select count(*) from invoices where status = 'overdue'`),
    collected: one(`select coalesce(sum(amount), 0) from payments`),
    payments: one(`select count(*) from payments`),
    tasksRunning: one(`select count(*) from tasks where status in ('running','running_local')`),
    tasks: db
      .prepare(
        `select t.id, t.request, t.route, t.status, t.devin_url, t.pr_url, t.preview_url, p.name project
         from tasks t left join projects p on p.id = t.project_id
         order by t.status in ('running','running_local','queued') desc, t.id desc limit 50`,
      )
      .all(),
    projects: db.prepare(`select id, slug, name, client_name, preview_url, autopilot from projects order by id desc limit 50`).all(),
    invoices: db
      .prepare(`select d.number, p.name, i.amount, i.paid_amount, i.status from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id order by i.id desc limit 50`)
      .all(),
  }
}

/** Local-only test hook: lets a script drive the self-chat control panel (set by index.ts). */
export const devHooks: { self?: (text: string) => void } = {}

export function startDashboard() {
  const app = new Hono()
  // Public deployment: everything except the OAuth callback sits behind basic auth
  if (config.dashboardPassword)
    app.use('*', async (c, next) => {
      if (c.req.path === '/healthz' || c.req.path.startsWith('/auth/google/callback')) return next()
      return basicAuth({ username: config.dashboardUser, password: config.dashboardPassword })(c, next)
    })
  app.get('/healthz', c => c.json({ ok: true, whatsapp: !lastQr, devin: devinReady() }))
  app.post('/dev/self', async c => {
    // Test hook: needs DEV_TOKEN in production (every tunnel request looks local)
    if (config.devToken && c.req.header('x-dev-token') !== config.devToken) return c.json({ error: 'forbidden' }, 403)
    if (!config.devToken && config.dashboardPassword) return c.json({ error: 'disabled' }, 403)
    const { text } = await c.req.json<{ text: string }>()
    devHooks.self?.(text)
    return c.json({ ok: true })
  })
  mountUi(app)
  app.get('/api/state', c => c.json({ stats: stats(), feed: recentFeed() }))
  app.get('/events', c =>
    streamSSE(c, async s => {
      const onFeed = (ev: FeedEvent) => s.writeSSE({ event: 'feed', data: JSON.stringify({ ev, stats: stats() }) })
      bus.on('feed', onFeed)
      s.onAbort(() => void bus.off('feed', onFeed))
      while (!s.aborted) await s.sleep(15000).then(() => s.writeSSE({ event: 'ping', data: '' }))
    }),
  )
  app.get('/qr', c => c.html(lastQr ? `<body style="display:grid;place-items:center;height:100vh;font-family:system-ui"><div><h2>Link WhatsApp</h2><img src="${lastQr}" width=320><p>WhatsApp > Linked devices > Link a device</p><script>setTimeout(()=>location.reload(),15000)</script></div></body>` : '<p style="font-family:system-ui">Already linked (or waiting for QR). <a href="/">Dashboard</a></p>'))
  app.get('/auth/google', c => (config.googleClientId ? c.redirect(gmailAuthUrl()) : c.text('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first')))
  app.get('/auth/google/callback', async c => {
    await gmailCallback(c.req.query('code') ?? '')
    return c.html('<p style="font-family:system-ui">Gmail connected. You can close this tab.</p>')
  })
  serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  console.log(`Dashboard on http://localhost:${config.port}`)
}
