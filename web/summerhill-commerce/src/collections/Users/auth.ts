import {
  APIError,
  type CollectionBeforeLoginHook,
  type CollectionBeforeOperationHook,
} from 'payload'

import { consume, LIMITS, type RateLimit } from '@/modules/ops'
import { getConfig } from '@/server/config'
import { clientIpFrom } from '@/server/securityHeaders'

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

function email(title: string, body: string, link: string, label: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
<h1 style="font-size:20px">${escape(title)}</h1><p>${escape(body)}</p>
<p><a href="${escape(link)}">${escape(label)}</a></p>
<p style="color:#6b7280;font-size:12px">If you didn't ask for this, you can ignore this email.</p>
</body></html>`
}

export const verifyEmailHTML = ({ token }: { token?: string }) =>
  email(
    'Confirm your email',
    'Welcome to the Grocery Marketplace Demo. Confirm your email address to finish creating your account.',
    `${getConfig().NEXT_PUBLIC_SERVER_URL}/verify-email?token=${encodeURIComponent(token ?? '')}`,
    'Confirm my email',
  )

export const resetPasswordHTML = (args?: { token?: string }) =>
  email(
    'Reset your password',
    'Use the link below within one hour to choose a new password.',
    `${getConfig().NEXT_PUBLIC_SERVER_URL}/reset-password?token=${encodeURIComponent(args?.token ?? '')}`,
    'Choose a new password',
  )

const LIMITED: Partial<Record<string, RateLimit>> = {
  login: LIMITS.login,
  forgotPassword: LIMITS.passwordReset,
  resetPassword: LIMITS.passwordReset,
  create: LIMITS.signup,
}

export const rateLimitAuth: CollectionBeforeOperationHook = async ({ operation, req, args }) => {
  const rule = LIMITED[operation]

  if (!rule || req.payloadAPI === 'local' || (operation === 'create' && req.user)) return args
  const ip =
    clientIpFrom(
      req.headers.get('x-forwarded-for'),
      req.headers.get('x-real-ip'),
      getConfig().TRUSTED_PROXY_HOPS,
    ) ?? 'unknown'
  try {
    await consume(rule, `ip:${ip}`)
  } catch {
    throw new APIError('Too many attempts. Please try again later.', 429)
  }
  return args
}

export function parseMailFrom(from: string): { name: string; address: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  return m ? { name: m[1] || m[2], address: m[2] } : { name: from, address: from }
}

export const blockDeactivatedLogin: CollectionBeforeLoginHook = ({ user }) => {
  if ((user as { deactivatedAt?: string | null }).deactivatedAt)
    throw new APIError('The email or password provided is incorrect.', 401)
  return user
}
