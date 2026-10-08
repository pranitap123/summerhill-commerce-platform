import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { simulatedCheckoutView } from '@/modules/payments'
import { getConfig } from '@/server/config'

import { SimulatedPayment } from './SimulatedPayment'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Test payment', robots: { index: false } }

export default async function SimulatorCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const config = getConfig()
  if (config.PAYMENT_PROVIDER !== 'simulator') notFound()
  const { sessionId } = await params
  const view = await simulatedCheckoutView(sessionId)
  if (!view) notFound()
  return <SimulatedPayment view={JSON.parse(JSON.stringify(view))} />
}
