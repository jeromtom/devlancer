import fs from 'node:fs'
import path from 'node:path'
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
         order by t.status in ('running','running_local','queued') desc, t.id desc limit 8`,
      )
      .all(),
    projects: db.prepare(`select slug, name, client_name, preview_url, autopilot from projects order by id desc limit 8`).all(),
    invoices: db
      .prepare(`select d.number, p.name, i.amount, i.paid_amount, i.status from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id order by i.id desc limit 8`)
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
  app.get('/', c => c.html(PAGE))
  app.get('/fonts/:file', c => {
    const file = c.req.param('file')
    if (!/^ibm-plex-sans-latin(-ext)?-[456]00-normal\.woff2$/.test(file)) return c.notFound()
    const body = fs.readFileSync(path.join(config.root, 'node_modules/@fontsource/ibm-plex-sans/files', file))
    return c.body(body, 200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' })
  })
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

const FONT_FACES = [400, 500, 600]
  .flatMap(w => [
    ['latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
    ['latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  ].map(([subset, range]) => `@font-face{font-family:Plex;font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/ibm-plex-sans-${subset}-${w}-normal.woff2) format('woff2');unicode-range:${range}}`))
  .join('\n')

const PAGE = /* html */ `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Devlancer</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23ffffff'/%3E%3Cpath d='M7 16h18' stroke='%23e4e8ef' stroke-width='3'/%3E%3Ccircle cx='9' cy='16' r='4' fill='%237b61ff'/%3E%3Ccircle cx='23' cy='16' r='4' fill='%233b82f6'/%3E%3C/svg%3E">
<style>
${FONT_FACES}
:root{--ground:#f3f5f9;--panel:#fff;--raise:#f4f6fa;--line:#e4e8ef;--ink:#1d2433;--mute:#5d6679;--dim:#97a0b2;
--lead:#7b61ff;--lead-ink:#5b3fe0;--build:#3b82f6;--build-ink:#1d63d8;--owed:#f0a020;--owed-ink:#a25e00;
--paid:#22b573;--paid-ink:#11804d;--alert:#ef5353;--alert-ink:#c93030;--shadow:0 1px 2px rgba(29,36,51,.05),0 6px 20px -8px rgba(29,36,51,.12);color-scheme:light}
*{box-sizing:border-box}
html{font-size:16px;scrollbar-color:var(--line) transparent;scrollbar-width:thin}
body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto minmax(0,1fr);background:var(--ground);color:var(--ink);
font:400 1rem/1.5 Plex,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;caret-color:var(--build-ink)}
::selection{background:#3b82f633;color:var(--ink)}
:focus-visible{outline:2px solid var(--build);outline-offset:2px;border-radius:4px}
a{color:var(--build-ink);text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{color:#174fae}
h1,h2{margin:0;font-weight:600;letter-spacing:-.01em}
.num{font-variant-numeric:tabular-nums}
.zero{color:var(--dim)!important}

header{display:flex;align-items:center;flex-wrap:wrap;gap:6px 18px;padding:14px 28px;background:var(--panel);border-bottom:1px solid var(--line)}
h1{font-size:1.44rem}
.tagline{color:var(--mute);font-size:.94rem}
.status{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;padding:0;margin-block:0;font-size:.875rem;color:var(--mute)}
.status li{display:flex;align-items:center;gap:7px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.on .dot{background:var(--paid)}.off-warn .dot{background:var(--owed)}

.demo{margin:14px 28px 0;padding:10px 14px;border-radius:8px;background:#fff4de;color:#7a4700;font-size:.875rem}

.top{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:20px;padding:20px 28px 0}
.bottom{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;padding:20px 28px 24px;min-height:0}
.panel{background:var(--panel);box-shadow:var(--shadow);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;min-height:0;min-width:0}
.phead{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}
.phead h2{font-size:1rem}
.meta{color:var(--mute);font-size:.875rem}
.phead .meta{margin-left:auto}

/* Pipeline: the deal track */
.track{list-style:none;margin:0;padding:0 0 4px;display:grid;grid-template-columns:repeat(7,minmax(132px,1fr));gap:12px;overflow-x:auto}
.stage{position:relative;min-width:0;--c:var(--lead);--ci:var(--lead-ink)}
.stage[data-stage=building],.stage[data-stage=live]{--c:var(--build);--ci:var(--build-ink)}
.stage[data-stage=invoiced]{--c:var(--owed);--ci:var(--owed-ink)}.stage[data-stage=paid]{--c:var(--paid);--ci:var(--paid-ink)}
.stage::before{content:"";position:absolute;top:5px;left:0;right:-12px;height:2px;background:var(--line)}
.stage[data-stage=paid]::before{right:0}
.stage.has::before{background:linear-gradient(90deg,var(--c) 0 12px,var(--line) 12px)}
.node{position:relative;display:block;width:12px;height:12px;border-radius:50%;background:var(--panel);border:2px solid var(--line)}
.stage.has .node{background:var(--c);border-color:var(--c)}
.sh{display:flex;align-items:baseline;gap:8px;margin:10px 0}
.sh .name{color:var(--mute);font-size:.875rem}
.sh .count{font-size:1.44rem;font-weight:600;line-height:1}
.stage.has .count{color:var(--ci)}
.deals{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:24vh;overflow:auto}
.deal{background:var(--raise);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}
.deal b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500;font-size:.875rem;line-height:1.35}
.deal span{display:block;color:var(--mute);font-size:.8125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.deal .late{color:var(--alert-ink)}
.deal.moved{animation:moved 1.8s cubic-bezier(.16,1,.3,1)}
@keyframes moved{from{box-shadow:0 0 0 2px var(--c),0 6px 24px -6px var(--c)}to{box-shadow:0 0 0 2px transparent,0 6px 24px -6px transparent}}
.more{color:var(--mute);font-size:.8125rem;padding-left:2px}
.pipe-empty{grid-column:1/-1;color:var(--mute);font-size:.94rem;margin:2px 0 0}

/* Money */
.money dl{margin:0;display:grid;gap:16px}
.money dt{color:var(--mute);font-size:.875rem}
.money dd{margin:0;font-size:1.44rem;font-weight:600;line-height:1.2}
.money .lead dd{font-size:2.07rem;color:var(--owed-ink)}
.money .collected dd{color:var(--paid-ink)}
.money .alerting dd{color:var(--alert-ink)}
.money p{margin:2px 0 0;color:var(--mute);font-size:.8125rem}

/* Feed */
.filters{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap}
.filters button{font:inherit;font-size:.8125rem;color:var(--mute);background:none;border:1px solid transparent;border-radius:6px;padding:3px 9px;cursor:pointer}
.filters button:hover{color:var(--ink);background:var(--raise)}
.filters button[aria-pressed=true]{color:var(--ink);background:var(--raise);border-color:var(--line)}
#feed{list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:0}
#feed li{display:grid;grid-template-columns:4.6rem 6.2rem minmax(0,1fr);gap:10px;padding:10px 0;border-top:1px solid var(--line);align-items:baseline}
#feed li:first-child{border-top:0}
#feed li.none{display:block}
#feed li.fresh{animation:fresh 1.2s cubic-bezier(.16,1,.3,1)}
@keyframes fresh{from{background:#3b82f614}to{background:transparent}}
.t{color:var(--mute);font-size:.8125rem}
.kind{display:flex;align-items:center;gap:7px;font-size:.8125rem;color:var(--mute)}
.kind .dot{background:var(--k)}
.k-lead{--k:var(--lead)}.k-build{--k:var(--build)}.k-owed{--k:var(--owed)}.k-paid{--k:var(--paid)}.k-note{--k:var(--dim)}
.msg{font-size:.94rem}
.tag{display:inline-block;margin-left:8px;font-size:.75rem;padding:1px 7px;border-radius:5px;background:var(--raise);color:var(--mute);white-space:nowrap}
.tag.cloud{color:var(--build-ink);background:#3b82f614}.tag.cli{color:var(--lead-ink);background:#7b61ff14}
.tag.queued{color:var(--owed-ink);background:#f0a0201f}.tag.blocked{color:var(--alert-ink);background:#ef53531a}
.msg a{margin-left:8px;font-size:.875rem}
.empty{color:var(--mute);font-size:.94rem;margin:0;max-width:44ch}
.empty a{white-space:nowrap}

/* Side column */
.side{display:grid;gap:20px;align-content:start;overflow:auto;min-height:0;min-width:0}
.side>.panel{min-height:auto}
.sessions{list-style:none;margin:0;padding:0}
.sessions li{padding:10px 0;border-top:1px solid var(--line)}
.sessions li:first-child{border-top:0;padding-top:0}
.sessions .req{font-size:.94rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sessions .row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:4px;font-size:.8125rem;color:var(--mute)}
.state{display:flex;align-items:center;gap:6px}
.state.running .dot{background:var(--build)}.state.local .dot{background:var(--lead)}.state.queued .dot{background:var(--owed)}.state.done .dot{background:var(--paid)}.state.failed .dot{background:var(--alert)}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{text-align:left;font-weight:500;color:var(--mute);font-size:.8125rem;padding:0 6px 6px 0;border-bottom:1px solid var(--line)}
td{padding:8px 6px 8px 0;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
td.num{white-space:nowrap}
th.n,td.n{text-align:right;padding-right:16px}
.auto{color:var(--build-ink);font-size:.75rem;margin-left:6px}
.s-paid{color:var(--paid-ink)}.s-overdue{color:var(--alert-ink)}.s-sent,.s-part_paid{color:var(--owed-ink)}.s-draft{color:var(--mute)}

@media (min-width:1101px){body{height:100vh}}
@media (max-width:1100px){.top,.bottom{grid-template-columns:1fr}.side{overflow:visible}#feed{max-height:70vh}}
@media (max-width:640px){header,.top,.bottom{padding-inline:16px}.demo{margin-inline:16px}.status{margin-left:0;width:100%}
#feed li{grid-template-columns:1fr;gap:2px}.filters{margin-left:0}.phead{flex-wrap:wrap}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
<header>
<h1>Devlancer</h1>
<span class="tagline">Finds the gig, builds it, keeps the client happy</span>
<ul class="status" aria-label="Connections">
<li id="st-presence"><span class="dot"></span><span></span></li>
<li id="st-devin"><span class="dot"></span><span></span></li>
<li id="st-gmail"><span class="dot"></span><span></span></li>
</ul>
</header>
<div class="demo" id="demo" hidden>Showing sample data so you can see a busy board. Open the dashboard without <b>?demo</b> for live activity.</div>
<div class="top">
<section class="panel" aria-labelledby="h-pipe">
<div class="phead"><h2 id="h-pipe">Pipeline</h2><span class="meta" id="pipe-meta"></span></div>
<ol class="track" id="track"></ol>
</section>
<section class="panel money" aria-labelledby="h-money">
<div class="phead"><h2 id="h-money">Money</h2></div>
<dl>
<div class="lead"><dt>Scope creep caught</dt><dd class="num" id="m-scope"></dd><p id="m-scope-sub"></p></div>
<div id="m-out-wrap"><dt>Outstanding</dt><dd class="num" id="m-out"></dd><p id="m-out-sub"></p></div>
<div class="collected"><dt>Collected</dt><dd class="num" id="m-col"></dd><p id="m-col-sub"></p></div>
</dl>
</section>
</div>
<div class="bottom">
<section class="panel" aria-labelledby="h-feed">
<div class="phead"><h2 id="h-feed">Live activity</h2>
<div class="filters" role="group" aria-label="Filter activity">
<button data-f="all" aria-pressed="true">All</button><button data-f="lead" aria-pressed="false">Gigs</button><button data-f="build" aria-pressed="false">Devin and tasks</button><button data-f="money" aria-pressed="false">Money</button><button data-f="note" aria-pressed="false">Email and status</button>
</div></div>
<ul id="feed" aria-live="polite"></ul>
</section>
<div class="side">
<section class="panel" aria-labelledby="h-devin"><div class="phead"><h2 id="h-devin">Devin sessions</h2><span class="meta" id="devin-meta"></span></div><ul class="sessions" id="sessions"></ul></section>
<section class="panel" aria-labelledby="h-proj"><div class="phead"><h2 id="h-proj">Projects</h2></div><div id="projects"></div></section>
<section class="panel" aria-labelledby="h-inv"><div class="phead"><h2 id="h-inv">Invoices</h2></div><div id="invoices"></div></section>
</div>
</div>
<script>
const STAGES=[['gig','Gig'],['pitched','Pitched'],['proposal','Proposal'],['building','Building'],['live','Live'],['invoiced','Invoiced'],['paid','Paid']];
const KINDS={gig:['Gig','lead','lead'],pitch:['Pitch','lead','lead'],proposal:['Proposal','lead','lead'],task:['Task','build','build'],devin:['Devin','build','build'],
scope:['Scope','owed','money'],invoice:['Invoice','owed','money'],payment:['Payment','paid','money'],email:['Email','note','note'],info:['Status','note','note']};
const STATUS={paid:'Paid',overdue:'Overdue',sent:'Sent',part_paid:'Part paid',draft:'Draft'};
const $=id=>document.getElementById(id);
const inr=n=>'\\u20b9'+Math.round(n).toLocaleString('en-IN');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const link=(u,t)=>u?'<a target="_blank" rel="noopener" href="'+esc(u)+'">'+t+'</a>':'';
const plural=(n,one,many)=>n+' '+(n===1?one:many);
const routeClass=r=>!r?'':/cloud/i.test(r)?'cloud':/cli/i.test(r)?'cli':/scope|block/i.test(r)?'blocked':'queued';
const routeLabel=r=>({cloud:'Devin Cloud',cli:'Devin CLI',queued:'Queued for you'})[r]||r||'';
const taskState=s=>({running:['running','Building in Devin Cloud'],running_local:['local','Open in Devin CLI'],queued:['queued','Queued'],done:['done','Done'],failed:['failed','Failed']})[s]||['queued',s||'Queued'];

let state=null,feed=[],filter='all',prevStage={};

function setStatus(id,cls,text,html){const li=$(id);li.className=cls;li.lastElementChild.innerHTML=html||esc(text)}

function renderStats(s){
setStatus('st-presence',s.presence==='online'?'on':'',s.presence==='online'?'You are online':'You are offline, Devlancer is covering');
setStatus('st-devin',s.devin?'on':'off-warn',s.devin?'Devin connected':'Devin not connected');
setStatus('st-gmail',s.gmail?'on':'',s.gmail?'Gmail connected':'',s.gmail?'':'<a href="/auth/google">Connect Gmail</a>');

const by={};STAGES.forEach(([k])=>by[k]=[]);s.deals.forEach(d=>(by[d.stage]||by.gig).push(d));
$('track').innerHTML=STAGES.map(([k,label])=>{const ds=by[k];
return '<li class="stage'+(ds.length?' has':'')+'" data-stage="'+k+'"><span class="node"></span><div class="sh"><span class="name">'+label+'</span><span class="count num'+(ds.length?'':' zero')+'">'+ds.length+'</span></div><ul class="deals">'+
ds.slice(0,4).map(d=>'<li class="deal'+(prevStage[d.id]&&prevStage[d.id]!==d.stage?' moved':'')+'"><b title="'+esc(d.title)+'">'+esc(d.title)+'</b><span>'+
(d.overdue?'<span class="late">Overdue</span>':esc([d.client,d.budget].filter(Boolean).join(', '))||'&nbsp;')+'</span></li>').join('')+
(ds.length>4?'<li class="more">'+(ds.length-4)+' more</li>':'')+'</ul></li>'}).join('')+
(s.deals.length?'':'<li class="pipe-empty">No gigs yet. Devlancer is watching your WhatsApp groups, and each gig post it spots lands in the first column.</li>');
prevStage={};s.deals.forEach(d=>prevStage[d.id]=d.stage);
const active=s.deals.filter(d=>!['gig','paid'].includes(d.stage)).length;
$('pipe-meta').textContent=s.deals.length?plural(s.deals.length,'deal','deals')+', '+active+' in progress':'';

const money=(id,v,sub)=>{$(id).textContent=inr(v);$(id).classList.toggle('zero',!v);$(id+'-sub').textContent=sub};
money('m-scope',s.scopeCaught,s.changeOrders?'Billed as '+plural(s.changeOrders,'change order','change orders'):'Change requests outside the agreed scope are priced here');
money('m-out',s.outstanding,s.outstandingCount?plural(s.outstandingCount,'invoice','invoices')+' unpaid'+(s.overdueCount?', '+s.overdueCount+' overdue':''):'Nothing waiting on clients');
$('m-out-wrap').classList.toggle('alerting',s.overdueCount>0);
money('m-col',s.collected,s.payments?'From '+plural(s.payments,'payment','payments'):'Payments matched from UPI and Gmail show here');

$('devin-meta').textContent=s.tasksRunning?s.tasksRunning+' running':'';
$('sessions').innerHTML=s.tasks.length?s.tasks.map(t=>{const [c,l]=taskState(t.status);
return '<li><div class="req">'+esc(t.request)+'</div><div class="row"><span class="state '+c+'"><span class="dot"></span>'+esc(l)+'</span>'+(t.project?'<span>'+esc(t.project)+'</span>':'')+
(t.route?'<span class="tag '+routeClass(t.route)+'" style="margin-left:0">'+esc(routeLabel(t.route))+'</span>':'')+link(t.devin_url,'Session')+link(t.pr_url,'Pull request')+link(t.preview_url,'Preview')+'</div></li>'}).join('')
:'<li><p class="empty">'+(s.devin?'No sessions yet. Devin starts one when a client accepts a proposal or asks for a change.':'Devin is not connected. Add DEVIN_API_KEY to .env and restart Devlancer.')+'</p></li>';

$('projects').innerHTML=s.projects.length?'<table><thead><tr><th>Project</th><th>Client</th><th>Preview</th></tr></thead><tbody>'+s.projects.map(p=>'<tr><td>#'+esc(p.slug)+(p.autopilot?'<span class="auto">Autopilot</span>':'')+'</td><td>'+esc(p.client_name)+'</td><td>'+(p.preview_url?link(p.preview_url,'Open'):'<span class="meta">Building</span>')+'</td></tr>').join('')+'</tbody></table>'
:'<p class="empty">Projects appear here when a client accepts your proposal.</p>';
$('invoices').innerHTML=s.invoices.length?'<table><thead><tr><th>Number</th><th>Project</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>'+s.invoices.map(i=>'<tr><td class="num">'+esc(i.number)+'</td><td>'+esc(i.name)+'</td><td class="n num">'+inr(i.amount)+'</td><td class="s-'+esc(i.status)+'">'+esc(STATUS[i.status]||i.status)+'</td></tr>').join('')+'</tbody></table>'
:'<p class="empty">Invoices appear when a project starts (the advance) and when a change order is approved.</p>';
}

function feedItem(e,fresh){const k=KINDS[e.kind]||[e.kind,'note','note'];
const proj=state&&state.projects.find(p=>p.name&&e.text.includes(p.name));
return '<li'+(fresh?' class="fresh"':'')+'><span class="t num">'+new Date(e.ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+'</span><span class="kind k-'+k[1]+'"><span class="dot"></span>'+k[0]+'</span><span class="msg">'+esc(e.text)+
(e.route?'<span class="tag '+routeClass(e.route)+'">'+esc(e.route)+'</span>':'')+(proj?'<span class="tag">#'+esc(proj.slug)+'</span>':'')+link(e.url,'Open')+'</span></li>'}

function renderFeed(freshTs){const shown=feed.filter(e=>filter==='all'||(KINDS[e.kind]||[,,'note'])[2]===filter);
$('feed').innerHTML=shown.length?shown.map(e=>feedItem(e,e.ts===freshTs)).join(''):'<li class="none"><p class="empty">'+(feed.length?'Nothing in this filter yet.':'Activity from WhatsApp, Gmail and Devin shows up here as it happens.')+'</p></li>'}

document.querySelector('.filters').addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;filter=b.dataset.f;
document.querySelectorAll('.filters button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderFeed()});

function apply(s){state=s;renderStats(s)}

if(new URLSearchParams(location.search).has('demo')){
$('demo').hidden=false;const m=60000,n=Date.now();
apply({presence:'offline',devin:true,gmail:true,scopeCaught:18000,changeOrders:2,outstanding:42000,outstandingCount:3,overdueCount:1,collected:65000,payments:4,tasksRunning:2,
deals:[{id:'l1',title:'Landing page for a bakery in Kakkanad',client:'Anu',budget:'\\u20b915,000',stage:'gig'},{id:'l2',title:'WhatsApp order bot for a pharmacy',client:'Rahul',budget:'\\u20b925,000',stage:'gig'},
{id:'l3',title:'Clinic appointment booking site',client:'Dr Meera',budget:'\\u20b930,000',stage:'pitched'},{id:'l4',title:'Inventory dashboard for a spice exporter',client:'Joseph',budget:'\\u20b960,000',stage:'proposal'},
{id:'p1',title:'Homestay booking site',client:'Thomas',stage:'building'},{id:'p2',title:'Tuition centre app',client:'Lakshmi',stage:'live'},{id:'p3',title:'Boutique catalogue',client:'Fathima',stage:'invoiced',overdue:true},{id:'p4',title:'Restaurant menu site',client:'Arjun',stage:'paid'}],
tasks:[{request:'Add a gallery section with 12 room photos',route:'cloud',status:'running',project:'Homestay booking site',devin_url:'#'},
{request:'Fix the fee calculator rounding for sibling discounts',route:'cli',status:'running_local',project:'Tuition centre app'},
{request:'Add Malayalam language toggle',route:'cloud',status:'done',project:'Tuition centre app',pr_url:'#',preview_url:'#'}],
projects:[{slug:'homestay',name:'Homestay booking site',client_name:'Thomas'},{slug:'tuition',name:'Tuition centre app',client_name:'Lakshmi',preview_url:'#',autopilot:1},{slug:'boutique',name:'Boutique catalogue',client_name:'Fathima',preview_url:'#'}],
invoices:[{number:'INV-2026-004',name:'Boutique catalogue',amount:22000,status:'overdue'},{number:'INV-2026-003',name:'Tuition centre app',amount:12000,status:'sent'},{number:'INV-2026-002',name:'Homestay booking site',amount:8000,status:'part_paid'},{number:'INV-2026-001',name:'Restaurant menu site',amount:35000,status:'paid'}]});
feed=[{ts:n-2*m,kind:'devin',text:'Devin Cloud session started for Homestay booking site: Add a gallery section',route:'Devin Cloud',url:'#'},
{ts:n-6*m,kind:'scope',text:'Scope creep caught on Tuition centre app: "Add online fee payments" = \\u20b910,000'},
{ts:n-9*m,kind:'task',text:'Hands-on: "Fix the fee calculator rounding" on Tuition centre app. Opening Devin CLI',route:'Devin CLI'},
{ts:n-14*m,kind:'gig',text:'Gig in Kochi Freelancers: WhatsApp order bot for a pharmacy, \\u20b925,000 (fit 86%)'},
{ts:n-21*m,kind:'payment',text:'Payment \\u20b935,000 recorded (UPI)'},
{ts:n-30*m,kind:'pitch',text:'Pitched Clinic appointment booking site privately to Dr Meera'},
{ts:n-42*m,kind:'email',text:'Client email from Fathima: Can we add a size chart?'}];
renderFeed();
}else{
fetch('/api/state').then(r=>r.json()).then(d=>{apply(d.stats);feed=d.feed.slice().reverse();renderFeed()});
const es=new EventSource('/events');
es.addEventListener('feed',m=>{const d=JSON.parse(m.data);feed.unshift(d.ev);if(feed.length>200)feed.pop();apply(d.stats);renderFeed(d.ev.ts)});
}
</script></body></html>`
