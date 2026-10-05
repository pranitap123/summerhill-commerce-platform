import { z } from 'zod'

import { SLOT_MINUTES, weeklyHoursSchema } from '@/modules/scheduling'

/**
 * Request schemas for the merchant console API (/api/console, G4). Strict: unknown keys are
 * rejected. Kept out of the route files so the OpenAPI generator can read them.
 */
const publicId = z.string().regex(/^SH-[0-9A-Z]{6}$/)

export const locationParams = z.object({ id: z.coerce.number().int().positive() }).strict()
export const orderParams = z.object({ publicId }).strict()
export const lineParams = z
  .object({ publicId, lineId: z.coerce.number().int().positive() })
  .strict()
export const closureParams = z
  .object({
    id: z.coerce.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
export const productAvailabilityParams = z
  .object({ id: z.coerce.number().int().positive(), productId: z.string().trim().min(1).max(100) })
  .strict()
export const categoryAvailabilityParams = z
  .object({
    id: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive(),
  })
  .strict()

export const rejectBody = z
  .object({ reason: z.enum(['too_busy', 'items_unavailable', 'closing', 'other']) })
  .strict()

export const startBody = z.object({ takeover: z.boolean().optional() }).strict()

const weightLb = z.number().positive().max(50)
const scannedCode = z.string().trim().min(8).max(20)

export const pickBody = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('picked'),
      quantity: z.number().int().min(1).max(99).optional(),
      weightLb: weightLb.optional(),
      scannedCode: scannedCode.optional(),
      confirmUnusualWeight: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('unavailable'),
      reason: z.enum(['out_of_stock', 'damaged', 'quality', 'other']),
    })
    .strict(),
  z.object({ action: z.literal('reset') }).strict(),
])

export const substituteBody = z
  .object({
    productId: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(99).optional(),
    weightLb: weightLb.optional(),
    scannedCode: scannedCode.optional(),
    reason: z.string().trim().max(140).optional(),
    confirmUnusualWeight: z.boolean().optional(),
  })
  .strict()

export const scanBody = z.object({ code: z.string().trim().min(1).max(64) }).strict()

export const completeBody = z.object({ confirmOverAuthorization: z.boolean().optional() }).strict()

export const handoverBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()

export const settingsBody = z
  .object({
    weeklyHours: weeklyHoursSchema.optional(),
    slotMinutes: z
      .number()
      .int()
      .refine((m) => (SLOT_MINUTES as readonly number[]).includes(m), {
        message: `One of ${SLOT_MINUTES.join(', ')}`,
      })
      .optional(),
    slotCapacity: z.number().int().min(1).max(100).optional(),
    leadTimeMinutes: z.number().int().min(0).max(10_080).optional(),
    paused: z.boolean().optional(),
    pauseReason: z.string().trim().max(200).nullable().optional(),
    scaleBarcode: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const closureBody = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(1).max(100),
  })
  .strict()

export const availabilityBody = z.object({ outOfStock: z.boolean() }).strict()
