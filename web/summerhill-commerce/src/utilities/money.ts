
const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

export function formatCad(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '–' : cad.format(cents / 100)
}

export function formatUnitPrice(cents: number, unit: 'ea' | 'lb' | null | undefined): string {
  return unit === 'lb' ? `${formatCad(cents)} /lb` : formatCad(cents)
}

export function formatLb(lb: number | null | undefined): string {
  return lb === null || lb === undefined ? '' : `${lb.toFixed(2)} lb`
}
