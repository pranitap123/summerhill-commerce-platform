import { getConfig } from '@/server/config'

/**
 * Stripe TEST-MODE onboarding values (GAP-08, G1-10). Stripe documents these magic values
 * (e.g. `address_full_match`, tax id 000000000, `file_identity_document_success`) to make Custom
 * connected accounts verify instantly in test mode. They must never reach a live account, so every
 * accessor refuses to run outside test mode or in production.
 */
function assertTestMode(): void {
  const config = getConfig()
  if (config.stripeMode !== 'test' || config.isProduction) {
    throw new Error('Stripe test fixtures are only available in test mode outside production')
  }
}

const TEST_ADDRESS = {
  line1: 'address_full_match',
  city: 'Toronto',
  state: 'ON',
  postal_code: 'M5V 2T6',
  country: 'CA',
} as const

/**
 * Public website Stripe records for a demo merchant. Stripe rejects reserved domains such as
 * example.com ("Not a valid URL"); accessible.stripe.com is Stripe's documented test-mode website
 * that passes URL verification.
 */
export const DEMO_BUSINESS_URL = 'https://accessible.stripe.com'

export function testCompany(merchantName: string) {
  assertTestMode()
  return { name: `${merchantName} Inc.`, tax_id: '000000000' }
}

/**
 * Terms-of-service acceptance for an admin-assisted TEST account. Records the real request's IP
 * and user agent (never a hard-coded address). A live integration must capture this from the
 * merchant's own session instead (ADR-0011).
 */
export function testTosAcceptance(requestIp: string, userAgent: string | null) {
  assertTestMode()
  return {
    date: Math.floor(Date.now() / 1000),
    ip: requestIp,
    ...(userAgent ? { user_agent: userAgent } : {}),
    service_agreement: 'full' as const,
  }
}

export function testRepresentative() {
  assertTestMode()
  return {
    first_name: 'Jordan',
    last_name: 'Reyes',
    email: 'jordan.reyes@example.com',
    relationship: {
      representative: true,
      owner: true,
      director: true,
      title: 'Owner',
      percent_ownership: 100,
    },
    dob: { day: 1, month: 1, year: 1985 },
    address: TEST_ADDRESS,
    phone: '+14165551234',
  }
}

export function testCompanyVerification() {
  assertTestMode()
  return {
    business_profile: {
      mcc: '5411',
      product_description: 'Online grocery and specialty foods retailer',
      support_phone: '+14165551234',
    },
    company: {
      address: TEST_ADDRESS,
      phone: '+14165551234',
      tax_id: '000000000',
      directors_provided: true,
      verification: { document: { front: 'file_identity_document_success' } },
    },
  }
}

export function testBankAccount() {
  assertTestMode()
  return {
    object: 'bank_account' as const,
    country: 'CA',
    currency: 'cad',
    routing_number: '11000-000',
    account_number: '000123456789',
  }
}

/** Test-mode values that make Stripe fail or restrict verification (simulate-verification). */
export function testVerificationOutcome(
  outcome: 'success' | 'failure' | 'restricted',
  merchantUrl: string,
) {
  assertTestMode()
  if (outcome === 'failure') return { company: { tax_id: '111111111' } }
  if (outcome === 'restricted')
    return { business_profile: { url: 'https://inactivity.stripe.com' } }
  return { company: { tax_id: '000000000' }, business_profile: { url: merchantUrl } }
}
