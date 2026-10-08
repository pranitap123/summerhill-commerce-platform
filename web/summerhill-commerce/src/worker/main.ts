import { startTracing } from '@/server/tracing'

await startTracing('worker')
await import('./loop')
