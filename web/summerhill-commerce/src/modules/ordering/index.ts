// Public API of the ordering module: orders, state machine, timeline, access.
export {
  ORDER_STATUSES,
  TRANSITIONS,
  VOIDABLE_STATUSES,
  STATUS_LABELS,
  canTransition,
  isTerminal,
} from './stateMachine'
export type { OrderStatus } from './stateMachine'
export {
  insertPendingOrder,
  getOrder,
  getOrderForUpdate,
  getOrderByPublicId,
  findPendingOrderForCart,
  getOrderLines,
  getOrderEvents,
  listOrdersForUser,
  listRecentOrders,
  findOrderForLookup,
  recordPick,
  saveFinalAmounts,
  generatePublicId,
} from './repository'
export type { Order, OrderLine, OrderEvent, LineOptions } from './repository'
export { transition, transitionInTx, recordOrderEvent, pickupCode } from './transition'
export {
  recordLinePick,
  resetLinePick,
  insertSubstituteLine,
  deleteSubstituteLine,
  setSubstituteDecision,
  listOrderIdsForLocations,
} from './picking'
export type { LinePick, SubstituteSnapshot } from './picking'
export type { TransitionResult, TransitionOptions } from './transition'
export { orderAccessToken, verifyOrderAccessToken, canViewOrder } from './access'
