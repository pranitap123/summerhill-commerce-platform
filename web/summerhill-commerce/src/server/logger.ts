import pino, { type Logger } from 'pino'

import { getConfig } from './config'

let root: Logger | undefined

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
