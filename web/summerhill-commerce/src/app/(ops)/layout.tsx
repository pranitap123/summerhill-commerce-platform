import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { can, getSessionUser, isPlatformStaff, type Permission } from '@/modules/identity'

import '../(app)/globals.css'

export const metadata: Metadata = {
  title: { default: 'Operations', template: '%s · Operations' },
  robots: { index: false, follow: false },
}

const MENU: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/ops', label: 'Dashboard', permission: 'ops.enter' },
  { href: '/ops/orders', label: 'Orders', permission: 'orders.read' },
  { href: '/ops/issues', label: 'Support issues', permission: 'issues.resolve' },
  { href: '/ops/merchants', label: 'Merchants', permission: 'merchants.read' },
  { href: '/ops/payouts', label: 'Payouts', permission: 'payouts.manage' },
  { href: '/ops/disputes', label: 'Disputes', permission: 'disputes.manage' },
  { href: '/ops/reconciliation', label: 'Reconciliation', permission: 'recon.run' },
  { href: '/ops/refunds', label: 'Refunds by agent', permission: 'finance.read' },
  { href: '/ops/metrics', label: 'Metrics', permission: 'metrics.read' },
  { href: '/ops/catalog', label: 'Catalogue', permission: 'catalog.manage' },
  { href: '/ops/users', label: 'Users', permission: 'users.manage' },
  { href: '/ops/flags', label: 'Flags', permission: 'flags.manage' },
  { href: '/ops/audit', label: 'Audit log', permission: 'audit.read' },
  { href: '/ops/privacy', label: 'Privacy', permission: 'privacy.manage' },
]

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser(await headers())
  const staff = isPlatformStaff(user) && user?.mfaVerified
  const items = staff ? MENU.filter((m) => can(user, m.permission)) : []
  return (

    <html lang="en-CA" data-theme="light">
      <body className="block min-h-screen bg-[#FAF6EE] text-[#211F1C]">
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <header className="border-b border-neutral-300 bg-white px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="font-display text-xl text-[#1F3A2E]">Operations</p>
            {staff && (
              <nav aria-label="Operations" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {items.map((m) => (
                  <Link key={m.href} href={m.href} className="hover:underline">
                    {m.label}
                  </Link>
                ))}
                <Link href="/console" className="hover:underline">
                  Store console
                </Link>
              </nav>
            )}
            {user && (
              <p className="ml-auto text-xs text-neutral-600">
                {user.email} · {user.roles.filter((r) => r !== 'customer').join(', ')}
              </p>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Test mode: no real money moves. Stripe test mode or the payment simulator.
          </p>
        </header>
        <main id="main" className="px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
