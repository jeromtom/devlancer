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

async function decideOr<T>(name: string, laya: () => Promise<T>, fallback: () => Promise<T>, opts: { preferFallback?: boolean } = {}): Promise<T> {
  if (!opts.preferFallback && takeLaya()) {
    try {
      const r = await laya()
      engineStats.laya++
      console.log(`[laya] ${name}`)
      return r
    } catch (e: any) {
      console.log(`[laya] ${name} failed (${String(e.message).slice(0, 80)}), falling back`)
    }
  }
  const r = await fallback()
  engineStats.fallback++
  console.log(`[fallback] ${name}`)
  return r
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
    ), opts)
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

export async function classifyClientMessage(input: ClientInput) {
  return decideOr('client message', () => classifyClientLaya(input), async () => {
    const r = await extract(
      z.object({
        project: z.enum(['none', ...input.projects.map(p => p.slug)] as [string, ...string[]]),
        projectConfidence: z.number().describe('0-1'),
        intent: z.enum(['change_request', 'bug_report', 'question', 'approval', 'payment_claim', 'chatter']),
        inScope: z.number().describe('0-1 probability the request is covered by the agreed scope'),
        clarity: z.number().describe('0-1 how clear and specific'),
        verifiable: z.number().describe('0-1 how easily success can be checked'),
        humanDependence: z.number().describe('0-1 how much it needs human judgement: taste, negotiation, credentials, prod data, missing context'),
        sizeOk: z.number().describe('0-1 probability it takes under 3 hours'),
      }),
      'Classify the new client message for a freelance developer.',
      `Projects: ${input.projects.map(p => `${p.slug} (${p.name})`).join(', ')}\n\nAgreed scope:\n${input.spec.slice(0, 2500)}\n\nRecent conversation:\n${input.recent.slice(-2500)}\n\nNew client message:\n${input.message}`,
    )
    return r
  })
}

async function classifyClientLaya(input: ClientInput) {
  const projectCriteria: Record<string, string> = { none: 'Not about any listed project' }
  for (const p of input.projects) projectCriteria[p.slug] = p.name
  const r = await decide({
    maxRetries: 0,
    model: config.decideModel,
    state: `Agreed scope of work:\n${input.spec.slice(0, 2500)}\n\nRecent conversation:\n${input.recent.slice(-2500)}\n\nNew client message:\n"""${input.message}"""`,
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
    project: a.project.choice as string,
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
    ))
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
    (await extract(z.object({ kind: z.enum(['payment_alert', 'client_message', 'gig_lead', 'other']) }), 'Classify this email.', `${subject}\n${body.slice(0, 3000)}`)).kind)
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

// ---------- Text model: writing ----------

// Use the Anthropic key directly when present (the gateway free tier blocks Claude models)
const textModel = () =>
  process.env.ANTHROPIC_API_KEY && config.textModel.startsWith('anthropic/')
    ? anthropic(config.textModel.replace('anthropic/', ''))
    : config.textModel

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

export async function write(task: string, context = ''): Promise<string> {
  const { text } = await generateText({
    model: textModel(),
    system: voiceGuide(),
    prompt: `${context ? `Context:\n${context}\n\n` : ''}Task: ${task}\n\nReply with only the message text.`,
  })
  return text.trim().replace(/—/g, ', ')
}

export async function extract<T>(schema: z.ZodType<T>, task: string, context: string): Promise<T> {
  const { object } = await generateObject({
    model: textModel(),
    schema,
    system: `You help ${config.freelancer.name} (${config.freelancer.business}), a freelance developer in Kerala, India. Skills: ${config.freelancer.skills}. Hourly rate INR ${config.freelancer.hourlyRate}. Prices in INR. Never use em dashes.`,
    prompt: `${task}\n\n${context}`,
  })
  return object as T
}
