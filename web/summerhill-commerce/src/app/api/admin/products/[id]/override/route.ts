import { z } from 'zod'

import { clearProductOverride, OverrideTargetNotFound, setProductOverride } from '@/modules/catalog'
import type { Actor } from '@/modules/ops'
import { HttpError, parseJson, parseParams, route } from '@/server/http'

const params = z.object({ id: z.string().trim().min(1).max(100) }).strict()
const body = z
  .object({
    hidden: z.boolean().optional(),
    hiddenUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    name: z.string().trim().min(1).max(200).nullable().optional(),
    subcategoryId: z.number().int().positive().nullable().optional(),
    estimatedWeightLb: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,3})?$/)
      .refine((v) => Number(v) > 0, 'must be greater than 0')
      .nullable()
      .optional(),
    blockedReason: z.string().trim().min(3).max(100).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field' })

export const PUT = route<{ id: string }>(
  'admin',
  async ({ req, params: raw, user, requestId }) => {
    const { id } = parseParams(raw, params)
    const patch = await parseJson(req, body)
    const actor: Actor = { type: 'admin', id: String(user!.id) }
    try {
      return { override: await setProductOverride(id, patch, actor, requestId) }
    } catch (err) {
      if (err instanceof OverrideTargetNotFound)
        throw new HttpError(404, 'NOT_FOUND', 'Product not found')
      throw err
    }
  },
  { permission: 'catalog.manage', audit: 'service' },
)

export const DELETE = route<{ id: string }>(
  'admin',
  async ({ params: raw, user, requestId }) => {
    const { id } = parseParams(raw, params)
    const cleared = await clearProductOverride(
      id,
      { type: 'admin', id: String(user!.id) },
      requestId,
    )
    if (!cleared) throw new HttpError(404, 'NOT_FOUND', 'No override for this product')
    return { cleared: true }
  },
  { permission: 'catalog.manage', audit: 'service' },
)
