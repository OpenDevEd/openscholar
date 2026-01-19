"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useBatchScreeningResponses } from "@/lib/ai/client/router";
import { useTransientScreeningStore } from "@/lib/store";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

interface ScreeningError {
  paperId: string;
  error: string;
}

interface UseBatchScreeningOptions {
  searchId: string;
  papers: Paper[];
  missingResponses: Record<string, string[]>;
  canStart: boolean;
  onResults: (paperId: string, responses: Record<string, boolean | null>) => void;
}

/**
 * Hook that manages batch screening for a set of papers.
 * 
 * Key safeguards:
 * 1. Uses a stable batchKey derived from paper IDs + missing questions + testIndex
 * 2. Tracks fetched keys in a ref to prevent duplicate fetches
 * 3. Clears the ref on searchId change
 * 4. Uses searchIdAtFetchRef to prevent race conditions when searchId changes mid-flight
 * 5. Exposes errors for UI feedback
 */
export function useBatchScreening({
  searchId,
  papers,
  missingResponses,
  canStart,
  onResults,
}: UseBatchScreeningOptions) {
  const { execute, isConfigured } = useBatchScreeningResponses();
  const { testIndexPerQuestion } = useTransientScreeningStore();
  
  // Track loading state per-question for each paper
  const [loadingQuestions, setLoadingQuestions] = useState<Record<string, Set<string>>>({});
  const [errors, setErrors] = useState<ScreeningError[]>([]);
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);
  // Track the searchId at the time of fetch to prevent race conditions
  const searchIdAtFetchRef = useRef<string | null>(null);

  // Create a stable key for deduplication
  // This key changes when:
  // 1. Different papers need screening
  // 2. Different questions are missing for a paper
  // 3. testIndex changes (manual re-screen trigger)
  const batchKey = useMemo(() => {
    const paperIds = Object.keys(missingResponses).sort();
    if (paperIds.length === 0) return null;

    const keyParts = paperIds.map((id) => {
      const questions = missingResponses[id] || [];
      // Include testIndex in the key so re-screening generates a new key
      const questionsWithIndex = questions
        .map((q) => `${q}#${testIndexPerQuestion[q] || 0}`)
        .sort();
      return `${id}:${questionsWithIndex.join(",")}`;
    });
    return keyParts.join("|");
  }, [missingResponses, testIndexPerQuestion]);

  // Stable callback for results - checks searchId hasn't changed
  const handleResults = useCallback(
    (paperId: string, responses: Record<string, boolean | null>, expectedSearchId: string) => {
      // Only store if the searchId hasn't changed since we started the fetch
      if (expectedSearchId === searchId) {
        onResults(paperId, responses);
      }
    },
    [onResults, searchId]
  );

  // Reset fetched keys and errors when searchId changes
  useEffect(() => {
    fetchedKeysRef.current.clear();
    setLoadingQuestions({});
    setErrors([]);
    searchIdAtFetchRef.current = null;
  }, [searchId]);

  // Main effect to trigger batch screening
  useEffect(() => {
    // Guard conditions
    if (!canStart || !isConfigured || !batchKey) return;
    if (fetchedKeysRef.current.has(batchKey)) return;
    if (isFetchingRef.current) return;

    // Filter to papers that actually need screening
    const papersToFetch = papers.filter(
      (p) => missingResponses[p.id]?.length > 0
    );
    if (papersToFetch.length === 0) return;

    // Capture the searchId at fetch time to detect race conditions
    const searchIdAtFetch = searchId;
    searchIdAtFetchRef.current = searchIdAtFetch;

    // Mark as fetching
    fetchedKeysRef.current.add(batchKey);
    isFetchingRef.current = true;
    setErrors([]);
    
    // Set loading state per-question for each paper
    const newLoadingQuestions: Record<string, Set<string>> = {};
    papersToFetch.forEach((p) => {
      newLoadingQuestions[p.id] = new Set(missingResponses[p.id] || []);
    });
    setLoadingQuestions(newLoadingQuestions);

    // Only send the questions that are actually missing (union of all missing questions)
    const questionsToFetch = [...new Set(
      papersToFetch.flatMap((p) => missingResponses[p.id] || [])
    )];

    // Execute batch screening
    execute({
      papers: papersToFetch.map((p) => ({
        id: p.id,
        title: p.title || "",
        abstract: p.abstract || "",
      })),
      questions: questionsToFetch,
    })
      .then(({ results, errors: batchErrors }) => {
        // Check if searchId changed while we were fetching
        if (searchIdAtFetchRef.current !== searchIdAtFetch) {
          console.warn("SearchId changed during fetch, discarding results");
          return;
        }

        // Process results
        Object.entries(results).forEach(([paperId, data]) => {
          handleResults(paperId, data.responses, searchIdAtFetch);
        });

        // Store errors for UI feedback
        if (batchErrors.length > 0) {
          console.warn("Batch screening had partial failures:", batchErrors);
          setErrors(batchErrors);
        }
      })
      .catch((error) => {
        console.error("Batch screening failed:", error);
        // Remove from fetched so it can be retried
        fetchedKeysRef.current.delete(batchKey);
        setErrors([{ paperId: "batch", error: error.message || String(error) }]);
      })
      .finally(() => {
        isFetchingRef.current = false;
        setLoadingQuestions({});
      });
  }, [
    batchKey,
    canStart,
    isConfigured,
    execute,
    handleResults,
  ]);

  return { loadingQuestions, errors, isConfigured };
}
