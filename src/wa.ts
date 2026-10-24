import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  jidNormalizedUser,
  isJidGroup,
  normalizeMessageContent,
  type WAMessage,
  type WASocket,
  type AnyMessageContent,
} from 'baileys'
import { Boom } from '@hapi/boom'
import fs from 'node:fs'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import QR from 'qrcode'
import { config } from './config.js'
import { db, now } from './db.js'
import { bus } from './bus.js'

export let sock: WASocket
export let lastQr = ''
const sentByMe = new Set<string>() // ids of messages Devlancer itself sent (never treat as commands)

export type InMsg = {
  raw: WAMessage
  id: string
  chat: string
  sender: string
  /** The other form of the sender id (phone number vs LID), when WhatsApp provides it */
  senderAlt: string
  senderName: string
  fromMe: boolean
  text: string
  ts: number
  isGroup: boolean
  isSelfChat: boolean
  quotedId?: string
}

export const selfJids = () => {
  const u = sock?.user
  return [u?.id && jidNormalizedUser(u.id), u?.lid && jidNormalizedUser(u.lid)].filter(Boolean) as string[]
}
export const selfJid = () => selfJids()[0]
export const isSelf = (jid?: string | null) => !!jid && selfJids().includes(jidNormalizedUser(jid))

export function textOf(m: WAMessage): string {
  const c = normalizeMessageContent(m.message)
  return (
    c?.conversation ??
    c?.extendedTextMessage?.text ??
    c?.imageMessage?.caption ??
    c?.videoMessage?.caption ??
    c?.documentMessage?.caption ??
    ''
  ).trim()
}

function toIn(m: WAMessage): InMsg | null {
  const chat = m.key.remoteJid
  if (!chat || chat === 'status@broadcast' || !m.message) return null
  const text = textOf(m)
  if (!text) return null
  const fromMe = !!m.key.fromMe
  const isGroup = !!isJidGroup(chat)
  const c = normalizeMessageContent(m.message)
  return {
    raw: m,
    id: m.key.id!,
    chat,
    sender: fromMe ? selfJid() : jidNormalizedUser(m.key.participant ?? chat),
    senderAlt: jidNormalizedUser((isGroup ? m.key.participantAlt : m.key.remoteJidAlt) ?? '') || '',
    senderName: m.pushName ?? '',
    fromMe,
    text,
    ts: Number(m.messageTimestamp ?? 0) * 1000 || now(),
    isGroup,
    isSelfChat: !isGroup && isSelf(chat),
    quotedId: c?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
  }
}

function store(m: InMsg) {
  db.prepare(
    `insert or ignore into messages (source, ext_id, chat_jid, sender, sender_name, from_me, text, ts)
     values ('wa', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.chat, m.sender, m.senderName, m.fromMe ? 1 : 0, m.text, m.ts)
}

export async function connect(onMessage: (m: InMsg) => void, onReady: () => void, onHistory: () => void) {
  fs.mkdirSync(config.authDir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir)
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'warn' }) as any,
    syncFullHistory: false,
    markOnlineOnConnect: false, // stay a ghost: do not show "online" on every connect
    browser: ['Devlancer', 'Chrome', '1.0'],
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async u => {
    if (u.qr) {
      lastQr = await QR.toDataURL(u.qr)
      qrcode.generate(u.qr, { small: true })
      console.log(`Scan the QR above in WhatsApp > Linked devices, or open http://localhost:${config.port}/qr`)
      bus.emit('qr')
    }
    if (u.connection === 'open') {
      lastQr = ''
      console.log(`WhatsApp connected as ${sock.user?.id}`)
      await syncGroups()
      onReady()
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Delete ./auth and restart to relink.')
        return
      }
      console.log('Connection closed, reconnecting...', code)
      setTimeout(() => connect(onMessage, onReady, onHistory), 2000)
    }
  })

  const nameChats = (chats: { id?: string | null; name?: string | null; subject?: string | null }[]) => {
    const up = db.prepare(`insert into chats (jid, name) values (?, ?) on conflict(jid) do update set name = coalesce(nullif(excluded.name, ''), chats.name)`)
    for (const c of chats) if (c.id && isJidGroup(c.id) && (c.name || c.subject)) up.run(c.id, c.name || c.subject)
  }
  sock.ev.on('chats.upsert', chats => nameChats(chats as any))
  sock.ev.on('groups.update', groups => nameChats(groups as any))

  sock.ev.on('messaging-history.set', ({ messages, chats, isLatest }) => {
    nameChats(chats as any)
    let n = 0
    for (const raw of messages) {
      const m = toIn(raw)
      if (m && m.ts > now() - 7 * 864e5) (store(m), n++)
    }
    if (n) console.log(`History sync: stored ${n} recent messages`)
    if (isLatest || n) onHistory()
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const raw of messages) {
      const m = toIn(raw)
      if (!m) continue
      if (sentByMe.has(m.id)) continue
      store(m)
      if (type === 'notify' || m.isSelfChat) onMessage(m)
    }
  })
}

