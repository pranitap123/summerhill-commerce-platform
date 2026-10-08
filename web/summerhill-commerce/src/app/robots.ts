import type { MetadataRoute } from 'next'

import { getConfig } from '@/server/config'

/* eslint-disable no-restricted-exports */
export default function robots(): MetadataRoute.Robots {
  const base = getConfig().NEXT_PUBLIC_SERVER_URL
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',

        disallow: ['/admin', '/ops', '/api/', '/account', '/orders', '/cart', '/checkout'],
      },
    ],
    sitemap: new URL('/sitemap.xml', base).toString(),
  }
}
