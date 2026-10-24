import { experimental_decide as decide, generateText, generateObject } from 'ai'
import { z } from 'zod'
import { anthropic } from '@ai-sdk/anthropic'
import { config } from './config.js'
import { db } from './db.js'

// ---------- Laya: typed decisions ----------

// Laya on our gateway tier allows 5 requests/minute. Spend those on live messages and fall back
// to the text model (same typed shape) when the budget is used up, so nothing ever stalls.
const LAYA_RPM = Number(process.env.LAYA_RPM ?? 5)
const layaCalls: number[] = []
export const engineStats = { laya: 0, fallback: 0 }

function takeLaya() {
  const t = Date.now()
  while (layaCalls.length && t - layaCalls[0] > 60_000) layaCalls.shift()
  if (layaCalls.length >= LAYA_RPM) return false
  layaCalls.push(t)
  return true
}

async function decideOr<T>(
  name: string,
  laya: () => Promise<T>,
  fallback: () => Promise<T>,
  opts: { preferFallback?: boolean; rules?: () => T; merge?: (laya: T, other: T) => T } = {},
): Promise<T> {
  if (!opts.preferFallback && takeLaya()) {
    try {
      // Ensemble: Laya and the text model vote in parallel; if the text model fails, Laya alone decides
      const [r, other] = await Promise.all([laya(), opts.merge ? fallback().catch(() => null) : Promise.resolve(null)])
      engineStats.laya++
      console.log(`[laya${other ? '+text' : ''}] ${name}`)
      return other && opts.merge ? opts.merge(r, other) : r
    } catch (e: any) {
      console.log(`[laya] ${name} failed (${String(e.message).slice(0, 80)}), falling back`)
    }
  }
  try {
    const r = await fallback()
    engineStats.fallback++
    console.log(`[fallback] ${name}`)
    return r
  } catch (e: any) {
    if (!opts.rules) throw e
    console.log(`[rules] ${name} (${String(e.message).slice(0, 60)})`)
    return opts.rules()
  }
}

// ---------- Last-resort rules (no AI) ----------

const has = (re: RegExp, t: string) => re.test(t)
export function gigRules(text: string) {
  const t = text.toLowerCase()
  const isGig = has(/\b(need|looking for|require|hiring|anyone|want (a|someone))\b/, t) && has(/\b(website|app|developer|automation|bot|landing|design|freelanc|build|project)\b/, t) ? 0.75 : 0.2
  const category = has(/website|landing|web/, t) ? 'website' : has(/\bapp\b|android|ios/, t) ? 'mobile_app' : has(/automation|bot|whatsapp|integration|script/, t) ? 'automation' : has(/design|logo|ui|video/, t) ? 'design' : 'other'
  return { isGig, fit: category === 'design' || category === 'other' ? 0.4 : 0.7, category }
}
function clientRules(input: ClientInput) {
  const t = input.message.toLowerCase()
  const intent = has(/\b(paid|sent the|transferred|payment done|gpay|upi|utr)\b/, t) ? 'payment_claim'
    : has(/^(ok|okay|done|approved|go ahead|looks good|perfect|great|confirmed)\b/, t) ? 'approval'
    : has(/\b(not working|broken|error|bug|issue|crash)\b/, t) ? 'bug_report'
    : has(/\b(change|add|make|update|remove|replace|fix|can you|could you|please)\b/, t) ? 'change_request'
    : t.includes('?') ? 'question' : 'chatter'
  const tasteful = has(/\b(feel|premium|look|vibe|design|logo|brand|colou?r scheme|password|login|credentials|payment gateway)\b/, t)
  return {
    project: input.projects[0]?.slug ?? 'none', projectConfidence: input.projects.length === 1 ? 1 : 0.4, intent,
    inScope: has(/\b(payment|app|login|delivery|tracking|booking system|admin panel)\b/, t) ? 0.3 : 0.7,
    clarity: t.length > 15 ? 0.6 : 0.3, verifiable: 0.6, humanDependence: tasteful ? 0.7 : 0.3, sizeOk: 0.8,
  }
}


const LEVELS = ['none', 'low', 'medium', 'high', 'very high']
const norm = (a: { type: string; score?: number } | undefined) =>
  a && a.type === 'score' ? (a.score ?? 0) / (LEVELS.length - 1) : 0
const prob = (a: { type: string; probability?: number } | undefined) =>
  a && a.type === 'boolean' ? (a.probability ?? 0) : 0

