import pino, { type Logger } from 'pino'

import { getConfig } from './config'

let root: Logger | undefined

/**
 * Structured JSON logger (G1-11). Secrets and personal data are redacted before anything is
 * written (threat T10): auth headers, cookies, Stripe signatures, passwords, emails.
 */
export function getLogger(): Logger {
  root ??= pino({
    level: getConfig().LOG_LEVEL,
    base: { service: 'web' },
    redact: {
      paths: [
        'headers.authorization',
        'headers.cookie',
        'headers["stripe-signature"]',
        '*.password',
        '*.email',
        'email',
        'password',
      ],
      censor: '[redacted]',
    },
  })
  return root
}

export type { Logger }
