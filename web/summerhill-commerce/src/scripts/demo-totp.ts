import { totp } from '@/modules/identity'

const secret = process.env.DEMO_TOTP_SECRET
if (!secret) {
  console.error('demo-totp: DEMO_TOTP_SECRET is not set (see stack.env)')
  process.exit(2)
}
const seconds = 30 - (Math.floor(Date.now() / 1000) % 30)
console.log(`${totp(secret)}  (valid for ${seconds} more seconds)`)
