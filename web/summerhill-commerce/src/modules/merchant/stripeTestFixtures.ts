import { getConfig } from '@/server/config'

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

export const DEMO_BUSINESS_URL = 'https://accessible.stripe.com'

export function testCompany(merchantName: string) {
  assertTestMode()
  return { name: `${merchantName} Inc.`, tax_id: '000000000' }
}

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
