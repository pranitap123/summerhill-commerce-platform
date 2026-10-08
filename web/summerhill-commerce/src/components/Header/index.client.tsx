'use client'
import { CMSLink } from '@/components/Link'
import { HeaderCartLink } from '@/components/HeaderCartLink'
import { Search } from '@/components/Search'

import Link from 'next/link'
import React, { Suspense } from 'react'

import { MobileMenu } from './MobileMenu'
import type { Header } from 'src/payload-types'

import { LogoIcon } from '@/components/icons/logo'
import { usePathname } from 'next/navigation'
import { cn } from '@/utilities/cn'

type Props = {
  header: Header
}

const PRIMARY = [
  { href: '/shop', label: 'Shop' },
  { href: '/specials', label: 'Specials' },
  { href: '/stores', label: 'Stores' },
]

export function HeaderClient({ header }: Props) {
  const menu = header.navItems || []
  const pathname = usePathname()
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <header className="relative z-20 border-b border-[#DCE5D8] bg-[#FAF6EE]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="container flex items-center gap-4 py-3">
        <div className="block flex-none md:hidden">
          <Suspense fallback={null}>
            <MobileMenu menu={menu} />
          </Suspense>
        </div>
        <Link className="flex flex-none items-center gap-2 text-[#1F3A2E]" href="/">
          <LogoIcon className="h-auto w-6" />
          <span className="font-display hidden text-lg font-semibold sm:inline">Grocery Demo</span>
        </Link>
        <ul className="hidden items-center gap-4 text-sm md:flex">
          {PRIMARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={cn(
                  'font-medium text-[#1F3A2E] hover:underline',
                  active(item.href) && 'underline decoration-[#C9962C] decoration-2 underline-offset-4',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
          {menu.map((item) => (
            <li key={item.id}>
              <CMSLink {...item.link} size={'clear'} className="relative navLink" appearance="nav" />
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden w-full max-w-xs lg:block">
          <Suspense fallback={null}>
            <Search />
          </Suspense>
        </div>
        <div className="ml-auto flex flex-none items-center gap-4 lg:ml-0">
          <Link href="/account" className="text-sm font-medium text-[#1F3A2E] hover:underline">
            Account
          </Link>
          <HeaderCartLink />
        </div>
      </nav>

      <ul className="container flex gap-5 overflow-x-auto pb-2 text-sm md:hidden">
        {PRIMARY.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={cn('font-medium text-[#1F3A2E]', active(item.href) && 'underline')}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </header>
  )
}
