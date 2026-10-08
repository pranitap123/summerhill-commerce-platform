import type { z } from 'zod'

import type { Permission } from '@/modules/identity'

import * as s from './schemas'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
export interface G5Operation {
  path: string
  method: Method
  summary: string
  auth: 'public' | 'optional-session' | 'customer' | 'staff' | 'admin'
  permission?: Permission
  params?: z.ZodObject
  query?: z.ZodObject
  body?: z.ZodType
  idempotent?: boolean
  responses: Record<string, string>
}

const ADMIN_ERRORS = {
  '401': 'UNAUTHENTICATED',
  '403': 'FORBIDDEN (role lacks the permission) or MFA_REQUIRED',
}
const a = (
  method: Method,
  path: string,
  permission: Permission | undefined,
  summary: string,
  extra: Partial<G5Operation> = {},
): G5Operation => ({
  path: `/api/admin${path}`,
  method,
  summary,
  auth: 'admin',
  permission,
  ...extra,
  responses: { '200': 'OK', ...ADMIN_ERRORS, ...(extra.responses ?? {}) },
})

export const G5_OPERATIONS: G5Operation[] = [

  {
    path: '/api/v1/status',
    method: 'get',
    summary: 'Whether checkout is open (kill switch, read without a cache; G5-10)',
    auth: 'public',
    responses: { '200': '{ checkoutEnabled }' },
  },
  {
    path: '/api/v1/orders/{publicId}/issues',
    method: 'post',
    summary:
      'Report a problem within 48 h of pickup (owner session or guest link). Small claims are refunded at once (G5-11)',
    auth: 'optional-session',
    body: s.reportIssueBody,
    responses: {
      '201': '{ issueId, status, claimedCents, refunded }',
      '404': 'NOT_FOUND',
      '409': 'ISSUE_WINDOW_CLOSED | ISSUE_ALREADY_OPEN',
      '429': 'RATE_LIMITED',
    },
  },
  {
    path: '/api/v1/me/mfa',
    method: 'get',
    summary: 'Two-step verification status for this account and session (G5-12)',
    auth: 'customer',
    responses: { '200': '{ enrolled, confirmed, verified }' },
  },
  {
    path: '/api/v1/me/mfa',
    method: 'post',
    summary: 'Start TOTP enrolment (staff only). The secret is returned once',
    auth: 'customer',
    responses: {
      '200': '{ secret, otpauthUri }',
      '409': 'MFA_ALREADY_ENROLLED | MFA_NOT_APPLICABLE',
    },
  },
  {
    path: '/api/v1/me/mfa/verify',
    method: 'post',
    summary: 'Check a 6-digit code; sets the HttpOnly `mfa` cookie bound to this session',
    auth: 'customer',
    body: s.mfaVerifyBody,
    responses: { '200': '{ verified: true }', '400': 'MFA_CODE_INVALID', '429': 'RATE_LIMITED' },
  },
  {
    path: '/api/v1/me/data',
    method: 'get',
    summary: 'Download your personal data as JSON (G5-17)',
    auth: 'customer',
    responses: { '200': 'Export (attachment)' },
  },
  {
    path: '/api/v1/me/delete-account',
    method: 'post',
    summary: 'Close your account; orders are kept 7 years with your contact details removed',
    auth: 'customer',
    body: s.deleteAccountBody,
    responses: { '200': '{ deleted, ordersAnonymised, accountClosed }', '409': 'STAFF_ACCOUNT' },
  },
  {
    path: '/api/console/merchants/{id}/finance',
    method: 'get',
    summary: "Owner: the month's sales, fees, refunds, payouts and statement months (G5-13)",
    auth: 'staff',
    params: s.consoleMerchantParams,
    query: s.consoleFinanceQuery,
    responses: {
      '200': '{ merchant, months, statement, payouts }',
      '403': 'FORBIDDEN (owners only)',
      '404': 'NOT_FOUND',
    },
  },
  {
    path: '/api/console/merchants/{id}/statements/{month}',
    method: 'get',
    summary: 'Owner: the monthly statement as CSV',
    auth: 'staff',
    params: s.consoleStatementParams,
    responses: { '200': 'text/csv', '403': 'FORBIDDEN', '404': 'NOT_FOUND' },
  },

  a('get', '/me', 'ops.enter', 'Who is signed in to /ops, their permissions and MFA state'),
  a('get', '/orders', 'orders.read', 'Order search by id, email or pickup name (G5-03)', {
    query: s.orderSearchQuery,
  }),
  a(
    'get',
    '/orders/{id}',
    'orders.read',
    'One order with payment, refunds, disputes, issues, ledger and a merged timeline',
    { params: s.idParam },
  ),
  a(
    'post',
    '/orders/{id}/cancel',
    'orders.cancel',
    'Cancel on behalf: void before capture, full refund after (A7)',
    { params: s.idParam, body: s.cancelBody },
  ),
  a('get', '/orders/{id}/refunds', 'refunds.create', 'What can still be refunded, per line', {
    params: s.idParam,
  }),
  a(
    'post',
    '/orders/{id}/refunds',
    'refunds.create',
    'Refund lines, part of a line, an amount or everything; liability per the matrix; support capped at $50 per order (G5-04)',
    {
      params: s.idParam,
      body: s.refundBody,
      idempotent: true,
      responses: {
        '201': 'Refund',
        '403': 'REFUND_LIMIT',
        '409': 'NOT_CAPTURED | REFUND_IN_PROGRESS',
        '422': 'NOT_REFUNDABLE | LIABILITY_FIXED | LINE_ALREADY_REFUNDED | REFUND_EXCEEDS_CAPTURED',
        '502': 'PAYMENT_PROVIDER_ERROR',
      },
    },
  ),
  a('get', '/refunds', 'finance.read', 'Refunds by agent over N days (threat T16)', {
    query: s.refundReportQuery,
  }),
  a('get', '/disputes', 'disputes.manage', 'Disputes, soonest evidence deadline first (G5-06)', {
    query: s.disputeListQuery,
  }),
  a('get', '/disputes/{id}', 'disputes.manage', 'One dispute with its evidence pack', {
    params: s.idParam,
  }),
  a('post', '/disputes/{id}/evidence', 'disputes.manage', 'Rebuild the evidence pack', {
    params: s.idParam,
  }),
  a('post', '/disputes/{id}/submit', 'disputes.manage', 'Submit the evidence to Stripe', {
    params: s.idParam,
  }),
  a(
    'post',
    '/disputes/{id}/liability',
    'disputes.manage',
    'Record who bears it; recover a merchant-liable amount by transfer reversal',
    { params: s.idParam, body: s.disputeLiabilityBody, idempotent: true },
  ),
  a('get', '/payouts', 'payouts.manage', 'Manual and automatic payouts (G5-07)', {
    query: s.payoutListQuery,
  }),
  a(
    'post',
    '/payouts/{id}/decision',
    'payouts.approve',
    'Second-person approval of a payout above $5,000 (never your own)',
    {
      params: s.idParam,
      body: s.payoutDecisionBody,
      idempotent: true,
      responses: { '403': 'SELF_APPROVAL' },
    },
  ),
  a('get', '/merchants', 'merchants.read', 'Merchants with lifecycle and Stripe status'),
  a(
    'post',
    '/merchants',
    'merchants.manage',
    'Create a draft merchant with its first store (G5-02)',
    { body: s.createMerchantBody, responses: { '201': '{ merchant }', '409': 'SLUG_TAKEN' } },
  ),
  a('get', '/merchants/{id}', 'merchants.read', 'Merchant, health (A2) and recent payouts', {
    params: s.idParam,
  }),
  a(
    'post',
    '/merchants/{id}/lifecycle',
    'merchants.manage',
    'go_live (gated), pause, resume, offboard, finish_offboarding',
    {
      params: s.idParam,
      body: s.lifecycleBody,
      responses: { '409': 'LIFECYCLE_CONFLICT | OPEN_ORDERS', '422': 'GO_LIVE_BLOCKED' },
    },
  ),
  a(
    'post',
    '/merchants/{id}/onboarding-link',
    'merchants.manage',
    'Create the connected account (Custom by default, Express optional) and return the onboarding URL',
    { params: s.idParam },
  ),
  a(
    'post',
    '/merchants/{id}/refresh-status',
    'merchants.manage',
    'Read the connected account now',
    { params: s.idParam },
  ),
  a('get', '/merchants/{id}/balance', 'payouts.manage', 'Available and pending balance', {
    params: s.idParam,
  }),
  a(
    'post',
    '/merchants/{id}/payout',
    'payouts.manage',
    'Manual payout; above $5,000 it waits for approval',
    {
      params: s.idParam,
      body: s.payoutBody,
      idempotent: true,
      responses: { '201': 'Payout', '409': 'PAYOUTS_BLOCKED', '422': 'INSUFFICIENT_BALANCE' },
    },
  ),
  a(
    'post',
    '/merchants/{id}/payout-schedule',
    'payouts.manage',
    "Stripe's automatic payout interval",
    { params: s.idParam, body: s.payoutScheduleBody },
  ),
  a(
    'get',
    '/merchants/{id}/statements/{month}',
    'finance.read',
    'Monthly statement from the ledger (JSON or CSV) (G5-08)',
    { params: s.monthParam, query: s.statementQuery },
  ),
  a('get', '/reconciliation', 'recon.run', 'Recent reconciliation runs (G5-05)'),
  a('post', '/reconciliation', 'recon.run', 'Reconcile one business day now', {
    body: s.reconRunBody,
    responses: { '201': 'ReconRun' },
  }),
  a('get', '/reconciliation/{id}', 'recon.run', 'A run and its mismatches', { params: s.idParam }),
  a(
    'get',
    '/reconciliation/close/{month}',
    'finance.read',
    'Monthly close export: every ledger entry as CSV',
    { params: s.closeMonthParam },
  ),
  a('get', '/issues', 'issues.resolve', 'Support queue (G5-11)', { query: s.issueListQuery }),
  a(
    'get',
    '/issues/{id}',
    'issues.resolve',
    "Issue, the customer's 90-day refunds and earlier issues",
    { params: s.idParam },
  ),
  a('post', '/issues/{id}/resolve', 'issues.resolve', 'Approve (refund) or reject with a note', {
    params: s.idParam,
    body: s.resolveIssueBody,
    idempotent: true,
  }),
  a('get', '/catalog/ingest-runs', 'catalog.manage', 'Ingest runs and pipeline requests (G5-14)'),
  a('post', '/catalog/ingest-runs', 'catalog.manage', 'Ask the pipeline for a run', {
    body: s.ingestRunBody,
    responses: { '202': '{ requestId, status }' },
  }),
  a('get', '/catalog/ingest-runs/{id}', 'catalog.manage', 'A run with quarantined rows and flags', {
    params: s.idParam,
  }),
  a(
    'post',
    '/catalog/ingest-runs/{id}/decision',
    'catalog.manage',
    'Approve (pipeline applies it) or reject a held run',
    {
      params: s.idParam,
      body: s.ingestDecisionBody,
      responses: { '409': 'RUN_NOT_HELD | ALREADY_REQUESTED' },
    },
  ),
  a('get', '/catalog/mappings', 'catalog.manage', 'Source categories and our subcategories', {
    query: s.mappingQuery,
  }),
  a(
    'put',
    '/catalog/mappings/{id}',
    'catalog.manage',
    'Map a source category; a full re-run is requested',
    { params: s.idParam, body: s.mappingBody },
  ),
  a('get', '/products', 'catalog.manage', 'Products by id, name or UPC with their overrides', {
    query: s.productSearchQuery,
  }),
  a('get', '/users', 'users.manage', 'Platform and store staff with MFA and memberships (G5-15)'),
  a('post', '/users', 'users.manage', 'Invite (password-setup email)', {
    body: s.inviteBody,
    responses: { '201': '{ user }' },
  }),
  a(
    'put',
    '/users/{id}/roles',
    'users.manage',
    'Change platform roles (not your own; the last admin stays)',
    { params: s.userParam, body: s.rolesBody, responses: { '409': 'SELF_CHANGE | LAST_ADMIN' } },
  ),
  a(
    'post',
    '/users/{id}/deactivate',
    'users.manage',
    'Deactivate: sessions end, store access removed',
    { params: s.userParam },
  ),
  a('post', '/users/{id}/reactivate', 'users.manage', 'Reactivate', { params: s.userParam }),
  a('post', '/users/{id}/reset-mfa', 'users.manage', 'Reset two-step verification (lost device)', {
    params: s.userParam,
  }),
  a(
    'put',
    '/users/{id}/memberships/{merchantId}',
    'users.manage',
    'Give store access with a role',
    { params: s.membershipParam, body: s.membershipBody },
  ),
  a('delete', '/users/{id}/memberships/{merchantId}', 'users.manage', 'Remove store access', {
    params: s.membershipParam,
  }),
  a('get', '/flags', 'flags.manage', 'Feature flags and kill switches (G5-10)'),
  a('put', '/flags/{key}', 'flags.manage', 'Flip a flag (audited)', {
    params: s.flagParam,
    body: s.flagBody,
  }),
  a('get', '/audit', 'audit.read', 'Audit log: filter by actor, action and target (G5-09)', {
    query: s.auditQuery,
  }),
  a('get', '/metrics', 'metrics.read', 'Metrics with written definitions (G5-18)', {
    query: s.metricsQuery,
  }),
  a('get', '/alerts', 'ops.enter', 'Operational alerts', { query: s.alertQuery }),
  a('post', '/alerts/{id}/resolve', 'ops.enter', 'Mark an alert handled', { params: s.idParam }),
  a('get', '/privacy', 'privacy.manage', 'Handled data subject requests (G5-17)'),
  a('post', '/privacy/export', 'privacy.manage', "Export someone's personal data", {
    body: s.privacySubjectBody,
  }),
  a(
    'post',
    '/privacy/delete',
    'privacy.manage',
    "Anonymise an account and its orders' contact data",
    { body: s.privacyDeleteBody, responses: { '409': 'STAFF_ACCOUNT' } },
  ),

  a(
    'post',
    '/merchants/{id}/create-account',
    undefined,
    'Test tool: a Custom connected account with Stripe test values',
    { params: s.idParam },
  ),
  a(
    'post',
    '/merchants/{id}/onboard',
    undefined,
    'Test tool: complete Custom-account verification with test values',
    { params: s.idParam },
  ),
  a(
    'post',
    '/merchants/{id}/simulate-verification',
    undefined,
    'Test tool (404 in production): push a test account to verified/failed/restricted',
    { params: s.idParam },
  ),
  a(
    'put',
    '/products/{id}/override',
    'catalog.manage',
    'Hide, hide until, rename, recategorise or block a product (G3-11)',
  ),
  a('delete', '/products/{id}/override', 'catalog.manage', 'Remove the override'),
  a('post', '/search/rebuild', undefined, 'Rebuild the search index with an alias swap'),
  a('get', '/search/report', undefined, 'Search analytics report (zero results, click positions)'),
  a(
    'post',
    '/demo/orders/{id}/fast-forward',
    undefined,
    'Demo tool (404 in production): walk an order to picked',
    { params: s.idParam },
  ),
  a(
    'post',
    '/demo/separate-charge-transfer',
    undefined,
    'Demo tool (404 in production): separate charge and transfer',
  ),
]
