import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Starts a worker for the run (outbox relay, webhook processing, capture job), with the payment
 * simulator like the web server. Several workers can run side by side (SKIP LOCKED), so an
 * already-running `npm run worker:sim` does no harm. E2E_WORKER=external skips this.
 */
export default async function globalSetup() {
  if (process.env.E2E_WORKER === 'external') return
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const worker = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'worker:sim'], {
    cwd,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  return async () => {
    // Synchronously: Playwright exits right after teardown, and a taskkill still starting then
    // never runs, leaving a worker behind after every run (seen on Windows, G7).
    if (process.platform === 'win32' && worker.pid)
      spawnSync('taskkill', ['/pid', String(worker.pid), '/t', '/f'], { stdio: 'ignore' })
    else worker.kill('SIGTERM')
  }
}
