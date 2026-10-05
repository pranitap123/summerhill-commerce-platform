import { stringify } from 'yaml'
import { z } from 'zod'

import { PERMISSIONS, type Permission } from '@/modules/identity'

import { G5_OPERATIONS } from '../../admin/_lib/openapi'

import {
  availabilityBody,
  categoryAvailabilityParams,
  closureBody,
  closureParams,
  completeBody,
  handoverBody,
  lineParams as consoleLineParams,
  locationParams,
  orderParams as consoleOrderParams,
  pickBody,
  productAvailabilityParams,
  rejectBody,
  scanBody,
  settingsBody,
  startBody,
  substituteBody,
} from '../../console/_lib/schemas'

import {
  addItemBody,
  arrivedBody,
  browseQuery,
  checkoutBody,
  lineIdParams,
  lookupBody,
  orderLineParams,
  orderQuery,
  productParams,
  publicIdParams,
  ratingBody,
  reorderBody,
  searchClickBody,
  searchQuery,
  substitutionDecisionBody,
  updateItemBody,
} from './schemas'

/**
 * OpenAPI 3.1 for the storefront API (G2-18), generated from the same zod schemas the routes use
 * to validate requests. `npm run openapi` writes docs/openapi.yaml; the contract test fails if the
 * file is stale or an /api/v1 or /api/console route is missing here.
 */
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
interface Operation {
  path: string
  method: Method
  summary: string
  /** staff: merchant console (G4), an active staff membership scoped to the store, or an admin;
   *  admin: back office (G5), a platform role holding `permission`; both need a verified MFA */
  auth: 'public' | 'optional-session' | 'customer' | 'staff' | 'admin'
  permission?: Permission
  params?: z.ZodObject
  query?: z.ZodObject
  body?: z.ZodType
  idempotent?: boolean
  responses: Record<string, string>
}