export async function classifyGig(text: string, opts: { preferFallback?: boolean } = {}) {
  return decideOr('gig', () => classifyGigLaya(text), () =>
    extract(
      z.object({
        isGig: z.number().describe('0-1 probability that someone is looking to hire or pay for work'),
        fit: z.number().describe('0-1 how well the work matches the freelancer skills'),
        category: z.enum(['website', 'mobile_app', 'automation', 'design', 'other']),
      }),
      'Classify this WhatsApp group message. Ads, offers of services, greetings and news are not gigs.',
      `Freelancer skills: ${config.freelancer.skills}\n\nMessage:\n${text}`,
    ), {
      ...opts,
      rules: () => gigRules(text),
      merge: (l, o) => ({ isGig: (l.isGig + o.isGig) / 2, fit: (l.fit + o.fit) / 2, category: l.category }),
    })
}

async function classifyGigLaya(text: string) {
  const r = await decide({
    maxRetries: 0,
    model: config.decideModel,
    state: `Freelancer skills: ${config.freelancer.skills}\n\nMessage posted in a business WhatsApp group:\n"""${text}"""`,
    questions: {
      is_gig: {
        type: 'boolean',
        instructions: 'Is this message someone looking to hire or pay for work to be done (a job, gig, project or requirement)? Ads, offers of services, greetings and news are not gigs.',
      },
      fit: {
        type: 'score',
        instructions: 'How well does the requested work match the freelancer skills?',
        criteria: LEVELS,
      },
      category: {
        type: 'choice',
        instructions: 'What kind of work is requested?',
        criteria: {
          website: 'A website, landing page or web app',
          mobile_app: 'A mobile app',
          automation: 'Automation, bots, integrations or scripts',
          design: 'Graphic, UI or video design',
          other: 'Anything else',
        },
      },
    },
  })
  return { isGig: prob(r.answers.is_gig), fit: norm(r.answers.fit), category: r.answers.category.choice }
}

type ClientInput = { spec: string; recent: string; message: string; projects: { slug: string; name: string }[] }

