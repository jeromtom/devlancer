export type Party = {
  name: string
  business?: string
  email?: string
  phone?: string
  address?: string
}

export type LineItem = { description: string; qty: number; rate: number }

export type Milestone = { name: string; due: string; amountPct: number }

export type ProposalData = {
  number: string
  date: string
  validUntil: string
  from: Party
  to: Party
  title: string
  summary: string
  understanding: string[]
  scope: string[]
  deliverables: string[]
  outOfScope: string[]
  milestones: Milestone[]
  items: LineItem[]
  paymentTerms: string[]
  notes?: string
}

export type InvoiceData = {
  number: string
  date: string
  dueDate: string
  kind: 'advance' | 'milestone' | 'change_order' | 'final' | 'retainer'
  from: Party
  to: Party
  projectName: string
  items: LineItem[]
  amountPaid: number
  upiId?: string
  bankDetails?: string[]
  notes?: string
}

export type ChangeOrderData = {
  number: string
  date: string
  from: Party
  to: Party
  projectName: string
  request: string
  reason: string
  items: LineItem[]
  timelineImpact: string
}
