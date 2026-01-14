'use client';

/**
 * SearchInitializer - Handles URL/History Reconciliation
 * 
 * This component runs ONCE on mount and handles these scenarios:
 * 
 * 1. Unknown ID (any params, including none) → Create new entry with new ID, redirect
 * 2. Known ID + has URL params → If query differs, add to queryHistory; update filters
 * 3. Known ID + no URL params → Restore params from storage to URL
 * 4. Known ID + matching params → Ready (do nothing)
 * 
 * IMPORTANT: Empty searches (no query, no filters) are VALID and should be stored.
 * 
 * Uses useEffect to handle redirects (cannot call router during render).
 */

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useSearchHistoryStore } from '../store';
import { paramsToSearchResult, searchResultToParams, paramsMatchState } from '../search-params/converters';
import { buildResultsUrl, DEFAULT_SEARCH_PARAMS } from '../search-params';
import type { ParsedSearchParams } from '../search-params/parsers';

interface SearchInitializerProps {
  children: ReactNode;
}

/**
 * Parse URL search params into our ParsedSearchParams format
 * Uses the nuqs parser defaults for missing values
 */
function parseUrlParams(searchParams: URLSearchParams): ParsedSearchParams {
  return {
    q: searchParams.get('q') ?? DEFAULT_SEARCH_PARAMS.q,
    field: searchParams.get('field') ?? DEFAULT_SEARCH_PARAMS.field,
    sort: searchParams.get('sort') ?? DEFAULT_SEARCH_PARAMS.sort,
    page: searchParams.has('page') ? parseInt(searchParams.get('page')!, 10) : DEFAULT_SEARCH_PARAMS.page,
    yf: searchParams.has('yf') ? parseInt(searchParams.get('yf')!, 10) : null,
    yt: searchParams.has('yt') ? parseInt(searchParams.get('yt')!, 10) : null,
    df: searchParams.get('df') ?? null,
    dt: searchParams.get('dt') ?? null,
    ft: searchParams.get('ft') ?? DEFAULT_SEARCH_PARAMS.ft,
    rmin: searchParams.has('rmin') ? parseInt(searchParams.get('rmin')!, 10) : DEFAULT_SEARCH_PARAMS.rmin,
    rmax: searchParams.has('rmax') ? parseInt(searchParams.get('rmax')!, 10) : DEFAULT_SEARCH_PARAMS.rmax,
    rated: searchParams.get('rated') === 'true',
    reg: searchParams.has('reg') ? decodeRegionsFromUrl(searchParams.get('reg')!) : [],
    focus: searchParams.has('focus') ? decodeRegionsFromUrl(searchParams.get('focus')!) : [],
    cites: searchParams.get('cites') ?? DEFAULT_SEARCH_PARAMS.cites,
    citedBy: searchParams.get('citedBy') ?? DEFAULT_SEARCH_PARAMS.citedBy,
    rel: searchParams.get('rel') ?? DEFAULT_SEARCH_PARAMS.rel,
    review: searchParams.get('review') === 'true',
    lang: searchParams.get('lang') ?? null,
  };
}

/**
 * Simple region decoder - handles comma-separated values
 * The actual smart encoding/decoding is done by nuqs parser
 */
function decodeRegionsFromUrl(value: string): string[] {
  if (!value) return [];
  // Import the decode function from regions module
  try {
    const { decodeRegions } = require('../search-params/regions');
    return decodeRegions(value);
  } catch {
    // Fallback: simple comma split
    return value.split(',').filter(Boolean);
  }
}

export function SearchInitializer({ children }: SearchInitializerProps) {
  const router = useRouter();
  const routeParams = useParams<{ searchId: string }>();
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
    // Skip if no searchId (shouldn't happen on /results/[searchId] routes)
    if (!searchId) {
      setStatus('ready');
      return;
    }

    // Skip if searchParams is null (during SSR)
    if (!searchParams) {
      return;
    }
    
    // Only run initialization logic once when pending
    if (status !== 'pending') {
      return;
    }
    
    const existingEntry = getSearchResult(searchId);
    // Check if URL has any search-related params (q is always present with clearOnDefault: false)
    const hasUrlParams = searchParams.has('q') || searchParams.has('field') || searchParams.toString() !== '';
    
    // CASE 1: Unknown ID → Create new entry with new ID, redirect
    // This handles both shared links (with params) and direct URL access (no params)
    if (!existingEntry) {
      setStatus('redirecting');
      
      // Parse URL params (or use defaults for empty search)
      const parsedParams = hasUrlParams ? parseUrlParams(searchParams) : DEFAULT_SEARCH_PARAMS;
      const newEntry = paramsToSearchResult(parsedParams);
      const newId = addSearchResult(newEntry);
      
      // Build URL with params and redirect to new ID
      const params = searchResultToParams({ ...newEntry, id: newId } as any);
      router.replace(buildResultsUrl(newId, params));
      return;
    }
    
    // CASE 2: Known ID + has URL params → Add to queryHistory if query differs, update filters
    if (existingEntry && hasUrlParams) {
      const parsedParams = parseUrlParams(searchParams);
      
      // Check if params differ from stored state
      if (!paramsMatchState(parsedParams, existingEntry)) {
        // If query changed, add to query history within this entry
        if (parsedParams.q !== existingEntry.query) {
          addQueryToHistory(searchId, parsedParams.q);
        }
        
        // Update filter fields (query is already handled by addQueryToHistory if changed)
        // Note: We exclude 'count' because paramsToSearchResult always returns count: 0
        // and we don't want to overwrite the actual count from the store
        const updatedEntry = paramsToSearchResult(parsedParams);
        const { query, count, ...filterUpdates } = updatedEntry;
        updateSearchResult(searchId, filterUpdates);
      }
      
      // Either way, we're ready
      setStatus('ready');
      return;
    }
    
    // CASE 3: Known ID + no URL params → Restore params from storage to URL
    if (existingEntry && !hasUrlParams) {
      setStatus('redirecting');
      const params = searchResultToParams(existingEntry);
      router.replace(buildResultsUrl(searchId, params));
      return;
    }
    
    // CASE 4: Should not reach here, but mark as ready
    setStatus('ready');
  }, [searchId, status, getSearchResult, addSearchResult, updateSearchResult, addQueryToHistory, searchParams, router]);
  
  // After redirect completes, check if we can mark as ready
  useEffect(() => {
    if (status === 'redirecting' && searchParams) {
      const existingEntry = getSearchResult(searchId);
      // Check if URL has any search-related params (q is always present with clearOnDefault: false)
      const hasUrlParams = searchParams.has('q') || searchParams.has('field') || searchParams.toString() !== '';
      
      // Redirect complete when: entry exists and has URL params
      if (existingEntry && hasUrlParams) {
        setStatus('ready');
      }
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
