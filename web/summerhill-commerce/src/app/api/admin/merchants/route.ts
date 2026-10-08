import { createMerchant, listMerchants } from '@/modules/merchant'
import { parseJson, route } from '@/server/http'

import { createMerchantBody } from '../_lib/schemas'

export const GET = route('admin', async () => ({ merchants: await listMerchants() }), {
  permission: 'merchants.read',
})

export const POST = route(
  'admin',
  async ({ req, audit }) => {
    const body = await parseJson(req, createMerchantBody)
    const merchant = await createMerchant({
      slug: body.slug,
      name: body.name,
      hstRegistrationNumber: body.hstRegistrationNumber ?? null,
      location: {
        slug: body.location.slug,
        name: body.location.name,
        addressLine1: body.location.addressLine1 ?? null,
        city: body.location.city ?? null,
        province: body.location.province ?? null,
        postalCode: body.location.postalCode ?? null,
      },
    })
    await audit({
      action: 'merchant.create',
      targetType: 'merchant',
      targetId: merchant.id,
      data: { slug: merchant.slug, name: merchant.name },
    })
    return Response.json({ merchant }, { status: 201 })
  },
  { permission: 'merchants.manage' },
)
