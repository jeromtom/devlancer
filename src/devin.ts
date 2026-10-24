import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

/**
 * Devin MCP client (https://mcp.devin.ai/mcp).
 * Tool argument names are not documented, so we read each tool's input schema at startup
 * and map our intent onto whatever property names the server actually exposes.
 */

type Schema = { properties?: Record<string, any>; required?: string[] }
let client: Client | null = null
const tools = new Map<string, Schema>()

export const devinReady = () => !!client

export async function connectDevin() {
  if (!config.devinApiKey) {
    console.log('Devin: DEVIN_API_KEY not set, Devin features disabled')
    return
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${config.devinApiKey}` }
  if (config.devinOrgId) headers['X-Org-Id'] = config.devinOrgId
  const c = new Client({ name: 'devlancer', version: '0.1.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL('https://mcp.devin.ai/mcp'), { requestInit: { headers } }))
  const { tools: list } = await c.listTools()
  for (const t of list) tools.set(t.name, t.inputSchema as Schema)
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(path.join(config.dataDir, 'devin-tools.json'), JSON.stringify(list, null, 2))
  client = c
  console.log(`Devin MCP connected: ${list.map(t => t.name).join(', ')}`)
}

function toolName(...candidates: string[]) {
  return candidates.find(n => tools.has(n)) ?? candidates[0]
}

/** Pick the schema property whose name best matches any of the hints. */
function prop(schema: Schema | undefined, ...hints: string[]): string | undefined {
  const keys = Object.keys(schema?.properties ?? {})
  for (const h of hints) {
    const exact = keys.find(k => k === h)
    if (exact) return exact
  }
  for (const h of hints) {
    const loose = keys.find(k => k.toLowerCase().includes(h))
    if (loose) return loose
  }
}

function enumValue(schema: Schema | undefined, key: string | undefined, ...hints: string[]) {
  const p = key ? schema?.properties?.[key] : undefined
  const values: string[] = p?.enum ?? p?.anyOf?.flatMap((x: any) => x.enum ?? (x.const ? [x.const] : [])) ?? []
  for (const h of hints) {
    const v = values.find(v => v === h) ?? values.find(v => v.toLowerCase().includes(h))
    if (v) return v
  }
  return hints[0]
}

export async function call(name: string, args: Record<string, unknown>): Promise<string> {
  if (!client) throw new Error('Devin MCP not connected')
  const res = (await client.callTool({ name, arguments: args })) as any
  const text = (res.content ?? []).map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
  if (res.isError) throw new Error(`${name}: ${text}`)
  return text
}

const findSessionId = (t: string) => t.match(/(devin-[a-z0-9]+)/i)?.[1] ?? t.match(/"session_id"\s*:\s*"([^"]+)"/)?.[1] ?? ''
export const findUrl = (t: string, re: RegExp) => t.match(re)?.[0] ?? ''
export const PR_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/
export const PREVIEW_RE = /https:\/\/[\w.-]+\.vercel\.app[^\s)"'`]*/

// ---------- Sessions ----------

export async function createSession(input: { prompt: string; title: string; tags?: string[]; playbook?: string }) {
  const name = toolName('devin_session_create')
  const s = tools.get(name)
  const one: Record<string, unknown> = {}
  one[prop(s, 'prompt') ?? 'prompt'] = input.prompt
  const t = prop(s, 'title')
  if (t) one[t] = input.title
  const tg = prop(s, 'tags')
  if (tg && input.tags) one[tg] = input.tags
  const pb = prop(s, 'playbook_id', 'playbook')
  if (pb && input.playbook) one[pb] = input.playbook
  // Some versions take a list of sessions ("creates one or more sessions")
  const listKey = prop(s, 'sessions')
  const text = await call(name, listKey && !prop(s, 'prompt') ? { [listKey]: [one] } : one)
  const id = findSessionId(text)
  const url = findUrl(text, /https:\/\/app\.devin\.ai\/sessions\/[\w-]+/) || (id ? `https://app.devin.ai/sessions/${id.replace(/^devin-/, '')}` : '')
  return { id, url, raw: text }
}

export async function sessionStatus(sessionId: string) {
  const name = toolName('devin_session_interact')
  const s = tools.get(name)
  const actionKey = prop(s, 'action', 'operation')
  const idKey = prop(s, 'session_id', 'session') ?? 'session_id'
  const text = await call(name, { [idKey]: sessionId, ...(actionKey ? { [actionKey]: enumValue(s, actionKey, 'get_status', 'status', 'get') } : {}) })
  const lower = text.toLowerCase()
  const state = /"status(_enum)?"\s*:\s*"(\w+)"/i.exec(text)?.[2]?.toLowerCase() ?? ''
  const settled = ['finished', 'blocked', 'stopped', 'expired', 'error', 'errored', 'sleeping', 'waiting', 'completed']
  const done = settled.includes(state) || /\b(finished|completed|blocked|errored|sleeping|waiting for user)\b/.test(lower)
  return { done, state: state || (done ? 'settled' : 'running'), raw: text }
}

export async function sessionMessages(sessionId: string) {
  const name = toolName('devin_session_interact')
  const s = tools.get(name)
  const actionKey = prop(s, 'action', 'operation')
  const idKey = prop(s, 'session_id', 'session') ?? 'session_id'
  return call(name, { [idKey]: sessionId, ...(actionKey ? { [actionKey]: enumValue(s, actionKey, 'read_messages', 'messages', 'get_messages') } : {}) })
}

export async function sendToSession(sessionId: string, message: string) {
  const name = toolName('devin_session_interact')
  const s = tools.get(name)
  const actionKey = prop(s, 'action', 'operation')
  const idKey = prop(s, 'session_id', 'session') ?? 'session_id'
  const msgKey = prop(s, 'message', 'content', 'text') ?? 'message'
  return call(name, { [idKey]: sessionId, [msgKey]: message, ...(actionKey ? { [actionKey]: enumValue(s, actionKey, 'send_message', 'message', 'send') } : {}) })
}

// ---------- Knowledge ----------

export async function saveKnowledge(title: string, body: string, trigger: string) {
  const name = toolName('devin_knowledge_manage')
  const s = tools.get(name)
  const actionKey = prop(s, 'action', 'operation')
  const args: Record<string, unknown> = {}
  if (actionKey) args[actionKey] = enumValue(s, actionKey, 'create', 'add')
  args[prop(s, 'name', 'title') ?? 'name'] = title
  args[prop(s, 'body', 'content') ?? 'body'] = body
  const tr = prop(s, 'trigger_description', 'trigger')
  if (tr) args[tr] = trigger
  return call(name, args).catch(e => `knowledge failed: ${e.message}`)
}

// ---------- Ask (repo Q&A, used as Ask Devin for scoping briefs) ----------

export async function askRepo(repo: string, question: string) {
  const name = toolName('ask_question', 'ask_wiki_question')
  const s = tools.get(name)
  const repoKey = prop(s, 'repoName', 'repo_names', 'repos', 'repo') ?? 'repoName'
  const isArray = s?.properties?.[repoKey]?.type === 'array'
  return call(name, { [repoKey]: isArray ? [repo] : repo, [prop(s, 'question') ?? 'question']: question })
}

// ---------- Schedules ----------

export async function createSchedule(title: string, prompt: string, cron: string) {
  const name = toolName('devin_schedule_manage')
  const s = tools.get(name)
  const actionKey = prop(s, 'action', 'operation')
  const args: Record<string, unknown> = {}
  if (actionKey) args[actionKey] = enumValue(s, actionKey, 'create')
  args[prop(s, 'prompt') ?? 'prompt'] = prompt
  const t = prop(s, 'title', 'name')
  if (t) args[t] = title
  args[prop(s, 'cron', 'schedule') ?? 'cron'] = cron
  return call(name, args)
}

export async function closeDevin() {
  await client?.close().catch(() => {})
}
