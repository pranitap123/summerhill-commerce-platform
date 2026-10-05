/**
 * The worker loop (G2-03, SYSTEM_DESIGN §3): relays the outbox, runs jobs and cron schedules.
 * Started by main.ts once tracing is set up. Stop with Ctrl+C: the current tick finishes, then
 * the process exits.
 */
import { newWorkerId } from '@/modules/ops'
import { getConfig } from '@/server/config'
import { closeDb } from '@/server/db'
import { getLogger } from '@/server/logger'

import { recoverStuckJobs, runOnce } from './registry'

const config = getConfig()
const workerId = newWorkerId()
const log = getLogger().child({ service: 'worker', workerId })
let stopping = false

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    log.info({ signal }, 'stopping after the current tick')
    stopping = true
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

log.info({ pollMs: config.WORKER_POLL_MS }, 'worker started')
let lastRecovery = 0
while (!stopping) {
  try {
    if (Date.now() - lastRecovery > 60_000) {
      const recovered = await recoverStuckJobs()
      if (recovered) log.warn({ recovered }, 'requeued jobs from a dead worker')
      lastRecovery = Date.now()
    }
    const ran = await runOnce(workerId, log)
    if (ran === 0) await sleep(config.WORKER_POLL_MS)
  } catch (err) {
    log.error({ err }, 'worker tick failed')
    await sleep(Math.max(config.WORKER_POLL_MS, 5_000))
  }
}
await closeDb()
log.info('worker stopped')
