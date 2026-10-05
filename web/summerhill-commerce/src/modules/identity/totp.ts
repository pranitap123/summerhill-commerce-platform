import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226): HMAC-SHA1, 30-second steps, 6 digits,
 * the format every authenticator app understands. Pure functions; the clock is a parameter.
 */
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** Codes from one step before or after are accepted (clock drift). */
export const TOTP_WINDOW = 1

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('invalid base32 character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new random secret: 20 bytes (160 bits, RFC 4226's recommendation), base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS)
}

/** HOTP value for one counter (RFC 4226 §5.3 dynamic truncation). */
export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

export function totp(secret: string, now: Date = new Date()): string {
  return hotp(secret, totpStep(now))
}

/**
 * Checks a code. Returns the matching step, or null. A step at or before `lastUsedStep` is
 * refused, so a code can't be replayed (RFC 6238 §5.2).
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: Date = new Date(),
  lastUsedStep: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = totpStep(now)
  const given = Buffer.from(code)
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = current + delta
    if (lastUsedStep !== null && step <= lastUsedStep) continue
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), given)) return step
  }
  return null
}

/** The URI authenticator apps import (Key Uri Format). */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
