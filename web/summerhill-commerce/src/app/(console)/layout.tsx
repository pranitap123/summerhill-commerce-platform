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

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await connection()
  return (

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
