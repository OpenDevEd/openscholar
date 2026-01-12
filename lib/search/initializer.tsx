'use client';

/**
 * SearchInitializer - Handles Shared Link Logic
 * 
 * This component runs ONCE on mount and handles these scenarios:
 * 
 * 1. Shared link (unknown ID + URL params) → Create new history entry, redirect
 * 2. Direct access (known ID + no params) → Populate URL from history
 * 3. Normal case (known ID + params) → Just render children
 * 4. Empty state (unknown ID + no params) → Render children (empty state)
 * 
 * Uses useEffect to handle redirects (cannot call router during render).
 */

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useSearchHistoryStore } from '../store';
import { hasSearchParams } from './types';

interface SearchInitializerProps {
  children: ReactNode;
}

/**
 * Parse URL search params into our param format
 */
function parseSearchParams(searchParams: URLSearchParams): Record<string, any> {
  const params: Record<string, any> = {};
  
  // Parse each param according to its type
  params.q = searchParams.get('q') || '';
  params.field = searchParams.get('field') || 'title_and_abstract';
  params.sort = searchParams.get('sort') || 'relevance_score:desc';
  params.page = parseInt(searchParams.get('page') || '1', 10);
  params.yf = searchParams.get('yf') ? parseInt(searchParams.get('yf')!, 10) : null;
  params.yt = searchParams.get('yt') ? parseInt(searchParams.get('yt')!, 10) : null;
  params.df = searchParams.get('df') || null;
  params.dt = searchParams.get('dt') || null;
  params.ft = searchParams.get('ft') || 'year';
  params.rmin = parseInt(searchParams.get('rmin') || '0', 10);
  params.rmax = parseInt(searchParams.get('rmax') || '5', 10);
  params.rated = searchParams.get('rated') === 'true';
  params.cites = searchParams.get('cites') || '';
  params.citedBy = searchParams.get('citedBy') || '';
  params.rel = searchParams.get('rel') || '';
  params.review = searchParams.get('review') === 'true';
  params.lang = searchParams.get('lang') || null;
  
  // Parse arrays (reg and focus use special encoding)
  const regParam = searchParams.get('reg');
  params.reg = regParam ? regParam.split(',').filter(Boolean) : [];
  
  const focusParam = searchParams.get('focus');
  params.focus = focusParam ? focusParam.split(',').filter(Boolean) : [];
  
  return params;
}

/**
 * Convert parsed params to a history entry
 */
function paramsToHistoryEntry(params: Record<string, any>) {
  return {
    query: params.q || '',
    field: params.field || 'title_and_abstract',
    count: 0,
    sortBy: params.sort,
    filterType: params.ft,
    yearRange: params.yf && params.yt ? [params.yf, params.yt] as [number, number] : undefined,
    isYearRangeEnabled: !!(params.yf || params.yt),
    dateRange: params.df || params.dt ? {
      from: params.df ? new Date(params.df) : undefined,
      to: params.dt ? new Date(params.dt) : undefined,
    } : undefined,
    ratingRange: [params.rmin, params.rmax] as [number, number],
    onlyRatedPapers: params.rated,
    selectedRegions: params.reg || [],
    selectedCountryFocus: params.focus || [],
    citesItemId: params.cites || '',
    citedByItemId: params.citedBy || '',
    relatedToItemId: params.rel || '',
    reviewFilter: params.review || false,
    language: params.lang,
  };
}

/**
 * Convert a history entry to URL params
 */
