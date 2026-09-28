'use client';

/**
 * SearchInitializer - Handles URL/History Reconciliation
 *
 * Runs once on mount and reconciles the URL with the stored search history.
 * The decision (create / restore / canonicalize / sync / ready) is computed by
 * the pure, unit-tested resolveSearchInit(); this component only applies it.
 *
 *  A. Missing OR unknown searchId → create a new entry, redirect to /results/[id].
 *     (bare /results always renders results; an empty query is a valid search.)
 *  B. Known id, no URL params → restore stored state to a canonical URL.
 *  C. Known id, URL params → sync the store if they changed, then canonicalize.
 *
 * Uses useEffect because the router cannot be called during render, and the
 * id is minted by the client-side history store (localStorage).
 */

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams, useParams, usePathname } from 'next/navigation';
import { useSearchHistoryStore } from '../store';
import { searchResultToParams } from '../search-params/converters';
import { buildResultsUrl, parseSearchParamsFromUrl, readSharedOql } from '../search-params';
import { OQL_FIELD } from '../openalex/oql';
import { resolveSearchInit } from './resolve-search-init';
import type { SearchField, SearchResult } from '../types';

interface SearchInitializerProps {
  children: ReactNode;
}

export function SearchInitializer({ children }: SearchInitializerProps) {
  const router = useRouter();
  const routeParams = useParams<{ searchId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchId = routeParams?.searchId ?? '';

  // Store methods
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addSearchResult = useSearchHistoryStore((state) => state.addSearchResult);
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  const addQueryToHistory = useSearchHistoryStore((state) => state.addQueryToHistory);

  const [status, setStatus] = useState<'pending' | 'redirecting' | 'ready'>('pending');

  // Reconcile URL <-> stored history. Pure decision in resolveSearchInit();
  // this effect only performs the resulting side effects.
  useEffect(() => {
    if (!searchParams) return; // SSR
    if (status !== 'pending') return;

    const urlParams = parseSearchParamsFromUrl(searchParams);
    // A shared OQL search carries its query in the link's fragment.
    const sharedOql = urlParams.field === OQL_FIELD ? readSharedOql(window.location.hash) : null;
    const parsedParams = sharedOql ? { ...urlParams, q: sharedOql } : urlParams;
    const hasExplicitParams = searchParams.toString() !== '';
    const existingEntry = searchId ? getSearchResult(searchId) : undefined;
    const currentUrl = `${pathname}${hasExplicitParams ? `?${searchParams.toString()}` : ''}`;

    const decision = resolveSearchInit({
      searchId,
      parsedParams,
      hasExplicitParams,
      existingEntry,
      currentUrl,
    });

    switch (decision.kind) {
      case 'create': {
        setStatus('redirecting');
        const newId = addSearchResult(decision.entry);
        const url = buildResultsUrl(
          newId,
          searchResultToParams({ ...decision.entry, id: newId } as SearchResult),
        );
        router.replace(url);
        return;
      }
      case 'redirect':
        setStatus('redirecting');
        router.replace(decision.url);
        return;
      case 'sync':
        if (decision.addQuery !== null) {
          addQueryToHistory(searchId, decision.addQuery, parsedParams.field as SearchField);
        }
        updateSearchResult(searchId, decision.filterUpdates);
        if (decision.redirectTo) {
          setStatus('redirecting');
          router.replace(decision.redirectTo);
          return;
        }
        setStatus('ready');
        return;
      case 'ready':
        setStatus('ready');
        return;
    }
  }, [
    searchId,
    status,
    getSearchResult,
    addSearchResult,
    updateSearchResult,
    addQueryToHistory,
    pathname,
    searchParams,
    router,
  ]);

  // After a redirect lands on a route with a known entry, mark ready.
  useEffect(() => {
    if (status !== 'redirecting' || !searchId) return;
    if (getSearchResult(searchId)) {
      setStatus('ready');
    }
  }, [status, searchId, searchParams, getSearchResult]);

  // Show loading while pending or redirecting.
  if (status !== 'ready') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return <>{children}</>;
}
