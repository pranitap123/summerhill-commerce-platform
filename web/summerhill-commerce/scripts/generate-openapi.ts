// Writes docs/openapi.yaml from the zod schemas (G2-18).   npm run openapi
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderOpenApi } from '../src/app/api/v1/_lib/openapi'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/openapi.yaml')
fs.writeFileSync(out, renderOpenApi())
console.log(`openapi: wrote ${path.relative(process.cwd(), out)}`)
