'use strict'
const STAGES = [['gig', 'Gig spotted'], ['pitched', 'Pitched'], ['proposal', 'Proposal sent'], ['building', 'Building'], ['live', 'Preview live'], ['invoiced', 'Invoiced'], ['paid', 'Paid']]
const STAGE_HINT = {
  gig: 'Gig posts Devlancer spots in your marketplace groups.',
  pitched: 'Pitched privately in DM.',
  proposal: 'Proposal PDF sent, waiting on the client.',
  building: 'Devin is building.',
  live: 'Preview link sent to the client.',
  invoiced: 'Waiting on payment.',
  paid: 'Settled in full.',
}
// kind -> [label, colour family, filter group, icon]
const KINDS = {
  gig: ['Gig', 'lead', 'lead', 'pipeline'], pitch: ['Pitch', 'lead', 'lead', 'pipeline'], proposal: ['Proposal', 'lead', 'lead', 'pipeline'],
  task: ['Task', 'build', 'build', 'devin'], devin: ['Devin', 'build', 'build', 'devin'],
  scope: ['Scope', 'owed', 'money', 'invoices'], invoice: ['Invoice', 'owed', 'money', 'invoices'], payment: ['Payment', 'paid', 'money', 'invoices'],
  email: ['Email', 'note', 'note', 'activity'], info: ['Status', 'note', 'note', 'activity'],
}
const INVOICE = { paid: ['Paid', 'green'], overdue: ['Overdue', 'coral'], sent: ['Sent', 'amber'], part_paid: ['Part paid', 'amber'], draft: ['Draft', ''] }
const TASK = {
  running: ['Building in Devin Cloud', 'cyan'], running_local: ['Open in Devin CLI', 'blue'], queued: ['Queued for you', 'amber'],
  done: ['Done', 'green'], failed: ['Failed', 'coral'], blocked: ['Needs you', 'coral'],
}
const PAGES = {
  overview: ['Overview', s => s.presence === 'online' ? 'You are online. Devlancer drafts, you approve.' : 'You are offline. Devlancer is covering your clients.'],
  pipeline: ['Pipeline', s => `${plural(s.deals.length, 'deal', 'deals')} from first gig post to final payment`],
  projects: ['Projects', () => 'Client work that Devin is building or maintaining'],
  devin: ['Devin sessions', () => 'Each client request goes to the Devin surface that fits it'],
  activity: ['Activity', () => 'Everything Devlancer did across WhatsApp, Gmail and Devin'],
  invoices: ['Invoices', () => 'Advances, change orders and payments'],
  connections: ['Connections', () => 'The accounts Devlancer works through'],
}

const $ = id => document.getElementById(id)
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const icon = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`
const ext = (u, t) => u ? `<a target="_blank" rel="noopener" href="${esc(u)}">${esc(t)}${icon('out')}</a>` : ''
const chip = (text, tone = '', dot = false) => `<span class="chip ${tone}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
const routeTone = r => !r ? '' : /cloud/i.test(r) ? 'cyan' : /cli/i.test(r) ? 'blue' : /scope|block/i.test(r) ? 'coral' : 'amber'
const routeLabel = r => ({ cloud: 'Devin Cloud', cli: 'Devin CLI', queued: 'Queued for you' })[r] || r || ''
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const panel = (title, body, { meta = '', go = '', extra = '' } = {}) =>
  `<section class="panel"><div class="phead"><h2>${esc(title)}</h2>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}${extra}${go ? `<a class="go" href="${go[0]}">${esc(go[1])}</a>` : ''}</div>${body}</section>`
const empty = (title, text, small) => `<div class="empty${small ? ' small' : ''}">${title ? `<h3>${esc(title)}</h3>` : ''}<p>${text}</p></div>`

let state = null, feed = [], filter = 'all', invFilter = 'all', page = 'overview', prevStage = {}, freshTs = 0

