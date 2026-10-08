import { completeSimulatedOnboarding } from '@/modules/payments'
import { getConfig } from '@/server/config'
import { HttpError, parseParams, route } from '@/server/http'

import { simulatorAccountParams } from '../../../admin/_lib/schemas'

export const POST = route<{ accountId: string }>('public', async ({ params }) => {
  const config = getConfig()
  if (config.PAYMENT_PROVIDER !== 'simulator') throw new HttpError(404, 'NOT_FOUND', 'Not found')
  const { accountId } = parseParams(params, simulatorAccountParams)
  const returnUrl = await completeSimulatedOnboarding(accountId)
  return { completed: true, returnUrl }
})
