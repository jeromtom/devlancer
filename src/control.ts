import { db, now, getSetting, setSetting } from './db.js'
import { notify, notifyPdf, type InMsg } from './wa.js'
import { feed } from './bus.js'

/**
 * Self-chat control panel: approval cards and slash commands.
 * Nothing that commits money, scope or deadlines goes to a client without passing through here.
 */

export type Choice = { key: string; label: string }
type Handler = (payload: any, choice: string, edited?: string) => Promise<void>
const handlers = new Map<string, Handler>()
const commands = new Map<string, (args: string, m: InMsg) => Promise<void>>()

export const onApproval = (kind: string, h: Handler) => handlers.set(kind, h)
export const onCommand = (name: string, h: (args: string, m: InMsg) => Promise<void>) => commands.set(name, h)

export async function ask(kind: string, payload: unknown, text: string, choices: Choice[], pdf?: { path: string; name: string }) {
  const id = Number(
    db.prepare(`insert into approvals (kind, payload_json, created_at) values (?, ?, ?)`).run(kind, JSON.stringify(payload), now())
      .lastInsertRowid,
  )
  const menu = choices.map(c => `*${c.key}* ${c.label}`).join('   ')
  const body = `${text}\n\n${menu}\n_Ref #${id}. Reply with a number (or quote this card)._`
  const msgId = pdf ? await notifyPdf(pdf.path, pdf.name, body) : await notify(body)
  db.prepare(`update approvals set self_msg_id = ? where id = ?`).run(msgId, id)
  return id
}

type Approval = { id: number; kind: string; payload_json: string; status: string }

async function resolve(a: Approval, choice: string, edited?: string) {
  const h = handlers.get(a.kind)
  if (!h) return notify(`No handler for ${a.kind}`)
  db.prepare(`update approvals set status = ? where id = ?`).run(choice === '0' ? 'skipped' : 'done', a.id)
  try {
    await h(JSON.parse(a.payload_json), choice, edited)
  } catch (e: any) {
    console.error(e)
    await notify(`Something failed on #${a.id}: ${e.message}`)
  }
}

export async function handleSelfMessage(m: InMsg) {
  const text = m.text.trim()

  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/)
    const h = commands.get(cmd.toLowerCase())
    if (!h) return notify(helpText())
    try {
      await h(rest.join(' '), m)
    } catch (e: any) {
      console.error(e)
      await notify(`/${cmd} failed: ${e.message}`)
    }
    return
  }

  // A pending edit takes the next free-text message as the new draft
  const editing = db.prepare(`select * from approvals where status = 'editing' order by id desc limit 1`).get() as Approval | undefined
  if (editing && !/^\d$/.test(text)) return resolve(editing, '1', text)

  const quoted = m.quotedId
    ? (db.prepare(`select * from approvals where self_msg_id = ?`).get(m.quotedId) as Approval | undefined)
    : undefined
  const refMatch = text.match(/^#?(\d+)\s+(\d)$/) // "#12 1"
  const target =
    quoted ??
    (refMatch ? (db.prepare(`select * from approvals where id = ?`).get(Number(refMatch[1])) as Approval | undefined) : undefined) ??
    (db.prepare(`select * from approvals where status = 'pending' order by id desc limit 1`).get() as Approval | undefined)
  const choice = refMatch ? refMatch[2] : text.match(/^\d$/)?.[0]
  if (!choice) return notify(helpText())
  if (!target || (target.status !== 'pending' && target.status !== 'editing')) return notify('Nothing pending.')
  if (choice === '2') {
    db.prepare(`update approvals set status = 'editing' where id = ?`).run(target.id)
    return notify(`Send me the new text for #${target.id}.`)
  }
  return resolve(target, choice)
}

export const presence = () => getSetting('presence', 'online') as 'online' | 'offline'

onCommand('online', async () => {
  setSetting('presence', 'online')
  feed('info', 'Freelancer is online')
  await notify('🟢 Online. Hands-on tasks will open in Devin CLI on your machine.')
})
onCommand('offline', async () => {
  setSetting('presence', 'offline')
  feed('info', 'Freelancer is offline')
  await notify('🌙 Offline. Devin Cloud handles clear tasks; anything needing you gets a brief and waits.')
})
onCommand('help', async () => {
  await notify(helpText())
})

export function helpText() {
  return [
    '*Devlancer commands*',
    '/online, /offline  set presence',
    '/status  what is going on',
    '/gigs  recent leads   /scan  rescan marketplaces',
    '/groups  mark marketplace and client groups',
    '/m 1,3  mark groups as marketplaces   /c 2  mark as client group',
    '/won <lead#> [slug]  start a project from a lead',
    '/link <slug> <group#>  move a project into a client group',
    '/project email <slug> <email>  set client email for Gmail',
    '/projects  list projects',
    '/invoice <slug> <amount> <note>  draft an invoice',
    '/invoices  outstanding',
    '/autopilot on|off <slug>   /speed on|off <group#>',
    '/gmail  connect Gmail',
  ].join('\n')
}
