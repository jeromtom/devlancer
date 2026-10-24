import { z } from 'zod'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db, now, type Lead, type Project, type Task } from './db.js'
import { classifyClientMessage, extract, write } from './ai.js'
import { config } from './config.js'
import { feed } from './bus.js'
import { ask, onApproval, onCommand, presence } from './control.js'
import { send, sendText, notify, type InMsg } from './wa.js'
import * as devin from './devin.js'
import { draftInvoice, draftChangeOrder, acceptPendingChangeOrder, proposePayment } from './billing.js'
import { getBrowser } from './docs/pdf.js'
import { pickGroups } from './scout.js'

const GITHUB_OWNER = process.env.GITHUB_OWNER ?? 'jeromtom'

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `project-${Date.now()}`

// ---------- Start a project ----------

export async function startProject(leadId: number, chatJid: string) {
  const lead = db.prepare(`select * from leads where id = ?`).get(leadId) as Lead
  const proposal = db.prepare(`select * from documents where lead_id = ? and kind = 'proposal' order by id desc limit 1`).get(leadId) as any
  let spec: string
  let total = 0
  if (proposal) {
    const p = JSON.parse(proposal.data_json)
    spec = `${p.title}\n${p.summary}\nScope:\n- ${p.scope.join('\n- ')}\nDeliverables:\n- ${p.deliverables.join('\n- ')}\nOut of scope:\n- ${p.outOfScope.join('\n- ')}`
    total = p.items.reduce((s: number, i: any) => s + i.qty * i.rate, 0)
    db.prepare(`update documents set status = 'accepted' where id = ?`).run(proposal.id)
  } else {
    const chat = (db.prepare(`select from_me, text from messages where chat_jid = ? order by ts desc limit 30`).all(chatJid) as any[])
      .reverse().map(r => `${r.from_me ? 'Me' : 'Client'}: ${r.text}`).join('\n')
    const s = await extract(
      z.object({ spec: z.string().describe('scope, features and acceptance criteria as bullet points'), price: z.number().describe('agreed or budgeted INR total, 0 if unknown') }),
      'Write the agreed project spec from this gig and conversation.',
      `Gig: ${lead.summary}\nBudget: ${lead.budget}\n\n${chat}`,
      { spec: `${lead.title}\n${lead.summary}`, price: Number((lead.budget || '').replace(/,/g, '').match(/\d+/)?.[0] ?? 0) * (/k\b/i.test(lead.budget || '') ? 1000 : 1) },
    )
    spec = s.spec
    total = s.price
  }
  let slug = slugify(lead.title)
  if (db.prepare(`select 1 from projects where slug = ?`).get(slug)) slug = `${slug}-${leadId}`
  const projectId = Number(
    db.prepare(
      `insert into projects (chat_jid, lead_id, slug, name, client_name, client_jid, spec, created_at) values (?,?,?,?,?,?,?,?)`,
    ).run(chatJid, leadId, slug, lead.title, lead.poster_name, lead.poster_jid, spec, now()).lastInsertRowid,
  )
  db.prepare(`update leads set status = 'won' where id = ?`).run(leadId)
  const project = db.prepare(`select * from projects where id = ?`).get(projectId) as Project
  feed('task', `Project started: ${project.name} (#${slug})`)
  await notify(`🚀 Project *${project.name}* created as #${slug}.`)

  if (devin.devinReady()) {
    devin.saveKnowledge(`Client project: ${project.name} (${slug})`, `Client: ${project.client_name}\nRepo: ${GITHUB_OWNER}/${slug}\n\nAgreed spec:\n${spec}`, `When working on the ${slug} repo or the ${project.name} project`)
      .catch(e => console.error('knowledge', e))
  }
  if (total > 0) await draftInvoice(project, 'advance', [{ description: `Advance (50%) for ${project.name}`, qty: 1, rate: Math.round(total / 2) }])
  await kickoff(project)
}

async function kickoff(project: Project) {
  const prompt = [
    `You are the engineer for a freelance client project: "${project.name}".`,
    `Agreed spec:\n${project.spec}`,
    '',
    'Do this:',
    config.demoTemplateRepo
      ? `1. Create a new GitHub repo ${GITHUB_OWNER}/${project.slug} from the template ${config.demoTemplateRepo}.`
      : `1. Create a new GitHub repo ${GITHUB_OWNER}/${project.slug}.`,
    '2. Build a polished, mobile-first first version that covers the spec. Keep it simple and fast: plain Next.js or static HTML is fine. Use realistic placeholder content where the client has not provided any.',
    '3. Make sure it builds. Deploy it to Vercel and get the public URL.',
    '4. Push to main.',
    'Report preview_url and repo_url in your structured output, and also finish with the lines PREVIEW_URL: <url> and REPO_URL: <url>.',
  ].join('\n')
  await startDevinTask(project, 'kickoff', 'Build first version', prompt, '')
}

