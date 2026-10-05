'use client'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded bg-[#1F3A2E] px-4 py-2 text-white"
    >
      Print
    </button>
  )
}
