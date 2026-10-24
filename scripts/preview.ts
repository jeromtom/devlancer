// Dashboard against the real database, without starting WhatsApp or Devin. Read-only: it never sends anything.
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { mountUi } from '../src/ui.js'
import { board, history } from '../src/board.js'
import { getSetting } from '../src/db.js'
import { config } from '../src/config.js'
import { gmailReady } from '../src/gmail.js'

const app = new Hono()
mountUi(app)
app.get('/api/state', c =>
  c.json({
    stats: { presence: getSetting('presence', 'online'), devin: Boolean(config.devinApiKey), gmail: gmailReady(), ...board() },
    feed: history(),
  }),
)
app.get('/events', c => streamSSE(c, async s => { while (!s.aborted) await s.sleep(15000).then(() => s.writeSSE({ event: 'ping', data: '' })) }))
const port = Number(process.env.PREVIEW_PORT ?? 4100)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
console.log(`Preview of the real data on http://localhost:${port}`)
