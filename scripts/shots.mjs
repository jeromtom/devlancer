// Screenshot every dashboard page from the preview server (real data): node scripts/shots.mjs [outDir]
import { chromium } from 'playwright'
const out = process.argv[2] ?? '/tmp/dl'
const base = 'http://localhost:4100/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 960 } })
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
for (const pg of ['overview', 'pipeline', 'projects', 'devin', 'activity', 'invoices', 'connections']) {
  await p.goto(`${base}#/${pg}`); await p.waitForTimeout(400)
  await p.screenshot({ path: `${out}-${pg}.png`, fullPage: true })
}
await p.goto(`${base}#/overview`); await p.click('#rail-toggle'); await p.waitForTimeout(400)
await p.screenshot({ path: `${out}-rail.png` })
await p.evaluate(() => localStorage.clear())
const m = await b.newPage({ viewport: { width: 390, height: 844 } })
await m.goto(`${base}#/overview`); await m.waitForTimeout(300); await m.screenshot({ path: `${out}-mobile.png`, fullPage: true })
await m.click('#menu'); await m.waitForTimeout(400); await m.screenshot({ path: `${out}-mobile-nav.png` })
console.log(errs.length ? errs : 'no errors')
await b.close()
