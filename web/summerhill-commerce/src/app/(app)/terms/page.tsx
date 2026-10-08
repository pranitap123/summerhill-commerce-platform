import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Demo terms',
  description: 'Terms for this demonstration project.',
}

const heading = 'font-display text-2xl mt-10 mb-3 text-[#1F3A2E]'
const body = 'text-[#211F1C] leading-relaxed'

export default function DemoTermsPage() {
  return (
    <div className="container max-w-3xl py-16">
      <h1 className="font-display text-4xl mb-8 text-[#1F3A2E]">Demo terms</h1>
      <p className={body}>
        This website is an independent software demonstration of a grocery marketplace. It is not a
        shop. It is not affiliated with, endorsed by or operated on behalf of Summerhill Market or
        any other retailer named in it.
      </p>

      <h2 className={heading}>No real orders or payments</h2>
      <p className={body}>
        All payments run in Stripe test mode. Use Stripe&apos;s published test card numbers only. No
        goods are sold, no money is charged and no order will be fulfilled.
      </p>

      <h2 className={heading}>Data</h2>
      <p className={body}>
        Product data shown in the demo is synthetic unless you configured your own data source. Do
        not enter real personal information. Accounts and orders you create may be deleted at any
        time.
      </p>

      <h2 className={heading}>No warranty</h2>
      <p className={body}>
        The software is provided as is, without warranty of any kind. The source code is
        proprietary; see the LICENSE file in the repository.
      </p>
    </div>
  )
}
