import type { Access } from 'payload'

import { checkRole } from '@/access/utilities'

export const isDocumentOwner: Access = ({ req }) => {

  if (req.user && checkRole(['admin'], req.user)) {
    return true
  }

  if (req.user?.id) {
    return {
      customer: {
        equals: req.user.id,
      },
    }
  }

  return false
}
