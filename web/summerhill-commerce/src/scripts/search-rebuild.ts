import { rebuildSearchIndex } from '@/modules/search'
import { closeDb } from '@/server/db'

try {
  const result = await rebuildSearchIndex()
  console.log(
    `search: indexed ${result.count} products into ${result.index} (alias swapped; ${result.caughtUp} caught up, ${result.removed.length} old index(es) removed)`,
  )
} catch (err) {
  console.error(`search: rebuild failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await closeDb()
}
