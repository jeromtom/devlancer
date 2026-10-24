import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { createHash } from 'node:crypto'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { board, history } from './board.js'
import { bus, recentFeed, type FeedEvent } from './bus.js'
import { config } from './config.js'
import { lastQr } from './wa.js'
import { gmailAuthUrl, gmailCallback, gmailReady } from './gmail.js'
import { presence } from './control.js'
import { devinReady } from './devin.js'
import { mountUi } from './ui.js'

/** Live feed events start here; anything older comes from the database. */
const bootTime = Date.now()

export function stats() {
  return { presence: presence(), devin: devinReady(), gmail: gmailReady(), ...board() }
}

const feedState = () => [...history(bootTime), ...recentFeed()]

/** Local-only test hook: lets a script drive the self-chat control panel (set by index.ts). */
export const devHooks: { self?: (text: string) => void } = {}

export function startDashboard() {
  const app = new Hono()
  // Public deployment: a login screen with one shared password, then a signed session cookie
  if (config.dashboardPassword) {
    const secret = createHash('sha256').update(`devlancer:${config.dashboardPassword}:${config.devToken}`).digest('hex')
    const OPEN = /^\/(healthz|login|logout|tokens\.css|fonts\.css|components\.css|fonts\/|brand\/|auth\/google\/callback|dev\/self)/
    app.use('*', async (c, next) => {
      if (OPEN.test(c.req.path)) return next()
      if ((await getSignedCookie(c, secret, 'dl_session')) === 'ok') return next()
      if (c.req.path.startsWith('/api') || c.req.path === '/events') return c.json({ error: 'login required' }, 401)
      return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`)
    })
    app.get('/login', c => c.html(loginPage(c.req.query('error') ? 'That password did not work. Try again.' : '', c.req.query('next') ?? '/')))
    app.post('/login', async c => {
      const form = await c.req.parseBody()
      const next = String(form.next ?? '/').startsWith('/') ? String(form.next ?? '/') : '/'
      if (String(form.password ?? '') !== config.dashboardPassword) return c.redirect(`/login?error=1&next=${encodeURIComponent(next)}`)
      await setSignedCookie(c, 'dl_session', 'ok', secret, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
      return c.redirect(next)
    })
    app.get('/logout', c => {
      deleteCookie(c, 'dl_session', { path: '/' })
      return c.redirect('/login')
    })
  }
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
  app.get('/api/state', c => c.json({ stats: stats(), feed: feedState() }))
  app.get('/events', c =>
    streamSSE(c, async s => {
      const onFeed = (ev: FeedEvent) => s.writeSSE({ event: 'feed', data: JSON.stringify({ ev, stats: stats() }) })
      bus.on('feed', onFeed)
      s.onAbort(() => void bus.off('feed', onFeed))
      while (!s.aborted) await s.sleep(15000).then(() => s.writeSSE({ event: 'ping', data: '' }))
    }),
  )
  app.get('/qr', c =>
    c.html(
      lastQr
        ? notice('Link WhatsApp', `<img class="qr" src="${lastQr}" width="280" height="280" alt="WhatsApp link code"><p>On your phone, open WhatsApp, go to Linked devices, tap Link a device and scan this code. It refreshes every 15 seconds.</p>`, '<meta http-equiv="refresh" content="15">')
        : notice('WhatsApp is linked', '<p>No code to scan. Devlancer is already linked to your number, or a fresh code is on its way. This page shows it as soon as it arrives.</p><a class="btn primary" href="/">Open dashboard</a>', '<meta http-equiv="refresh" content="10">'),
    ),
  )
  app.get('/auth/google', c => (config.googleClientId ? c.redirect(gmailAuthUrl()) : c.text('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first')))
  app.get('/auth/google/callback', async c => {
    await gmailCallback(c.req.query('code') ?? '')
    return c.html(notice('Gmail connected', '<p>Devlancer can now read client emails and payment receipts. You can close this tab.</p><a class="btn primary" href="/#/connections">Back to connections</a>'))
  })
  serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  console.log(`Dashboard on http://localhost:${config.port}`)
}

const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** Login screen: one password field, branded like the rest of the app. */
const loginPage = (error: string, next: string) =>
  notice(
    'Sign in',
    `<p>Your freelance dev that finds the gig, builds it, and keeps the client happy.</p>
<form method="post" action="/login" style="display:grid;gap:12px;width:100%">
<input type="hidden" name="next" value="${esc(next)}">
<label style="display:grid;gap:6px;font-weight:500">Password<input class="input" type="password" name="password" autocomplete="current-password" autofocus required style="padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-control);font:inherit;background:var(--surface,#fff);color:inherit"></label>
${error ? `<p role="alert" style="color:var(--danger,#b42318);margin:0">${error}</p>` : ''}
<button class="btn primary" type="submit">Open dashboard</button>
</form>`,
  )

/** Small branded page for one-off screens (WhatsApp linking, OAuth return). */
const notice = (title: string, body: string, head = '') => `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}
<title>Devlancer: ${title}</title><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/components.css">
<style>body{min-height:100vh;display:grid;place-items:center;padding:24px}.box{max-width:420px;display:grid;gap:16px;justify-items:start;padding:32px}.box h1{font:700 var(--text-2xl)/1.15 var(--font-display);letter-spacing:-.02em}.box p{color:var(--ink-2)}.qr{border-radius:var(--r-control);border:1px solid var(--line)}</style></head>
<body><main class="panel box"><img src="/brand/mark.svg" width="36" height="36" alt="Devlancer"><h1>${title}</h1>${body}</main></body></html>`
