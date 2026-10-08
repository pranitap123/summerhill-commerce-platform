import { afterEach, describe, expect, it } from 'vitest'

import { reencryptMfaSecrets } from '@/modules/identity'
import type { Db } from '@/server/db'
import { resetConfigForTests } from '@/server/config'
import { decrypt, encrypt, resetSigningKeysForTests } from '@/server/signing'

const OLD = 'test-secret-not-used-anywhere-real'
const NEW = 'rotated-test-secret-not-used-anywhere'

function useSecret(secret: string) {
  process.env.PAYLOAD_SECRET = secret
  resetConfigForTests()
  resetSigningKeysForTests()
}

function fakeDb(rows: Array<{ user_id: string; secret_encrypted: string }>): Db {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT'))
        return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length }
      const row = rows.find((r) => r.user_id === params![0])!
      row.secret_encrypted = String(params![1])
      return { rows: [], rowCount: 1 }
    },
  } as unknown as Db
}

afterEach(() => useSecret(OLD))

describe('MFA secrets after a PAYLOAD_SECRET rotation (RB-13)', () => {
  it('re-seals old secrets, leaves current ones, reports unreadable ones; a second run is a no-op', async () => {
    useSecret(OLD)
    const sealedOld = encrypt('mfa-secret', 'JBSWY3DPEHPK3PXP')
    useSecret('some-other-secret-entirely-unknown')
    const sealedUnknown = encrypt('mfa-secret', 'KRSXG5CTMVRXEZLU')
    useSecret(NEW)
    const sealedNew = encrypt('mfa-secret', 'MFRGGZDFMZTWQ2LK')
    const rows = [
      { user_id: 'a', secret_encrypted: sealedOld },
      { user_id: 'b', secret_encrypted: sealedNew },
      { user_id: 'c', secret_encrypted: sealedUnknown },
    ]
    const db = fakeDb(rows)

    expect(() => decrypt('mfa-secret', sealedOld)).toThrow()
    await expect(reencryptMfaSecrets(OLD, db)).resolves.toEqual({
      reencrypted: 1,
      current: 1,
      unreadable: ['c'],
    })
    expect(decrypt('mfa-secret', rows[0].secret_encrypted)).toBe('JBSWY3DPEHPK3PXP')
    expect(rows[1].secret_encrypted).toBe(sealedNew)

    await expect(reencryptMfaSecrets(OLD, db)).resolves.toEqual({
      reencrypted: 0,
      current: 2,
      unreadable: ['c'],
    })
  })
})
