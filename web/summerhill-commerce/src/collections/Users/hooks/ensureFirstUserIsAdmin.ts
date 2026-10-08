import type { FieldHook } from 'payload'

import type { User } from '@/payload-types'

export const ensureFirstUserIsAdmin: FieldHook<User> = async ({ operation, req, value }) => {
  if (operation === 'create') {
    const users = await req.payload.find({ collection: 'users', depth: 0, limit: 0 })
    if (users.totalDocs === 0) {

      if (!(value || []).includes('admin')) {
        return [...(value || []), 'admin']
      }
    }
  }

  return value
}
