

const CLAIM_LABELS: Record<string, string> = {
  glutenFree: 'Gluten free',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  peanutsFree: 'Peanut free',
  treeNutsFree: 'Tree-nut free',
  eggFree: 'Egg free',
  dairyFree: 'Dairy free',
  kosher: 'Kosher',
  halal: 'Halal',
  nonGmo: 'Non-GMO',
  lowSodium: 'Low sodium',
  noSugarAdded: 'No sugar added',
  organic: 'Organic',
}

export function claimLabel(claim: string): string {
  if (CLAIM_LABELS[claim]) return CLAIM_LABELS[claim]
  const words = claim.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatDays(days: number[]): string | null {
  if (days.length === 0 || days.length === 7) return null
  const sorted = [...days].sort((a, b) => a - b)
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (consecutive && sorted.length > 2) return `${DAYS[sorted[0] - 1]}–${DAYS[sorted.at(-1)! - 1]}`
  return sorted.map((d) => DAYS[d - 1]).join(', ')
}

export const DIETARY_DISCLAIMER =
  'Dietary information is as supplied by the store. Always check the product label; a missing claim does not mean an item contains that ingredient.'
