import { z } from 'zod'

export const scaleBarcodeConfigSchema = z
  .object({
    itemDigits: z.number().int().min(4).max(6),
    valueDigits: z.number().int().min(4).max(6),
    priceCheckDigit: z.boolean(),
    value: z.enum(['price', 'weight']),

    weightDecimals: z.union([z.literal(2), z.literal(3)]).optional(),
  })
  .strict()
  .refine((c) => c.itemDigits + c.valueDigits + (c.priceCheckDigit ? 1 : 0) === 10, {
    message: 'itemDigits + valueDigits (+1 for a price check digit) must be 10',
  })
export type ScaleBarcodeConfig = z.infer<typeof scaleBarcodeConfigSchema>

export const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = {
  itemDigits: 5,
  valueDigits: 5,
  priceCheckDigit: false,
  value: 'price',
}

export function parseScaleConfig(raw: unknown): ScaleBarcodeConfig {
  const parsed = scaleBarcodeConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_SCALE_CONFIG
}

export function gs1CheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error('check digit body must be digits')
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

export function hasValidCheckDigit(code: string): boolean {
  return /^\d{8,14}$/.test(code) && gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1))
}

export function toGtin13(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits)) return null
  let code: string
  if (digits.length === 12) code = `0${digits}`
  else if (digits.length === 13) code = digits
  else if (digits.length === 14 && digits.startsWith('0')) code = digits.slice(1)
  else return null
  return hasValidCheckDigit(code) ? code : null
}

export function toCatalogCode(gtin13: string): string {
  return gtin13.startsWith('0') ? gtin13.slice(1) : gtin13
}

export function isVariableMeasure(gtin13: string): boolean {
  return /^(02|2\d)/.test(gtin13)
}

export type DecodedBarcode =
  | { kind: 'standard'; gtin13: string; catalogCode: string }
  | {
      kind: 'variable_measure'
      gtin13: string

      catalogCode: string
      itemCode: string
      priceCents: number | null
      weightMlb: number | null
    }
  | { kind: 'invalid'; reason: 'not_a_gtin' | 'bad_check_digit' }

export function decodeBarcode(
  raw: string,
  config: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG,
): DecodedBarcode {
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d{12,14}$/.test(digits)) return { kind: 'invalid', reason: 'not_a_gtin' }
  const gtin13 = toGtin13(digits)
  if (!gtin13) return { kind: 'invalid', reason: 'bad_check_digit' }
  if (!isVariableMeasure(gtin13))
    return { kind: 'standard', gtin13, catalogCode: toCatalogCode(gtin13) }

  const prefix = gtin13.slice(0, 2)
  const itemCode = gtin13.slice(2, 2 + config.itemDigits)
  const valueStart = 2 + config.itemDigits + (config.priceCheckDigit ? 1 : 0)
  const value = Number(gtin13.slice(valueStart, valueStart + config.valueDigits))
  const zeroed = `${prefix}${itemCode}${'0'.repeat(10 - config.itemDigits)}`
  const catalog13 = zeroed + String(gs1CheckDigit(zeroed))
  let priceCents: number | null = null
  let weightMlb: number | null = null
  if (config.value === 'price') priceCents = value
  else weightMlb = value * 10 ** (3 - (config.weightDecimals ?? 2))
  return {
    kind: 'variable_measure',
    gtin13,
    catalogCode: toCatalogCode(catalog13),
    itemCode,
    priceCents,
    weightMlb,
  }
}

export function encodeScaleLabel(
  catalogCode: string,
  value: number,
  config: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG,
): string {
  const gtin13 = toGtin13(catalogCode)
  if (!gtin13 || !isVariableMeasure(gtin13))
    throw new Error(`${catalogCode} is not a variable-measure code`)
  if (!Number.isInteger(value) || value < 0 || value >= 10 ** config.valueDigits)
    throw new Error(`value ${value} doesn't fit in ${config.valueDigits} digits`)
  const head = gtin13.slice(0, 2 + config.itemDigits)
  const pcd = config.priceCheckDigit ? '0' : ''
  const body = `${head}${pcd}${String(value).padStart(config.valueDigits, '0')}`
  return toCatalogCode(body + String(gs1CheckDigit(body)))
}
