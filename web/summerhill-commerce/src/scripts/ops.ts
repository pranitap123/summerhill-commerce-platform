/**
 * Operator commands for the runbooks (docs/runbooks). Every change is written to the audit log with
 * the operator's name.
 *   npm run ops -- alerts                                   open alerts
 *   npm run ops -- jobs:dead                                dead-lettered jobs
 *   npm run ops -- webhook:replay <evt_…> --by <name>       process a failed webhook event again (RB-03)
 *   npm run ops -- capture:retry <order> --by <name> [--reason <text>]   capture again (RB-04)
 *   npm run ops -- mfa:reencrypt --by <name>   after rotating PAYLOAD_SECRET; reads PAYLOAD_SECRET_PREVIOUS (RB-13)
 */
import { reencryptMfaSecrets } from '@/modules/identity'
import { audit, listAlerts, type Actor } from '@/modules/ops'
import { getOrderByPublicId } from '@/modules/ordering'
import { replayWebhookEvent, retryCapture } from '@/modules/payments'
import { closeDb, getDb } from '@/server/db'

const args = process.argv.slice(2)
const [command] = args
const target = args[1]?.startsWith('--') ? undefined : args[1]
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

function operator(): Actor {
  const by = option('by')
  if (!by) throw new Error('say who you are: --by <name> (it goes into the audit log)')
  return { type: 'admin', id: `cli:${by}` }
}

async function run(): Promise<void> {
  switch (command) {
    case 'alerts': {
      const alerts = await listAlerts({ open: true })
      if (!alerts.length) console.log('no open alerts')
      for (const a of alerts)
        console.log(`#${a.id}  ${a.severity.padEnd(8)} ${a.kind.padEnd(24)} ${a.message}`)
      return
    }
    case 'jobs:dead': {
      const { rows } = await getDb().query(
        `SELECT id, queue, attempts, last_error, payload FROM ops.jobs
         WHERE status = 'dead' ORDER BY id DESC LIMIT 50`,
      )
      if (!rows.length) console.log('no dead jobs')
      for (const j of rows)
        console.log(
          `#${j.id}  ${j.queue}  attempts ${j.attempts}  ${JSON.stringify(j.payload).slice(0, 120)}\n    ${j.last_error}`,
        )
      return
    }
    case 'webhook:replay': {
      if (!target) throw new Error('usage: webhook:replay <evt_…> --by <name>')
      const outcome = await replayWebhookEvent(target, operator())
      console.log(`webhook ${target}: ${outcome}`)
      return
    }
    case 'capture:retry': {
      if (!target) throw new Error('usage: capture:retry <order number> --by <name>')
      const order = await getOrderByPublicId(target)
      if (!order) throw new Error(`no order ${target}`)
      const outcome = await retryCapture(order.id, operator(), option('reason') ?? 'runbook RB-04')
      console.log(`order ${target}: ${outcome}`)
      return
    }
    case 'mfa:reencrypt': {
      // From the environment (put it in .env for the run), never as an argument: process lists show those.
      const previous = process.env.PAYLOAD_SECRET_PREVIOUS
      if (!previous) throw new Error('set PAYLOAD_SECRET_PREVIOUS to the secret before rotation')
      const actor = operator()
      const result = await reencryptMfaSecrets(previous)
      await audit(getDb(), {
        actor,
        action: 'mfa.reencrypt',
        targetType: 'staff_mfa',
        targetId: null,
        data: { ...result },
      })
      console.log(
        `mfa: ${result.reencrypted} re-encrypted, ${result.current} already current, ${result.unreadable.length} unreadable`,
      )
      for (const id of result.unreadable) console.log(`  reset MFA for user ${id} (/ops/users)`)
      return
    }
    default:
      throw new Error(
        'commands: alerts | jobs:dead | webhook:replay | capture:retry | mfa:reencrypt',
      )
  }
}

try {
  await run()
} catch (err) {
  console.error(`ops: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await closeDb()
}
