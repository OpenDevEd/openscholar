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
 * A new search whose address asks a research question (`?question=`) and has no
 * query waits for AI to write its query, then goes on as in A. The redirect drops
 * the question from the address, so reloading never writes or pays for it again.
 *
 * Uses useEffect because the router cannot be called during render, and the
 * id is minted by the client-side history store (localStorage).
 */

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useEnhanceSearchQuery } from '@/lib/ai/client/router';
import { localeToLanguageCode } from '@/lib/i18n/locale-map';
import { useAppToast } from '@/lib/toast';
import { getEffectiveSearchId } from '../utils';
import { useSearchHistoryStore } from '../store';
import { searchResultToParams, type NewSearchResultData } from '../search-params/converters';
import { buildResultsUrl, parseSearchParamsFromUrl, readSharedOql, readUrlQuestion } from '../search-params';
import { OQL_FIELD } from '../openalex/oql';
import { resolveSearchInit } from './resolve-search-init';
import { useCopiedSearches } from './copied';
import type { SearchField, SearchResult } from '../types';

interface SearchInitializerProps {
  children: ReactNode;
  /** Told the ID of each search this makes, before the server has answered. */
  onMade?: (id: string) => void;
}

/**
 * Writes the query of a search made from a research question in its address, once the AI hook
 * knows who pays for it. An effect because nobody pressed anything: opening the address is the
 * request. It runs once however often React renders or re-runs it, and a person who has left by
 * the time it answers gets no search and isn't sent back. If it can't be written, the search
 * opens with no query and the question in its box, to try again from there.
 */
function QuestionSearch({ question, entry, onWritten }: { question: string; entry: NewSearchResultData; onWritten: (query: string) => void }) {
  const { execute, isReady } = useEnhanceSearchQuery();
  const locale = useLocale();
  const toast = useAppToast();
  const tToast = useTranslations('toast');
  const started = useRef(false);
  const left = useRef(false);

  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady || started.current) return;
    started.current = true;
    const write = async () => {
      let query = '';
      try {
        const result = await execute({
          query: question,
          language: entry.language ?? localeToLanguageCode(locale),
          syntax: entry.field === OQL_FIELD ? 'oql' : undefined,
          task: 'questionToQuery',
        });
        query = result.enhancedQuery;
      } catch (error) {
        console.error('Failed to convert research question:', error);
        if (!left.current) toast.ai.failed(tToast('questionConversion'), error);
      }
      if (!left.current) onWritten(query);
    };
    void write();
  }, [isReady, execute, question, entry, locale, toast, tToast, onWritten]);

  return null;
}

export function SearchInitializer({ children, onMade }: SearchInitializerProps) {
  const router = useWorkspaceRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchId = getEffectiveSearchId(pathname) ?? '';

  // Store methods
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addSearchResult = useSearchHistoryStore((state) => state.addSearchResult);
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  const addQueryToHistory = useSearchHistoryStore((state) => state.addQueryToHistory);

  const [status, setStatus] = useState<'pending' | 'writing' | 'redirecting' | 'ready'>('pending');
  const [unwritten, setUnwritten] = useState<{ address: string; question: string; entry: NewSearchResultData } | null>(null);
  const address = `${pathname}?${searchParams?.toString() ?? ''}`;
  // React re-runs an effect on mount in development, before the status it set has arrived.
  const decidedToCreate = useRef(false);

  const createSearch = useCallback((entry: NewSearchResultData, question: string) => {
    setStatus('redirecting');
    const newId = addSearchResult({
      ...entry,
      ...(question ? { questionHistory: [{ question, timestamp: new Date().toISOString() }] } : {}),
    });
    onMade?.(newId);
    router.replace(buildResultsUrl(newId, searchResultToParams({ ...entry, id: newId } as SearchResult)));
    return newId;
  }, [addSearchResult, onMade, router]);

  // Reconcile URL <-> stored history. Pure decision in resolveSearchInit();
  // this effect only performs the resulting side effects.
  useEffect(() => {
    if (!searchParams) return; // SSR
    // The address changed while its question was being written: what it says now decides.
    if (status === 'writing' && unwritten?.address !== address) {
      decidedToCreate.current = false;
      setUnwritten(null);
      setStatus('pending');
      return;
    }
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
        if (decidedToCreate.current) return;
        decidedToCreate.current = true;
        const question = readUrlQuestion(searchParams);
        if (question && !decision.entry.query.trim()) {
          setUnwritten({ address, question, entry: decision.entry });
          setStatus('writing');
          return;
        }
        const newId = createSearch(decision.entry, question);
        // A link that named a search this person can't open made them their own copy of it, and its page says so. An address that names one and carries no query of it copied nothing.
        if (searchId && parsedParams.q?.trim()) useCopiedSearches.setState((state) => ({ ids: [...state.ids, newId] }));
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
    unwritten,
    address,
    getSearchResult,
    createSearch,
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        {status === 'writing' && unwritten?.address === address && (
          <QuestionSearch
            question={unwritten.question}
            entry={unwritten.entry}
            onWritten={(query) => createSearch({ ...unwritten.entry, query }, unwritten.question)}
          />
        )}
      </div>
    );
  }

  return <>{children}</>;
}
