import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { db, getSetting } from './db.js'
import { bus, recentFeed, type FeedEvent } from './bus.js'
import { config } from './config.js'
import { lastQr } from './wa.js'
import { gmailAuthUrl, gmailCallback, gmailReady } from './gmail.js'
import { presence } from './control.js'
import { devinReady } from './devin.js'

export function stats() {
  const one = (sql: string) => Number(db.prepare(sql).pluck().get() ?? 0)
  return {
    presence: presence(),
    devin: devinReady(),
    gmail: gmailReady(),
    gigs: one(`select count(*) from leads`),
    pitched: one(`select count(*) from leads where status in ('pitched','proposal_sent','won')`),
    won: one(`select count(*) from leads where status = 'won'`),
    scopeCaught: Number(getSetting('scope_caught', '0')),
    outstanding: one(`select coalesce(sum(amount - paid_amount), 0) from invoices where status in ('sent','part_paid','overdue')`),
    collected: one(`select coalesce(sum(amount), 0) from payments`),
    tasksRunning: one(`select count(*) from tasks where status in ('running','running_local')`),
    projects: db.prepare(`select slug, name, client_name, preview_url, autopilot from projects order by id desc limit 8`).all(),
    invoices: db
      .prepare(`select d.number, p.name, i.amount, i.paid_amount, i.status from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id order by i.id desc limit 8`)
      .all(),
  }
}

export function startDashboard() {
  const app = new Hono()
  app.get('/', c => c.html(PAGE))
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
  serve({ fetch: app.fetch, port: config.port })
  console.log(`Dashboard on http://localhost:${config.port}`)
}

const PAGE = /* html */ `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Devlancer</title>
<style>
:root{--bg:#0b1110;--card:#121a19;--line:#1f2b29;--ink:#e6f2ef;--mute:#8aa39e;--teal:#14b8a6;--amber:#f59e0b;--red:#f43f5e;--violet:#a78bfa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto}
header{display:flex;align-items:center;gap:14px;padding:18px 28px;border-bottom:1px solid var(--line)}
h1{font-size:20px;margin:0;letter-spacing:.2px}h1 b{color:var(--teal)}.tag{color:var(--mute);font-size:13px}
.pill{margin-left:auto;display:flex;gap:8px}.pill span{padding:4px 10px;border:1px solid var(--line);border-radius:99px;font-size:12px;color:var(--mute)}
.pill .on{color:var(--teal);border-color:#115e59}
main{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;padding:20px 28px}
.stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat .v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}.stat .l{color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.6px}
.stat.hl .v{color:var(--amber)}.stat.ok .v{color:var(--teal)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;min-height:200px}
section h2{margin:0 0 10px;font-size:13px;color:var(--mute);text-transform:uppercase;letter-spacing:.6px}
#feed{list-style:none;margin:0;padding:0;max-height:62vh;overflow:auto}
#feed li{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);animation:in .4s ease}
@keyframes in{from{opacity:0;transform:translateY(-4px)}to{opacity:1}}
.t{color:var(--mute);font-variant-numeric:tabular-nums;font-size:12px}
.k{display:inline-block;font-size:11px;padding:1px 7px;border-radius:6px;margin-right:6px;background:#1c2a28;color:var(--mute)}
.k.gig,.k.pitch{color:#7dd3fc}.k.devin{color:var(--teal)}.k.scope{color:var(--amber)}.k.invoice,.k.payment{color:var(--violet)}
.r{font-size:11px;padding:1px 7px;border-radius:6px;margin-left:6px;border:1px solid var(--line)}
.r.cloud{color:var(--teal)}.r.cli{color:#7dd3fc}.r.queued{color:var(--amber)}.r.scope{color:var(--red)}
a{color:var(--teal)}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums}
.s-paid{color:var(--teal)}.s-overdue{color:var(--red)}.s-sent{color:var(--amber)}
</style></head><body>
<header><h1><b>Dev</b>lancer</h1><span class="tag">your freelance dev that finds the gig, builds it, and keeps the client happy</span>
<div class="pill"><span id="p-presence">...</span><span id="p-devin">Devin</span><span id="p-gmail">Gmail</span></div></header>
<main>
<div class="stats">
<div class="stat"><div class="v" id="s-gigs">0</div><div class="l">Gigs found</div></div>
<div class="stat"><div class="v" id="s-pitched">0</div><div class="l">Pitched</div></div>
<div class="stat ok"><div class="v" id="s-won">0</div><div class="l">Won</div></div>
<div class="stat hl"><div class="v" id="s-scope">₹0</div><div class="l">Scope creep caught</div></div>
<div class="stat"><div class="v" id="s-out">₹0</div><div class="l">Outstanding</div></div>
<div class="stat ok"><div class="v" id="s-col">₹0</div><div class="l">Collected</div></div>
</div>
<section><h2>Live</h2><ul id="feed"></ul></section>
<div style="display:grid;gap:18px;align-content:start">
<section><h2>Projects</h2><table id="projects"></table></section>
<section><h2>Invoices</h2><table id="invoices"></table></section>
</div></main>
<script>
const inr=n=>'₹'+Math.round(n).toLocaleString('en-IN');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rc=r=>!r?'':r.includes('Cloud')?'cloud':r.includes('CLI')?'cli':r.includes('scope')?'scope':'queued';
function addFeed(e,top=true){const li=document.createElement('li');
li.innerHTML='<span class="t">'+new Date(e.ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+'</span><span><span class="k '+e.kind+'">'+e.kind+'</span>'+esc(e.text)+(e.route?'<span class="r '+rc(e.route)+'">'+esc(e.route)+'</span>':'')+(e.url?' <a target=_blank href="'+esc(e.url)+'">open</a>':'')+'</span>';
const f=document.getElementById('feed');top?f.prepend(li):f.append(li)}
function setStats(s){
document.getElementById('p-presence').textContent=s.presence==='online'?'🟢 Online':'🌙 Offline';
document.getElementById('p-devin').className=s.devin?'on':'';document.getElementById('p-gmail').className=s.gmail?'on':'';
s_('gigs',s.gigs);s_('pitched',s.pitched);s_('won',s.won);s_('scope',inr(s.scopeCaught));s_('out',inr(s.outstanding));s_('col',inr(s.collected));
document.getElementById('projects').innerHTML=s.projects.map(p=>'<tr><td>#'+esc(p.slug)+(p.autopilot?' 🤖':'')+'</td><td>'+esc(p.client_name)+'</td><td>'+(p.preview_url?'<a target=_blank href="'+esc(p.preview_url)+'">preview</a>':'building')+'</td></tr>').join('')||'<tr><td>None yet</td></tr>';
document.getElementById('invoices').innerHTML=s.invoices.map(i=>'<tr><td>'+esc(i.number)+'</td><td>'+esc(i.name)+'</td><td class=n>'+inr(i.amount)+'</td><td class="s-'+i.status+'">'+i.status+'</td></tr>').join('')||'<tr><td>None yet</td></tr>'}
function s_(k,v){document.getElementById('s-'+k).textContent=v}
fetch('/api/state').then(r=>r.json()).then(d=>{setStats(d.stats);d.feed.forEach(e=>addFeed(e))});
const es=new EventSource('/events');es.addEventListener('feed',m=>{const d=JSON.parse(m.data);addFeed(d.ev);setStats(d.stats)});
</script></body></html>`
