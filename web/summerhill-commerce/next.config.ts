import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)
import { redirects } from './redirects'
import { staticSecurityHeaders } from './src/server/securityHeaders'

const NEXT_PUBLIC_SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack's on-disk dev cache (default on in Next 16) speeds up restarts on fast disks but can
    // make every compile take minutes on slow ones. NEXT_DEV_FS_CACHE=false turns it off.
    turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE !== 'false',
  },
  // Tracing (G6-08): loaded at runtime from node_modules, not bundled. The instrumentations hook
  // `require` of pg and undici, which only works on the real modules (and bundling them stalls
  // Turbopack).
  serverExternalPackages: [
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/instrumentation',
    '@opentelemetry/instrumentation-pg',
    '@opentelemetry/instrumentation-undici',
  ],
  // Temporarily required on Windows until Next.js fixes Turbopack Sass resolution.
  // See: https://github.com/vercel/next.js/issues/86431
  sassOptions: {
    loadPaths: ['./node_modules/@payloadcms/ui/dist/scss/'],
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
    qualities: [90, 100],
    remotePatterns: [
      ...[NEXT_PUBLIC_SERVER_URL /* 'https://example.com' */].map((item) => {
        const url = new URL(item)

        return {
          hostname: url.hostname,
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
        }
      }),
    ],
  },
  reactStrictMode: true,
  redirects,
  poweredByHeader: false,
  // G6-01: the same security headers on every response; the per-request CSP is set in src/proxy.ts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders({ production: process.env.NODE_ENV === 'production' }),
      },
    ]
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig)
