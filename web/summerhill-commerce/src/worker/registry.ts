import { runAcceptanceSweep, runNoShowSweep } from '@/modules/fulfilment'
import {
  ALERT_NOTIFY_QUEUE,
  handleAlertNotification,
  handleOrderNotification,
  NOTIFY_QUEUE,
} from '@/modules/notifications'
import {
  claimJobs,
  completeJob,
  enqueue,
  evaluateAlertRules,
  failJob,
  purgeExpiredIdempotencyKeys,
  purgeRateLimitWindows,
  raiseAlert,
  recoverStuckJobs,
  relayOutbox,
  type Job,
  type OutboxEvent,
  type Subscriptions,
} from '@/modules/ops'
import {
  captureOrder,
  onCaptureDead,
  onWebhookDead,
  processWebhookEvent,
  runAuthExpiryGuard,
  runDisputeDeadlineAlerts,
  sweepAbandonedCheckouts,
  WEBHOOK_QUEUE,
} from '@/modules/payments'
import { runScheduledReconciliation } from '@/modules/payouts'
import { runRetentionPurge } from '@/modules/privacy'
import { generateAllSlots, releaseExpiredHolds } from '@/modules/scheduling'
import { rebuildSearchIndex, upsertSearchDocuments } from '@/modules/search'
import { getDb } from '@/server/db'
import type { Logger } from '@/server/logger'
import { inSpan, SpanKind, type TraceCarrier } from '@/server/tracing'
import { CATALOG_TAG, productTag, requestRevalidation } from '@/server/revalidate'

export const SUBSCRIPTIONS: Subscriptions = {
  'order.placed': [NOTIFY_QUEUE],
  'order.cancelled': [NOTIFY_QUEUE],
  'order.picked': ['payment.capture'],

  'order.ready': [NOTIFY_QUEUE],
  'order.line_substituted': [NOTIFY_QUEUE],

  'order.refunded': [NOTIFY_QUEUE],
  'order.issue_rejected': [NOTIFY_QUEUE],

  'product.changed': ['search.upsertProduct', 'storefront.revalidate'],
  'catalog.ingested': ['storefront.revalidate'],

  'ops.alert_raised': [ALERT_NOTIFY_QUEUE],
}

function revalidationTags(event: OutboxEvent): string[] {
  if (event.topic === 'catalog.ingested') return [CATALOG_TAG]
  const tags = [productTag(event.key)]
  if (event.payload.reason !== 'ingest') tags.push(CATALOG_TAG)
  return tags
}

const eventOf = (job: Job) => job.payload.event as OutboxEvent
const orderIdOf = (job: Job) => Number(eventOf(job).payload.orderId)

interface Handler {
  handle(job: Job): Promise<unknown>

  onDead?(job: Job, error: string): Promise<void>
}

export const HANDLERS: Record<string, Handler> = {
  [WEBHOOK_QUEUE]: {
    handle: (job) => processWebhookEvent(String(job.payload.eventId)),
    onDead: (job, error) => onWebhookDead(String(job.payload.eventId), error),
  },
  [NOTIFY_QUEUE]: { handle: (job) => handleOrderNotification(eventOf(job)) },
  [ALERT_NOTIFY_QUEUE]: { handle: (job) => handleAlertNotification(eventOf(job)) },

  'alerts.evaluate': { handle: () => evaluateAlertRules() },
  'payment.capture': {
    handle: (job) => captureOrder(orderIdOf(job)),
    onDead: (job, error) => onCaptureDead(orderIdOf(job), error),
  },
  'payment.authExpiryGuard': { handle: () => runAuthExpiryGuard() },
  'checkout.expireAbandoned': { handle: () => sweepAbandonedCheckouts() },
  'search.upsertProduct': { handle: (job) => upsertSearchDocuments([eventOf(job).key]) },
  'search.rebuild': { handle: () => rebuildSearchIndex() },
  'storefront.revalidate': { handle: (job) => requestRevalidation(revalidationTags(eventOf(job))) },

  'slots.generate': { handle: () => generateAllSlots() },
  'slots.releaseExpired': { handle: () => releaseExpiredHolds() },
  'orders.acceptanceSweep': { handle: () => runAcceptanceSweep() },
  'orders.noShowSweep': { handle: () => runNoShowSweep() },

  'recon.daily': { handle: () => runScheduledReconciliation() },
  'disputes.deadlineAlerts': { handle: () => runDisputeDeadlineAlerts() },
  'retention.purge': { handle: () => runRetentionPurge() },
  'ops.cleanup': {
    handle: async () => {
      await purgeExpiredIdempotencyKeys()
      await purgeRateLimitWindows()
    },
  },
}

export const SCHEDULES: Array<{ queue: string; everyMs: number }> = [
  { queue: 'payment.authExpiryGuard', everyMs: 60 * 60_000 },
  { queue: 'checkout.expireAbandoned', everyMs: 15 * 60_000 },

  { queue: 'slots.generate', everyMs: 60 * 60_000 },
  { queue: 'slots.releaseExpired', everyMs: 60_000 },
  { queue: 'orders.acceptanceSweep', everyMs: 60_000 },
  { queue: 'orders.noShowSweep', everyMs: 15 * 60_000 },
  { queue: 'ops.cleanup', everyMs: 24 * 60 * 60_000 },
  { queue: 'alerts.evaluate', everyMs: 60_000 },

  { queue: 'recon.daily', everyMs: 60 * 60_000 },
  { queue: 'disputes.deadlineAlerts', everyMs: 60 * 60_000 },
  { queue: 'retention.purge', everyMs: 7 * 24 * 60 * 60_000 },

  { queue: 'search.rebuild', everyMs: 24 * 60 * 60_000 },
]

export async function enqueueDueSchedules(now: Date = new Date()): Promise<void> {
  for (const s of SCHEDULES) {
    const period = Math.floor(now.getTime() / s.everyMs)
    await enqueue(getDb(), s.queue, {}, { dedupeKey: `${s.queue}:${period}`, maxAttempts: 1 })
  }
}

export async function runOnce(workerId: string, log: Logger, batch = 10): Promise<number> {
  await relayOutbox(SUBSCRIPTIONS)
  await enqueueDueSchedules()
  const jobs = await claimJobs(Object.keys(HANDLERS), batch, workerId)
  for (const job of jobs) {
    const jobLog = log.child({ jobId: job.id, queue: job.queue, attempt: job.attempts })
    try {
      await inSpan(
        `job ${job.queue}`,
        {
          kind: SpanKind.CONSUMER,
          parent: job.payload.trace as TraceCarrier | undefined,
          attributes: {
            'job.id': Number(job.id),
            'job.queue': job.queue,
            'job.attempt': job.attempts,
          },
        },
        () => HANDLERS[job.queue].handle(job),
      )
      await completeJob(job.id)
    } catch (err) {
      const outcome = await failJob(job, err)
      const message = err instanceof Error ? err.message : String(err)
      if (outcome === 'dead') {
        jobLog.error({ err }, 'job dead-lettered')
        await HANDLERS[job.queue]
          .onDead?.(job, message)
          .catch((e) => jobLog.error({ err: e }, 'onDead hook failed'))
        await raiseAlert(getDb(), {
          kind: 'job.dead',
          dedupeKey: `job-dead:${job.id}`,
          severity: 'critical',
          message: `Job ${job.queue} #${job.id} failed ${job.attempts} times`,
          data: { jobId: job.id, queue: job.queue, error: message },
        })
      } else jobLog.warn({ err }, 'job failed, will retry')
    }
  }
  return jobs.length
}

export { recoverStuckJobs }
