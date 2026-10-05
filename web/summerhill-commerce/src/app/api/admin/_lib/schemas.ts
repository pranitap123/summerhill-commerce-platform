import { z } from 'zod'

import { ISSUE_TYPES } from '@/modules/support'

/**
 * Request schemas of the back-office API (/api/admin, G5). Shared by the routes and the OpenAPI
 * registry, so the published contract is exactly what the routes validate. Strict: unknown keys
 * are refused (GAP-10).
 */
export const idParam = z.object({ id: z.coerce.number().int().positive() }).strict()
export const userParam = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) }).strict()
export const monthParam = z
  .object({
    id: z.coerce.number().int().positive(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict()
export const closeMonthParam = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
  .strict()
export const flagParam = z
  .object({
    key: z
      .string()
      .regex(/^[a-z0-9_.]+$/)
      .max(64),
  })
  .strict()
export const membershipParam = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    merchantId: z.coerce.number().int().positive(),
  })
  .strict()

const reason = z.string().trim().min(3).max(200)
const liability = z.enum(['merchant', 'platform', 'split'])
const cents = z.number().int().positive().max(10_000_000)

export const orderSearchQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.string().max(20).optional(),
    merchantId: z.coerce.number().int().positive().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    hasIssue: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()

export const cancelBody = z
  .object({ reason, liability: z.enum(['merchant', 'platform']).optional() })
  .strict()

export const refundBody = z
  .object({
    scenario: z.enum([
      'missing_item',
      'wrong_substitute',
      'damaged',
      'quality',
      'price_error',
      'goodwill',
      'cancellation',
      'changed_mind',
      'no_show',
    ]),
    lines: z
      .array(
        z
          .object({
            lineId: z.number().int().positive(),
            quantity: z.number().int().positive().max(99).optional(),
            weightLb: z.number().positive().max(50).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    amountCents: cents.optional(),
    full: z.literal(true).optional(),
    liability: liability.optional(),
    merchantShareCents: cents.optional(),
    reason,
  })
  .strict()

export const refundReportQuery = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(7) })
  .strict()

export const disputeListQuery = z.object({ open: z.enum(['true', 'false']).optional() }).strict()
export const disputeLiabilityBody = z
  .object({ liability: z.enum(['merchant', 'platform']), recoverCents: cents.optional() })
  .strict()

export const payoutBody = z
  .object({ amountCents: z.number().int().min(100).max(10_000_000), reason })
  .strict()
export const payoutDecisionBody = z.object({ decision: z.enum(['approve', 'reject']) }).strict()
export const payoutScheduleBody = z
  .object({ interval: z.enum(['manual', 'daily', 'weekly', 'monthly']) })
  .strict()
export const payoutListQuery = z
  .object({
    merchantId: z.coerce.number().int().positive().optional(),
    status: z.string().max(20).optional(),
  })
  .strict()

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(60)
export const createMerchantBody = z
  .object({
    slug,
    name: z.string().trim().min(2).max(100),
    hstRegistrationNumber: z
      .string()
      .regex(/^\d{9}RT\d{4}$/)
      .nullable()
      .optional(),
    location: z
      .object({
        slug,
        name: z.string().trim().min(2).max(100),
        addressLine1: z.string().trim().max(200).nullable().optional(),
        city: z.string().trim().max(100).nullable().optional(),
        province: z.string().length(2).nullable().optional(),
        postalCode: z.string().trim().max(10).nullable().optional(),
      })
      .strict(),
  })
  .strict()
export const lifecycleBody = z
  .object({
    action: z.enum(['go_live', 'pause', 'resume', 'offboard', 'finish_offboarding']),
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
export const statementQuery = z.object({ format: z.enum(['json', 'csv']).default('json') }).strict()

export const reconRunBody = z.object({ runDate: z.iso.date() }).strict()

export const issueListQuery = z
  .object({ status: z.enum(['open', 'auto_approved', 'approved', 'rejected']).optional() })
  .strict()
export const resolveIssueBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().min(3).max(500),
    scenario: z
      .enum(['missing_item', 'wrong_substitute', 'damaged', 'quality', 'price_error', 'goodwill'])
      .optional(),
    amountCents: cents.optional(),
    liability: liability.optional(),
  })
  .strict()
export const reportIssueBody = z
  .object({
    type: z.enum(ISSUE_TYPES),
    lines: z
      .array(
        z
          .object({
            lineId: z.number().int().positive(),
            quantity: z.number().int().positive().max(99).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()

export const ingestRunBody = z
  .object({ merchantId: z.number().int().positive(), mode: z.enum(['full', 'delta']) })
  .strict()
export const ingestDecisionBody = z.object({ decision: z.enum(['approve', 'reject']) }).strict()
export const mappingBody = z.object({ subcategoryId: z.number().int().positive() }).strict()
export const mappingQuery = z.object({ unmapped: z.enum(['true', 'false']).optional() }).strict()
export const productSearchQuery = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict()

const role = z.enum(['admin', 'support', 'finance', 'customer'])
const membership = z
  .object({
    merchantId: z.number().int().positive(),
    locationId: z.number().int().positive().nullable(),
    role: z.enum(['owner', 'manager', 'picker']),
  })
  .strict()
export const inviteBody = z
  .object({
    email: z.email().max(200),
    name: z.string().trim().max(100).nullable().optional(),
    roles: z.array(role).max(4).default([]),
    membership: membership.optional(),
  })
  .strict()
export const rolesBody = z.object({ roles: z.array(role).max(4) }).strict()
export const membershipBody = z
  .object({
    locationId: z.number().int().positive().nullable(),
    role: z.enum(['owner', 'manager', 'picker']),
  })
  .strict()

export const flagBody = z.object({ enabled: z.boolean() }).strict()

export const auditQuery = z
  .object({
    actorId: z.string().max(64).optional(),
    action: z.string().max(64).optional(),
    targetType: z.string().max(32).optional(),
    targetId: z.string().max(64).optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict()

export const metricsQuery = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .strict()

export const alertQuery = z.object({ open: z.enum(['true', 'false']).optional() }).strict()

export const privacySubjectBody = z
  .object({ email: z.email().max(200).optional(), userId: z.string().max(64).optional() })
  .strict()
  .refine((b) => !!b.email !== !!b.userId, { message: 'Give exactly one of email or userId' })
export const privacyDeleteBody = z
  .object({
    email: z.email().max(200).optional(),
    userId: z.string().max(64).optional(),
    confirm: z.literal('DELETE'),
  })
  .strict()
  .refine((b) => !!b.email !== !!b.userId, { message: 'Give exactly one of email or userId' })

// Customer and staff self-service
export const mfaVerifyBody = z.object({ code: z.string().regex(/^\s*\d{6}\s*$/) }).strict()
export const deleteAccountBody = z.object({ confirm: z.literal('DELETE') }).strict()
export const consoleFinanceQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict()
export const consoleMerchantParams = z.object({ id: z.coerce.number().int().positive() }).strict()
export const consoleStatementParams = monthParam
export const simulatorAccountParams = z
  .object({ accountId: z.string().regex(/^acct_sim_[0-9a-f]{24}$/) })
  .strict()
