// Public API of the payments module. Stripe SDK access goes through here only.
export { createStripeClient, getStripe, STRIPE_API_VERSION } from './stripe'
export type { default as Stripe } from 'stripe'
export {
  postCapture,
  postProcessingFee,
  postRefund,
  postDispute,
  postDisputeCredit,
  reverseEntries,
  isBalanced,
} from './ledgerRules'
export type { LedgerAccount, LedgerEntry } from './ledgerRules'
export { postJournal, getOrderLedger } from './ledger'
export type { AccountBalance } from './ledger'
export {
  getGateway,
  setGatewayForTests,
  verifyWebhook,
  toPaymentIntentInfo,
  stripeGateway,
} from './gateway'
export type {
  PaymentGateway,
  PaymentIntentInfo,
  CheckoutSessionInfo,
  RefundInfo,
  TransferReversalInfo,
  ConnectedAccountInfo,
  PayoutInfo,
  BalanceTransaction,
} from './gateway'
export { getPaymentForOrder } from './repository'
export type { Payment, PaymentStatus } from './repository'
export {
  startCheckout,
  buildCheckoutLineItems,
  lineItemsTotal,
  HOLD_MESSAGE,
  SESSION_TTL_MS,
  SLOT_HOLD_TTL_MS,
  sweepAbandonedCheckouts,
} from './checkout'
export type { CheckoutInput, CheckoutResult } from './checkout'
export {
  captureOrder,
  finalizableLines,
  projectCapture,
  onCaptureDead,
  retryCapture,
  voidOrder,
  recordAuthorization,
  runAuthExpiryGuard,
  AUTH_EXPIRY_WARNING_MS,
} from './capture'
export {
  recordWebhookEvent,
  processWebhookEvent,
  replayWebhookEvent,
  onWebhookDead,
  WEBHOOK_QUEUE,
} from './webhooks'
export type { WebhookSource } from './webhooks'
export { fastForwardToPicked } from './demo'
export { simulateCheckout, simulatedCheckoutView } from './simulatorCheckout'
export {
  completeSimulatedOnboarding,
  getSimAccount,
  proportionalFeeRefund,
  SIM_DISPUTE_FEE_CENTS,
} from './simulatorBackOffice'
// Back office (G5)
export {
  REFUND_SCENARIOS,
  NON_REFUNDABLE_SCENARIOS,
  createRefund,
  cancelOnBehalf,
  finalizeRefund,
  failRefund,
  getRefund,
  listRefundsForOrder,
  refundableSummary,
  refundsByAgent,
  customerRefundTotal,
} from './refunds'
export type { Refund, RefundRequest, RefundScenario, Liability } from './refunds'
export { lineRefundCents, lineFullCents, splitShares, hstShareOfFeeRefund } from './refundMath'
export type { RefundableLine } from './refundMath'
export {
  getDispute,
  listDisputes,
  buildEvidencePack,
  submitDisputeEvidence,
  setDisputeLiability,
  suggestedDisputeLiability,
  runDisputeDeadlineAlerts,
  DISPUTE_ALERT_HOURS,
} from './disputes'
export type { Dispute, EvidencePack } from './disputes'
export type { SimAction, SimOutcome } from './simulatorCheckout'
