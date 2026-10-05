/**
 * Worker process entry point. Start with `npm run worker` (loads stack.env + .env). Tracing
 * (G6-08) must be registered before `pg` is first imported, so the loop is loaded afterwards.
 */
import { startTracing } from '@/server/tracing'

await startTracing('worker')
await import('./loop')