/* ---------- Shell ---------- */
function renderShell(s) {
  const p = $('presence')
  const online = s.presence === 'online'
  p.className = 'presence ' + (online ? 'online' : 'covering')
  p.querySelector('b').textContent = online ? 'You are online' : 'Covering for you'
  p.querySelector('.presence-text span').textContent = online ? 'Drafts wait for your approval' : 'Clients still get replies'
  p.title = online ? 'You are online' : 'You are offline. Devlancer is covering.'

  const inProgress = s.deals.filter(d => !['gig', 'paid'].includes(d.stage)).length
  badge('b-pipeline', inProgress)
  badge('b-projects', s.projects.length)
  badge('b-devin', s.tasksRunning, 'live')
  badge('b-invoices', s.overdueCount, 'alert')
  badge('b-connections', (s.devin ? 0 : 1) + (s.gmail ? 0 : 1), 'alert')

  $('health').innerHTML =
    `<li><span class="pill ${s.devin ? 'ok' : 'bad'}"><span class="dot"></span>${s.devin ? 'Devin connected' : 'Devin not connected'}</span></li>` +
    (s.gmail ? '<li><span class="pill ok"><span class="dot"></span>Gmail connected</span></li>' : '<li><a class="warn" href="/auth/google"><span class="dot"></span>Connect Gmail</a></li>')
}
function badge(id, n, tone = '') { const el = $(id); el.textContent = n ? n : ''; el.className = n ? tone : '' }

