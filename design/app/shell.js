/* Devlancer shell: icon sprite, sidebar, mobile bar and the command bar.
   Usage: <body data-page="approvals"><div class="app"><main class="main">...</main></div><script src="shell.js"></script> */
(function () {
  const ICONS = {
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    approvals: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16A2.5 2.5 0 0 1 4 13.5z"/><path d="m9 10 2 2 4-4"/>',
    gigs: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M11 8v6M8 11h6"/>',
    pipeline: '<rect x="3.5" y="4" width="4.5" height="16" rx="1.5"/><rect x="9.75" y="4" width="4.5" height="11" rx="1.5"/><rect x="16" y="4" width="4.5" height="7" rx="1.5"/>',
    projects: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    clients: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.7 3 2.3 3.5 4.7"/>',
    devin: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="2.2"/>',
    upkeep: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><path d="M12 8v4l2.5 1.5"/>',
    invoices: '<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
    scope: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z"/><path d="M9 12h6"/>',
    groups: '<path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.5-4.6A7.5 7.5 0 1 1 20 11.5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    rail: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    send: '<path d="M20.5 3.5 10 14"/><path d="m20.5 3.5-6.5 17-4-6.5-6.5-4z"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    skip: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    out: '<path d="M14 4.5h5.5V10M19.5 4.5l-8 8M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
    chat: '<path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.5-4.6A7.5 7.5 0 1 1 20 11.5z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.01"/>',
    more: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    filter: '<path d="M4 5.5h16l-6 7.5v5l-4 1.5v-6.5z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    pr: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2v7.6M18 15.8V10a3 3 0 0 0-3-3h-4"/><path d="m13 5-2 2 2 2"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
    terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l9-11h-6z"/>',
    rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 6.5 1.8 6.5 4S12 13 7 13l7 6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  }
  const sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') + '</defs></svg>'
  const icon = (n, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`
  window.dlIcon = icon

  const NAV = [
    [null, [['today', 'Today', 'today.html'], ['approvals', 'Approvals', 'approvals.html', '4', 'hot']]],
    ['Work', [['gigs', 'Gigs', 'gigs.html', '6'], ['pipeline', 'Pipeline', 'pipeline.html'], ['projects', 'Projects', 'projects.html', '4'], ['clients', 'Clients', 'clients.html']]],
    ['Devin', [['devin', 'Requests', 'requests.html', '2'], ['upkeep', 'Upkeep', 'upkeep.html']]],
    ['Money', [['invoices', 'Invoices', 'invoices.html', '1', 'alert'], ['scope', 'Scope ledger', 'scope.html']]],
  ]
  const FOOT = [['groups', 'Groups', 'groups.html'], ['settings', 'Settings', 'settings.html']]
  const page = document.body.dataset.page
  const link = ([id, label, href, count, tone]) =>
    `<a href="${href}" title="${label}"${id === page ? ' aria-current="page"' : ''}>${icon(id)}<span>${label}</span>${count ? `<em class="count ${tone || ''}">${count}</em>` : ''}</a>`
  const online = document.body.dataset.presence === 'online'

  const side = `<aside class="side" aria-label="Main">
    <div class="side-top"><a class="wordmark" href="today.html"><img src="brand/mark.svg" alt=""><span>Devlancer</span></a>
      <button class="side-collapse" type="button" title="Collapse sidebar  [" aria-label="Collapse sidebar">${icon('rail', 'i sm')}</button></div>
    <button class="jump" type="button" data-cmdk>${icon('search', 'i sm')}<span>Jump to or run</span><kbd>⌘K</kbd></button>
    <div class="presence${online ? ' online' : ''}"><span class="pdot"></span><b>${online ? 'You are online' : 'Covering for you'}</b><span>${online ? 'Drafts wait for your approval' : 'Until 8:00 tomorrow'}</span>
      <div class="seg" role="group" aria-label="Presence"><button type="button" aria-pressed="${online}">Online</button><button type="button" aria-pressed="${!online}">Away</button></div></div>
    <nav class="nav">${NAV.map(([h, items]) => `<div class="nav-group">${h ? `<p>${h}</p>` : ''}${items.map(link).join('')}</div>`).join('')}</nav>
    <div class="side-foot nav">${FOOT.map(link).join('')}
      <div class="me"><span class="avatar sm">JT</span><div><b>Jerom</b><span>Freelance developer, Kochi</span></div></div></div>
  </aside>`
  const mobile = `<div class="mobile-bar"><button class="menu-btn" type="button" aria-label="Open menu">${icon('menu')}</button><a class="wordmark" href="today.html"><img src="brand/mark.svg" alt="" style="width:22px;height:22px"><span>Devlancer</span></a></div>`

  const app = document.querySelector('.app')
  document.body.insertAdjacentHTML('afterbegin', sprite)
  app.insertAdjacentHTML('afterbegin', side)
  app.querySelector('.main').insertAdjacentHTML('afterbegin', mobile)

  // Fill <i data-i="name"> placeholders used inside screens
  document.querySelectorAll('[data-i]').forEach(el => { el.outerHTML = icon(el.dataset.i, 'i' + (el.classList.contains('sm') ? ' sm' : '')) })

  // Collapse to rail
  try { if (localStorage.getItem('dl-rail') === '1') app.classList.add('rail') } catch {}
  const toggleRail = () => { app.classList.toggle('rail'); try { localStorage.setItem('dl-rail', app.classList.contains('rail') ? '1' : '0') } catch {} }
  app.querySelector('.side-collapse').addEventListener('click', toggleRail)
  app.querySelector('.wordmark img').addEventListener('click', e => { if (app.classList.contains('rail')) { e.preventDefault(); toggleRail() } })
  document.querySelector('.menu-btn').addEventListener('click', () => document.documentElement.classList.add('nav-open'))
  document.querySelectorAll('.presence .seg button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.presence .seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
  }))

  // Command bar
  const CMDS = [
    ['Go to', [['approvals', 'Approvals', 'approvals.html', 'G A'], ['gigs', 'Gigs', 'gigs.html', 'G G'], ['projects', 'Projects', 'projects.html', 'G P'], ['invoices', 'Invoices', 'invoices.html', 'G I']]],
    ['Actions', [['moon', 'Go away until 8:00', '#', ''], ['plus', 'New invoice', 'invoice.html', 'N I'], ['file', 'New proposal', 'proposal.html', 'N P'], ['gigs', 'Rescan marketplace groups', '#', '']]],
    ['Projects', [['projects', 'Homestay booking site', 'project.html', 'Thomas'], ['projects', 'Tuition centre app', 'project.html', 'Lakshmi']]],
  ]
  const cmdk = `<div class="scrim" hidden data-cmdk-scrim></div><div class="cmdk" role="dialog" aria-label="Command bar" hidden>
    <div class="cmdk-input">${icon('search')}<input placeholder="Search projects, clients, invoices, or type a command" aria-label="Command"></div>
    <div class="cmdk-list">${CMDS.map(([h, items]) => `<p>${h}</p>` + items.map(([ic, t, href, hint], i) => `<a href="${href}"${h === 'Go to' && i === 0 ? ' aria-selected="true"' : ''}>${icon(ic, 'i sm')}<span>${t}</span><span class="hint">${hint}</span></a>`).join('')).join('')}</div>
    <div class="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div></div>`
  document.body.insertAdjacentHTML('beforeend', cmdk)
  const box = document.querySelector('.cmdk'), scrim = document.querySelector('[data-cmdk-scrim]')
  const open = on => { box.hidden = scrim.hidden = !on; if (on) box.querySelector('input').focus() }
  document.querySelectorAll('[data-cmdk]').forEach(b => b.addEventListener('click', () => open(true)))
  scrim.addEventListener('click', () => open(false))
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(box.hidden) }
    if (e.key === 'Escape') { open(false); document.documentElement.classList.remove('nav-open') }
    if (e.key === '[' && !/input|textarea|select/i.test(document.activeElement.tagName)) toggleRail()
  })
  if (location.hash === '#cmdk') open(true)
})()
