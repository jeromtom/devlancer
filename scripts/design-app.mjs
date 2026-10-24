// Prepares design/app for Claude Design: copies shared tokens, fonts and brand, then renders thumbnails.
// Usage: node scripts/design-app.mjs   (serves design/app itself on a free port)
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '../design')
const app = path.join(root, 'app')
for (const f of ['tokens.css', 'fonts.css']) fs.copyFileSync(path.join(root, f), path.join(app, f))
for (const d of ['fonts', 'brand']) fs.cpSync(path.join(root, d), path.join(app, d), { recursive: true })

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const file = path.join(app, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(app) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
}).listen(0)
const base = `http://localhost:${server.address().port}/`

const pages = fs.readdirSync(app).filter(f => f.endsWith('.html') && f !== 'index.html')
fs.mkdirSync(path.join(app, 'thumbs'), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 })
const problems = []
page.on('pageerror', e => problems.push(e.message))
page.on('response', r => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`))
for (const p of [...pages, 'today.html#cmdk']) {
  await page.goto(base + p)
  await page.waitForTimeout(300)
  const name = p === 'today.html#cmdk' ? 'cmdk' : p.replace('.html', '')
  await page.screenshot({ path: path.join(app, 'thumbs', `${name}.png`) })
}
await browser.close()
server.close()
console.log(`${pages.length + 1} thumbnails`, problems.length ? problems : 'no errors')
