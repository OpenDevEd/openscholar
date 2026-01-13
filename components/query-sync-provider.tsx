"use client"

import React, { useEffect } from 'react'
import { useKeywordExpansionDialogStore, useCurrentQueryStore } from '@/lib/store'
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation'
import { useSearchOptional } from '@/lib/search'

interface QuerySyncProviderProps {
  children: React.ReactNode
}

/**
 * QuerySyncProvider - Simple query synchronization
 * 
 * When query changes → update suggestedQuery (with keyword expansion)
 * This keeps the AI enhancement and bookmarks pages in sync with the main search query
 * 
 * Priority:
 * 1. URL params (on results pages) - source of truth
 * 2. currentQueryStore (on home page) - fallback
 */
export function QuerySyncProvider({ children }: QuerySyncProviderProps) {
  // URL-based query (source of truth on results pages)
  const search = useSearchOptional()
  const urlQuery = search?.params?.q ?? null

  // Store-based query (for home page)
  const { currentQuery: storeQuery } = useCurrentQueryStore()
  
  const { setSuggestedQuery } = useKeywordExpansionDialogStore()

  // Determine which query to use: URL if on results page, store otherwise
  const effectiveQuery = urlQuery !== null ? urlQuery : storeQuery

  // When effectiveQuery changes, update suggestedQuery with expansion
  useEffect(() => {
    if (effectiveQuery) {
      const { expandedQuery } = validateAndExpandKeywordsSilently(effectiveQuery)
      setSuggestedQuery(expandedQuery)
    } else {
      setSuggestedQuery('')
    }
  }, [effectiveQuery, setSuggestedQuery])

  return <>{children}</>
} 