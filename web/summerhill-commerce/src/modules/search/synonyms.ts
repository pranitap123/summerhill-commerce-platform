/**
 * Curated, versioned synonym sets (CATALOG §8.3). Used by the Elasticsearch search analyzer and by
 * the Postgres fallback's query expansion. The weekly zero-result report (G3-15) is where new sets
 * come from. Lowercase; one set per line of equivalent terms.
 */
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

/** Elasticsearch `synonyms` rule format ("a, b, c"). */
export const synonymRules = (): string[] => SYNONYMS.map((set) => set.join(', '))

/** Single-word alternatives for a term (the Postgres fallback matches word by word). */
export function expandTerm(term: string): string[] {
  const out = new Set([term])
  for (const set of SYNONYMS)
    if (set.includes(term)) for (const s of set) if (!s.includes(' ')) out.add(s)
  return [...out]
}

/** Lowercase words of a query: letters and digits only (safe for to_tsquery), at most 8. */
export function queryTerms(q: string): string[] {
  return q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 8)
}
