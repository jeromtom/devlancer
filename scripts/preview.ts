// UI-only preview: serves the dashboard without WhatsApp, Devin or the database. Open /?demo for sample data.
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { mountUi } from '../src/ui.js'

const app = new Hono()
mountUi(app)
const port = Number(process.env.PREVIEW_PORT ?? 4100)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
console.log(`Preview on http://localhost:${port}/?demo`)
