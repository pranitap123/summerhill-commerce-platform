/** Loading state for product listings (G3-13), shown while results stream in. */
export function ListingSkeleton() {
  return (
    <div className="container py-8 md:py-12" aria-busy="true" aria-label="Loading products">
      <div className="mb-6 h-10 w-64 animate-pulse rounded bg-[#EDE7DA]" />
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden h-96 animate-pulse rounded-xl bg-[#EDE7DA] lg:block" />
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="list-none rounded-2xl bg-white p-3">
              <div className="mb-3 aspect-square animate-pulse rounded-xl bg-[#EDE7DA]" />
              <div className="mb-2 h-4 animate-pulse rounded bg-[#EDE7DA]" />
              <div className="h-4 w-16 animate-pulse rounded bg-[#EDE7DA]" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
