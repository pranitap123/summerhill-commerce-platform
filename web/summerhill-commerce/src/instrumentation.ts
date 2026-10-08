
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfig } = await import('./server/config')
    getConfig()

    const { startTracing } = await import('./server/tracing')
    await startTracing('web')
  }
}
