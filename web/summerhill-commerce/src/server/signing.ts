import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { getConfig } from './config'

/**
 * Signed, tamper-proof values (anonymous cart cookie, guest order links). Each use gets its own
 * key derived from PAYLOAD_SECRET with HKDF and a purpose label, so a value signed for one purpose
 * is useless for another, and there's no extra secret to configure.
 */
export type SigningPurpose =
  | 'cart-cookie'
  | 'order-link'
  | 'revalidate'
  // G5-12: the "second factor verified" cookie, and TOTP secrets encrypted at rest
  | 'mfa-session'
  | 'mfa-secret'

const deriveKey = (secret: string, purpose: SigningPurpose) =>
  Buffer.from(hkdfSync('sha256', secret, '', `grocery:${purpose}`, 32))

const keys = new Map<SigningPurpose, Buffer>()
function key(purpose: SigningPurpose): Buffer {
  let k = keys.get(purpose)
  if (!k) {
    k = deriveKey(getConfig().PAYLOAD_SECRET, purpose)
    keys.set(purpose, k)
  }
  return k
}

function mac(purpose: SigningPurpose, value: string): string {
  return createHmac('sha256', key(purpose)).update(value).digest('base64url')
}

/** `value.signature`. The value must not contain a dot. */
export function sign(purpose: SigningPurpose, value: string): string {
  if (value.includes('.')) throw new Error('signed values must not contain "."')
  return `${value}.${mac(purpose, value)}`
}

/** Returns the value if the signature is valid, else null. Constant-time comparison. */
export function unsign(purpose: SigningPurpose, signed: string | null | undefined): string | null {
  if (!signed) return null
  const dot = signed.lastIndexOf('.')
  if (dot <= 0) return null
  const value = signed.slice(0, dot)
  const given = Buffer.from(signed.slice(dot + 1))
  const expected = Buffer.from(mac(purpose, value))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return value
}

/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP secrets). The output is
 * `iv.tag.ciphertext` in base64url; tampering makes `decrypt` throw.
 */
export function encrypt(purpose: SigningPurpose, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(purpose: SigningPurpose, sealed: string): string {
  return open(key(purpose), sealed)
}

/**
 * Runbook RB-13: reads a value sealed under a previous PAYLOAD_SECRET, so it can be encrypted again
 * under the current one after the secret is rotated.
 */
export function decryptWithSecret(secret: string, purpose: SigningPurpose, sealed: string): string {
  return open(deriveKey(secret, purpose), sealed)
}

function open(k: Buffer, sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
  if (!iv || !tag || !body) throw new Error('malformed encrypted value')
  const decipher = createDecipheriv('aes-256-gcm', k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/** Test helper: forget derived keys after changing PAYLOAD_SECRET. */
export function resetSigningKeysForTests(): void {
  keys.clear()
}