async function startDevinTask(project: Project, kind: string, request: string, prompt: string, msgId: string, route = 'cloud') {
  const taskId = Number(
    db.prepare(`insert into tasks (project_id, source_msg_id, kind, request, in_scope, route, status, prompt, created_at) values (?,?,?,?,1,?,'queued',?,?)`)
      .run(project.id, msgId, kind, request, route, prompt, now()).lastInsertRowid,
  )
  await launchQueued(taskId)
  return taskId
}

/** Try to start a queued cloud task on Devin. On failure it stays queued and is retried by the watcher. */
async function launchQueued(taskId: number) {
  const t = db.prepare(`select * from tasks where id = ?`).get(taskId) as Task & { prompt: string; attempts: number }
  const project = db.prepare(`select * from projects where id = ?`).get(t.project_id) as Project
  db.prepare(`update tasks set attempts = attempts + 1 where id = ?`).run(taskId)
  try {
    const s = await devin.createSession({ prompt: t.prompt, title: `${project.slug}: ${t.request}`.slice(0, 80), tags: ['devlancer', project.slug, t.kind] })
    if (!s.id) throw new Error('no session id returned')
    db.prepare(`update tasks set status = 'running', devin_session_id = ?, devin_url = ? where id = ?`).run(s.id, s.url, taskId)
    feed('devin', `Devin Cloud session started for ${project.name}: ${t.request}`, { route: 'Devin Cloud', url: s.url })
  } catch (e: any) {
    console.error('[devin] start failed:', e.message)
    if (t.attempts === 0) {
      feed('devin', `Devin unavailable, queued "${t.request}" for ${project.name}. Retrying automatically`, { route: 'Queued' })
      await notify(`⏳ Devin could not start *${t.request.slice(0, 60)}* (${project.name}) right now. I queued it and will retry every minute.`)
    }
  }
}

// ---------- Session watcher ----------

export async function watchSessions() {
  // Retry queued cloud tasks (Devin was down, or the key was missing at the time)
  const queued = db.prepare(`select id from tasks where status = 'queued' and route = 'cloud' and prompt is not null and attempts < 30`).pluck().all() as number[]
  for (const id of queued) await launchQueued(id)

  const running = db.prepare(`select * from tasks where status = 'running' and devin_session_id != ''`).all() as Task[]
  for (const t of running) {
    try {
      const st = await devin.sessionStatus(t.devin_session_id)
      if (!st.done) continue
      const msgs = await devin.sessionMessages(t.devin_session_id).catch(() => '')
      const all = `${st.raw}\n${msgs}`
      const field = (k: string) => all.match(new RegExp(`${k}["']?\\s*[:=]\\s*["']?(https?://[^\\s"',}]+)`, 'i'))?.[1] ?? ''
      const preview = field('preview_url') || all.match(/PREVIEW_URL:\s*(\S+)/)?.[1] || devin.findUrl(all, devin.PREVIEW_RE)
      const repo = field('repo_url') || all.match(/REPO_URL:\s*(\S+)/)?.[1] || ''
      const pr = field('pr_url') || devin.findUrl(all, devin.PR_RE)
      db.prepare(`update tasks set status = 'done', pr_url = ?, preview_url = ? where id = ?`).run(pr, preview, t.id)
      const project = db.prepare(`select * from projects where id = ?`).get(t.project_id) as Project
      if (preview) db.prepare(`update projects set preview_url = ? where id = ?`).run(preview, project.id)
      if (repo) db.prepare(`update projects set repo_url = ? where id = ?`).run(repo, project.id)
      feed('devin', `Devin finished "${t.request}" for ${project.name}`, { route: 'Devin Cloud', url: preview || pr || t.devin_url })
      await deliver(project, t, preview, pr)
    } catch (e) {
      console.error('watch', t.id, e)
    }
  }
}

async function screenshot(url: string): Promise<Buffer | null> {
  try {
    const b = await getBrowser()
    const page = await b.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    const buf = await page.screenshot()
    await page.close()
    return buf
  } catch {
    return null
  }
}

