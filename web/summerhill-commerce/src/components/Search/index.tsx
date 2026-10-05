'use client'

import { SearchIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import React from 'react'

import { cn } from '@/utilities/cn'

type Props = {
  className?: string
}

/** Header search: a plain GET form to /shop (works without JavaScript). */
export const Search: React.FC<Props> = ({ className }) => {
  const searchParams = useSearchParams()
  return (
    <form action="/shop" method="get" role="search" className={cn('relative w-full', className)}>
      <label htmlFor="header-q" className="sr-only">
        Search products
      </label>
      <input
        id="header-q"
        autoComplete="off"
        className="w-full rounded-full border border-[#DCE5D8] bg-white px-4 py-2 pr-9 text-sm text-[#211F1C] placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C9962C]"
        defaultValue={searchParams?.get('q') || ''}
        key={searchParams?.get('q')}
        maxLength={100}
        name="q"
        placeholder="Search products…"
        type="search"
      />
      <button type="submit" aria-label="Search" className="absolute right-0 top-0 mr-3 flex h-full items-center text-[#1F3A2E]">
        <SearchIcon className="h-4" aria-hidden="true" />
      </button>
    </form>
  )
}
