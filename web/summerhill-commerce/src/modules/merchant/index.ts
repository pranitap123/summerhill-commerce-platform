// Public API of the merchant module.
export {
  getMerchantById,
  getMerchantByStripeAccount,
  getLocation,
  listMerchants,
  updateMerchantStripeAccount,
  updateMerchantStatus,
  buildStatusUpdate,
  UPDATABLE_STATUS_COLUMNS,
} from './repository'
export type {
  Merchant,
  Location,
  MerchantStatusUpdate,
  OnboardingStatus,
  LifecycleStatus,
} from './repository'
export { deriveOnboardingStatus } from './status'
export {
  STAFF_ROLES,
  roleAtLeast,
  listStaffMemberships,
  upsertStaffMembership,
  listAllStaffMemberships,
  deactivateStaffMemberships,
} from './staff'
export type { StaffMembership, StaffMembershipRow, StaffRole } from './staff'
export {
  OPEN_ORDER_STATUSES,
  goLiveCheck,
  openOrderCount,
  changeLifecycle,
  markOffboarded,
  createMerchant,
  setStripeAccount,
  merchantHealth,
} from './lifecycle'
export type { GoLiveCheck, LifecycleAction, MerchantHealth } from './lifecycle'
export * as stripeTestFixtures from './stripeTestFixtures'
