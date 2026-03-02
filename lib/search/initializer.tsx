'use client';

/**
 * SearchInitializer - Handles URL/History Reconciliation
 * 
 * This component runs ONCE on mount and handles these scenarios:
 * 
 * 1. Missing ID or unknown ID (with or without params) → Create new entry with new ID, redirect
 * 2. Known ID + explicit URL params → Sync store if params differ, then ready
 * 3. Known ID + no URL params → Restore params from storage, redirect to canonical URL
 * 
 * IMPORTANT: Empty searches (no query, no filters) are VALID and should be stored.
 * 
 * Uses useEffect to handle redirects (cannot call router during render).
 */

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams, useParams, usePathname } from 'next/navigation';
import { useSearchHistoryStore } from '../store';
import { paramsToSearchResult, searchResultToParams, paramsMatchState } from '../search-params/converters';
import { buildResultsUrl, parseSearchParamsFromUrl } from '../search-params';
import type { SearchResult } from '../types';

interface SearchInitializerProps {
  children: ReactNode;
}

export function SearchInitializer({ children }: SearchInitializerProps) {
  const router = useRouter();
  const routeParams = useParams<{ searchId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchId = routeParams?.searchId ?? '';
  
  // Get store methods
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addSearchResult = useSearchHistoryStore((state) => state.addSearchResult);
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  const addQueryToHistory = useSearchHistoryStore((state) => state.addQueryToHistory);
  
  // Track initialization state
  const [status, setStatus] = useState<'pending' | 'redirecting' | 'ready'>('pending');
  
  // Handle initialization in useEffect (cannot call router during render)
  useEffect(() => {
    // Skip if searchParams is null (during SSR)
    if (!searchParams) {
      return;
    }
    
    // Only run initialization logic once when pending
    if (status !== 'pending') {
      return;
    }
    
    const parsedParams = parseSearchParamsFromUrl(searchParams);
    const hasExplicitParams = searchParams.toString() !== '';
    const existingEntry = searchId ? getSearchResult(searchId) : undefined;

    // Branch A: missing ID OR unknown ID -> create a new entry and canonicalize URL
    if (!searchId || !existingEntry) {
      setStatus('redirecting');

      const newEntry = paramsToSearchResult(parsedParams);
      const newId = addSearchResult(newEntry);

      const canonicalParams = searchResultToParams({ ...newEntry, id: newId } as SearchResult);
      router.replace(buildResultsUrl(newId, canonicalParams));
      return;
    }

    // Branch B: known ID with no explicit params -> restore stored state to URL
    if (!hasExplicitParams) {
      setStatus('redirecting');
      const canonicalParams = searchResultToParams(existingEntry);
      router.replace(buildResultsUrl(searchId, canonicalParams));
      return;
    }

    // Branch C: known ID with explicit params -> sync store if needed, then ready
    if (!paramsMatchState(parsedParams, existingEntry)) {
      if (parsedParams.q !== existingEntry.query) {
        addQueryToHistory(searchId, parsedParams.q);
      }

      // Exclude query/count: query history writes query, count comes from live results.
      const updatedEntry = paramsToSearchResult(parsedParams);
      const { query, count, ...filterUpdates } = updatedEntry;
      updateSearchResult(searchId, filterUpdates);
    }

    // Always canonicalize explicit param URLs to strip defaults/empties like reg= or focus=
    const canonicalEntry = paramsToSearchResult(parsedParams);
    const canonicalParams = searchResultToParams({ ...canonicalEntry, id: searchId } as SearchResult);
    const canonicalUrl = buildResultsUrl(searchId, canonicalParams);
    const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    if (canonicalUrl !== currentUrl) {
      setStatus('redirecting');
      router.replace(canonicalUrl);
      return;
    }

    setStatus('ready');
  }, [searchId, status, getSearchResult, addSearchResult, updateSearchResult, addQueryToHistory, pathname, searchParams, router]);
  
  // After redirect, mark ready once the route has a valid searchId with an existing entry.
  useEffect(() => {
    if (status !== 'redirecting' || !searchId) {
      return;
    }

    const existingEntry = getSearchResult(searchId);
    if (existingEntry) {
      setStatus('ready');
    }
  }, [status, searchId, searchParams, getSearchResult]);
  
  // Show loading while pending or redirecting
  if (status !== 'ready') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }
  
  return <>{children}</>;
}
