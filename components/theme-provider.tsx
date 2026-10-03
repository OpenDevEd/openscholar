"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

interface ThemeProviderProps {
  children: React.ReactNode
}

/**
 * The four colour versions in the brand guidelines. Each name is the class on
 * <html> that selects its tokens in globals.css. "dark" is the black version,
 * so a system dark preference lands on it.
 */
export const THEMES = ["light", "navy", "dark", "blue"] as const

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={[...THEMES]}
      defaultTheme="light"
      enableSystem
      // globals.css sets color-scheme per theme; next-themes only knows light and dark.
      enableColorScheme={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
