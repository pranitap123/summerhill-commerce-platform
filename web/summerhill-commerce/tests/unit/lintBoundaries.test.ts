import path from 'node:path'

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

// Module boundary rules from eslint.config.mjs (G1-05, ADR-0002), exercised through the ESLint API.
const eslint = new ESLint({ cwd: path.resolve(__dirname, '../..') })

beforeAll(async () => {
  await eslint.lintText('export {}\n', { filePath: 'src/warmup.ts' })
}, 240_000)

async function blocked(file: string, importLine: string): Promise<boolean> {
  const [result] = await eslint.lintText(`${importLine}\nexport const used = y\n`, {
    filePath: file,
  })
  return result.messages.some((m) => m.ruleId === 'no-restricted-imports')
}

describe('module boundaries', () => {
  it.each([
    ['src/app/api/x/route.ts', "import { y } from '@/modules/merchant/repository'", true],
    ['src/app/api/x/route.ts', "import { y } from '@/modules/merchant'", false],
    ['src/modules/catalog/x.ts', "import { y } from '@/modules/merchant/repository'", true],
    ['src/modules/catalog/x.ts', "import { y } from '../merchant/repository'", true],
    ['src/modules/catalog/x.ts', "import { y } from '@/modules/merchant'", false],
    ['src/modules/catalog/x.ts', "import { y } from '@/modules/catalog/repository'", false],
    ['src/modules/catalog/x.ts', "import { y } from './repository'", false],
  ])(
    '%s: %s → blocked=%s',
    async (file, line, expected) => {
      expect(await blocked(file, line)).toBe(expected)
    },
    60_000,
  )
})
