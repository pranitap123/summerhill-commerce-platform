import { AuthProvider } from '@/providers/Auth'
import React from 'react'

import { HeaderThemeProvider } from './HeaderTheme'
import { ThemeProvider } from './Theme'
import { SonnerProvider } from '@/providers/Sonner'

// The Payload ecommerce provider is gone (ADR-0003, G2-15): the cart is the server cart
// (src/lib/cartStore.ts → /api/v1/cart).
export const Providers: React.FC<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HeaderThemeProvider>
          <SonnerProvider />
          {children}
        </HeaderThemeProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
