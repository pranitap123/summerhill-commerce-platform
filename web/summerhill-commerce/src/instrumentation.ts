/**
 * Runs once when the Next.js server starts. Validating config here makes the server refuse to
 * boot with a missing or invalid environment variable instead of failing on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfig } = await import('./server/config')
    getConfig()
    // G6-08: tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set (npm run stack:observability)
    const { startTracing } = await import('./server/tracing')
    await startTracing('web')
  }
}
