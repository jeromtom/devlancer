import fs from 'node:fs'
import path from 'node:path'
import type { Hono } from 'hono'

const root = path.resolve(import.meta.dirname, '..')
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }

function send(file: string, cache = 'no-cache') {
  return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': cache } })
}

/** Static dashboard UI: web/ for the app shell and script, design/ for tokens, fonts, components and brand. No app state is imported, so a preview server can mount it alone. */
export function mountUi(app: Hono) {
  app.get('/', () => send(path.join(root, 'web/index.html')))
  app.get('/app.js', () => send(path.join(root, 'web/app.js')))
  for (const f of ['tokens.css', 'fonts.css', 'components.css']) app.get('/' + f, () => send(path.join(root, 'design', f)))
  app.get('/brand/:file', c => (/^[a-z-]+\.svg$/.test(c.req.param('file')) ? send(path.join(root, 'design/brand', c.req.param('file'))) : c.notFound()))
  app.get('/fonts/:file', c => {
    const file = c.req.param('file')
    if (!/^[a-z-]+-[4-7]00-normal\.woff2$/.test(file) || !fs.existsSync(path.join(root, 'design/fonts', file))) return c.notFound()
    return c.body(fs.readFileSync(path.join(root, 'design/fonts', file)), 200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' })
  })
}