async function deliver(project: Project, t: Task, preview: string, pr: string) {
  const msg = await write(
    t.kind === 'kickoff'
      ? `Tell the client the first version of ${project.name} is ready to look at, share the link ${preview}, ask for feedback.`
      : `Tell the client their request "${t.request}" is done and they can check it at ${preview || project.preview_url}.`,
  )
  const shot = preview ? await screenshot(preview) : null
  const payload = { projectId: project.id, text: msg, shot: shot ? shot.toString('base64') : '' }
  if (project.autopilot && t.kind !== 'kickoff') return deliverToClient(payload)
  await ask(
    'deliver',
    payload,
    `✅ Devin finished *${t.request}* for ${project.name}\n${preview ? `Preview: ${preview}\n` : ''}${pr ? `PR: ${pr}\n` : ''}Session: ${t.devin_url}\n\n*Draft to client:*\n${msg}`,
    [
      { key: '1', label: 'send to client' },
      { key: '2', label: 'edit' },
      { key: '0', label: 'hold' },
    ],
  )
}

async function deliverToClient(p: { projectId: number; text: string; shot: string }, edited?: string) {
  const project = db.prepare(`select * from projects where id = ?`).get(p.projectId) as Project
  const jid = project.chat_jid
  if (p.shot) await send(jid, { image: Buffer.from(p.shot, 'base64'), caption: edited ?? p.text })
  else await sendText(jid, edited ?? p.text)
  feed('task', `Update sent to ${project.client_name || 'client'} for ${project.name}`)
}

onApproval('deliver', async (p, choice, edited) => {
  if (choice === '1') await deliverToClient(p, edited)
})

// ---------- Maintain: client messages ----------

export function projectsForChat(m: InMsg): Project[] {
  const ids = [m.chat, m.sender, m.senderAlt].filter(Boolean)
  const q = ids.map(() => '?').join(',')
  return db.prepare(`select * from projects where status = 'active' and (chat_jid in (${q}) or client_jid in (${q}))`).all(...ids, ...ids) as Project[]
}

