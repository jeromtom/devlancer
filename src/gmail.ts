import { google } from 'googleapis'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const tokenPath = path.join(config.dataDir, 'google-token.json')
const redirect = `http://localhost:${config.port}/auth/google/callback`
const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']

const oauth = () => new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, redirect)
let auth: ReturnType<typeof oauth> | null = null

export function gmailReady() {
  if (auth) return true
  if (!config.googleClientId || !fs.existsSync(tokenPath)) return false
  auth = oauth()
  auth.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')))
  auth.on('tokens', t => fs.writeFileSync(tokenPath, JSON.stringify({ ...auth!.credentials, ...t })))
  return true
}

export const gmailAuthUrl = () => oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })

export async function gmailCallback(code: string) {
  const o = oauth()
  const { tokens } = await o.getToken(code)
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(tokenPath, JSON.stringify(tokens))
  auth = null
  return gmailReady()
}

const b64url = (s: Buffer | string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function sendEmail(to: string, subject: string, body: string, attachments: { path: string; name: string }[] = []) {
  if (!gmailReady()) throw new Error('Gmail not connected')
  const boundary = `dl_${Date.now()}`
  const parts = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ]
  for (const a of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${a.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.name}"`,
      '',
      fs.readFileSync(a.path).toString('base64').replace(/(.{76})/g, '$1\n'),
    )
  }
  parts.push(`--${boundary}--`)
  const gmail = google.gmail({ version: 'v1', auth: auth! })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: b64url(parts.join('\r\n')) } })
}

export type Mail = { id: string; from: string; fromEmail: string; subject: string; body: string; ts: number }

/** New inbox mail since the given epoch ms. */
export async function fetchNewMail(sinceMs: number): Promise<Mail[]> {
  if (!gmailReady()) return []
  const gmail = google.gmail({ version: 'v1', auth: auth! })
  const q = `in:inbox after:${Math.floor(sinceMs / 1000)}`
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 15 })
  const out: Mail[] = []
  for (const { id } of list.data.messages ?? []) {
    const m = await gmail.users.messages.get({ userId: 'me', id: id!, format: 'full' })
    const h = (n: string) => m.data.payload?.headers?.find(x => x.name?.toLowerCase() === n)?.value ?? ''
    const from = h('from')
    out.push({
      id: id!,
      from,
      fromEmail: (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase(),
      subject: h('subject'),
      body: extractBody(m.data.payload) || m.data.snippet || '',
      ts: Number(m.data.internalDate ?? Date.now()),
    })
  }
  return out
}

function extractBody(p: any): string {
  if (!p) return ''
  if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64').toString('utf8')
  for (const part of p.parts ?? []) {
    const t = extractBody(part)
    if (t) return t
  }
  if (p.mimeType === 'text/html' && p.body?.data)
    return Buffer.from(p.body.data, 'base64').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return ''
}
