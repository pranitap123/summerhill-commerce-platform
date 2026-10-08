export const ISSUE_TYPES = ['missing', 'damaged', 'wrong_item', 'quality', 'other'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

export const ISSUE_SCENARIO = {
  missing: 'missing_item',
  damaged: 'damaged',
  wrong_item: 'wrong_substitute',
  quality: 'quality',
  other: null,
} as const satisfies Record<IssueType, string | null>

export interface PolicyConfig {
  maxIssueCents: number
  max90DayCents: number
}

export interface PolicyInput {
  type: IssueType
  claimedCents: number
  customer90DayRefundCents: number
  autoRefundEnabled: boolean
}

export interface PolicyDecision {
  decision: 'auto_approve' | 'queue'
  reasons: string[]
}

export function decideIssue(input: PolicyInput, config: PolicyConfig): PolicyDecision {
  const reasons: string[] = []
  if (!input.autoRefundEnabled) reasons.push('automatic refunds are switched off')
  if (ISSUE_SCENARIO[input.type] === null)
    reasons.push(`"${input.type}" issues are reviewed by an agent`)
  if (input.claimedCents <= 0) reasons.push('no refundable amount')
  if (input.claimedCents > config.maxIssueCents)
    reasons.push(
      `claim ${input.claimedCents}¢ is over the ${config.maxIssueCents}¢ automatic limit`,
    )
  const total = input.customer90DayRefundCents + input.claimedCents
  if (total > config.max90DayCents)
    reasons.push(
      `the customer's 90-day refunds would be ${total}¢ (limit ${config.max90DayCents}¢)`,
    )
  return reasons.length
    ? { decision: 'queue', reasons }
    : { decision: 'auto_approve', reasons: ['within the automatic refund policy'] }
}
