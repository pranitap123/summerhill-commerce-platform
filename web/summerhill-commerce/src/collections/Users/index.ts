import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { publicAccess } from '@/access/publicAccess'
import { adminOrSelf } from '@/access/adminOrSelf'
import { checkRole } from '@/access/utilities'
import { isMfaCookieValid, MFA_COOKIE, readCookie } from '@/modules/identity'

import { blockDeactivatedLogin, rateLimitAuth, resetPasswordHTML, verifyEmailHTML } from './auth'
import { ensureFirstUserIsAdmin } from './hooks/ensureFirstUserIsAdmin'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    // G6-01: Payload's CMS panel needs the second factor too (G5-12), like /ops and the console.
    admin: ({ req: { user, headers } }) =>
      checkRole(['admin'], user) &&
      isMfaCookieValid(
        readCookie(headers, MFA_COOKIE),
        String(user!.id),
        (user as { _sid?: string })._sid,
      ),
    create: publicAccess,
    delete: adminOnly,
    read: adminOrSelf,
    unlock: adminOnly,
    update: adminOrSelf,
  },
  admin: {
    group: 'Users',
    defaultColumns: ['name', 'email', 'roles'],
    useAsTitle: 'name',
  },
  auth: {
    tokenExpiration: 1209600,
    // G6-01 cookie review: HttpOnly (Payload's default), SameSite=Lax, Secure in production
    cookies: { sameSite: 'Lax', secure: process.env.NODE_ENV === 'production' },
    // G2-20: per-account lockout (the per-IP limit is the beforeOperation hook below)
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    verify: {
      generateEmailSubject: () => 'Confirm your email',
      generateEmailHTML: verifyEmailHTML,
    },
    forgotPassword: {
      expiration: 60 * 60 * 1000,
      generateEmailSubject: () => 'Reset your password',
      generateEmailHTML: resetPasswordHTML,
    },
  },
  hooks: {
    beforeOperation: [rateLimitAuth],
    // G5-15: a deactivated account can't sign in (its sessions are ended when it's deactivated)
    beforeLogin: [blockDeactivatedLogin],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      // G2-20: applied to new cart lines ("if an item is unavailable…"); editable per line.
      name: 'defaultReplacementPreference',
      type: 'select',
      defaultValue: 'best_match',
      options: [
        { label: 'Replace with the best match', value: 'best_match' },
        { label: "Don't replace (refund)", value: 'refund' },
      ],
    },
    {
      name: 'roles',
      type: 'select',
      access: {
        create: adminOnlyFieldAccess,
        read: adminOnlyFieldAccess,
        update: adminOnlyFieldAccess,
      },
      defaultValue: ['customer'],
      hasMany: true,
      hooks: {
        beforeChange: [ensureFirstUserIsAdmin],
      },
      options: [
        {
          label: 'admin',
          value: 'admin',
        },
        // Back-office roles (G5, SECURITY §4.1): managed in /ops/users
        { label: 'support', value: 'support' },
        { label: 'finance', value: 'finance' },
        {
          label: 'customer',
          value: 'customer',
        },
      ],
    },
    {
      // G5-15: set by /ops/users; a deactivated user has no sessions and can't sign in
      name: 'deactivatedAt',
      type: 'date',
      access: {
        create: adminOnlyFieldAccess,
        read: adminOnlyFieldAccess,
        update: adminOnlyFieldAccess,
      },
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
