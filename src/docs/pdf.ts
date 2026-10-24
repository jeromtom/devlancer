import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import QRCode from 'qrcode'
import type { ChangeOrderData, InvoiceData, LineItem, ProposalData } from './types.js'
import { changeOrderHtml, inr as inrImpl, invoiceHtml, proposalHtml, totals as totalsImpl } from './templates.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(REPO_ROOT, 'out', 'pdf')

export function totals(items: LineItem[]): number {
  return totalsImpl(items)
}

export function inr(n: number): string {
  return inrImpl(n)
}

let browserPromise: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      browserPromise = null
      throw err
    })
  }
  return browserPromise
}

export async function closePdf(): Promise<void> {
  const p = browserPromise
  browserPromise = null
  if (p) {
    try {
      await (await p).close()
    } catch {
      /* ignore */
    }
  }
}

function safeName(number: string): string {
  return String(number).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'document'
}

async function renderHtml(html: string, number: string): Promise<string> {
  await mkdir(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${safeName(number)}.pdf`)
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.pdf({
      path: file,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '16mm', right: '16mm' },
    })
  } finally {
    await page.close()
  }
  return file
}

export async function renderProposal(data: ProposalData): Promise<string> {
  return renderHtml(proposalHtml(data), data.number)
}

export async function renderInvoice(data: InvoiceData): Promise<string> {
  let qr: string | undefined
  if (data.upiId) {
    const balance = Math.max(0, totals(data.items) - (data.amountPaid || 0))
    const params = [
      ['pa', data.upiId],
      ['pn', data.from.business || data.from.name],
      ['am', balance.toFixed(2)],
      ['cu', 'INR'],
      ['tn', data.number],
    ]
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    qr = await QRCode.toDataURL(`upi://pay?${params}`, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
  }
  return renderHtml(invoiceHtml(data, qr), data.number)
}

export async function renderChangeOrder(data: ChangeOrderData): Promise<string> {
  return renderHtml(changeOrderHtml(data), data.number)
}
