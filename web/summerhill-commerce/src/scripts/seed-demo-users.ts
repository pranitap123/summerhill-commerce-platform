/**
 * Creates the demo accounts (G1-13): an admin and a customer, store staff (G4-05), and the
 * back-office roles support and finance (G5). Local demo only.
 *   npm run seed:users      (uses DEMO_* from stack.env)
 * Staff accounts get two-step verification set up with DEMO_TOTP_SECRET (G5-12), so the demo and
 * the end-to-end tests can compute the codes (`npm run demo:totp`). Never use that secret for a
 * real account. Idempotent: existing accounts keep their data (roles are topped up).
 */
import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { enrolWithSecret, type Role } from '@/modules/identity'
import { upsertStaffMembership, type StaffRole } from '@/modules/merchant'
import { closeDb, getDb } from '@/server/db'

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('seed-demo-users must not run in production')
  const password = process.env.DEMO_USER_PASSWORD
  const accounts = [
    { email: process.env.DEMO_ADMIN_EMAIL, name: 'Demo Admin', roles: ['admin'] as const },
    { email: process.env.DEMO_CUSTOMER_EMAIL, name: 'Demo Customer', roles: ['customer'] as const },
    ...(process.env.DEMO_SUPPORT_EMAIL
      ? [
          {
            email: process.env.DEMO_SUPPORT_EMAIL,
            name: 'Demo Support',
            roles: ['support'] as const,
          },
        ]
      : []),
    ...(process.env.DEMO_FINANCE_EMAIL
      ? [
          {
            email: process.env.DEMO_FINANCE_EMAIL,
            name: 'Demo Finance',
            roles: ['finance'] as const,
          },
        ]
      : []),
    ...(process.env.DEMO_OWNER_EMAIL
      ? [
          {
            email: process.env.DEMO_OWNER_EMAIL,
            name: 'Demo Store Owner',
            roles: ['customer'] as const,
            staff: 'owner' as StaffRole,
          },
        ]
      : []),
    ...(process.env.DEMO_PICKER_EMAIL
      ? [
          {
            email: process.env.DEMO_PICKER_EMAIL,
            name: 'Demo Picker',
            roles: ['customer'] as const,
            staff: 'picker' as StaffRole,
          },
        ]
      : []),
  ]
  if (!password || accounts.some((a) => !a.email)) {
    throw new Error(
      'Set DEMO_ADMIN_EMAIL, DEMO_CUSTOMER_EMAIL and DEMO_USER_PASSWORD (see stack.env)',
    )
  }

  const payload = await getPayload({ config: configPromise })
  const staff: Array<{ userId: string; role: StaffRole }> = []
  const needsMfa: string[] = []
  for (const account of accounts) {
    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: account.email } },
      limit: 1,
    })
    if (existing.docs.length) {
      // Demo accounts are pre-verified (email verification arrived with G2-20).
      const doc = existing.docs[0]
      const roles = [...new Set([...((doc.roles ?? []) as Role[]), ...account.roles])]
      if (!doc._verified || roles.length !== (doc.roles ?? []).length)
        await payload.update({
          collection: 'users',
          id: doc.id,
          data: { _verified: true, roles: roles as never },
          overrideAccess: true,
        })
      console.log(`seed-demo-users: ${account.email} already exists`)
      if ('staff' in account && account.staff)
        staff.push({ userId: String(doc.id), role: account.staff })
      if (account.roles.some((r) => r !== 'customer') || ('staff' in account && account.staff))
        needsMfa.push(String(doc.id))
      continue
    }
    const created = await payload.create({
      collection: 'users',
      data: {
        email: account.email!,
        name: account.name,
        password,
        roles: [...account.roles] as never,
        _verified: true,
      },
      disableVerificationEmail: true,
      overrideAccess: true,
    })
    console.log(`seed-demo-users: created ${account.email} (${account.roles.join(', ')})`)
    if ('staff' in account && account.staff)
      staff.push({ userId: String(created.id), role: account.staff })
    if (account.roles.some((r) => r !== 'customer') || ('staff' in account && account.staff))
      needsMfa.push(String(created.id))
  }

  // Staff MFA (G5-12) with the demo secret, so nobody has to scan anything to try the demo.
  const totpSecret = process.env.DEMO_TOTP_SECRET
  if (totpSecret) {
    for (const userId of needsMfa) await enrolWithSecret(getDb(), userId, totpSecret)
    console.log(
      `seed-demo-users: two-step verification set up for ${needsMfa.length} staff account(s)`,
    )
  }

  // Store staff belong to the demo merchant (the seeded one), at every location.
  if (staff.length) {
    const { rows } = await getDb().query<{ id: string }>(
      `SELECT id FROM merchant.merchants WHERE slug = 'demo-market'`,
    )
    if (!rows[0]) throw new Error('demo merchant missing: run `npm run db:setup` first')
    for (const s of staff)
      await upsertStaffMembership(getDb(), {
        userId: s.userId,
        merchantId: Number(rows[0].id),
        locationId: null,
        role: s.role,
      })
    console.log(`seed-demo-users: ${staff.length} staff membership(s) for Demo Market`)
  }
  await closeDb()
}

// Top-level await: `payload run` only awaits this module's import and then calls process.exit(0),
// so un-awaited async work would be cut off before it finishes.
try {
  await main()
} catch (err) {
  console.error(`seed-demo-users: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
