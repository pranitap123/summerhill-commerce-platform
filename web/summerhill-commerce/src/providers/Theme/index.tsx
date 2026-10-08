'use client'

import React, { createContext, useContext } from 'react'

import type { ThemeContextType } from './types'

const value: ThemeContextType = { setTheme: () => null, theme: 'light' }
const ThemeContext = createContext(value)

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => (
  <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
)

export const useTheme = (): ThemeContextType => useContext(ThemeContext)
