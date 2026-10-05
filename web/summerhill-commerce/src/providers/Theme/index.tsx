'use client'

import React, { createContext, useContext } from 'react'

import type { ThemeContextType } from './types'

/**
 * The storefront has one design: the light cream/evergreen palette (G3-13). The template's theme
 * selector followed the OS into `data-theme="dark"`, which turned every `dark:` style unreadable on
 * the forced cream background, so dark mode is off: the root layout always sets `light`, and this
 * provider only exposes that fixed value to components that ask (Sonner toasts).
 */
const value: ThemeContextType = { setTheme: () => null, theme: 'light' }
const ThemeContext = createContext(value)

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => (
  <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
)

export const useTheme = (): ThemeContextType => useContext(ThemeContext)
