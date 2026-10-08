import {
  parseScaleConfig,
  requireRole,
  scaleBarcodeConfigSchema,
  staffActor,
} from '@/modules/fulfilment'
import {
  getLocationSettings,
  listClosures,
  listSlots,
  updateLocationSettings,
} from '@/modules/scheduling'
import { HttpError, parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { locationParams, settingsBody } from '../../../_lib/schemas'

async function load(id: number) {
  const settings = await getLocationSettings(id)
  if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
  return settings
}

async function view(id: number) {
  const settings = await load(id)
  const now = new Date()
  const slots = await listSlots(id, now, new Date(now.getTime() + 7 * 86_400_000))
  return {
    settings: { ...settings, scaleBarcode: parseScaleConfig(settings.scaleBarcode) },
    closures: await listClosures(id, now.toISOString().slice(0, 10)),
    slots: slots.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      capacity: s.capacity,
      booked: s.booked,
      held: s.held,
      closed: s.closed,
    })),
  }
}

export const GET = route<{ id: string }>('staff', async (ctx) => {
  const { id } = parseParams(ctx.params, locationParams)
  requireRole(scopeOf(ctx), await load(id), 'picker', 'Location not found')
  return view(id)
})

export const PUT = route<{ id: string }>('staff', async (ctx) => {
  const { id } = parseParams(ctx.params, locationParams)
  const scope = scopeOf(ctx)
  requireRole(scope, await load(id), 'owner', 'Location not found')
  const body = await parseJson(ctx.req, settingsBody)
  const scaleBarcode = body.scaleBarcode
    ? scaleBarcodeConfigSchema.parse(body.scaleBarcode)
    : undefined
  await updateLocationSettings(id, { ...body, scaleBarcode }, staffActor(scope), {
    requestId: ctx.requestId,
  })
  return view(id)
})
