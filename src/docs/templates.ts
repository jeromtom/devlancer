import type { ChangeOrderData, InvoiceData, LineItem, Party, ProposalData } from './types.js'

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function totals(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0)
}

export function inr(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const neg = v < 0
  const abs = Math.abs(v)
  const hasPaise = Math.round(abs * 100) % 100 !== 0
  const s = abs.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return `${neg ? '-' : ''}₹${s}`
}

const ACCENT = '#0f766e'

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    color: #1f2937; font-size: 10.5pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .band { height: 6px; background: ${ACCENT}; margin-bottom: 22px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .brand { font-size: 15pt; font-weight: 700; color: #111827; }
  .brand small { display: block; font-size: 9pt; font-weight: 400; color: #6b7280; line-height: 1.45; }
  .doctype { text-align: right; }
  .doctype h1 { margin: 0; font-size: 22pt; letter-spacing: 2px; color: ${ACCENT}; font-weight: 800; }
  .pill { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 999px; background: #ccfbf1; color: ${ACCENT}; font-size: 8.5pt; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
  .meta { margin-top: 8px; font-size: 9.5pt; color: #374151; }
  .meta td { padding: 1px 0 1px 12px; text-align: right; }
  .meta td.k { color: #6b7280; }
  .cover { background: #f0fdfa; border-left: 4px solid ${ACCENT}; padding: 18px 20px; margin: 20px 0 8px; border-radius: 4px; }
  .cover .eyebrow { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1.5px; color: ${ACCENT}; font-weight: 700; }
  .cover h1 { margin: 4px 0 10px; font-size: 20pt; line-height: 1.25; color: #111827; }
  .grid { display: flex; gap: 24px; flex-wrap: wrap; }
  .grid > div { flex: 1; min-width: 140px; }
  .label { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; margin-bottom: 2px; }
  .parties { display: flex; gap: 24px; margin: 22px 0 6px; }
  .parties > div { flex: 1; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 6px; }
  .pname { font-weight: 700; color: #111827; }
  .muted { color: #6b7280; font-size: 9.5pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1.2px; color: ${ACCENT}; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d1d5db; page-break-after: avoid; }
  p { margin: 0 0 8px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 2px 0; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; page-break-inside: auto; }
  table.items th { background: ${ACCENT}; color: #fff; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .6px; padding: 7px 10px; font-weight: 600; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.items tr { page-break-inside: avoid; }
  table.items tbody tr:nth-child(even) td { background: #f9fafb; }
  .num { text-align: right !important; white-space: nowrap; }
  .sum { width: 300px; margin-left: auto; margin-top: 10px; border-collapse: collapse; }
  .sum td { padding: 5px 10px; }
  .sum td:last-child { text-align: right; white-space: nowrap; }
  .sum tr.total td { border-top: 2px solid ${ACCENT}; font-weight: 700; font-size: 12pt; color: #111827; padding-top: 8px; }
  .due { margin-top: 14px; display: flex; justify-content: flex-end; }
  .due > div { background: ${ACCENT}; color: #fff; border-radius: 8px; padding: 12px 20px; text-align: right; min-width: 300px; }
  .due .label { color: #ccfbf1; }
  .due .amt { font-size: 24pt; font-weight: 800; letter-spacing: .5px; line-height: 1.2; }
  .pay { display: flex; gap: 24px; margin-top: 22px; align-items: flex-start; page-break-inside: avoid; }
  .pay > div { flex: 1; }
  .qr { flex: 0 0 auto !important; text-align: center; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .qr img { width: 150px; height: 150px; display: block; margin: 0 auto 4px; }
  .qr .cap { font-size: 9pt; font-weight: 600; color: #111827; }
  .quote { border-left: 4px solid ${ACCENT}; background: #f9fafb; padding: 10px 14px; font-style: italic; color: #374151; border-radius: 0 4px 4px 0; white-space: pre-wrap; }
  .sign { display: flex; gap: 40px; margin-top: 30px; page-break-inside: avoid; }
  .sign > div { flex: 1; }
  .line { border-bottom: 1px solid #9ca3af; height: 42px; margin-bottom: 4px; }
  .approve { margin-top: 24px; padding: 14px 16px; border: 2px dashed ${ACCENT}; border-radius: 8px; background: #f0fdfa; page-break-inside: avoid; }
  .approve strong { color: ${ACCENT}; }
  .notes { white-space: pre-wrap; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #9ca3af; text-align: center; }
`

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="band"></div>${body}</body></html>`
}

function displayName(p: Party): string {
  return p.business || p.name
}

function partyBlock(label: string, p: Party): string {
  const lines: string[] = []
  if (p.business && p.business !== p.name) lines.push(esc(p.name))
  if (p.address) lines.push(esc(p.address).replace(/\n/g, '<br>'))
  if (p.email) lines.push(esc(p.email))
  if (p.phone) lines.push(esc(p.phone))
  return `<div><div class="label">${esc(label)}</div><div class="pname">${esc(displayName(p))}</div><div class="muted">${lines.join('<br>')}</div></div>`
}

function senderHeader(from: Party): string {
  const bits = [from.business && from.business !== from.name ? from.name : '', from.email, from.phone]
    .filter(Boolean)
    .map(esc)
  return `<div class="brand">${esc(displayName(from))}<small>${bits.join(' &middot; ')}</small></div>`
}

function list(items: string[]): string {
  if (!items?.length) return '<p class="muted">None.</p>'
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
}

function itemsTable(items: LineItem[]): string {
  const rows = items
    .map(
      (i, n) =>
        `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="num">${esc(i.qty)}</td><td class="num">${inr(i.rate)}</td><td class="num">${inr(i.qty * i.rate)}</td></tr>`,
    )
    .join('')
  return `<table class="items"><thead><tr><th style="width:28px">#</th><th>Description</th><th class="num" style="width:50px">Qty</th><th class="num" style="width:100px">Rate</th><th class="num" style="width:110px">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
}

function metaTable(rows: [string, string][]): string {
  return `<table class="meta">${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</table>`
}

function footer(from: Party, number: string): string {
  return `<div class="foot">${esc(displayName(from))} &middot; ${esc(number)}</div>`
}

export function proposalHtml(d: ProposalData): string {
  const total = totals(d.items)
  const ms = d.milestones
    .map(
      (m) =>
        `<tr><td>${esc(m.name)}</td><td>${esc(m.due)}</td><td class="num">${esc(m.amountPct)}%</td><td class="num">${inr((total * m.amountPct) / 100)}</td></tr>`,
    )
    .join('')
  const body = `
  <div class="head">${senderHeader(d.from)}<div class="doctype"><h1>PROPOSAL</h1>${metaTable([
    ['Proposal no.', d.number],
    ['Date', d.date],
    ['Valid until', d.validUntil],
  ])}</div></div>
  <div class="cover">
    <div class="eyebrow">Project proposal</div>
    <h1>${esc(d.title)}</h1>
    <div class="grid">
      <div><div class="label">Prepared for</div><div class="pname">${esc(displayName(d.to))}</div>${d.to.business && d.to.business !== d.to.name ? `<div class="muted">${esc(d.to.name)}</div>` : ''}</div>
      <div><div class="label">Prepared by</div><div class="pname">${esc(displayName(d.from))}</div>${d.from.business && d.from.business !== d.from.name ? `<div class="muted">${esc(d.from.name)}</div>` : ''}</div>
      <div><div class="label">Investment</div><div class="pname">${inr(total)}</div></div>
    </div>
  </div>
  <h2>Summary</h2><p class="notes">${esc(d.summary)}</p>
  <h2>Our understanding</h2>${list(d.understanding)}
  <h2>Scope of work</h2>${list(d.scope)}
  <h2>Deliverables</h2>${list(d.deliverables)}
  <h2>Out of scope</h2>${list(d.outOfScope)}
  <h2>Timeline</h2>
  <table class="items"><thead><tr><th>Milestone</th><th style="width:140px">Due</th><th class="num" style="width:80px">% of fee</th><th class="num" style="width:110px">Amount</th></tr></thead><tbody>${ms}</tbody></table>
  <h2>Investment</h2>${itemsTable(d.items)}
  <table class="sum"><tr class="total"><td>Total</td><td>${inr(total)}</td></tr></table>
  <h2>Payment terms</h2>${list(d.paymentTerms)}
  ${d.notes ? `<h2>Notes</h2><p class="notes">${esc(d.notes)}</p>` : ''}
  <h2>Acceptance</h2>
  <p>By signing below, both parties agree to the scope, timeline and investment set out in this proposal.</p>
  <div class="sign">
    <div><div class="line"></div><div class="pname">${esc(d.to.name)}</div><div class="muted">${esc(d.to.business || 'Client')} &middot; Date: ____________</div></div>
    <div><div class="line"></div><div class="pname">${esc(d.from.name)}</div><div class="muted">${esc(d.from.business || 'Service provider')} &middot; Date: ____________</div></div>
  </div>
  ${footer(d.from, d.number)}`
  return page(`Proposal ${d.number}`, body)
}

const KIND_LABEL: Record<InvoiceData['kind'], string> = {
  advance: 'Advance',
  milestone: 'Milestone',
  change_order: 'Change order',
  final: 'Final',
  retainer: 'Retainer',
}

export function invoiceHtml(d: InvoiceData, qrDataUrl?: string): string {
  const subtotal = totals(d.items)
  const paid = d.amountPaid || 0
  const balance = subtotal - paid
  const bank = d.bankDetails?.length
    ? `<div><div class="label">Bank transfer</div><div>${d.bankDetails.map(esc).join('<br>')}</div></div>`
    : ''
  const qr =
    d.upiId && qrDataUrl
      ? `<div class="qr"><img src="${qrDataUrl}" alt="UPI QR"><div class="cap">Scan to pay with any UPI app</div><div class="muted">UPI ID: ${esc(d.upiId)}</div></div>`
      : d.upiId
        ? `<div><div class="label">UPI</div><div>${esc(d.upiId)}</div></div>`
        : ''
  const payBlock =
    bank || qr
      ? `<h2>Payment details</h2><div class="pay">${bank || '<div></div>'}${qr}</div>`
      : ''
  const body = `
  <div class="head">${senderHeader(d.from)}<div class="doctype"><h1>INVOICE</h1><div class="pill">${esc(KIND_LABEL[d.kind] ?? d.kind)}</div>${metaTable([
    ['Invoice no.', d.number],
    ['Date', d.date],
    ['Due date', d.dueDate],
  ])}</div></div>
  <div class="parties">${partyBlock('Bill from', d.from)}${partyBlock('Bill to', d.to)}</div>
  <p style="margin-top:10px"><span class="label">Project</span><br><strong>${esc(d.projectName)}</strong></p>
  ${itemsTable(d.items)}
  <table class="sum">
    <tr><td>Subtotal</td><td>${inr(subtotal)}</td></tr>
    <tr><td>Amount paid</td><td>${paid ? '-' + inr(paid) : inr(0)}</td></tr>
  </table>
  <div class="due"><div><div class="label">Balance due by ${esc(d.dueDate)}</div><div class="amt">${inr(balance)}</div></div></div>
  ${payBlock}
  ${d.notes ? `<h2>Notes</h2><p class="notes">${esc(d.notes)}</p>` : ''}
  ${footer(d.from, d.number)}`
  return page(`Invoice ${d.number}`, body)
}

export function changeOrderHtml(d: ChangeOrderData): string {
  const total = totals(d.items)
  const body = `
  <div class="head">${senderHeader(d.from)}<div class="doctype"><h1>CHANGE ORDER</h1>${metaTable([
    ['Change order no.', d.number],
    ['Date', d.date],
  ])}</div></div>
  <div class="parties">${partyBlock('From', d.from)}${partyBlock('For', d.to)}</div>
  <p style="margin-top:10px"><span class="label">Project</span><br><strong>${esc(d.projectName)}</strong></p>
  <h2>Your request</h2><div class="quote">&ldquo;${esc(d.request)}&rdquo;</div>
  <h2>Why this is outside the agreed scope</h2><p class="notes">${esc(d.reason)}</p>
  <h2>Additional cost</h2>${itemsTable(d.items)}
  <table class="sum"><tr class="total"><td>Total for this change</td><td>${inr(total)}</td></tr></table>
  <h2>Timeline impact</h2><p class="notes">${esc(d.timelineImpact)}</p>
  <div class="approve"><strong>Approval:</strong> Reply 'approved' to proceed. Work on this change begins once approval is received, and the amount above will be added to the project invoice.</div>
  ${footer(d.from, d.number)}`
  return page(`Change order ${d.number}`, body)
}