function historyEntryToParams(entry: any): Record<string, any> {
  const params: Record<string, any> = {
    q: entry.query || '',
    field: entry.field || 'title_and_abstract',
    sort: entry.sortBy || 'relevance_score:desc',
    ft: entry.filterType || 'year',
  };
  
  // Only include non-default values
  if (entry.yearRange && entry.isYearRangeEnabled) {
    params.yf = entry.yearRange[0];
    params.yt = entry.yearRange[1];
  }
  
  if (entry.filterType === 'date' && entry.dateRange) {
    if (entry.dateRange.from) {
      params.df = entry.dateRange.from instanceof Date 
        ? entry.dateRange.from.toISOString().split('T')[0]
        : entry.dateRange.from;
    }
    if (entry.dateRange.to) {
      params.dt = entry.dateRange.to instanceof Date
        ? entry.dateRange.to.toISOString().split('T')[0]
        : entry.dateRange.to;
    }
  }
  
  if (entry.ratingRange && (entry.ratingRange[0] !== 0 || entry.ratingRange[1] !== 5)) {
    params.rmin = entry.ratingRange[0];
    params.rmax = entry.ratingRange[1];
  }
  
  if (entry.onlyRatedPapers) params.rated = true;
  if (entry.selectedRegions?.length > 0) params.reg = entry.selectedRegions;
  if (entry.selectedCountryFocus?.length > 0) params.focus = entry.selectedCountryFocus;
  if (entry.citesItemId) params.cites = entry.citesItemId;
  if (entry.citedByItemId) params.citedBy = entry.citedByItemId;
  if (entry.relatedToItemId) params.rel = entry.relatedToItemId;
  if (entry.reviewFilter) params.review = true;
  if (entry.language) params.lang = entry.language;
  
  return params;
}

/**
 * Build URL query string from params
 */
function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (value === false) return;
    if (value === '') return;
    if (Array.isArray(value)) {
      if (value.length > 0) {
        searchParams.set(key, value.join(','));
      }
    } else {
      searchParams.set(key, String(value));
    }
  });
  
  return searchParams.toString();
}

export function SearchInitializer({ children }: SearchInitializerProps) {
  const router = useRouter();
  const routeParams = useParams<{ searchId: string }>();
  const searchParams = useSearchParams();
  const searchId = routeParams?.searchId ?? '';
  
  // Get store methods
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addSearchResult = useSearchHistoryStore((state) => state.addSearchResult);
  
  // Track initialization state
  const [status, setStatus] = useState<'pending' | 'redirecting' | 'ready'>('pending');
  
  // Handle initialization in useEffect (cannot call router during render)
  useEffect(() => {
    // Skip if no searchId
    if (!searchId) {
      setStatus('ready');
      return;
    }
    
    // Only run initialization logic once when pending
    if (status === 'pending') {
      const existingEntry = getSearchResult(searchId);
      const parsedParams = parseSearchParams(searchParams);
      const hasParams = hasSearchParams(parsedParams);
      
      // CASE 1: Unknown ID + has URL params → Shared link
      // Create new history entry, redirect to new ID (preserving params)
      if (!existingEntry && hasParams) {
        setStatus('redirecting');
        const newEntry = paramsToHistoryEntry(parsedParams);
        const newId = addSearchResult(newEntry);
        
        // Redirect preserving all params
        const queryString = searchParams.toString();
        router.replace(`/results/${newId}?${queryString}`);
        return;
      }
      
      // CASE 2: Known ID + no URL params → Restore from history
      // Populate URL from stored entry
      if (existingEntry && !hasParams) {
        setStatus('redirecting');
        const params = historyEntryToParams(existingEntry);
        const queryString = buildQueryString(params);
        router.replace(`/results/${searchId}?${queryString}`);
        return;
      }
      
      // CASE 3 & 4: Normal case or empty state - ready to render
      setStatus('ready');
      return;
    }
    
    // After redirect completes, verify and mark as ready
    if (status === 'redirecting') {
      const existingEntry = getSearchResult(searchId);
      const parsedParams = parseSearchParams(searchParams);
      const hasParams = hasSearchParams(parsedParams);
      
      // Redirect complete: entry now exists with params
      if (existingEntry && hasParams) {
        setStatus('ready');
      }
    }
  }, [searchId, status, getSearchResult, addSearchResult, searchParams, router]);
  
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