/** Signals that a request needs the freelancer no matter what the models say. */
const NEEDS_HUMAN = /\b(i('| wi)ll (share|send)|will (share|send)|later|logo|brand( guide)?|fonts?|colou?rs?|feel|vibe|premium|look and feel|redesign|password|login|credentials|access|domain|dns|payment gateway|razorpay|stripe)\b/i

export async function classifyClientMessage(input: ClientInput) {
  const r = await classifyClientRaw(input)
  if (NEEDS_HUMAN.test(input.message)) r.humanDependence = Math.max(r.humanDependence, 0.7)
  return r
}

async function classifyClientRaw(input: ClientInput) {
  return decideOr('client message', () => classifyClientLaya(input), async () => {
    const r = await extract(
      z.object({
        project: z.enum(['none', ...input.projects.map(p => p.slug)] as [string, ...string[]]),
        projectConfidence: z.number().describe('0-1'),
        intent: z.enum(['change_request', 'bug_report', 'question', 'approval', 'payment_claim', 'chatter']),
        inScope: z.number().describe('0-1 probability the request is covered by the agreed scope'),
        clarity: z.number().describe('0-1 how clear and specific'),
        verifiable: z.number().describe('0-1 how easily success can be checked'),
        humanDependence: z.number().describe('0-1 how much it needs human judgement: taste or brand decisions, negotiation, credentials, prod data, or assets the client has not sent yet'),
        sizeOk: z.number().describe('0-1 probability it takes under 3 hours'),
      }),
      'Classify the new client message for a freelance developer.',
      `Projects: ${input.projects.map(p => `${p.slug} (${p.name})`).join(', ')}\n\nAgreed scope:\n${input.spec.slice(0, 2500)}\n\nRecent conversation:\n${input.recent.slice(-2500)}\n\nNew client message:\n${input.message}`,
    )
    return r
  }, {
    rules: () => clientRules(input),
    // Laya picks the choices (intent, project); calibrated scores are averaged with the text model
    merge: (l, o) => ({
      ...l,
      // On disagreement the text model wins on intent (Laya over-reads approvals from context)
      intent: l.intent === o.intent ? l.intent : o.intent,
      inScope: (l.inScope + o.inScope) / 2,
      clarity: (l.clarity + o.clarity) / 2,
      verifiable: (l.verifiable + o.verifiable) / 2,
      humanDependence: (l.humanDependence + o.humanDependence) / 2,
      sizeOk: (l.sizeOk + o.sizeOk) / 2,
    }),
  })
}

async function classifyClientLaya(input: ClientInput) {
  // Laya choice keys must be simple identifiers: map p1, p2... back to slugs
  const projectCriteria: Record<string, string> = { none: 'Not about any listed project' }
  input.projects.forEach((p, i) => (projectCriteria[`p${i + 1}`] = p.name))
  const keyToSlug = (k: string) => (k.startsWith('p') ? input.projects[Number(k.slice(1)) - 1]?.slug ?? 'none' : 'none')
  const r = await decide({
    maxRetries: 0,
    model: config.decideModel,
    state: `Agreed scope of work:\n${input.spec.slice(0, 1500)}\n\nRecent conversation:\n${input.recent.slice(-1200)}\n\nNew client message:\n"""${input.message}"""`,
    questions: {
      project: { type: 'choice', instructions: 'Which project is the new client message about?', criteria: projectCriteria },
      intent: {
        type: 'choice',
        instructions: 'What is the client doing in the new message?',
        criteria: {
          change_request: 'Asking for a change, addition or new feature',
          bug_report: 'Reporting something broken or not working',
          question: 'Asking a question that needs an answer',
          approval: 'Approving, accepting, agreeing or saying go ahead',
          payment_claim: 'Saying they paid, sent money or sharing payment proof',
          chatter: 'Greetings, thanks, small talk or nothing actionable',
        },
      },
      in_scope: { type: 'boolean', instructions: 'Is the request covered by the agreed scope of work above?' },
      clarity: { type: 'score', instructions: 'How clear and specific is the request, enough to act on without asking?', criteria: LEVELS },
      verifiable: { type: 'score', instructions: 'How easily can success be checked (build passes, visible on the page, test)?', criteria: LEVELS },
      human_dependence: {
        type: 'score',
        instructions: 'How much does this need human judgement: taste, negotiation, credentials or access, production data, or context only the freelancer has?',
        criteria: LEVELS,
      },
      size_ok: { type: 'boolean', instructions: 'Can a developer finish this in under 3 hours?' },
    },
  })
  const a = r.answers
  return {
    project: keyToSlug(a.project.choice as string),
    projectConfidence: a.project.probabilities?.[a.project.choice] ?? 1,
    intent: a.intent.choice,
    inScope: prob(a.in_scope),
    clarity: norm(a.clarity),
    verifiable: norm(a.verifiable),
    humanDependence: norm(a.human_dependence),
    sizeOk: prob(a.size_ok),
  }
}

export async function classifyLeadReply(context: string, message: string) {
  return decideOr('lead reply', () => classifyLeadReplyLaya(context, message), () =>
    extract(
      z.object({ accepted: z.number().describe('0-1 client accepted or agreed to start'), wantsProposal: z.number().describe('0-1 client asks for quote, proposal, details or pricing') }),
      'Classify the new client message.',
      `Conversation:\n${context.slice(-3000)}\n\nNew client message:\n${message}`,
    ), { rules: () => ({
      accepted: /\b(let'?s (do|start|go)|go ahead|confirmed|deal|approved|sending (the )?advance|ok let'?s)\b/i.test(message) ? 0.8 : 0.1,
      wantsProposal: /\b(quote|proposal|details|price|pricing|cost|how much|charges)\b/i.test(message) ? 0.8 : 0.1,
    }) })
}

async function classifyLeadReplyLaya(context: string, message: string) {
  const r = await decide({
    maxRetries: 0,
    model: config.decideModel,
    state: `Conversation between a freelancer and a potential client:\n${context.slice(-3000)}\n\nNew message from the client:\n"""${message}"""`,
    questions: {
      accepted: { type: 'boolean', instructions: 'Has the client accepted the proposal or agreed to start the project?' },
      wants_proposal: { type: 'boolean', instructions: 'Is the client asking for a quote, proposal, details or pricing?' },
    },
  })
  return { accepted: prob(r.answers.accepted), wantsProposal: prob(r.answers.wants_proposal) }
}

export async function classifyEmail(subject: string, body: string) {
  return decideOr('email', () => classifyEmailLaya(subject, body), async () =>
    (await extract(z.object({ kind: z.enum(['payment_alert', 'client_message', 'gig_lead', 'other']) }), 'Classify this email.', `${subject}\n${body.slice(0, 3000)}`)).kind, { rules: () => (/credited|received|payment|upi|imps|neft/i.test(subject + body) ? 'payment_alert' : 'other') })
}

async function classifyEmailLaya(subject: string, body: string) {
  const r = await decide({
    maxRetries: 0,
    model: config.decideModel,
    state: `Email subject: ${subject}\n\n${body.slice(0, 4000)}`,
    questions: {
      kind: {
        type: 'choice',
        instructions: 'What is this email?',
        criteria: {
          payment_alert: 'A bank, UPI or payment gateway alert that money was received or credited',
          client_message: 'A client writing about a project or work',
          gig_lead: 'A job or gig opportunity',
          other: 'Newsletter, promotion, notification or anything else',
        },
      },
    },
  })
  return r.answers.kind.choice
}

// ---------- Text model: writing (with a fallback chain, then templates) ----------

const CHAIN = [
  ...new Set([
    config.textModel,
    'openai/gpt-4.1-mini',
    'google/gemini-2.5-flash-lite',
    'openai/gpt-5-mini',
    'openai/gpt-4o-mini',
    'meta/llama-3.3-70b',
    'mistral/mistral-small',
  ]),
]
const resolveModel = (id: string) =>
  process.env.ANTHROPIC_API_KEY && id.startsWith('anthropic/') && process.env.USE_ANTHROPIC_DIRECT ? anthropic(id.replace('anthropic/', '')) : id
const down = new Map<string, number>() // model -> retry-after epoch ms

async function withChain<T>(what: string, fn: (model: any) => Promise<T>): Promise<T> {
  let last: unknown
  for (const id of CHAIN) {
    if ((down.get(id) ?? 0) > Date.now()) continue
    try {
      return await fn(resolveModel(id))
    } catch (e: any) {
      last = e
      const msg = String(e?.message ?? e)
      // Park models that are rate limited or not allowed, for a while
      if (/rate limit|429|free tier|credit|not found|403|401/i.test(msg)) down.set(id, Date.now() + (/rate/i.test(msg) ? 60_000 : 30 * 60_000))
      console.log(`[text] ${what} failed on ${id}: ${msg.slice(0, 90)}`)
    }
  }
  throw last ?? new Error('all text models failed')
}

function voiceGuide(): string {
  const rows = db
    .prepare(`select text from messages where from_me = 1 and source = 'wa' and length(text) between 8 and 300
              and chat_jid not like '%status%' order by ts desc limit 25`)
    .all() as { text: string }[]
  const samples = rows.map(r => `- ${r.text.replace(/\n/g, ' ')}`).join('\n')
  return `You write WhatsApp messages AS ${config.freelancer.name}, a freelance developer in Kerala, India. Never reveal you are an AI or a bot, never sign off with a bot name. Sound like a real person texting: short, warm, professional, natural Indian English. No em dashes.${
    samples ? `\nMatch the tone, length, emoji use and language mix of these real messages they sent:\n${samples}` : ''
  }`
}

const clean = (t: string) => t.trim().replace(/^["']|["']$/g, '').replace(/\u2014/g, ', ')

/** Write a message in the freelancer's voice. Never throws: falls back to `fallback` (or a safe generic line). */
export async function write(task: string, context = '', fallback = 'Sure, noted. Will get back to you shortly 🙂'): Promise<string> {
  try {
    const { text } = await withChain('write', model =>
      generateText({
        model,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(25_000),
        system: voiceGuide(),
        prompt: `${context ? `Context:\n${context}\n\n` : ''}Task: ${task}\n\nReply with only the message text.`,
      }),
    )
    return clean(text) || fallback
  } catch {
    console.log('[template] write')
    return fallback
  }
}

/** Structured extraction. Falls back through the model chain, then to `fallback` if given. */
export async function extract<T>(schema: z.ZodType<T>, task: string, context: string, fallback?: T): Promise<T> {
  try {
    const { object } = await withChain('extract', model =>
      generateObject({
        model,
        schema,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(40_000),
        system: `You help ${config.freelancer.name} (${config.freelancer.business}), a freelance developer in Kerala, India. Skills: ${config.freelancer.skills}. Hourly rate INR ${config.freelancer.hourlyRate}. Prices in INR. Never use em dashes.`,
        prompt: `${task}\n\n${context}`,
      }),
    )
    return object as T
  } catch (e) {
    if (fallback !== undefined) {
      console.log('[template] extract')
      return fallback
    }
    throw e
  }
}
