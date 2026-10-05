import Link from 'next/link'

import { STATUS_LABELS, type Order } from '@/modules/ordering'
import { formatCad } from '@/utilities/money'

export function OrderList({ orders }: { orders: Order[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            href={`/orders/${order.publicId}`}
            className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted"
          >
            <span className="flex flex-col">
              <span className="font-mono text-sm">{order.publicId}</span>
              <span className="text-sm text-muted-foreground">
                {order.placedAt ? order.placedAt.toLocaleDateString('en-CA') : 'Not placed'} ·{' '}
                {STATUS_LABELS[order.status]}
              </span>
            </span>
            <span className="font-medium">
              {formatCad(order.finalTotalCents ?? order.estimatedTotalCents)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
