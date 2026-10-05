/**
 * EAN-13 / UPC-A barcode as inline SVG (G4-10, G4-16): printed on pick slips and demo labels so
 * scan-to-verify can be tried with a real scanner or a phone camera. UPC-A is EAN-13 with a
 * leading 0. Pure: no dependencies, renders on the server.
 */
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
]
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
]
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
]
// Which of the left six digits use the G code, by the first digit
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
]

export function ean13Modules(code: string): string {
  const digits = code.length === 12 ? `0${code}` : code
  if (!/^\d{13}$/.test(digits)) throw new Error(`not an EAN-13/UPC-A code: ${code}`)
  const d = [...digits].map(Number)
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[d[i]]
  return bits + '101'
}

export function Barcode({
  code,
  height = 48,
  label = true,
}: {
  code: string
  height?: number
  label?: boolean
}) {
  const bits = ean13Modules(code)
  const quiet = 9
  const width = bits.length + quiet * 2
  const bars: Array<{ x: number; w: number }> = []
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue
    const last = bars.at(-1)
    if (last && last.x + last.w === i + quiet) last.w++
    else bars.push({ x: i + quiet, w: 1 })
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height + (label ? 12 : 0)}`}
      width={width * 2}
      height={(height + (label ? 12 : 0)) * 2}
      role="img"
      aria-label={`Barcode ${code}`}
      shapeRendering="crispEdges"
    >
      <rect width={width} height={height + (label ? 12 : 0)} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      {label && (
        <text x={width / 2} y={height + 10} fontSize="9" textAnchor="middle" fontFamily="monospace">
          {code}
        </text>
      )}
    </svg>
  )
}
