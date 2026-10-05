'use client'

import { useRouter } from 'next/navigation'

const OPTIONS = [
  ['relevance', 'Best match'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
] as const

/** Changes the sort straight away; `hrefs` are prebuilt on the server for each option. */
export function SortSelect({ value, hrefs }: { value: string; hrefs: Record<string, string> }) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-sm text-[#211F1C]">
      <span>Sort</span>
      <select
        value={value}
        onChange={(e) => router.push(hrefs[e.target.value])}
        className="rounded-full border border-[#DCE5D8] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9962C]"
      >
        {OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
