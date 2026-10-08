import { buildEvidencePack } from '@/modules/payments'
import { idParam, parseParams, route } from '@/server/http'

export const POST = route<{ id: string }>(
  'admin',
  async ({ params, audit }) => {
    const { id } = parseParams(params, idParam)
    const pack = await buildEvidencePack(id)
    await audit({ action: 'dispute.evidence_rebuild', targetType: 'dispute', targetId: id })
    return pack
  },
  { permission: 'disputes.manage' },
)
