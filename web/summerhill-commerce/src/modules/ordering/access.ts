import type { SessionUser } from '@/modules/identity'
import { sign, unsign } from '@/server/signing'

import type { Order } from './repository'

const DEFAULT_TTL_DAYS = 30

export function orderAccessToken(
  order: Pick<Order, 'publicId' | 'accessVersion'>,
  now: Date = new Date(),
  ttlDays = DEFAULT_TTL_DAYS,
): string {
  const expires = Math.floor(now.getTime() / 1000) + ttlDays * 86_400
  return sign('order-link', `${order.publicId}~${order.accessVersion}~${expires}`)
}

export function verifyOrderAccessToken(
  token: string | null | undefined,
  order: Pick<Order, 'publicId' | 'accessVersion'>,
  now: Date = new Date(),
): boolean {
  const value = unsign('order-link', token)
  if (!value) return false
  const [publicId, version, expires] = value.split('~')
  return (
    publicId === order.publicId &&
    Number(version) === order.accessVersion &&
    Number(expires) > Math.floor(now.getTime() / 1000)
  )
}

export function canViewOrder(
  order: Pick<Order, 'publicId' | 'accessVersion' | 'userId'>,
  user: SessionUser | null,
  token: string | null | undefined,
): boolean {
  if (user?.roles.includes('admin')) return true
  if (user && order.userId !== null && String(user.id) === order.userId) return true
  return verifyOrderAccessToken(token, order)
}