export async function syncGroups() {
  const groups = await sock.groupFetchAllParticipating()
  const up = db.prepare(
    `insert into chats (jid, name) values (?, ?) on conflict(jid) do update set name = coalesce(excluded.name, chats.name)`,
  )
  for (const g of Object.values(groups)) up.run(g.id, g.subject || null)
  return Object.values(groups)
}

/** Some groups come back without a subject in the bulk fetch; look those up one by one. */
export async function fillGroupNames(jids: string[]) {
  const missing = db.prepare(`select jid from chats where jid in (${jids.map(() => '?').join(',') || "''"}) and (name is null or name = '')`).pluck().all(...jids) as string[]
  for (const jid of missing) {
    const meta = await sock.groupMetadata(jid).catch(() => null)
    if (meta?.subject) db.prepare(`update chats set name = ? where jid = ?`).run(meta.subject, jid)
  }
}

// ---------- Sending ----------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let lastSend = 0

/** Send with human pacing: typing indicator and a delay proportional to length. */
export async function send(jid: string, content: AnyMessageContent, opts: { quoted?: WAMessage; human?: boolean } = {}) {
  const gap = 1200 - (Date.now() - lastSend)
  if (gap > 0) await sleep(gap) // global rate limit
  if (opts.human !== false && !isSelf(jid)) {
    const len = 'text' in content ? String(content.text).length : 40
    await sock.presenceSubscribe(jid).catch(() => {})
    await sock.sendPresenceUpdate('composing', jid).catch(() => {})
    await sleep(Math.min(6000, 1200 + len * 25))
    await sock.sendPresenceUpdate('paused', jid).catch(() => {})
  }
  let sent
  try {
    sent = await sock.sendMessage(jid, content, opts.quoted ? { quoted: opts.quoted } : undefined)
  } catch (e: any) {
    console.log(`[wa] send failed (${String(e.message).slice(0, 60)}), retrying${opts.quoted ? ' without quote' : ''}`)
    await sleep(2000)
    sent = await sock.sendMessage(jid, content) // quoted messages from history can fail; plain send is the fallback
  }
  lastSend = Date.now()
  if (sent?.key.id) sentByMe.add(sent.key.id)
  if (sent) {
    const m = toIn(sent)
    if (m) store({ ...m, fromMe: true })
  }
  return sent
}

export const sendText = (jid: string, text: string, opts: { quoted?: WAMessage; human?: boolean } = {}) =>
  send(jid, { text }, opts)

export async function sendPdf(jid: string, pdfPath: string, fileName: string, caption?: string) {
  return send(jid, { document: fs.readFileSync(pdfPath), mimetype: 'application/pdf', fileName, caption }, { human: !isSelf(jid) })
}

export async function react(msg: WAMessage, emoji = '👍') {
  return sock.sendMessage(msg.key.remoteJid!, { react: { text: emoji, key: msg.key } })
}

/** Message to the freelancer's own "Message yourself" chat (the control panel). */
export async function notify(text: string) {
  const sent = await sendText(selfJid(), text, { human: false })
  return sent?.key.id ?? ''
}

export async function notifyPdf(pdfPath: string, fileName: string, caption: string) {
  const sent = await sendPdf(selfJid(), pdfPath, fileName, caption)
  return sent?.key.id ?? ''
}
