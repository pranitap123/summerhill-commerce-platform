import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  decodeBarcode,
  DEFAULT_SCALE_CONFIG,
  encodeScaleLabel,
  gs1CheckDigit,
  hasValidCheckDigit,
  parseScaleConfig,
  scaleBarcodeConfigSchema,
  toGtin13,
} from '@/modules/fulfilment/barcode'

/** G4-10 / G4-11: GTIN normalisation and the GS1 variable-measure (deli label) decoder. */
describe('GS1 check digits', () => {
  it.each([
    ['03600029145', 2], // UPC-A 036000291452
    ['400638133393', 1], // EAN-13 4006381333931
    ['978030640615', 7], // EAN-13 (ISBN) 9780306406157
  ])('check digit of %s is %i', (body, digit) => {
    expect(gs1CheckDigit(body)).toBe(digit)
  })

  it('accepts real-world codes and rejects a single wrong digit', () => {
    expect(hasValidCheckDigit('036000291452')).toBe(true)
    expect(hasValidCheckDigit('4006381333931')).toBe(true)
    expect(hasValidCheckDigit('036000291453')).toBe(false)
  })

  it('every single-digit error is detected (property)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{11}$/),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 9 }),
        (body, pos, delta) => {
          const code = body + gs1CheckDigit(body)
          const d = (Number(code[pos]) + delta) % 10
          const broken = code.slice(0, pos) + d + code.slice(pos + 1)
          return hasValidCheckDigit(code) && !hasValidCheckDigit(broken)
        },
      ),
    )
  })
})

describe('toGtin13', () => {
  it('normalises UPC-A, EAN-13 and GTIN-14 to GTIN-13', () => {
    expect(toGtin13('036000291452')).toBe('0036000291452')
    expect(toGtin13('4006381333931')).toBe('4006381333931')
    expect(toGtin13('00036000291452')).toBe('0036000291452')
    expect(toGtin13('0 36000 29145 2')).toBe('0036000291452')
  })
  it('rejects wrong lengths, letters and bad check digits', () => {
    expect(toGtin13('1234567')).toBeNull()
    expect(toGtin13('03600029145X')).toBeNull()
    expect(toGtin13('036000291453')).toBeNull()
    expect(toGtin13('10036000291452')).toBeNull() // GTIN-14 with an indicator digit
  })
})

describe('decodeBarcode', () => {
  it('a packaged item is a standard code, matched by its UPC-A', () => {
    expect(decodeBarcode('420260000204')).toEqual({
      kind: 'standard',
      gtin13: '0420260000204',
      catalogCode: '420260000204',
    })
  })

  it('invalid scans say why', () => {
    expect(decodeBarcode('hello')).toEqual({ kind: 'invalid', reason: 'not_a_gtin' })
    expect(decodeBarcode('420260000205')).toEqual({ kind: 'invalid', reason: 'bad_check_digit' })
  })

  // Test vectors: default layout 2 IIIII VVVVV C, value = price in cents.
  it.each([
    ['200001012341', '00001', 1234],
    ['200001000997', '00001', 99],
    ['212345099995', '12345', 9999],
  ])('price label %s → item %s, %i¢', (label, itemCode, cents) => {
    const d = decodeBarcode(label)
    expect(d).toMatchObject({
      kind: 'variable_measure',
      itemCode,
      priceCents: cents,
      weightMlb: null,
    })
    if (d.kind === 'variable_measure') expect(hasValidCheckDigit(`0${d.catalogCode}`)).toBe(true)
  })

  it('matches the catalogue code with the value zeroed', () => {
    const d = decodeBarcode('200001012341')
    expect(d.kind === 'variable_measure' && d.catalogCode).toBe('200001000003')
  })

  it('EAN-13 in-store prefixes 20–29 are variable measure too', () => {
    const catalog = `210012300000${gs1CheckDigit('210012300000')}`
    const d = decodeBarcode(encodeScaleLabel(catalog, 450))
    expect(d).toMatchObject({ kind: 'variable_measure', itemCode: '00123', priceCents: 450 })
  })

  it('weight labels: 2 or 3 decimals of a pound', () => {
    const two = { ...DEFAULT_SCALE_CONFIG, value: 'weight' as const, weightDecimals: 2 as const }
    const three = { ...two, weightDecimals: 3 as const }
    const label = encodeScaleLabel('200001000003', 1234, two)
    expect(decodeBarcode(label, two)).toMatchObject({ weightMlb: 12_340, priceCents: null })
    expect(decodeBarcode(label, three)).toMatchObject({ weightMlb: 1234 })
  })

  it('layout with a price check digit: 2 IIII P VVVVV C', () => {
    const cfg = { itemDigits: 4, valueDigits: 5, priceCheckDigit: true, value: 'price' as const }
    const catalog = `21234000000${gs1CheckDigit('21234000000')}`
    const label = encodeScaleLabel(catalog, 1299, cfg)
    expect(label.slice(0, 11)).toBe('21234001299')
    const d = decodeBarcode(label, cfg)
    expect(d).toMatchObject({ kind: 'variable_measure', itemCode: '1234', priceCents: 1299 })
    expect(d.kind === 'variable_measure' && d.catalogCode.slice(0, 11)).toBe('21234000000')
  })

  it('encode → decode round-trips every price (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999 }), (cents) => {
        const d = decodeBarcode(encodeScaleLabel('200001000003', cents))
        return (
          d.kind === 'variable_measure' &&
          d.priceCents === cents &&
          d.catalogCode === '200001000003'
        )
      }),
    )
  })
})

describe('scale config', () => {
  it('rejects layouts that do not add up to 10 digits', () => {
    expect(
      scaleBarcodeConfigSchema.safeParse({
        itemDigits: 5,
        valueDigits: 4,
        priceCheckDigit: false,
        value: 'price',
      }).success,
    ).toBe(false)
  })
  it('falls back to the default for missing or invalid stored config', () => {
    expect(parseScaleConfig(null)).toEqual(DEFAULT_SCALE_CONFIG)
    expect(parseScaleConfig({ itemDigits: 9 })).toEqual(DEFAULT_SCALE_CONFIG)
  })
})
