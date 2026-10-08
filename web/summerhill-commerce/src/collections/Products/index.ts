import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

import { pushOverrideToCatalog } from './hooks'

const mirrored = {
  readOnly: true,
  description: 'Owned by the catalogue ingest; shown here read-only.',
}

export const Products: CollectionConfig = {
  slug: 'products',
  access: {
    create: () => false, // the sync uses the Local API with overrideAccess
    delete: () => false,
    read: adminOnly,
    update: adminOnly,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'price', 'stockStatus'],
    group: 'Catalogue',
    description:
      'Rename a product or mark it out of stock. Prices and descriptions come from ingest.',
  },
  hooks: { afterChange: [pushOverrideToCatalog] },
  fields: [
    { name: 'productId', type: 'text', required: true, unique: true, index: true, admin: mirrored },
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, admin: mirrored },
    {
      name: 'sourceName',
      type: 'text',
      admin: {
        ...mirrored,
        description: 'Name from the source; clear the title edit by restoring it.',
      },
    },
    { name: 'description', type: 'textarea', admin: mirrored },
    {
      name: 'price',
      type: 'number',
      admin: { ...mirrored, description: 'CAD, per sale unit. Owned by ingest.' },
    },
    { name: 'imageUrl', type: 'text', admin: mirrored },
    { name: 'category', type: 'relationship', relationTo: 'categories', admin: mirrored },
    {
      name: 'stockStatus',
      type: 'select',
      defaultValue: 'in_stock',
      required: true,
      options: [
        { label: 'In stock', value: 'in_stock' },
        { label: 'Out of stock (hidden from the storefront)', value: 'out_of_stock' },
      ],
    },
  ],
}
