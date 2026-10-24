import { db, getSetting, setSetting, type Chat, type Lead, type Project } from './db.js'
import { connect, notify, selfJid, type InMsg } from './wa.js'
import { feed } from './bus.js'
import { handleSelfMessage, onCommand } from './control.js'
import { scoutMessage, handleLeadDm, scanHistory } from './scout.js'
import { handleClientMessage, projectsForChat, watchSessions, runLocalUpkeep } from './projects.js'
import { proposePayment, chaseOverdue } from './billing.js'
import { connectDevin } from './devin.js'
import { fetchNewMail, gmailReady } from './gmail.js'
import { classifyEmail, write } from './ai.js'
import { startDashboard, devHooks } from './dashboard.js'
import { config } from './config.js'

// Serialise message handling so approvals and classifications never interleave
let chain = Promise.resolve()
// Each job gets at most 2 minutes so one hung call can never freeze Devlancer
const withTimeout = (p: Promise<unknown>, ms = 120_000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('job timed out')), ms))])
const queue = (fn: () => Promise<unknown>) =>
  (chain = chain.then(() => withTimeout(fn())).catch(e => console.error('[job]', e?.message ?? e)) as Promise<void>)

function route(m: InMsg) {
  if (m.isSelfChat) return queue(() => handleSelfMessage(m))
  if (m.fromMe) return

  const chat = db.prepare(`select * from chats where jid = ?`).get(m.chat) as Chat | undefined
  if (m.isGroup) {
    if (chat?.kind === 'marketplace') return queue(() => scoutMessage(m))
    if (projectsForChat(m).length) return queue(() => handleClientMessage(m))
    return
  }
  // Direct message: an existing client, or someone we pitched?
  if (projectsForChat(m).length) return queue(() => handleClientMessage(m))
  const ids = [m.chat, m.sender, m.senderAlt].filter(Boolean)
  const lead = db
    .prepare(`select * from leads where poster_jid in (${ids.map(() => '?').join(',')}) and status in ('pitched','proposal_sent') order by id desc limit 1`)
    .get(...ids) as Lead | undefined
  if (lead) return queue(() => handleLeadDm(m, lead))
}

async function onReady() {
  if (!getSetting('onboarded')) {
    setSetting('onboarded', '1')
    await notify(
      `👋 *Hi ${config.freelancer.name.split(' ')[0]}, Devlancer is connected.*\n\nThis chat is your control panel. I will post gigs, drafts and approvals here, and nothing goes to a client without your OK.\n\nFirst, tell me which groups are gig marketplaces. Send */groups*.`,
    )
  }
  feed('info', 'WhatsApp connected')
}

let historyTimer: NodeJS.Timeout | undefined
function onHistory() {
  // History arrives in batches; rescan once it settles if marketplaces are already set
  clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    if (!getSetting('history_scanned') && db.prepare(`select 1 from chats where kind = 'marketplace'`).get()) {
      setSetting('history_scanned', '1')
      queue(scanHistory)
    }
  }, 8000)
}

// ---------- Gmail poller ----------

async function pollMail() {
  if (!gmailReady()) return
  const since = Number(getSetting('gmail_since', String(Date.now() - 36e5)))
  const mails = await fetchNewMail(since)
  setSetting('gmail_since', String(Date.now()))
  for (const mail of mails) {
    if (db.prepare(`select 1 from messages where ext_id = ?`).get(`gmail:${mail.id}`)) continue
    db.prepare(`insert into messages (source, ext_id, chat_jid, sender, sender_name, from_me, text, ts) values ('gmail', ?, ?, ?, ?, 0, ?, ?)`)
      .run(`gmail:${mail.id}`, `gmail:${mail.fromEmail}`, mail.fromEmail, mail.from, `${mail.subject}\n${mail.body.slice(0, 2000)}`, mail.ts)
    const project = db.prepare(`select * from projects where client_email = ?`).get(mail.fromEmail) as Project | undefined
    const kind = await classifyEmail(mail.subject, mail.body)
    if (kind === 'payment_alert') {
      const amt = Number(mail.body.replace(/,/g, '').match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? 0)
      feed('email', `Payment alert in Gmail: ${mail.subject}`)
      await proposePayment('Gmail', amt || null, project?.id ?? null, `${mail.subject} ${mail.body.slice(0, 200)}`)
    } else if (project || kind === 'client_message') {
      feed('email', `Client email from ${mail.from}: ${mail.subject}`)
      const summary = await write(`Summarise this email for the freelancer in 2 lines (this is a note to self, not a reply).`, `${mail.subject}\n${mail.body.slice(0, 3000)}`)
      await notify(`📧 *${mail.from}*${project ? ` (${project.name})` : ''}\n${mail.subject}\n\n${summary}`)
    } else if (kind === 'gig_lead') {
      feed('email', `Gig lead by email: ${mail.subject}`)
      await notify(`📧💼 Possible gig by email from ${mail.from}:\n${mail.subject}`)
    }
  }
}

onCommand('gmail', async () => {
  await notify(gmailReady() ? '📧 Gmail is connected.' : `📧 Open http://localhost:${config.port}/auth/google on this laptop to connect Gmail.`)
})

onCommand('project', async args => {
  // /project email <slug> <email>
  const [sub, slug, value] = args.split(/\s+/)
  if (sub === 'email' && slug && value) {
    db.prepare(`update projects set client_email = ? where slug = ?`).run(value.toLowerCase(), slug)
    return void (await notify(`📧 #${slug} client email set to ${value}`))
  }
  await notify('Usage: /project email <slug> <client@email>')
})

// ---------- Boot ----------

async function main() {
  startDashboard()
  devHooks.self = text =>
    queue(() =>
      handleSelfMessage({
        raw: { key: { remoteJid: selfJid(), id: `dev-${Date.now()}`, fromMe: true }, message: { conversation: text } } as any,
        id: `dev-${Date.now()}`, chat: selfJid(), sender: selfJid(), senderAlt: '', senderName: 'me', fromMe: true,
        text, ts: Date.now(), isGroup: false, isSelfChat: true,
      }),
    )
  await connectDevin().catch(e => console.error('Devin MCP connect failed:', e.message))
  await connect(route, () => queue(onReady), onHistory)
  setInterval(() => void watchSessions().catch(e => console.error('watch', e)), 45_000) // own loop: never blocks messages
  setInterval(() => queue(pollMail), 60_000)
  setInterval(() => queue(chaseOverdue), 6 * 36e5)
  setInterval(() => void runLocalUpkeep().catch(e => console.error('upkeep', e)), 15 * 60_000)
}

main()
process.on('unhandledRejection', e => console.error('unhandled', e))
process.on('uncaughtException', e => console.error('uncaught', e)) // stay up no matter what
