import { z } from 'zod'
import type { WAMessage } from 'baileys'
import { db, now, getSetting, setSetting, type Chat, type Lead } from './db.js'
import { classifyGig, classifyLeadReply, extract, write } from './ai.js'
import { config } from './config.js'
import { feed } from './bus.js'
import { ask, onApproval, onCommand } from './control.js'
import { notify, react, sendText, syncGroups, fillGroupNames, type InMsg } from './wa.js'
import { makeProposal, sendDocument } from './billing.js'
import { startProject } from './projects.js'

const GIG_P = 0.6
const FIT_MIN = 0.35

const pct = (n: number) => `${Math.round(n * 100)}%`

/** A message in a marketplace group: is it a gig worth pitching? */
// Cheap prefilter so the model budget is only spent on messages that could be gigs
const GIG_HINT = /\b(need|needed|looking for|require|requirement|hiring|hire|freelanc|anyone|budget|developer|website|web ?site|app|automation|bot|landing|build|dm me|quote|project|work)\b|₹|\brs\.?\s?\d|\d+\s?k\b/i

export async function scoutMessage(m: InMsg, opts: { fromHistory?: boolean } = {}) {
  if (m.fromMe || m.text.length < 20 || !GIG_HINT.test(m.text)) return null
  if (db.prepare(`select 1 from leads where src_msg_id = ?`).get(m.id)) return null
  // Live messages get Laya first; the history scan uses the fallback so it never starves live traffic
  const c = await classifyGig(m.text, { preferFallback: opts.fromHistory })
  if (c.isGig < GIG_P || c.fit < FIT_MIN) return null

  const d = await extract(
    z.object({
      title: z.string().describe('short gig title, e.g. "Bakery website"'),
      budget: z.string().describe('budget as stated, or empty'),
      deadline: z.string().describe('deadline as stated, or empty'),
    }),
    'Extract the gig details.',
    m.text,
  )
  const pitch = await write(
    `Write a private WhatsApp reply to ${m.senderName || 'this person'} who posted this requirement in a business group. Mention one specific detail of their need, say briefly why you are a good fit (skills: ${config.freelancer.skills}), suggest a quick call or offer to send a proposal. 3-5 short lines.`,
    `Their post:\n${m.text}`,
  )
  const chat = db.prepare(`select * from chats where jid = ?`).get(m.chat) as Chat | undefined
  const leadId = Number(
    db.prepare(
      `insert into leads (chat_jid, src_msg_id, src_msg_json, poster_jid, poster_name, title, summary, budget, deadline, category, fit, pitch, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(m.chat, m.id, JSON.stringify(m.raw), m.sender, m.senderName, d.title, m.text, d.budget, d.deadline, c.category, c.fit, pitch, now())
      .lastInsertRowid,
  )
  feed('gig', `Gig in ${chat?.name ?? 'group'}: ${d.title}${d.budget ? `, ${d.budget}` : ''} (fit ${pct(c.fit)})`)
  if (opts.fromHistory) return leadId

  if (chat?.speed_mode && c.fit >= 0.85) {
    await pitchLead(leadId, false)
    await notify(`⚡ Speed mode pitched *${d.title}* in ${chat.name} (fit ${pct(c.fit)}).`)
    return leadId
  }
  await gigCard(leadId)
  return leadId
}

export async function gigCard(leadId: number) {
  const l = db.prepare(`select * from leads where id = ?`).get(leadId) as Lead
  const chat = db.prepare(`select name from chats where jid = ?`).get(l.chat_jid) as { name: string } | undefined
  await ask(
    'gig',
    { leadId },
    `💼 *Gig: ${l.title}*${l.budget ? `, ${l.budget}` : ''}${l.deadline ? `, ${l.deadline}` : ''}\nIn ${chat?.name ?? 'a group'} from ${l.poster_name || 'someone'}, fit ${pct(l.fit)}\n\n> ${l.summary.slice(0, 300)}\n\n*Draft private reply:*\n${l.pitch}`,
    [
      { key: '1', label: '👍 + "Check DM" + private pitch' },
      { key: '3', label: 'same + proposal PDF' },
      { key: '2', label: 'edit pitch' },
      { key: '0', label: 'skip' },
    ],
  )
}

/** Ghost move: react + "Check DM" in the group, full pitch as a private reply. */
export async function pitchLead(leadId: number, withProposal: boolean, editedPitch?: string) {
  const l = db.prepare(`select * from leads where id = ?`).get(leadId) as Lead
  const src = JSON.parse(l.src_msg_json) as WAMessage
  await react(src, '👍')
  await sendText(l.chat_jid, 'Check DM 🙂', { quoted: src })
  const pitch = editedPitch ?? l.pitch
  await sendText(l.poster_jid, pitch, { quoted: src }) // private reply: DM quoting the group post
  db.prepare(`update leads set status = 'pitched', pitch = ? where id = ?`).run(pitch, leadId)
  feed('pitch', `Pitched ${l.title} privately to ${l.poster_name || 'poster'}`)
  if (withProposal) {
    const { docId } = await makeProposal(l)
    await sendDocument(docId, l.poster_jid)
    db.prepare(`update leads set status = 'proposal_sent' where id = ?`).run(leadId)
  }
}

onApproval('gig', async (p: { leadId: number }, choice, edited) => {
  if (choice === '0') return void db.prepare(`update leads set status = 'skipped' where id = ?`).run(p.leadId)
  await pitchLead(p.leadId, choice === '3', edited)
  await notify(`✅ Pitched. I will watch their DM.`)
})

/** A DM from someone we pitched: do they want a proposal, or are they accepting? */
export async function handleLeadDm(m: InMsg, lead: Lead) {
  const ctx = (db.prepare(`select from_me, text from messages where chat_jid = ? order by ts desc limit 20`).all(m.chat) as any[])
    .reverse()
    .map(r => `${r.from_me ? 'Freelancer' : 'Client'}: ${r.text}`)
    .join('\n')
  const r = await classifyLeadReply(ctx, m.text)
  if (r.accepted > 0.6) {
    await ask('start_project', { leadId: lead.id, chat: m.chat }, `🎉 *${lead.poster_name || 'Client'} accepted* ${lead.title}:\n"${m.text}"`, [
      { key: '1', label: 'start project + advance invoice + Devin build' },
      { key: '0', label: 'not yet' },
    ])
    return
  }
  if (r.wantsProposal > 0.6) {
    const { docId, pdf, data } = await makeProposal(lead)
    await ask('send_proposal', { docId, leadId: lead.id, jid: m.chat }, `📄 ${lead.poster_name || 'Client'} wants details on *${lead.title}*. Proposal ${data.number} ready.`, [
      { key: '1', label: 'send proposal' },
      { key: '0', label: 'skip' },
    ], { path: pdf, name: `${data.number}.pdf` })
    return
  }
  const reply = await write('Reply naturally to the latest client message in this conversation.', ctx)
  await ask('send_text', { jid: m.chat, text: reply }, `💬 ${lead.poster_name || 'Lead'}: "${m.text}"\n\n*Draft:*\n${reply}`, [
    { key: '1', label: 'send' },
    { key: '2', label: 'edit' },
    { key: '0', label: 'skip' },
  ])
}

onApproval('send_proposal', async (p: { docId: number; leadId: number; jid: string }, choice) => {
  if (choice !== '1') return
  await sendDocument(p.docId, p.jid)
  db.prepare(`update leads set status = 'proposal_sent' where id = ?`).run(p.leadId)
})

onApproval('start_project', async (p: { leadId: number; chat: string }, choice) => {
  if (choice === '1') await startProject(p.leadId, p.chat)
})

/** First connect: look back over marketplace history for gigs that fit. */
export async function scanHistory() {
  const markets = db.prepare(`select jid from chats where kind = 'marketplace'`).pluck().all() as string[]
  if (!markets.length) return
  const rows = (db
    .prepare(
      `select * from messages where chat_jid in (${markets.map(() => '?').join(',')}) and from_me = 0 and length(text) > 30
       and ts > ? order by ts desc limit 150`,
    )
    .all(...markets, now() - 7 * 864e5) as any[]).filter(r => GIG_HINT.test(r.text)).slice(0, 25)
  await notify(`🔎 Checking ${rows.length} likely gig posts from the last 7 days...`)
  const found: number[] = []
  const one = async (r: any) => {
    const raw = { key: { remoteJid: r.chat_jid, id: r.ext_id, participant: r.sender, fromMe: false }, message: { conversation: r.text } }
    const id = await scoutMessage(
      { raw: raw as any, id: r.ext_id, chat: r.chat_jid, sender: r.sender, senderAlt: '', senderName: r.sender_name, fromMe: false, text: r.text, ts: r.ts, isGroup: true, isSelfChat: false },
      { fromHistory: true },
    ).catch(e => (console.error(e), null))
    if (id) found.push(id)
  }
  for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(one))
  if (!found.length) return void (await notify('No matching gigs in the last 7 days. I will keep watching.'))
  const leads = db.prepare(`select * from leads where id in (${found.join(',')}) order by fit desc`).all() as Lead[]
  await notify(`Found *${leads.length} gigs* that fit you in the last 7 days:\n` + leads.map((l, i) => `${i + 1}. ${l.title}${l.budget ? `, ${l.budget}` : ''} (fit ${pct(l.fit)})`).join('\n'))
  for (const l of leads.slice(0, 3)) await gigCard(l.id)
}

// ---------- Group setup ----------

/** /groups [search]: most active groups (last 7 days), or name matches. Numbers refer to this listing. */
onCommand('groups', async args => {
  await syncGroups()
  const q = args.trim()
  const chats = (
    q
      ? db.prepare(`select c.* from chats c where c.jid like '%@g.us' and c.name like ? order by c.name limit 30`).all(`%${q}%`)
      : db
          .prepare(
            `select c.*, count(m.id) as n from chats c left join messages m on m.chat_jid = c.jid and m.ts > ?
             where c.jid like '%@g.us' group by c.jid order by (c.kind != 'unknown') desc, n desc limit 30`,
          )
          .all(now() - 7 * 864e5)
  ) as Chat[]
  await fillGroupNames(chats.map(c => c.jid))
  for (const c of chats) c.name = (db.prepare(`select name from chats where jid = ?`).pluck().get(c.jid) as string) || '(unnamed group)'
  setSetting('group_list', JSON.stringify(chats.map(c => c.jid)))
  await notify(
    `*${q ? `Groups matching "${q}"` : 'Your 30 most active groups'}*\n` +
      chats.map((c, i) => `${i + 1}. ${c.name} ${c.kind === 'marketplace' ? '🛒' : c.kind === 'client' ? '🤝' : ''}${c.speed_mode ? '⚡' : ''}`).join('\n') +
      `\n\nReply */m 1,4* to mark marketplaces (where gigs are posted), */c 2* for client groups. Search with */groups kochi*.`,
  )
})

export function pickGroups(args: string) {
  const list = JSON.parse(getSetting('group_list', '[]')) as string[]
  return args
    .split(/[\s,]+/)
    .map(Number)
    .filter(Boolean)
    .map(n => list[n - 1])
    .filter(Boolean)
    .map(jid => db.prepare(`select * from chats where jid = ?`).get(jid) as Chat)
    .filter(Boolean)
}

onCommand('m', async args => {
  const picked = pickGroups(args)
  for (const c of picked) db.prepare(`update chats set kind = 'marketplace' where jid = ?`).run(c.jid)
  await notify(`🛒 Watching for gigs in: ${picked.map(c => c.name).join(', ')}`)
  void scanHistory().catch(e => console.error('scan', e)) // runs alongside live messages
})

onCommand('c', async args => {
  const picked = pickGroups(args)
  for (const c of picked) db.prepare(`update chats set kind = 'client' where jid = ?`).run(c.jid)
  await notify(`🤝 Client groups: ${picked.map(c => c.name).join(', ')}`)
})

onCommand('scan', async () => {
  void scanHistory().catch(e => console.error('scan', e))
})

onCommand('speed', async args => {
  const [onOff, n] = args.split(/\s+/)
  const [c] = pickGroups(n ?? '')
  if (!c) return void (await notify('Usage: /speed on|off <group#>'))
  db.prepare(`update chats set speed_mode = ? where jid = ?`).run(onOff === 'on' ? 1 : 0, c.jid)
  await notify(`⚡ Speed mode ${onOff} for ${c.name}`)
})

onCommand('gigs', async () => {
  const leads = db.prepare(`select * from leads order by id desc limit 10`).all() as Lead[]
  await notify(leads.length ? leads.map(l => `#${l.id} ${l.title} (${pct(l.fit)}) ${l.status}`).join('\n') : 'No gigs yet.')
})

onCommand('won', async args => {
  const id = Number(args.split(/\s+/)[0])
  const l = db.prepare(`select * from leads where id = ?`).get(id) as Lead | undefined
  if (!l) return void (await notify('Usage: /won <lead#> (see /gigs)'))
  await startProject(l.id, l.poster_jid)
})