/* ---------- Pages ---------- */
const VIEWS = {
  overview(s) {
    return kpis(s) + panel('Pipeline', track(s), { meta: s.deals.length ? plural(s.deals.length, 'deal', 'deals') : '', go: ['#/pipeline', 'Open board'] }) +
      `<div class="cols">${panel('Latest activity', feedList(feed.slice(0, 7)), { go: ['#/activity', 'View all'] })}${panel('Devin sessions', sessions(s, s.tasks.slice(0, 4)), { meta: s.tasksRunning ? s.tasksRunning + ' running' : '', go: ['#/devin', 'View all'] })}</div>`
  },
  pipeline(s) {
    const by = groupDeals(s)
    return `<div class="board">${STAGES.map(([k, label]) => `<section class="col" data-stage="${k}" aria-label="${label}">
      <div class="col-head"><span class="cell"></span><h3>${label}</h3><span class="n num">${by[k].length}</span></div>
      ${by[k].length ? by[k].map(dealCard).join('') : `<p class="col-hint">${STAGE_HINT[k]}</p>`}</section>`).join('')}</div>`
  },
  projects(s) {
    if (!s.projects.length) return panel('Projects', empty('No projects yet', 'A project starts when a client accepts your proposal. Devlancer then sends the advance invoice and hands the build to Devin.'))
    const stage = Object.fromEntries(s.deals.map(d => [d.id, d.stage]))
    const stageName = Object.fromEntries(STAGES)
    return panel('All projects', `<div class="table-wrap"><table><thead><tr><th>Project</th><th>Client</th><th>Stage</th><th>Preview</th><th>Replies</th></tr></thead><tbody>${s.projects.map(p => {
      const st = stage['p' + p.id] || (p.preview_url ? 'live' : 'building')
      return `<tr><td class="strong">${esc(p.name)}<div class="slug">#${esc(p.slug)}</div></td><td><span class="who" style="display:flex;gap:8px;align-items:center"><span class="avatar">${esc(initials(p.client_name))}</span>${esc(p.client_name || 'Unknown')}</span></td>
      <td>${chip(stageName[st] || st, { building: 'cyan', live: 'cyan', invoiced: 'amber', paid: 'green' }[st] || 'blue', true)}</td>
      <td>${p.preview_url ? `<span class="links">${ext(p.preview_url, 'Open preview')}</span>` : '<span class="dim">Building</span>'}</td>
      <td>${p.autopilot ? chip('Autopilot', 'cyan') : '<span class="dim">You approve</span>'}</td></tr>`
    }).join('')}</tbody></table></div>`, { meta: plural(s.projects.length, 'project', 'projects') })
  },
  devin(s) {
    const online = s.presence === 'online'
    const matrix = `<div class="pbody" style="padding:0"><div class="matrix">
      <span class="h"></span><span class="h">Clear, checkable, under about 3 hours</span><span class="h">Needs taste, access or judgement</span>
      <span class="rh">You are offline</span><div class="${online ? '' : 'now'}"><b>Devin Cloud</b>Builds on its own. The client gets a holding reply, then the preview.</div><div class="${online ? '' : 'now'}"><b>Ask Devin</b>Writes a brief, queued for your morning. The client gets an honest ETA.</div>
      <span class="rh">You are online</span><div class="${online ? 'now' : ''}"><b>Devin Cloud</b>Runs in parallel while you review.</div><div class="${online ? 'now' : ''}"><b>Devin CLI</b>Opens locally with the brief copied. Hand off to the cloud once direction is set.</div>
    </div></div>`
    return panel('Sessions', sessions(s, s.tasks), { meta: s.tasksRunning ? s.tasksRunning + ' running' : plural(s.tasks.length, 'session', 'sessions') }) + panel('How requests are routed', matrix)
  },
  activity() {
    const groups = [['all', 'All'], ['lead', 'Gigs'], ['build', 'Devin'], ['money', 'Money'], ['note', 'Email and status']]
    const shown = feed.filter(e => filter === 'all' || (KINDS[e.kind] || KINDS.info)[2] === filter)
    const filters = `<div class="filters" role="group" aria-label="Filter activity">${groups.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}</div>`
    return panel('Activity', shown.length || !feed.length ? feedList(shown) : empty('', 'Nothing in this filter yet.', true), { extra: filters })
  },
  invoices(s) {
    const tabs = [['all', 'All'], ['open', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid']]
    const rows = s.invoices.filter(i => invFilter === 'all' || (invFilter === 'open' ? ['sent', 'part_paid', 'overdue'].includes(i.status) : i.status === invFilter))
    const filters = `<div class="filters" role="group" aria-label="Filter invoices">${tabs.map(([k, l]) => `<button type="button" data-inv="${k}" aria-pressed="${invFilter === k}">${l}</button>`).join('')}</div>`
    const table = !s.invoices.length
      ? empty('No invoices yet', 'The advance invoice goes out when a project starts, and change orders become invoices once the client says ok.')
      : rows.length ? `<div class="table-wrap"><table><thead><tr><th>Number</th><th>Project</th><th class="r">Amount</th><th class="r">Paid</th><th>Status</th></tr></thead><tbody>${rows.map(i => {
        const [l, t] = INVOICE[i.status] || [i.status, '']
        return `<tr><td class="num strong">${esc(i.number)}</td><td>${esc(i.name)}</td><td class="r num">${inr(i.amount)}</td><td class="r num ${i.paid_amount ? '' : 'dim'}">${inr(i.paid_amount)}</td><td>${chip(l, t, true)}</td></tr>`
      }).join('')}</tbody></table></div>` : empty('', 'No invoices in this filter.', true)
    return kpis(s, true) + panel('Invoices', table, { extra: filters })
  },
  connections(s) {
    const online = s.presence === 'online'
    const card = (title, ok, okText, badText, body, action) => `<section class="panel conn"><div class="conn-top"><h2>${title}</h2>${chip(ok ? okText : badText, ok ? 'green' : 'amber', true)}</div><p>${body}</p>${action}</section>`
    return `<div class="conns">
      ${card('WhatsApp', true, online ? 'You are online' : 'Covering', '', 'Devlancer runs as a linked device on your number. It never shows as online and writes in your voice.', '<a class="btn" href="/qr">Relink device</a>')}
      ${card('Devin', s.devin, 'Connected', 'Not connected', s.devin ? 'Cloud sessions, Knowledge, Schedules and Ask Devin are available over the Devin MCP server.' : 'Add <b>DEVIN_API_KEY</b> and <b>DEVIN_ORG_ID</b> to .env, then restart Devlancer.', '')}
      ${card('Gmail', s.gmail, 'Connected', 'Not connected', 'Reads client emails and payment receipts so invoices are matched without you.', s.gmail ? '' : '<a class="btn primary" href="/auth/google">Connect Gmail</a>')}
    </div>` + panel('Control from WhatsApp', `<div class="pbody"><p class="muted" style="margin-bottom:14px;max-width:70ch">Your "Message yourself" chat is the control panel. Approval cards arrive there: reply 1 to send, 2 to edit, 0 to skip.</p><dl class="cmds">
      <dt>/groups [search]</dt><dd>List your groups, most active first</dd>
      <dt>/m 1,4 &nbsp; /c 2</dt><dd>Mark marketplace groups and client groups</dd>
      <dt>/scan &nbsp; /gigs</dt><dd>Rescan marketplaces and list leads</dd>
      <dt>/won &lt;lead&gt;</dt><dd>Start a project from a lead</dd>
      <dt>/autopilot on|off &lt;slug&gt;</dt><dd>Let Devlancer reply to a project without approval</dd>
      <dt>/invoice &lt;slug&gt; &lt;amount&gt; &lt;note&gt;</dt><dd>Draft an invoice</dd>
      <dt>/online &nbsp; /offline</dt><dd>Tell Devlancer whether you are at the keyboard</dd>
    </dl></div>`)
  },
}

function kpis(s, moneyOnly) {
  const k = (cls, label, value, sub, isMoney = true) => `<div class="kpi ${cls}"><dt>${label}</dt><dd class="${value ? '' : 'zero'}">${isMoney ? inr(value) : value}</dd><p>${esc(sub)}</p></div>`
  return `<dl class="panel kpis" style="margin:0">
    ${k('scope', 'Scope creep caught', s.scopeCaught, s.changeOrders ? `Billed as ${plural(s.changeOrders, 'change order', 'change orders')}` : 'Out-of-scope requests get priced here')}
    ${k('owed' + (s.overdueCount ? ' late' : ''), 'Outstanding', s.outstanding, s.outstandingCount ? `${plural(s.outstandingCount, 'invoice', 'invoices')} unpaid${s.overdueCount ? `, ${s.overdueCount} overdue` : ''}` : 'Nothing waiting on clients')}
    ${k('paid', 'Collected', s.collected, s.payments ? `From ${plural(s.payments, 'payment', 'payments')}` : 'UPI and Gmail payments land here')}
    ${moneyOnly ? k('overdue' + (s.overdueCount ? ' late' : ''), 'Overdue', s.overdueCount, s.overdueCount ? 'Polite reminders are going out' : 'No late payers', false) : k('devin', 'Devin running', s.tasksRunning, `${plural(s.tasks.filter(t => t.status === 'done').length, 'request', 'requests')} delivered recently`, false)}
  </dl>`
}

function groupDeals(s) {
  const by = {}; STAGES.forEach(([k]) => by[k] = [])
  s.deals.forEach(d => (by[d.stage] || by.gig).push(d))
  return by
}

function track(s) {
  if (!s.deals.length) return empty('Watching your groups', 'No gigs yet. Mark your marketplace groups with <b>/m</b> in your self-chat, and each real gig post Devlancer spots lands here.')
  const by = groupDeals(s)
  return `<ol class="track">${STAGES.map(([k, label]) => {
    const ds = by[k]
    return `<li class="stage${ds.length ? ' has' : ''}" data-stage="${k}"><span class="cell"></span><div class="sh"><span class="count num">${ds.length}</span><span class="name">${label}</span></div>
    <ul class="mini">${ds.slice(0, 3).map(d => `<li class="${prevStage[d.id] && prevStage[d.id] !== d.stage ? 'moved' : ''}"><b title="${esc(d.title)}">${esc(d.title)}</b><span class="${d.overdue ? 'late' : ''}">${d.overdue ? 'Overdue' : esc([d.client, d.budget].filter(Boolean).join(', ')) || '&nbsp;'}</span></li>`).join('')}
    ${ds.length > 3 ? `<li class="more">${ds.length - 3} more</li>` : ''}</ul></li>`
  }).join('')}</ol>`
}

function dealCard(d) {
  const moved = prevStage[d.id] && prevStage[d.id] !== d.stage
  return `<article class="card${moved ? ' moved' : ''}"><h4>${esc(d.title)}</h4>
    ${d.client ? `<div class="who"><span class="avatar">${esc(initials(d.client))}</span><span>${esc(d.client)}</span></div>` : ''}
    <div class="row">${d.budget ? chip(d.budget) : ''}${d.overdue ? chip('Overdue', 'coral', true) : ''}${d.autopilot ? chip('Autopilot', 'cyan') : ''}${d.preview_url ? `<span class="links">${ext(d.preview_url, 'Preview')}</span>` : ''}</div></article>`
}

function sessions(s, list) {
  if (!list.length) return s.devin
    ? empty('', 'No sessions yet. Devin starts one when a client accepts a proposal or asks for a change.', true)
    : empty('Devin is not connected', 'Add DEVIN_API_KEY to .env and restart Devlancer. <a href="#/connections">See connections</a>', true)
  return `<ul class="sessions">${list.map(t => {
    const [l, tone] = TASK[t.status] || [t.status || 'Queued', 'amber']
    return `<li><div class="req">${esc(t.request)}</div><div class="row">${chip(l, tone, true)}${t.project ? `<span>${esc(t.project)}</span>` : ''}
      ${t.route && !/cloud|cli/i.test(t.route) && routeLabel(t.route) !== l ? chip(routeLabel(t.route), routeTone(t.route)) : ''}
      <span class="links">${ext(t.devin_url, 'Session')}${ext(t.pr_url, 'Pull request')}${ext(t.preview_url, 'Preview')}</span></div></li>`
  }).join('')}</ul>`
}

function feedList(list) {
  if (!list.length) return empty('Quiet for now', 'Activity from WhatsApp, Gmail and Devin shows up here as it happens.', true)
  return `<ul class="feed" aria-live="polite">${list.map(e => {
    const [label, fam, , ic] = KINDS[e.kind] || KINDS.info
    const proj = state && state.projects.find(p => p.name && e.text.includes(p.name))
    const sub = (e.route ? chip(e.route, routeTone(e.route)) : '') + (proj ? chip('#' + proj.slug) : '') + (e.url ? `<span class="links">${ext(e.url, 'Open')}</span>` : '')
    return `<li class="k-${fam}${e.ts === freshTs ? ' fresh' : ''}"><span class="ic" title="${label}">${icon(ic)}</span><div><p class="msg">${esc(e.text)}</p>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <time class="t" datetime="${new Date(e.ts).toISOString()}" title="${new Date(e.ts).toLocaleString('en-IN')}">${ago(e.ts)}</time></li>`
  }).join('')}</ul>`
}

/* ---------- Routing and render ---------- */
function render() {
  if (!state) return
  renderShell(state)
  const [title, sub] = PAGES[page]
  $('page-title').textContent = title
  $('page-sub').textContent = sub(state)
  document.title = page === 'overview' ? 'Devlancer' : `Devlancer: ${title}`
  $('view').innerHTML = VIEWS[page](state)
  prevStage = Object.fromEntries(state.deals.map(d => [d.id, d.stage]))
  freshTs = 0
}

function route() {
  const next = (location.hash.match(/^#\/(\w+)/) || [])[1]
  page = PAGES[next] ? next : 'overview'
  document.querySelectorAll('[data-page]').forEach(a => a.dataset.page === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'))
  document.documentElement.classList.remove('nav-open')
  render()
  window.scrollTo(0, 0)
}

document.querySelectorAll('.sidebar a[data-page]').forEach(a => a.dataset.label = a.querySelector('span').textContent)
window.addEventListener('hashchange', route)

$('view').addEventListener('click', ev => {
  const f = ev.target.closest('[data-f]'), inv = ev.target.closest('[data-inv]')
  if (f) { filter = f.dataset.f; render() }
  if (inv) { invFilter = inv.dataset.inv; render() }
})

/* Collapsible sidebar */
const root = document.documentElement
function setRail(on) {
  root.classList.toggle('rail', on)
  $('rail-toggle').setAttribute('aria-expanded', String(!on))
  $('rail-toggle').querySelector('span').textContent = on ? 'Expand' : 'Collapse'
  $('rail-toggle').title = (on ? 'Expand' : 'Collapse') + ' sidebar ( [ )'
  try { localStorage.setItem('dl-rail', on ? '1' : '0') } catch {}
}
setRail(root.classList.contains('rail'))
$('rail-toggle').addEventListener('click', () => setRail(!root.classList.contains('rail')))
$('menu').addEventListener('click', () => root.classList.add('nav-open'))
$('scrim').addEventListener('click', () => root.classList.remove('nav-open'))
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') root.classList.remove('nav-open')
  if (ev.key === '[' && !ev.metaKey && !ev.ctrlKey && !/input|textarea|select/i.test(document.activeElement.tagName)) setRail(!root.classList.contains('rail'))
})

/* ---------- Data ---------- */
function apply(s) { state = s; render() }

if (new URLSearchParams(location.search).has('demo')) {
  $('demo').hidden = false
  const m = 60000, n = Date.now()
  feed = [
    { ts: n - 2 * m, kind: 'devin', text: 'Devin Cloud session started for Homestay booking site: add a gallery section with 12 room photos', route: 'Devin Cloud', url: '#' },
    { ts: n - 6 * m, kind: 'scope', text: 'Scope creep caught on Tuition centre app: "Add online fee payments" priced at ₹10,000' },
    { ts: n - 9 * m, kind: 'task', text: 'Hands-on request on Tuition centre app: fix the fee calculator rounding. Opening Devin CLI', route: 'Devin CLI' },
    { ts: n - 14 * m, kind: 'gig', text: 'Gig in Kochi Freelancers: WhatsApp order bot for a pharmacy, ₹25,000 (fit 86%)' },
    { ts: n - 21 * m, kind: 'payment', text: 'Payment of ₹35,000 recorded for Restaurant menu site (UPI)' },
    { ts: n - 30 * m, kind: 'pitch', text: 'Pitched Clinic appointment booking site privately to Dr Meera' },
    { ts: n - 42 * m, kind: 'email', text: 'Client email from Fathima: Can we add a size chart?' },
    { ts: n - 75 * m, kind: 'invoice', text: 'Reminder sent for INV-2026-004 (Boutique catalogue), 6 days overdue' },
    { ts: n - 130 * m, kind: 'proposal', text: 'Proposal sent to Joseph for Inventory dashboard, ₹60,000 in 3 milestones' },
  ]
  apply({
    presence: 'offline', devin: true, gmail: false, scopeCaught: 18000, changeOrders: 2, outstanding: 42000, outstandingCount: 3, overdueCount: 1, collected: 65000, payments: 4, tasksRunning: 2,
    deals: [
      { id: 'l1', title: 'Landing page for a bakery in Kakkanad', client: 'Anu', budget: '₹15,000', stage: 'gig' },
      { id: 'l2', title: 'WhatsApp order bot for a pharmacy', client: 'Rahul', budget: '₹25,000', stage: 'gig' },
      { id: 'l5', title: 'Portfolio site for a wedding photographer', client: 'Nikhil', budget: '₹12,000', stage: 'gig' },
      { id: 'l3', title: 'Clinic appointment booking site', client: 'Dr Meera', budget: '₹30,000', stage: 'pitched' },
      { id: 'l4', title: 'Inventory dashboard for a spice exporter', client: 'Joseph', budget: '₹60,000', stage: 'proposal' },
      { id: 'p1', title: 'Homestay booking site', client: 'Thomas', stage: 'building' },
      { id: 'p2', title: 'Tuition centre app', client: 'Lakshmi', stage: 'live', autopilot: true, preview_url: '#' },
      { id: 'p3', title: 'Boutique catalogue', client: 'Fathima', stage: 'invoiced', overdue: true, preview_url: '#' },
      { id: 'p4', title: 'Restaurant menu site', client: 'Arjun', stage: 'paid', preview_url: '#' },
    ],
    tasks: [
      { request: 'Add a gallery section with 12 room photos', route: 'cloud', status: 'running', project: 'Homestay booking site', devin_url: '#' },
      { request: 'Fix the fee calculator rounding for sibling discounts', route: 'cli', status: 'running_local', project: 'Tuition centre app' },
      { request: 'Add a size chart to every product page', route: 'queued', status: 'queued', project: 'Boutique catalogue' },
      { request: 'Add a Malayalam language toggle', route: 'cloud', status: 'done', project: 'Tuition centre app', pr_url: '#', preview_url: '#' },
      { request: 'Compress menu photos for faster loading', route: 'cloud', status: 'done', project: 'Restaurant menu site', pr_url: '#' },
    ],
    projects: [
      { id: 1, slug: 'homestay', name: 'Homestay booking site', client_name: 'Thomas' },
      { id: 2, slug: 'tuition', name: 'Tuition centre app', client_name: 'Lakshmi', preview_url: '#', autopilot: 1 },
      { id: 3, slug: 'boutique', name: 'Boutique catalogue', client_name: 'Fathima', preview_url: '#' },
      { id: 4, slug: 'menu', name: 'Restaurant menu site', client_name: 'Arjun', preview_url: '#' },
    ],
    invoices: [
      { number: 'INV-2026-005', name: 'Tuition centre app', amount: 10000, paid_amount: 0, status: 'draft' },
      { number: 'INV-2026-004', name: 'Boutique catalogue', amount: 22000, paid_amount: 0, status: 'overdue' },
      { number: 'INV-2026-003', name: 'Tuition centre app', amount: 12000, paid_amount: 0, status: 'sent' },
      { number: 'INV-2026-002', name: 'Homestay booking site', amount: 16000, paid_amount: 8000, status: 'part_paid' },
      { number: 'INV-2026-001', name: 'Restaurant menu site', amount: 35000, paid_amount: 35000, status: 'paid' },
    ],
  })
  route()
} else {
  fetch('/api/state').then(r => r.json()).then(d => { feed = d.feed.slice().reverse(); apply(d.stats); route() })
  const es = new EventSource('/events')
  es.addEventListener('feed', msg => {
    const d = JSON.parse(msg.data)
    feed.unshift(d.ev); if (feed.length > 200) feed.pop()
    freshTs = d.ev.ts
    apply(d.stats)
  })
}
setInterval(render, 60000) // keep "x min ago" honest
