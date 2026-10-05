import { z } from 'zod'

/**
 * Request schemas for /api/v1 (strict: unknown keys are rejected, GAP-10). Kept out of the route
 * files (Next.js allows only HTTP handlers there) so the OpenAPI generator (G2-18) can read them.
 */
export const replacementSchema = z.enum(['best_match', 'specific', 'refund'])
export const weightLbSchema = z.number().positive().max(50)
const productId = z.string().trim().min(1).max(100)

export const addItemBody = z
  .object({
    productId,
    quantity: z.number().int().min(1).max(99).optional(),
    weightLb: weightLbSchema.optional(),
    replacementPreference: replacementSchema.optional(),
    replacementProductIds: z.array(productId).max(3).optional(),
    note: z.string().trim().max(140).nullable().optional(),
    /** Start a new cart when the product belongs to another store (the current cart is saved). */
    replaceCart: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.quantity === undefined) !== (b.weightLb === undefined), {
    message: 'Send either quantity or weightLb',
  })

export const updateItemBody = z
  .object({
    quantity: z.number().int().min(0).max(99).optional(),
    weightLb: weightLbSchema.optional(),
    replacementPreference: replacementSchema.optional(),
    replacementProductIds: z.array(productId).max(3).optional(),
    note: z.string().trim().max(140).nullable().optional(),
  })
  .strict()

export const lineIdParams = z.object({ lineId: z.coerce.number().int().positive() }).strict()

export const checkoutBody = z
  .object({
    /** `quote.hash` from the latest GET/POST cart quote. */
    quoteHash: z.string().regex(/^[0-9a-f]{32}$/),
    /** Required for guests; signed-in customers use their account email. */
    email: z.email().max(254).optional(),
    pickupName: z.string().trim().min(1).max(100).optional(),
    /** A slot id from GET /api/v1/cart/slots (G4-03). */
    slotId: z.number().int().positive(),
  })
  .strict()

export const publicIdParams = z.object({ publicId: z.string().regex(/^SH-[0-9A-Z]{6}$/) }).strict()

export const orderQuery = z.object({ t: z.string().max(200).optional() }).strict()

export const lookupBody = z
  .object({
    publicId: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^SH-[0-9A-Z]{6}$/),
    email: z.email().max(254),
  })
  .strict()

// ---- catalogue (G3-09) -------------------------------------------------------------------------
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80)
const flag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')
const cents = z.coerce.number().int().min(0).max(1_000_000)

/** Shared browse/search filters. `dietary` is comma-separated; every claim must match. */
const catalogFilters = {
  merchant: slug.optional(),
  category: slug.optional(),
  subcategory: slug.optional(),
  organic: flag.optional(),
  onSale: flag.optional(),
  inStock: flag.optional(),
  dietary: z
    .string()
    .max(300)
    .transform((v) =>
      v
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).max(10))
    .optional(),
  minPriceCents: cents.optional(),
  maxPriceCents: cents.optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'name']).default('relevance'),
  page: z.coerce.number().int().min(1).max(200).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
}

export const browseQuery = z.object(catalogFilters).strict()

export const searchQuery = z
  .object({ q: z.string().trim().min(1, 'Missing query param "q"').max(100), ...catalogFilters })
  .strict()

export const productParams = z.object({ slug: z.string().trim().min(1).max(120) }).strict()

export const searchClickBody = z
  .object({
    searchId: z.uuid(),
    productId: z.string().trim().min(1).max(100),
    position: z.number().int().min(1).max(10_000),
  })
  .strict()

// ---- order actions after checkout (G4-12, G4-14, G4-15, G4-19) --------------------------------
export const orderLineParams = z
  .object({
    publicId: z.string().regex(/^SH-[0-9A-Z]{6}$/),
    lineId: z.coerce.number().int().positive(),
  })
  .strict()

export const substitutionDecisionBody = z
  .object({ decision: z.enum(['approved', 'rejected']) })
  .strict()

export const arrivedBody = z
  .object({ note: z.string().trim().max(140).nullable().optional() })
  .strict()

export const ratingBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    tags: z
      .array(
        z.enum([
          'fresh',
          'well_packed',
          'good_substitutes',
          'quick_pickup',
          'missing_items',
          'poor_substitutes',
          'damaged',
          'long_wait',
        ]),
      )
      .max(6)
      .default([]),
    comment: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const reorderBody = z.object({ replaceCart: z.boolean().optional() }).strict()

/** Empty JSON object: actions without input (cancel). */
export const emptyBody = z.object({}).strict()