export async function handleClientMessage(m: InMsg, forced?: Project) {
  const projects = forced ? [forced] : projectsForChat(m)
  if (!projects.length || m.fromMe) return
  const recent = (db.prepare(`select from_me, sender_name, text from messages where chat_jid = ? order by ts desc limit 15`).all(m.chat) as any[])
    .reverse().map(r => `${r.from_me ? 'Freelancer' : r.sender_name || 'Client'}: ${r.text}`).join('\n')
  const tag = m.text.match(/#([a-z0-9-]+)/i)?.[1]
  const tagged = tag ? projects.find(p => p.slug === tag.toLowerCase()) : undefined
  const c = await classifyClientMessage({
    spec: (tagged ?? projects[0]).spec,
    recent,
    message: m.text,
    projects: projects.map(p => ({ slug: p.slug, name: p.name })),
  })
  db.prepare(`update messages set intent = ?, scores_json = ? where ext_id = ?`).run(c.intent, JSON.stringify(c), m.id)
  if (c.intent === 'chatter') return

  let project = tagged ?? (projects.length === 1 ? projects[0] : projects.find(p => p.slug === c.project))
  if (!project || (!tagged && projects.length > 1 && c.projectConfidence < 0.7)) {
    // Ask the freelancer, never the client: stay a ghost
    await ask('which_project', { msg: serialise(m), slugs: projects.map(p => p.slug) },
      `❓ Which project is this about?\n"${m.text}"`,
      projects.map((p, i) => ({ key: String(i + 1), label: p.name })).concat({ key: '0', label: 'none' }))
    return
  }
  await act(project, m, c)
}

const serialise = (m: InMsg) => JSON.stringify({ ...m, raw: { key: m.raw.key, message: m.raw.message } })

onApproval('which_project', async (p: { msg: string; slugs: string[] }, choice) => {
  const slug = p.slugs[Number(choice) - 1]
  if (!slug) return
  const project = db.prepare(`select * from projects where slug = ?`).get(slug) as Project
  await handleClientMessage(JSON.parse(p.msg), project)
})

type Cls = Awaited<ReturnType<typeof classifyClientMessage>>

async function holding(project: Project, m: InMsg, why: string) {
  const text = await write(`Send a short natural holding reply to the client's message, ${why}. Do not promise a specific time unless told.`, `Client: ${m.text}`)
  await sendText(m.chat, text, { quoted: m.raw })
}

async function act(project: Project, m: InMsg, c: Cls) {
  db.prepare(`update messages set project_id = ? where ext_id = ?`).run(project.id, m.id)
  const scores = `clarity ${c.clarity.toFixed(2)}, verifiable ${c.verifiable.toFixed(2)}, human ${c.humanDependence.toFixed(2)}, in-scope ${c.inScope.toFixed(2)}`

  if (c.intent === 'payment_claim') {
    const amt = Number(m.text.replace(/,/g, '').match(/(?:₹|rs\.?|inr)\s*(\d+)/i)?.[1] ?? m.text.replace(/,/g, '').match(/\b(\d{3,7})\b/)?.[1] ?? 0)
    return proposePayment('WhatsApp', amt || null, project.id, m.text)
  }

  if (c.intent === 'approval') {
    const request = await acceptPendingChangeOrder(project)
    if (request) {
      feed('scope', `Change order approved on ${project.name}`)
      return route(project, m, request, { ...c, inScope: 1 })
    }
    return
  }

  if (c.intent === 'question') {
    let answer = ''
    if (devin.devinReady() && project.repo_url) answer = await devin.askRepo(project.repo_url.replace('https://github.com/', ''), m.text).catch(() => '')
    const reply = await write('Answer the client question briefly and accurately. If unsure, say you will check and confirm.', `Project spec:\n${project.spec}\n${answer ? `Facts from the codebase:\n${answer.slice(0, 2000)}\n` : ''}Client: ${m.text}`)
    return ask('send_text', { jid: m.chat, text: reply, quotedJson: JSON.stringify({ key: m.raw.key, message: m.raw.message }) },
      `❔ ${project.name}: "${m.text}"\n\n*Draft answer:*\n${reply}`,
      [{ key: '1', label: 'send' }, { key: '2', label: 'edit' }, { key: '0', label: 'skip' }])
  }

  // change_request / bug_report
  if (c.inScope < 0.5 && c.intent === 'change_request') {
    feed('task', `Out of scope on ${project.name}: "${m.text.slice(0, 60)}" (${scores})`, { route: 'Blocked: scope' })
    await holding(project, m, 'saying you will look at it and come back with details')
    return draftChangeOrder(project, m.text, m.id)
  }
  if (c.clarity < 0.35) {
    const q = await write('Ask the client one short clarifying question so you can do their request right.', `Client: ${m.text}`)
    return ask('send_text', { jid: m.chat, text: q, quotedJson: JSON.stringify({ key: m.raw.key, message: m.raw.message }) },
      `🤔 Unclear request on ${project.name}: "${m.text}"\n\n*Draft question:*\n${q}`,
      [{ key: '1', label: 'send' }, { key: '2', label: 'edit' }, { key: '0', label: 'skip' }])
  }
  return route(project, m, m.text, c)
}

/** The routing table: presence x human dependence -> Devin surface. */
async function route(project: Project, m: InMsg, request: string, c: Cls) {
  const high = c.humanDependence >= 0.55 || c.sizeOk < 0.5 || c.verifiable < 0.3
  const off = presence() === 'offline'
  const scores = `human ${c.humanDependence.toFixed(2)}, verifiable ${c.verifiable.toFixed(2)}, size ok ${c.sizeOk.toFixed(2)}`

  if (!high) {
    if (off) await holding(project, m, 'saying you are on it')
    const prompt = changePrompt(project, request)
    await startDevinTask(project, 'change', request, prompt, m.id, 'cloud')
    if (!off) await notify(`☁️ Devin Cloud is on *${request.slice(0, 80)}* (${project.name}). ${scores}`)
    return
  }

  const brief = await makeBrief(project, request)
  const briefPath = path.join(config.outDir, 'briefs', `${project.slug}-${Date.now()}.md`)
  fs.mkdirSync(path.dirname(briefPath), { recursive: true })
  fs.writeFileSync(briefPath, brief)

  if (off) {
    db.prepare(`insert into tasks (project_id, source_msg_id, kind, request, in_scope, route, status, created_at) values (?,?,?,?,1,'queued','queued',?)`)
      .run(project.id, m.id, 'change', request, now())
    feed('task', `Needs you: "${request.slice(0, 60)}" on ${project.name}. Brief ready, queued for morning`, { route: 'Queued for human' })
    await holding(project, m, 'saying you will take care of it first thing tomorrow')
    await notify(`🌙 Queued for you (needs your judgement, ${scores}):\n*${request}*\n\n${brief.slice(0, 1200)}`)
    return
  }

  db.prepare(`insert into tasks (project_id, source_msg_id, kind, request, in_scope, route, status, created_at) values (?,?,?,?,1,'cli','running_local',?)`)
    .run(project.id, m.id, 'change', request, now())
  feed('task', `Hands-on: "${request.slice(0, 60)}" on ${project.name}. Opening Devin CLI`, { route: 'Devin CLI' })
  launchCli(project, briefPath, brief)
  await notify(`💻 Opened Devin CLI with the brief for *${request.slice(0, 80)}* (${scores}). The brief is on your clipboard. Use /handoff in the CLI to send it to the cloud once the direction is set.`)
}

function changePrompt(project: Project, request: string) {
  return [
    `Client project "${project.name}" in repo ${project.repo_url || `${GITHUB_OWNER}/${project.slug}`}.`,
    `Agreed spec:\n${project.spec}`,
    '',
    `Client request: "${request}"`,
    '',
    'Make the change on a new branch, keep the existing style, make sure it builds, open a PR, and deploy a Vercel preview for the branch.',
    'Report preview_url and pr_url in your structured output, and also finish with the lines PREVIEW_URL: <url> and PR_URL: <url>.',
  ].join('\n')
}

async function makeBrief(project: Project, request: string) {
  let repoContext = ''
  if (devin.devinReady() && project.repo_url)
    repoContext = await devin.askRepo(project.repo_url.replace('https://github.com/', ''), `Which files and components would need to change to do this: "${request}"? Be specific.`).catch(() => '')
  return extract(
    z.object({ brief: z.string() }),
    'Write a high-context engineering brief (markdown) for this client request: goal, what the client actually wants, open questions that need human judgement, files likely involved, acceptance criteria. Keep it under 300 words.',
    `Project: ${project.name}\nRepo: ${project.repo_url}\nSpec:\n${project.spec}\n\nRequest: ${request}\n\n${repoContext ? `Codebase notes from Devin:\n${repoContext.slice(0, 3000)}` : ''}`,
    { brief: `# ${project.name}: ${request}\n\nClient asked: "${request}"\n\nRepo: ${project.repo_url || 'n/a'}\n\nNeeds your judgement before building.\n\n${repoContext.slice(0, 1500)}` },
  ).then(r => r.brief)
}

function launchCli(project: Project, briefPath: string, brief: string) {
  const dir = path.join(config.root, '..', project.slug)
  const cd = fs.existsSync(dir) ? `cd ${JSON.stringify(dir)} && ` : ''
  const p = execFile('pbcopy')
  p.stdin?.end(brief)
  const script = `tell application "Terminal" to do script "${cd.replace(/"/g, '\\"')}echo 'Brief: ${briefPath}' && (command -v devin >/dev/null && devin || cat ${JSON.stringify(briefPath).replace(/"/g, '\\"')})"`
  execFile('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate'], err => err && console.error('cli launch', err.message))
}

