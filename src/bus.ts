import { EventEmitter } from 'node:events'

export type FeedEvent = {
  ts: number
  kind: 'gig' | 'pitch' | 'proposal' | 'task' | 'devin' | 'scope' | 'invoice' | 'payment' | 'email' | 'info'
  text: string
  route?: string
  url?: string
}

export const bus = new EventEmitter()
bus.setMaxListeners(50)

const recent: FeedEvent[] = []

export function feed(kind: FeedEvent['kind'], text: string, extra: Partial<FeedEvent> = {}) {
  const ev: FeedEvent = { ts: Date.now(), kind, text, ...extra }
  recent.push(ev)
  if (recent.length > 200) recent.shift()
  console.log(`[${kind}] ${text}${extra.route ? ` (${extra.route})` : ''}`)
  bus.emit('feed', ev)
}

export const recentFeed = () => recent.slice(-100)
