import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Starts a worker for the run (outbox relay, webhook processing, capture job), with the payment
 * simulator like the web server. Several workers can run side by side (SKIP LOCKED), so an
 * already-running `npm run worker:sim` does no harm. E2E_WORKER=external skips this.
 *
 * Waits for the worker's "worker started" log line before the journeys begin: on a small CI
 * runner the cold start takes minutes, and orders placed meanwhile sit in "Waiting for payment".
 */
const READY = 'worker started'
const START_TIMEOUT_MS = 8 * 60_000

export default async function globalSetup() {
  if (process.env.E2E_WORKER === 'external') return
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const worker = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'worker:sim'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
  let output = ''
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`worker not ready after ${START_TIMEOUT_MS / 1000}s:
${output}`),
        ),
      START_TIMEOUT_MS,
    )
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000)
      if (output.includes(READY)) {
        clearTimeout(timer)
        resolve()
      }
    }
    worker.stdout?.on('data', onData)
    worker.stderr?.on('data', onData)
    worker.on('exit', (code) => {
      clearTimeout(timer)
      reject(
        new Error(`worker exited (${code}) before it was ready:
${output}`),
      )
    })
  })
  await ready
  // Keep draining the pipes so a chatty worker never blocks on a full buffer
  worker.stdout?.resume()
  worker.stderr?.resume()
  worker.removeAllListeners('exit')
  return async () => {
    // Synchronously: Playwright exits right after teardown, and a taskkill still starting then
    // never runs, leaving a worker behind after every run (seen on Windows, G7).
    if (process.platform === 'win32' && worker.pid)
      spawnSync('taskkill', ['/pid', String(worker.pid), '/t', '/f'], { stdio: 'ignore' })
    else worker.kill('SIGTERM')
  }
}
