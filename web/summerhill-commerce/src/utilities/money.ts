/**
 * Display formatting only (ADR-0006: money maths never happens in the UI). Amounts arrive from the
 * API as integer cents and are formatted once, here.
 */
const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

export function formatCad(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '–' : cad.format(cents / 100)
}

/** "$4.09 /lb" or "$9.39" */
export function formatUnitPrice(cents: number, unit: 'ea' | 'lb' | null | undefined): string {
  return unit === 'lb' ? `${formatCad(cents)} /lb` : formatCad(cents)
}

export function formatLb(lb: number | null | undefined): string {
  return lb === null || lb === undefined ? '' : `${lb.toFixed(2)} lb`
}