const CART = { '200': 'Cart and fresh quote (CartView)' }
const ORDER_404 = 'NOT_FOUND (also when not allowed to see it)'
const STAFF = {
  '401': 'UNAUTHENTICATED',
  '403': 'FORBIDDEN (not store staff, or role too low)',
  '404': 'NOT_FOUND (also outside your store)',
}
const CONSOLE_ORDER = 'Console order view (lines, projected total, timeline)'
const PAGE = '{ engine, total, page, limit, items: ProductSummary[], facets, searchId, tookMs }'
export const OPERATIONS: Operation[] = [
  {
    path: '/api/v1/categories',
    method: 'get',
    summary: 'Category tree with visible-product counts (empty branches left out)',
    auth: 'public',
    responses: { '200': '{ categories: CategoryNode[] }' },
  },
  {
    path: '/api/v1/merchants',
    method: 'get',
    summary: 'Stores on the storefront with their pickup locations',
    auth: 'public',
    responses: { '200': '{ merchants: MerchantStorefront[] }' },
  },
  {
    path: '/api/v1/products',
    method: 'get',
    summary: 'Browse with filters and drill-down facets (Postgres, the source of truth)',
    auth: 'public',
    query: browseQuery,
    responses: { '200': PAGE, '400': 'VALIDATION_FAILED' },
  },
  {
    path: '/api/v1/products/{slug}',
    method: 'get',
    summary: 'One visible product by slug (old slugs and ids also resolve; see canonicalSlug)',
    auth: 'public',
    params: productParams,
    responses: { '200': '{ product: ProductSummary, canonicalSlug }', '404': 'NOT_FOUND' },
  },
  {
    path: '/api/v1/search',
    method: 'get',
    summary:
      'Text search: typos, prefixes, synonyms; same filters and facets as browse. Elasticsearch with a Postgres fallback',
    auth: 'public',
    query: searchQuery,
    responses: { '200': PAGE, '400': 'VALIDATION_FAILED', '429': 'RATE_LIMITED' },
  },
  {
    path: '/api/v1/search/clicks',
    method: 'post',
    summary: 'Record which search result was opened (analytics; no personal data)',
    auth: 'public',
    body: searchClickBody,
    responses: { '202': '{ accepted: true }', '400': 'VALIDATION_FAILED' },
  },
  {
    path: '/api/v1/cart',
    method: 'get',
    summary: 'Current cart with a fresh quote',
    auth: 'optional-session',
    responses: CART,
  },
  {
    path: '/api/v1/cart/items',
    method: 'post',
    summary: 'Add a product (adds to its quantity if already in the cart)',
    auth: 'optional-session',
    body: addItemBody,
    responses: {
      '201': 'Updated cart (CartView)',
      '404': 'PRODUCT_NOT_FOUND',
      '409': 'CART_MIXED_MERCHANTS (retry with replaceCart)',
      '422': 'TOO_MANY_LINES',
    },
  },
  {
    path: '/api/v1/cart/items/{lineId}',
    method: 'patch',
    summary: 'Change quantity, weight, replacement preference or note (quantity 0 removes)',
    auth: 'optional-session',
    params: lineIdParams,
    body: updateItemBody,
    responses: { ...CART, '404': 'CART_ITEM_NOT_FOUND' },
  },
  {
    path: '/api/v1/cart/items/{lineId}',
    method: 'delete',
    summary: 'Remove a line',
    auth: 'optional-session',
    params: lineIdParams,
    responses: { ...CART, '404': 'CART_ITEM_NOT_FOUND' },
  },
  {
    path: '/api/v1/cart/quote',
    method: 'post',
    summary: 'Price breakdown; its hash is accepted by checkout for 10 minutes',
    auth: 'optional-session',
    responses: CART,
  },
  {
    path: '/api/v1/checkout',
    method: 'post',
    summary: 'Create the order (pending_payment) and a Stripe Checkout Session (manual capture)',
    auth: 'optional-session',
    body: checkoutBody,
    idempotent: true,
    responses: {
      '201': '{ publicId, checkoutUrl, orderUrl }',
      '400': 'IDEMPOTENCY_KEY_REQUIRED | VALIDATION_FAILED',
      '409':
        'PRICE_CHANGED | QUOTE_EXPIRED (details.quote holds the new quote) | CHECKOUT_ALREADY_COMPLETED | SLOT_UNAVAILABLE',
      '422': 'CART_INVALID | MERCHANT_PAUSED | SLOT_INVALID | IDEMPOTENCY_KEY_REUSED',
      '429': 'RATE_LIMITED',
      '503': 'CHECKOUT_DISABLED | MERCHANT_UNAVAILABLE | PAYMENT_PROVIDER_UNAVAILABLE',
    },
  },
  {
    path: '/api/v1/orders/{publicId}',
    method: 'get',
    summary: 'Order status for its owner or a signed guest link (?t=)',
    auth: 'optional-session',
    params: publicIdParams,
    query: orderQuery,
    responses: {
      '200': 'Order view (no fees, no payment ids)',
      '404': 'NOT_FOUND (also when not allowed to see it)',
    },
  },
  {
    path: '/api/v1/cart/slots',
    method: 'get',
    summary:
      'Pickup times this cart can book: open, with room, after the lead time, within 5 days, on days every item is available',
    auth: 'optional-session',
    responses: {
      '200': '{ timeZone, paused, leadTimeMinutes, slots: [{ id, startsAt, endsAt, remaining }] }',
    },
  },
  {
    path: '/api/v1/cart/items/{lineId}/replacements',
    method: 'get',
    summary: 'Products the customer can rank as specific replacements (same store and subcategory)',
    auth: 'optional-session',
    params: lineIdParams,
    responses: { '200': '{ selected: string[], options }', '404': 'CART_ITEM_NOT_FOUND' },
  },
  {
    path: '/api/v1/orders/{publicId}/cancel',
    method: 'post',
    summary: 'Cancel before the store accepts: the card hold is voided and the slot freed',
    auth: 'optional-session',
    params: publicIdParams,
    query: orderQuery,
    responses: { '200': 'Order view', '404': ORDER_404, '409': 'ORDER_STATE_CONFLICT' },
  },
  {
    path: '/api/v1/orders/{publicId}/substitutions/{lineId}',
    method: 'post',
    summary: 'Approve or reject a replacement until picking completes (rejected = not charged)',
    auth: 'optional-session',
    params: orderLineParams,
    query: orderQuery,
    body: substitutionDecisionBody,
    responses: { '200': 'Order view', '404': ORDER_404, '409': 'PICKING_COMPLETE' },
  },
  {
    path: '/api/v1/orders/{publicId}/arrived',
    method: 'post',
    summary: '"I\'m here" check-in, shown on the store console',
    auth: 'optional-session',
    params: publicIdParams,
    query: orderQuery,
    body: arrivedBody,
    responses: { '200': 'Order view', '404': ORDER_404, '409': 'ORDER_STATE_CONFLICT' },
  },
  {
    path: '/api/v1/orders/{publicId}/rating',
    method: 'post',
    summary: 'Rate a collected order (1–5 and tags)',
    auth: 'optional-session',
    params: publicIdParams,
    query: orderQuery,
    body: ratingBody,
    responses: { '200': 'Order view', '404': ORDER_404, '409': 'ORDER_STATE_CONFLICT' },
  },
  {
    path: '/api/v1/orders/{publicId}/reorder',
    method: 'post',
    summary: 'Buy again: add the products still sold to the cart; report the rest',
    auth: 'optional-session',
    params: publicIdParams,
    query: orderQuery,
    body: reorderBody,
    responses: {
      '200': '{ added, unavailable, cart, quote }',
      '404': ORDER_404,
      '409': 'CART_MIXED_MERCHANTS (retry with replaceCart)',
    },
  },
  {
    path: '/api/v1/orders/lookup',
    method: 'post',
    summary: 'Email a fresh order link to the address on the order; same response for every input',
    auth: 'public',
    body: lookupBody,
    responses: { '200': '{ ok, message }', '429': 'RATE_LIMITED' },
  },
  {
    path: '/api/v1/me/orders',
    method: 'get',
    summary: "The signed-in customer's orders",
    auth: 'customer',
    responses: { '200': '{ orders: OrderSummary[] }', '401': 'UNAUTHENTICATED' },
  },
  // ---- merchant console (G4) ------------------------------------------------------------------
  {
    path: '/api/console/locations',
    method: 'get',
    summary: 'Stores the caller can open in the console, with their role',
    auth: 'staff',
    responses: { '200': '{ locations, user }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/queue',
    method: 'get',
    summary: 'Orders that still need a person (polled every 10 s)',
    auth: 'staff',
    params: locationParams,
    responses: { '200': '{ location, role, serverTime, orders, done }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/settings',
    method: 'get',
    summary:
      'Hours, slot length and capacity, lead time, pause, scale label layout, next 7 days of slots',
    auth: 'staff',
    params: locationParams,
    responses: { '200': '{ settings, closures, slots }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/settings',
    method: 'put',
    summary: 'Change settings (owner only; audited; applies to future slots only)',
    auth: 'staff',
    params: locationParams,
    body: settingsBody,
    responses: { '200': '{ settings, closures, slots }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/closures',
    method: 'post',
    summary: 'Add a holiday closure (owner only)',
    auth: 'staff',
    params: locationParams,
    body: closureBody,
    responses: { '200': '{ closures }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/closures/{date}',
    method: 'delete',
    summary: 'Remove a holiday closure (owner only)',
    auth: 'staff',
    params: closureParams,
    responses: { '200': '{ closures }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/availability',
    method: 'get',
    summary: 'Products and categories switched off for today',
    auth: 'staff',
    params: locationParams,
    responses: { '200': '{ products, categories, allCategories }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/availability/products/{productId}',
    method: 'put',
    summary: 'Out of stock today (hidden until the next opening), or back in stock',
    auth: 'staff',
    params: productAvailabilityParams,
    body: availabilityBody,
    responses: { '200': '{ productId, hiddenUntil }', ...STAFF },
  },
  {
    path: '/api/console/locations/{id}/availability/categories/{categoryId}',
    method: 'put',
    summary: 'A whole category out of stock today, or back',
    auth: 'staff',
    params: categoryAvailabilityParams,
    body: availabilityBody,
    responses: { '200': '{ categoryId, hiddenUntil, products }', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}',
    method: 'get',
    summary: 'The pick screen: lines grouped by category, projected total vs. card hold, timeline',
    auth: 'staff',
    params: consoleOrderParams,
    responses: { '200': CONSOLE_ORDER, ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/accept',
    method: 'post',
    summary: 'Accept a new order',
    auth: 'staff',
    params: consoleOrderParams,
    responses: { '200': CONSOLE_ORDER, '409': 'ORDER_STATE_CONFLICT', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/reject',
    method: 'post',
    summary: 'Reject a new order with a reason; the card hold is voided',
    auth: 'staff',
    params: consoleOrderParams,
    body: rejectBody,
    responses: { '200': CONSOLE_ORDER, '409': 'ORDER_STATE_CONFLICT', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/start',
    method: 'post',
    summary: 'Claim the order for picking (one picker per order; takeover must be confirmed)',
    auth: 'staff',
    params: consoleOrderParams,
    body: startBody,
    responses: { '200': CONSOLE_ORDER, '409': 'ORDER_STATE_CONFLICT | PICKER_CONFLICT', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/scan',
    method: 'post',
    summary:
      'Identify a scanned barcode for this order: line, chosen replacement, wrong item, unknown',
    auth: 'staff',
    params: consoleOrderParams,
    body: scanBody,
    responses: {
      '200': '{ match, lineId?, productId?, name?, kind, priceCents, weightLb }',
      ...STAFF,
    },
  },
  {
    path: '/api/console/orders/{publicId}/lines/{lineId}',
    method: 'post',
    summary:
      'Line action: picked (quantity, weight or scale label, scan-to-verify), unavailable, reset',
    auth: 'staff',
    params: consoleLineParams,
    body: pickBody,
    responses: {
      '200': '{ order, suggestOutOfStock }',
      '409': 'ORDER_STATE_CONFLICT | PICKER_CONFLICT | LINE_SUBSTITUTED',
      '422':
        'WRONG_ITEM | UNKNOWN_BARCODE | INVALID_BARCODE | WEIGHT_REQUIRED | WEIGHT_INVALID | WEIGHT_CONFIRMATION_REQUIRED | QUANTITY_INVALID',
      ...STAFF,
    },
  },
  {
    path: '/api/console/orders/{publicId}/lines/{lineId}/replacements',
    method: 'get',
    summary: "Replacements the picker may offer, following the customer's preference",
    auth: 'staff',
    params: consoleLineParams,
    responses: { '200': '{ preference, options }', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/lines/{lineId}/substitute',
    method: 'post',
    summary:
      'Replace an item (never costs the customer more; they can reject until picking completes)',
    auth: 'staff',
    params: consoleLineParams,
    body: substituteBody,
    responses: {
      '200': CONSOLE_ORDER,
      '422': 'SUBSTITUTION_NOT_ALLOWED | SUBSTITUTE_INVALID | SUBSTITUTE_COSTS_MORE | WRONG_ITEM',
      ...STAFF,
    },
  },
  {
    path: '/api/console/orders/{publicId}/complete',
    method: 'post',
    summary:
      'Picking done: the capture job charges exactly the final amount, then the order is ready',
    auth: 'staff',
    params: consoleOrderParams,
    body: completeBody,
    responses: { '200': CONSOLE_ORDER, '422': 'LINES_NOT_PICKED | OVER_AUTHORIZATION', ...STAFF },
  },
  {
    path: '/api/console/orders/{publicId}/handover',
    method: 'post',
    summary: 'Hand over with the pickup code the customer gives (5 wrong codes lock the order)',
    auth: 'staff',
    params: consoleOrderParams,
    body: handoverBody,
    responses: {
      '200': CONSOLE_ORDER,
      '409': 'ORDER_STATE_CONFLICT',
      '422': 'WRONG_PICKUP_CODE (details.attemptsLeft)',
      '423': 'PICKUP_LOCKED',
      ...STAFF,
    },
  },
  {
    path: '/api/console/orders/{publicId}/unlock',
    method: 'post',
    summary: 'Unlock a handover after too many wrong codes (manager or owner)',
    auth: 'staff',
    params: consoleOrderParams,
    responses: { '200': CONSOLE_ORDER, ...STAFF },
  },
  ...G5_OPERATIONS,
]

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {},
      },
    },
  },
}

const schemaOf = (s: z.ZodType) => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' })
  return rest
}

function parameters(op: Operation) {
  const out: unknown[] = []
  for (const [where, obj] of [
    ['path', op.params],
    ['query', op.query],
  ] as const) {
    if (!obj) continue
    const js = schemaOf(obj) as { properties: Record<string, unknown>; required?: string[] }
    for (const [name, schema] of Object.entries(js.properties))
      out.push({
        name,
        in: where,
        required: where === 'path' || !!js.required?.includes(name),
        schema,
      })
  }
  if (op.idempotent)
    out.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description:
        'Unique per action (checkout, refund, payout…); retries with the same key return the same response for 24 h',
      schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,255}$' },
    })
  return out
}

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of OPERATIONS) {
    paths[op.path] ??= {}
    paths[op.path][op.method] = {
      summary: op.summary,
      ...(op.auth === 'admin'
        ? {
            description: op.permission
              ? `Permission \`${op.permission}\` (roles: ${PERMISSIONS[op.permission].join(', ')}). Staff session with a verified second factor; mutations are audited.`
              : 'Platform admin only. Staff session with a verified second factor; mutations are audited.',
          }
        : {}),
      ...(op.auth === 'customer' || op.auth === 'staff' || op.auth === 'admin'
        ? { security: [{ session: [] }] }
        : op.auth === 'optional-session'
          ? { security: [{}, { session: [] }] }
          : {}),
      ...(parameters(op).length ? { parameters: parameters(op) } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaOf(op.body) } },
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(op.responses).map(([status, description]) => [
          status,
          Number(status) >= 400
            ? {
                description,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              }
            : { description },
        ]),
      ),
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Grocery Marketplace Demo: storefront, merchant console and back-office API',
      version: '1.0.0',
      description:
        'Generated from the zod request schemas (web/summerhill-commerce/src/app/api/v1/_lib). Money is integer cents in CAD. Stripe test mode only.',
    },
    servers: [{ url: 'http://localhost:3000' }],
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'payload-token' } },
      schemas: { Error: errorEnvelope },
    },
    paths,
  }
}

export const renderOpenApi = () =>
  `# GENERATED by \`npm run openapi\` (web/summerhill-commerce). Do not edit by hand.\n${stringify(buildOpenApi())}`
