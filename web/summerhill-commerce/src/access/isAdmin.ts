import type { Access } from 'payload'

import { checkRole } from '@/access/utilities'

export const isAdmin: Access = ({ req }) => {
  if (req.user) {
    return checkRole(['admin'], req.user)
  }

  return false
}
