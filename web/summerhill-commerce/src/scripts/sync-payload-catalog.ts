import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { FROM_SYNC } from '@/collections/Products/hooks'
import { closeDb, getDb } from '@/server/db'

interface Row {
  id: string
  slug: string
  name: string
  source_name: string
  description: string | null
  unit_price_cents: string | number | null
  images: string[] | null
  category: string
  category_slug: string
  hidden: boolean
  hidden_until: Date | null
}

async function main() {
  const payload = await getPayload({ config: configPromise })
  const { rows } = await getDb().query<Row>(
    `SELECT id, slug, name, source_name, description, unit_price_cents, images, category,
            category_slug, hidden, hidden_until
     FROM catalog.product_view WHERE deleted_at IS NULL ORDER BY id`,
  )
  const context = { [FROM_SYNC]: true }

  const categoryIds = new Map<string, number>()
  for (const r of rows) {
    if (categoryIds.has(r.category_slug)) continue
    const found = await payload.find({
      collection: 'categories',
      where: { slug: { equals: r.category_slug } },
      limit: 1,
      depth: 0,
    })
    const id =
      found.docs[0]?.id ??
      (
        await payload.create({
          collection: 'categories',
          data: { title: r.category, slug: r.category_slug },
        })
      ).id
    categoryIds.set(r.category_slug, id)
  }

  let created = 0
  let updated = 0
  for (const r of rows) {
    const data = {
      productId: r.id,
      title: r.name,
      slug: r.slug,
      sourceName: r.source_name,
      description: r.description ?? '',
      price: r.unit_price_cents === null ? undefined : Number(r.unit_price_cents) / 100,
      imageUrl: r.images?.[0] ?? '',
      category: categoryIds.get(r.category_slug),
      stockStatus:
        r.hidden || (r.hidden_until && r.hidden_until > new Date())
          ? ('out_of_stock' as const)
          : ('in_stock' as const),
    }
    const found = await payload.find({
      collection: 'products',
      where: { productId: { equals: r.id } },
      limit: 1,
      depth: 0,
    })
    if (found.docs[0]) {
      await payload.update({ collection: 'products', id: found.docs[0].id, data, context })
      updated++
    } else {
      await payload.create({ collection: 'products', data, context })
      created++
    }
  }
  console.log(
    `sync-payload-catalog: ${created} created, ${updated} updated, ${categoryIds.size} categories`,
  )
}

try {
  await main()
} catch (err) {
  console.error(`sync-payload-catalog: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await closeDb()
  process.exit()
}
