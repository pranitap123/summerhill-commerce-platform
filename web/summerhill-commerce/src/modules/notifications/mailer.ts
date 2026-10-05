import nodemailer, { type Transporter } from 'nodemailer'

import { getConfig } from '@/server/config'
import { guard } from '@/server/outbound'

/**
 * SMTP delivery (G2-14). Locally every message lands in Mailpit (http://localhost:8025); a real
 * provider is a configuration change (SMTP_* variables), not a code change.
 */
export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

export interface Mailer {
  send(mail: Mail): Promise<{ messageId: string }>
}

let transport: Transporter | undefined
const smtpMailer: Mailer = {
  async send(mail) {
    const c = getConfig()
    transport ??= nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      ...(c.SMTP_USER ? { auth: { user: c.SMTP_USER, pass: c.SMTP_PASSWORD ?? '' } } : {}),
      connectionTimeout: 5_000,
      socketTimeout: 10_000,
    })
    const smtp = transport
    // G6-05: breaker and an overall time limit; no retry here (a resend could duplicate the email),
    // the outbox job retries a failed notification later.
    const info = await guard('smtp').run(() => smtp.sendMail({ from: c.MAIL_FROM, ...mail }), {
      idempotent: false,
    })
    return { messageId: info.messageId }
  },
}

let override: Mailer | undefined
export const getMailer = (): Mailer => override ?? smtpMailer
export function setMailerForTests(mailer: Mailer | undefined): void {
  override = mailer
}
