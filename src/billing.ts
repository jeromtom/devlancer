import { z } from 'zod'
import { db, now, nextNumber, type Lead, type Project } from './db.js'
import { extract, write } from './ai.js'
import { config } from './config.js'
import { feed } from './bus.js'
import { ask, onApproval, onCommand } from './control.js'
import { notify, sendPdf, sendText } from './wa.js'
import { gmailReady, sendEmail } from './gmail.js'
import { renderProposal, renderInvoice, renderChangeOrder, totals, inr } from './docs/pdf.js'
import type { InvoiceData, LineItem, Party, ProposalData } from './docs/types.js'

const today = (plusDays = 0) =>
  new Date(Date.now() + plusDays * 864e5).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export const fromParty = (): Party => ({
  name: config.freelancer.name,
  business: config.freelancer.business,
  email: config.freelancer.email,
  address: config.freelancer.address,
})

const phoneOf = (jid: string) => (jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0]}` : undefined)

const itemSchema = z.object({ description: z.string(), qty: z.number(), rate: z.number() })

function conversation(chatJids: string[], limit = 40) {
  if (!chatJids.length) return ''
  const rows = db
    .prepare(`select sender_name, from_me, text from messages where chat_jid in (${chatJids.map(() => '?').join(',')}) order by ts desc limit ?`)
    .all(...chatJids, limit) as { sender_name: string; from_me: number; text: string }[]
  return rows.reverse().map(r => `${r.from_me ? 'Me' : r.sender_name || 'Client'}: ${r.text}`).join('\n')
}

// ---------- Proposal ----------

export async function makeProposal(lead: Lead) {
  const ctx = `Original gig post by ${lead.poster_name}:\n${lead.summary}\nBudget mentioned: ${lead.budget || 'not stated'}\nDeadline: ${lead.deadline || 'not stated'}\n\nPrivate chat so far:\n${conversation([lead.poster_jid])}`
  const p = await extract(
    z.object({
      title: z.string(),
      summary: z.string().describe('2-3 sentence executive summary'),
      understanding: z.array(z.string()),
      scope: z.array(z.string()),
      deliverables: z.array(z.string()),
      outOfScope: z.array(z.string()),
      milestones: z.array(z.object({ name: z.string(), due: z.string(), amountPct: z.number() })).describe('percentages sum to 100'),
      items: z.array(itemSchema).describe('priced line items in INR; respect the client budget if stated'),
      paymentTerms: z.array(z.string()),
      clientBusiness: z.string().describe('client business name if known, else empty'),
    }),
    'Write a professional, realistic project proposal for this gig. Keep it tight and specific to the client. Default terms: 50% advance, 50% on delivery, 1 round of revisions included, hosting and domain billed separately.',
    ctx,
  )
  const data: ProposalData = {
    number: nextNumber('PR'),
    date: today(),
    validUntil: today(14),
    from: fromParty(),
    to: { name: lead.poster_name || 'Client', business: p.clientBusiness || undefined, phone: phoneOf(lead.poster_jid) },
    title: p.title,
    summary: p.summary,
    understanding: p.understanding,
    scope: p.scope,
    deliverables: p.deliverables,
    outOfScope: p.outOfScope,
    milestones: p.milestones,
    items: p.items,
    paymentTerms: p.paymentTerms,
  }
  const pdf = await renderProposal(data)
  const docId = Number(
    db.prepare(`insert into documents (lead_id, kind, number, data_json, pdf_path, created_at) values (?, 'proposal', ?, ?, ?, ?)`)
      .run(lead.id, data.number, JSON.stringify(data), pdf, now()).lastInsertRowid,
  )
  feed('proposal', `Proposal ${data.number} for ${lead.title}: ${inr(totals(data.items))}`)
  return { docId, pdf, data }
}

export async function sendDocument(docId: number, jid: string, email?: string) {
  const doc = db.prepare(`select * from documents where id = ?`).get(docId) as any
  const data = JSON.parse(doc.data_json)
  const label = doc.kind === 'proposal' ? 'proposal' : doc.kind === 'change_order' ? 'change order' : 'invoice'
  const caption = await write(
    `Write a one or two line WhatsApp caption to send with the attached ${label} (${data.title ?? data.projectName}). Friendly, no pressure.`,
  )
  await sendPdf(jid, doc.pdf_path, `${doc.number}.pdf`, caption)
  const via = ['whatsapp']
  if (email && gmailReady()) {
    const body = await write(
      `Write a short professional email body (not WhatsApp) sending the attached ${label} ${doc.number} for ${data.title ?? data.projectName}. Sign off as ${config.freelancer.name}${config.freelancer.business ? `, ${config.freelancer.business}` : ''}.`,
    )
    await sendEmail(email, `${label[0].toUpperCase()}${label.slice(1)} ${doc.number}: ${data.title ?? data.projectName}`, body, [
      { path: doc.pdf_path, name: `${doc.number}.pdf` },
    ])
    via.push('gmail')
  }
  db.prepare(`update documents set status = 'sent', sent_via = ? where id = ?`).run(via.join(','), docId)
  db.prepare(`update invoices set status = 'sent' where document_id = ? and status = 'draft'`).run(docId)
  feed(doc.kind === 'invoice' ? 'invoice' : 'proposal', `Sent ${doc.number} via ${via.join(' + ')}`)
}

// ---------- Invoices ----------

export async function draftInvoice(project: Project, kind: InvoiceData['kind'], items: LineItem[], notes?: string) {
  const data: InvoiceData = {
    number: nextNumber('INV'),
    date: today(),
    dueDate: today(7),
    kind,
    from: fromParty(),
    to: { name: project.client_name || 'Client', email: project.client_email || undefined, phone: phoneOf(project.client_jid) },
    projectName: project.name,
    items,
    amountPaid: 0,
    upiId: config.freelancer.upiId || undefined,
    notes,
  }
  const pdf = await renderInvoice(data)
  const docId = Number(
    db.prepare(`insert into documents (project_id, kind, number, data_json, pdf_path, created_at) values (?, 'invoice', ?, ?, ?, ?)`)
      .run(project.id, data.number, JSON.stringify(data), pdf, now()).lastInsertRowid,
  )
  const amount = totals(items)
  db.prepare(`insert into invoices (document_id, project_id, amount, due_date) values (?, ?, ?, ?)`).run(docId, project.id, amount, data.dueDate)
  feed('invoice', `Drafted ${data.number} (${kind}) for ${project.name}: ${inr(amount)}`)
  await ask(
    'send_doc',
    { docId, jid: project.client_jid || project.chat_jid, email: project.client_email },
    `🧾 *${kind.replace('_', ' ')} invoice ${data.number}* for ${project.name}: *${inr(amount)}*, due ${data.dueDate}`,
    [
      { key: '1', label: 'send to client' },
      { key: '0', label: 'keep as draft' },
    ],
    { path: pdf, name: `${data.number}.pdf` },
  )
  return docId
}

onApproval('send_doc', async (p: { docId: number; jid: string; email?: string }, choice) => {
  if (choice === '1') await sendDocument(p.docId, p.jid, p.email)
})

// ---------- Change orders (scope protection) ----------

export async function draftChangeOrder(project: Project, request: string, msgId: string) {
  const est = await extract(
    z.object({
      reason: z.string().describe('one sentence on why this is outside the agreed scope'),
      items: z.array(itemSchema).describe(`line items; rate is INR ${config.freelancer.hourlyRate} per hour, qty in hours`),
      timelineImpact: z.string(),
    }),
    'The client asked for something outside the agreed scope. Estimate it honestly as a change order.',
    `Agreed scope:\n${project.spec}\n\nClient request:\n${request}`,
  )
  const data = {
    number: nextNumber('CO'),
    date: today(),
    from: fromParty(),
    to: { name: project.client_name || 'Client', phone: phoneOf(project.client_jid) },
    projectName: project.name,
    request,
    reason: est.reason,
    items: est.items,
    timelineImpact: est.timelineImpact,
  }
  const pdf = await renderChangeOrder(data)
  const docId = Number(
    db.prepare(`insert into documents (project_id, kind, number, data_json, pdf_path, created_at) values (?, 'change_order', ?, ?, ?, ?)`)
      .run(project.id, data.number, JSON.stringify(data), pdf, now()).lastInsertRowid,
  )
  const amount = totals(data.items)
  const caught = Number(db.prepare(`select value from settings where key = 'scope_caught'`).pluck().get() ?? 0) + amount
  db.prepare(`insert into settings (key, value) values ('scope_caught', ?) on conflict(key) do update set value = excluded.value`).run(String(caught))
  feed('scope', `Scope creep caught on ${project.name}: "${request.slice(0, 60)}" = ${inr(amount)}`)
  await ask(
    'send_doc',
    { docId, jid: project.client_jid || project.chat_jid, email: project.client_email },
    `🚧 *Out of scope* on ${project.name}:\n"${request}"\n${est.reason}\nChange order ${data.number}: *${inr(amount)}*. Nothing will be built until the client approves.`,
    [
      { key: '1', label: 'send change order' },
      { key: '0', label: 'do it free / ignore' },
    ],
    { path: pdf, name: `${data.number}.pdf` },
  )
  return docId
}

/** Client approved a pending change order: bill it. Returns the change-order request text if one was pending. */
export async function acceptPendingChangeOrder(project: Project): Promise<string | null> {
  const doc = db
    .prepare(`select * from documents where project_id = ? and kind = 'change_order' and status = 'sent' order by id desc limit 1`)
    .get(project.id) as any
  if (!doc) return null
  db.prepare(`update documents set status = 'accepted' where id = ?`).run(doc.id)
  const data = JSON.parse(doc.data_json)
  db.prepare(`update projects set spec = spec || ? where id = ?`).run(`\n\nChange order ${doc.number} (approved): ${data.request}`, project.id)
  await draftInvoice(project, 'change_order', data.items, `Against change order ${doc.number}`)
  return data.request
}

// ---------- Payments ----------

export async function proposePayment(source: string, amount: number | null, projectId: number | null, ref: string) {
  const open = db
    .prepare(
      `select i.*, d.number, p.name as project from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id
       where i.status in ('sent','part_paid','overdue') ${projectId ? 'and i.project_id = ?' : ''} order by i.id`,
    )
    .all(...(projectId ? [projectId] : [])) as any[]
  const match = (amount && open.find(i => Math.abs(i.amount - i.paid_amount - amount) < 1)) || open[0]
  if (!match) return notify(`💰 Possible payment (${source}) ${amount ? inr(amount) : ''}, but no open invoice matches.\n${ref.slice(0, 200)}`)
  await ask(
    'mark_paid',
    { invoiceId: match.id, amount: amount ?? match.amount - match.paid_amount, source, ref: ref.slice(0, 300) },
    `💰 Payment signal from *${source}*${amount ? ` for ${inr(amount)}` : ''}.\nLooks like *${match.number}* (${match.project}, ${inr(match.amount - match.paid_amount)} due).\n"${ref.slice(0, 160)}"`,
    [
      { key: '1', label: 'mark paid' },
      { key: '0', label: 'not this one' },
    ],
  )
}

onApproval('mark_paid', async (p: { invoiceId: number; amount: number; source: string; ref: string }, choice) => {
  if (choice !== '1') return
  const inv = db.prepare(`select * from invoices where id = ?`).get(p.invoiceId) as any
  const paid = inv.paid_amount + p.amount
  db.prepare(`update invoices set paid_amount = ?, status = ? where id = ?`).run(paid, paid >= inv.amount - 1 ? 'paid' : 'part_paid', inv.id)
  db.prepare(`insert into payments (invoice_id, source, amount, ref, ts) values (?, ?, ?, ?, ?)`).run(inv.id, p.source, p.amount, p.ref, now())
  feed('payment', `Payment ${inr(p.amount)} recorded (${p.source})`)
  const proj = db.prepare(`select * from projects where id = ?`).get(inv.project_id) as Project
  const thanks = await write(`Thank the client briefly for the payment of ${inr(p.amount)} for ${proj.name}.`)
  await sendText(proj.client_jid || proj.chat_jid, thanks)
})

export async function chaseOverdue() {
  const due = db
    .prepare(
      `select i.*, d.number, p.client_jid, p.chat_jid, p.name from invoices i join documents d on d.id = i.document_id join projects p on p.id = i.project_id
       where i.status in ('sent','part_paid')`,
    )
    .all() as any[]
  for (const i of due) {
    if (new Date(i.due_date).getTime() > Date.now()) continue
    db.prepare(`update invoices set status = 'overdue' where id = ?`).run(i.id)
    const msg = await write(`Gentle, friendly reminder that invoice ${i.number} for ${i.name} (${inr(i.amount - i.paid_amount)}) is due. Not pushy.`)
    await ask('send_text', { jid: i.client_jid || i.chat_jid, text: msg }, `⏰ ${i.number} is overdue. Draft reminder:\n\n${msg}`, [
      { key: '1', label: 'send' },
      { key: '2', label: 'edit' },
      { key: '0', label: 'skip' },
    ])
  }
}

onApproval('send_text', async (p: { jid: string; text: string; quotedJson?: string }, choice, edited) => {
  if (choice !== '1') return
  await sendText(p.jid, edited ?? p.text, p.quotedJson ? { quoted: JSON.parse(p.quotedJson) } : {})
})

// ---------- Commands ----------

onCommand('invoice', async args => {
  const [slug, amountStr, ...note] = args.split(/\s+/)
  const project = db.prepare(`select * from projects where slug = ?`).get(slug) as Project | undefined
  if (!project || !Number(amountStr)) return void (await notify('Usage: /invoice <slug> <amount> <note>'))
  await draftInvoice(project, 'milestone', [{ description: note.join(' ') || 'Milestone payment', qty: 1, rate: Number(amountStr) }])
})

onCommand('invoices', async () => {
  const rows = db
    .prepare(
      `select d.number, p.name, i.amount, i.paid_amount, i.status, i.due_date from invoices i join documents d on d.id = i.document_id
       join projects p on p.id = i.project_id order by i.id desc limit 15`,
    )
    .all() as any[]
  if (!rows.length) return void (await notify('No invoices yet.'))
  const outstanding = rows.filter(r => r.status !== 'paid' && r.status !== 'draft').reduce((s, r) => s + r.amount - r.paid_amount, 0)
  await notify(
    `*Invoices* (outstanding ${inr(outstanding)})\n` +
      rows.map(r => `${r.number}  ${r.name}  ${inr(r.amount)}  ${r.status}${r.status !== 'paid' ? ` due ${r.due_date}` : ''}`).join('\n'),
  )
})
