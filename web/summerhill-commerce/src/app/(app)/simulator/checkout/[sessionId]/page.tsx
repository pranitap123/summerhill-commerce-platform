import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { simulatedCheckoutView } from '@/modules/payments'
import { getConfig } from '@/server/config'

import { SimulatedPayment } from './SimulatedPayment'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Test payment', robots: { index: false } }

/**
 * The payment simulator's checkout page (G4-18): stands in for the hosted payment page when
 * PAYMENT_PROVIDER=simulator (end-to-end tests, demos without a Stripe account). Clearly marked
 * as a simulator; it never asks for a real card. 404 unless the simulator is the payment provider (the config refuses it in production).
 */
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
