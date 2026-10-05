import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { connection } from 'next/server'
import type { ReactNode } from 'react'

import '../(app)/globals.css'

export const metadata: Metadata = {
  title: { default: 'Store console', template: '%s · Store console' },
  robots: { index: false, follow: false },
  manifest: '/console.webmanifest',
  appleWebApp: { capable: true, title: 'Store console', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#1F3A2E',
  width: 'device-width',
  initialScale: 1,
}

/**
 * Root layout of the merchant console (G4-06): tablet-first, installable (web app manifest),
 * separate from the storefront and from /ops. Every page checks the caller's store scope itself
 * (requireStaffPage); src/proxy.ts only checks that a session cookie exists.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await connection() // per-request CSP nonce (G6-01)
  return (
    // data-theme is required: globals.css keeps <html> hidden until a theme is set
    <html
      lang="en-CA"
      data-theme="light"
      className={[GeistSans.variable, GeistMono.variable].join(' ')}
    >
      <head>
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      </head>
      <body className="block min-h-screen bg-[#FAF6EE] text-[#211F1C]">{children}</body>
    </html>
  )
}
