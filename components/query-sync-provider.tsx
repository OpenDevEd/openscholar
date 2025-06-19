"use client"

import React, { useEffect } from 'react'
import { useKeywordExpansionDialogStore, useCurrentQueryStore } from '@/lib/store'
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation'

interface QuerySyncProviderProps {
  children: React.ReactNode
}

/**
 * QuerySyncProvider - Simple query synchronization
 * 
 * When currentQuery changes → update suggestedQuery (with keyword expansion)
 * This keeps the AI enhancement and bookmarks pages in sync with the main search query
 */
export function QuerySyncProvider({ children }: QuerySyncProviderProps) {
  const { currentQuery } = useCurrentQueryStore()
  const { setSuggestedQuery } = useKeywordExpansionDialogStore()

  // When currentQuery changes, update suggestedQuery with expansion
  useEffect(() => {
    if (currentQuery) {
      const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery)
      setSuggestedQuery(expandedQuery)
    } else {
      setSuggestedQuery('')
    }
  }, [currentQuery, setSuggestedQuery])

  return <>{children}</>
} 