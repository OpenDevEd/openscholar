"use client"

import React, { useEffect, useRef } from 'react'
import { useResultsStore, useKeywordExpansionDialogStore } from '@/lib/store'
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation'
import { useEffectiveQuery } from '@/lib/hooks'

interface QuerySyncProviderProps {
  children: React.ReactNode
}

/**
 * QuerySyncProvider - Centralized query synchronization
 * 
 * This provider automatically keeps the suggestedQuery in sync with the navbar query.
 * It also handles initial query loading on page mount from effective query sources.
 * It replaces all scattered setSuggestedQuery effects throughout the app with a single
 * centralized implementation.
 */
export function QuerySyncProvider({ children }: QuerySyncProviderProps) {
  const { currentQuery, setCurrentQuery } = useResultsStore()
  const { setSuggestedQuery } = useKeywordExpansionDialogStore()
  const effectiveQuery = useEffectiveQuery()
  const hasInitialized = useRef(false)

  // Initialize current query on page load from effective query sources
  // This ensures the app always has the most relevant query available
  // Only runs once on first page load after persisted data is loaded
  useEffect(() => {
    if (!hasInitialized.current && !currentQuery && effectiveQuery) {
      setCurrentQuery(effectiveQuery)
      hasInitialized.current = true
    }
  }, [effectiveQuery, currentQuery, setCurrentQuery])

  // Keep suggestedQuery in sync with current query changes
  useEffect(() => {
    if (currentQuery) {
      // Expand keywords and set suggested query
      const { expandedQuery } = validateAndExpandKeywordsSilently(currentQuery)
      setSuggestedQuery(expandedQuery)
    } else {
      // Clear suggested query when current query is empty
      setSuggestedQuery('')
    }
  }, [currentQuery, setSuggestedQuery])

  return <>{children}</>
} 