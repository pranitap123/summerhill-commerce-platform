export const SYNONYMS: string[][] = [
  ['pop', 'soda', 'soft drink'],
  ['courgette', 'zucchini'],
  ['aubergine', 'eggplant'],
  ['ground beef', 'minced beef', 'mince'],
  ['chips', 'crisps'],
  ['candy', 'sweets'],
  ['cookie', 'biscuit'],
  ['cilantro', 'coriander'],
  ['scallion', 'green onion', 'spring onion'],
  ['shrimp', 'prawn'],
  ['yogurt', 'yoghurt'],
  ['capsicum', 'bell pepper'],
  ['bap', 'bun', 'roll'],
  ['entree', 'main', 'dinner'],
]

export const synonymRules = (): string[] => SYNONYMS.map((set) => set.join(', '))

export function expandTerm(term: string): string[] {
  const out = new Set([term])
  for (const set of SYNONYMS)
    if (set.includes(term)) for (const s of set) if (!s.includes(' ')) out.add(s)
  return [...out]
}

export function queryTerms(q: string): string[] {
  return q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 8)
}
