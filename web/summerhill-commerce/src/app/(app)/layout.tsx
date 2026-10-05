import type { Metadata } from 'next'
import { Fraunces, Work_Sans } from 'next/font/google'
import { connection } from 'next/server'
import type { ReactNode } from 'react'

import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { CheckoutStatusBanner } from '@/components/storefront/CheckoutStatusBanner'
import { Providers } from '@/providers'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import React from 'react'
import './globals.css'

const SITE_NAME = process.env.SITE_NAME || 'Grocery Marketplace Demo'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description:
    'A grocery marketplace reference implementation: independent stores, pickup orders, Stripe test mode. Demo data only.',
  openGraph: { siteName: SITE_NAME, locale: 'en_CA', type: 'website' },
}

// Downloaded at build time and served from this origin (no request to Google at runtime).
const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
})
const body = Work_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' })

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request (G6-01): the CSP nonce Next.js puts on its scripts is new for every
  // response, so a page can't be prerendered at build time with a stale one.
  await connection()
  return (
    <html
      className={[GeistSans.variable, GeistMono.variable, display.variable, body.variable].join(
        ' ',
      )}
      lang="en-CA"
      // Fixed light theme (G3-13): set on the server, no client script needed
      data-theme="light"
    >
      <head>
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      </head>
      <body>
        <Providers>
          <CheckoutStatusBanner />
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
