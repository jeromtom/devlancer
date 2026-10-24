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

// ---------- Sessions (schemas verified against mcp.devin.ai tools/list) ----------

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    preview_url: { type: 'string', description: 'Public deployed URL of the app or preview' },
    repo_url: { type: 'string' },
    pr_url: { type: 'string' },
    summary: { type: 'string', description: 'One line, client-friendly summary of what changed' },
  },
}

const withPrefix = (id: string) => (id.startsWith('devin-') ? id : `devin-${id}`)

export async function createSession(input: { prompt: string; title: string; tags?: string[]; playbook?: string; repos?: string[] }) {
  const text = await call('devin_session_create', {
    sessions: [{ prompt: input.prompt, title: input.title, tags: input.tags ?? null, playbook_id: input.playbook ?? null }],
    structured_output_schema: OUTPUT_SCHEMA,
    ...(input.repos?.length ? { repos: input.repos } : {}),
  })
  const raw = text.match(/session_id["']?\s*[:=]\s*["']?([\w-]+)/i)?.[1] ?? text.match(/sessions\/([\w-]+)/)?.[1] ?? ''
  const id = raw ? withPrefix(raw) : ''
  const url = findUrl(text, /https:\/\/app\.devin\.ai\/sessions\/[\w-]+/) || (id ? `https://app.devin.ai/sessions/${id.replace(/^devin-/, '')}` : '')
  return { id, url, raw: text }
}

export async function sessionStatus(sessionId: string) {
  const text = await call('devin_session_interact', { action: 'get', session_id: withPrefix(sessionId) })
  const status = text.match(/\bstatus["']?\s*[:=]\s*["']?(\w+)/i)?.[1]?.toLowerCase() ?? ''
  const detail = text.match(/status_detail["']?\s*[:=]\s*["']?(\w+)/i)?.[1]?.toLowerCase() ?? ''
  const done =
    ['exit', 'error', 'suspended'].includes(status) ||
    (status === 'running' && ['finished', 'waiting_for_user', 'waiting_for_approval'].includes(detail))
  return { done, state: detail || status || 'unknown', raw: text }
}

export const sessionMessages = (sessionId: string) =>
  call('devin_session_interact', { action: 'get_messages', session_id: withPrefix(sessionId) })

export const sendToSession = (sessionId: string, message: string) =>
  call('devin_session_interact', { action: 'message', session_id: withPrefix(sessionId), message })

/** Block until sessions settle (used for parallel sub-tasks). */
export const gather = (ids: string[], timeoutSeconds = 600) =>
  call('devin_session_gather', { session_ids: ids.map(withPrefix), timeout_seconds: timeoutSeconds })

// ---------- Knowledge ----------

export const saveKnowledge = (name: string, content: string, trigger: string) =>
  call('devin_knowledge_manage', { action: 'create', name, content, trigger }).catch(e => `knowledge failed: ${e.message}`)

// ---------- Repo Q&A (DeepWiki-backed), used for client questions and scoping briefs ----------

export const askRepo = (repo: string, question: string) =>
  call(toolName('ask_wiki_question', 'ask_question'), { repoName: repo, question })

// ---------- Schedules ----------

export const createSchedule = (name: string, prompt: string, cron: string) =>
  call('devin_schedule_manage', { action: 'create', name, prompt, frequency: cron, schedule_type: 'recurring', agent: 'devin' })

export async function closeDevin() {
  await client?.close().catch(() => {})
}
