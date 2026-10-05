// Public API of the ops module: outbox, job queue, idempotency, rate limits, audit, flags, alerts.
export { emit, relayOutbox, handleOnce, queuesFor } from './outbox'
export type { OutboxEvent, Subscriptions } from './outbox'
export {
  enqueue,
  claimJobs,
  completeJob,
  failJob,
  recoverStuckJobs,
  backoffMs,
  newWorkerId,
} from './jobs'
export type { Job, EnqueueOptions } from './jobs'
export {
  withIdempotency,
  readIdempotencyKey,
  requestHash,
  purgeExpiredIdempotencyKeys,
} from './idempotency'
export type { StoredResponse } from './idempotency'
export { consume, purgeRateLimitWindows, LIMITS } from './rateLimit'
export type { RateLimit } from './rateLimit'
export { audit, searchAuditLog } from './audit'
export type { Actor, ActorType, AuditContext, AuditEntry, AuditRow } from './audit'
export { isEnabled, clearFlagCache, listFlags, readFlagNow, setFlag } from './flags'
export type { FeatureFlag } from './flags'
export { raiseAlert, listAlerts, resolveAlert } from './alerts'
export type { AlertRow } from './alerts'
export {
  ALERT_ROUTES,
  CONDITION_RULES,
  THRESHOLDS as ALERT_THRESHOLDS,
  evaluateAlertRules,
  routeFor,
} from './alertRules'
export type { AlertChannel, AlertRoute, ConditionRule } from './alertRules'
