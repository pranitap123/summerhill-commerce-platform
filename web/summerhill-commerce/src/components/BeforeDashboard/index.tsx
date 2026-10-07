import { Banner } from '@payloadcms/ui'
import React from 'react'

import './index.scss'

const baseClass = 'before-dashboard'

// Products are not a Payload collection (ADR-0004): the catalogue is ingest-owned and edited
// through overrides in the ops console. This panel is the Payload admin's door to it.
export const BeforeDashboard: React.FC = () => {
  return (
    <div className={baseClass}>
      <Banner className={`${baseClass}__banner`} type="success">
        <h4>Summerhill admin</h4>
      </Banner>
      This panel manages content, users and media. Everything commercial lives in the ops console:
      <ul className={`${baseClass}__instructions`}>
        <li>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ops/catalog">Products and prices</a>
          {' (edit overrides, hide or restore items; ingest never overwrites them).'}
        </li>
        <li>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ops/merchants">Merchants</a>
          {', '}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ops/orders">orders</a>
          {', '}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ops/payouts">payouts</a>
          {' and refunds.'}
        </li>
        <li>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Visit the storefront</a>
        </li>
      </ul>
    </div>
  )
}
