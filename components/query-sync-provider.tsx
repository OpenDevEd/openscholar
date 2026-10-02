"use client"

import React, { useEffect } from 'react'
import { useKeywordExpansionDialogStore, useCurrentQueryStore } from '@/lib/store'
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation-browser'
import { useSearchOptional } from '@/lib/search'

interface QuerySyncProviderProps {
  children: React.ReactNode
}

/**
 * QuerySyncProvider - Simple query synchronization for HOME PAGE ONLY
 * 
 * On home page (no SearchProvider): syncs storeQuery → suggestedQuery
 * On results pages: suggestedQuery is set by useSWR onSuccess in SearchProvider
 * 
 * This separation ensures suggestedQuery is always tied to actual search execution.
 */
export function QuerySyncProvider({ children }: QuerySyncProviderProps) {
  // Check if we're on a results page (has SearchProvider)
  const search = useSearchOptional()
  const isOnResultsPage = search !== undefined

  // Store-based query (for home page)
  const { currentQuery: storeQuery } = useCurrentQueryStore()
  
  const { setSuggestedQuery } = useKeywordExpansionDialogStore()

  // Only sync on home page - results pages handle this in useSWR onSuccess
  useEffect(() => {
    if (isOnResultsPage) return // Let SearchProvider handle it

    if (storeQuery) {
      const { expandedQuery } = validateAndExpandKeywordsSilently(storeQuery)
      setSuggestedQuery(expandedQuery)
    } else {
      setSuggestedQuery('')
    }
  }, [storeQuery, isOnResultsPage, setSuggestedQuery])

  return <>{children}</>
} 