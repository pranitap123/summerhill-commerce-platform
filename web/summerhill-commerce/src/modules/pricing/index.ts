// Public API of the pricing module. Money maths lives only here and in `payments` (ADR-0006).
export { calculatePlatformFee } from './revenueShare'
export type { RevenueShareResult } from './revenueShare'
export {
  dollarsToCents,
  divideRoundHalfUp,
  applyBasisPoints,
  priceForWeight,
  lbToMlb,
  mlbToLb,
} from './money'
export {
  computeFee,
  parseFeeSchedule,
  DEFAULT_FLAT_SCHEDULE,
  HST_ON_COMMISSION_BP,
  flatTiersSchema,
  marginalTiersSchema,
} from './fees'
export type { FeeSchedule, FeeResult } from './fees'
export {
  buildQuote,
  effectivePrice,
  quoteHash,
  toPublicQuote,
  TAX_RATE_BP,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  MAX_WEIGHT_MLB,
  DEFAULT_ESTIMATED_WEIGHT_MLB,
} from './quote'
export type {
  Quote,
  PublicQuote,
  QuoteLine,
  QuoteIssue,
  QuoteIssueCode,
  QuoteLineInput,
  QuoteSettings,
  PricingProduct,
  Promotion,
  TaxCode,
} from './quote'
export { finalizeOrder, planCapture } from './final'
export type { FinalizableLine, FinalAmounts, FinalLine, CapturePlan } from './final'
export { getActiveFeeSchedule, getFeeSchedule } from './feeSchedules'