// ---------- Commands ----------

onCommand('projects', async () => {
  const rows = db.prepare(`select * from projects order by id desc`).all() as Project[]
  await notify(rows.length ? rows.map(p => `#${p.slug}  ${p.name}  ${p.autopilot ? '🤖' : ''}\n${p.preview_url || 'no preview yet'}`).join('\n\n') : 'No projects yet.')
})

onCommand('autopilot', async args => {
  const [onOff, slug] = args.split(/\s+/)
  db.prepare(`update projects set autopilot = ? where slug = ?`).run(onOff === 'on' ? 1 : 0, slug)
  await notify(`🤖 Autopilot ${onOff} for #${slug}`)
})

onCommand('link', async args => {
  const [slug, n] = args.split(/\s+/)
  const [g] = pickGroups(n ?? '')
  if (!g) return void (await notify('Usage: /link <slug> <group#> (numbers from /groups)'))
  db.prepare(`update projects set chat_jid = ? where slug = ?`).run(g.jid, slug)
  db.prepare(`update chats set kind = 'client' where jid = ?`).run(g.jid)
  await notify(`🔗 #${slug} now lives in ${g.name}`)
})

onCommand('status', async () => {
  const running = db.prepare(`select count(*) from tasks where status in ('running','running_local')`).pluck().get()
  const queued = db.prepare(`select count(*) from tasks where status = 'queued'`).pluck().get()
  const leads = db.prepare(`select count(*) from leads where status = 'pitched'`).pluck().get()
  await notify(`${presence() === 'online' ? '🟢 Online' : '🌙 Offline'}\nDevin: ${devin.devinReady() ? 'connected' : 'not connected'}\nTasks running ${running}, queued for you ${queued}\nOpen pitches ${leads}`)
})
