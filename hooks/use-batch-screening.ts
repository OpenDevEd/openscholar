"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useBatchScreeningResponses } from "@/lib/ai/client/router";
import { useTransientScreeningStore } from "@/lib/store";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

interface UseBatchScreeningOptions {
  searchId: string;
  papers: Paper[];
  screeningQuestions: string[];
  missingResponses: Record<string, string[]>;
  canStart: boolean;
  onResults: (paperId: string, responses: Record<string, boolean | null>) => void;
}

/**
 * Hook that manages batch screening for a set of papers.
 * 
 * Key anti-infinite-loop safeguards:
 * 1. Uses a stable batchKey derived from paper IDs + missing questions + testIndex
 * 2. Tracks fetched keys in a ref to prevent duplicate fetches
 * 3. Clears the ref on searchId change
 * 4. Only triggers when batchKey changes AND isn't already fetched
 */
export function useBatchScreening({
  searchId,
  papers,
  screeningQuestions,
  missingResponses,
  canStart,
  onResults,
}: UseBatchScreeningOptions) {
  const { execute, isConfigured } = useBatchScreeningResponses();
  const { testIndexPerQuestion } = useTransientScreeningStore();
  
  // Track loading state per-question for each paper
  const [loadingQuestions, setLoadingQuestions] = useState<Record<string, Set<string>>>({});
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);

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

  // Stable callback for results
  const handleResults = useCallback(
    (paperId: string, responses: Record<string, boolean | null>) => {
      onResults(paperId, responses);
    },
    [onResults]
  );

  // Reset fetched keys when searchId changes
  useEffect(() => {
    fetchedKeysRef.current.clear();
    setLoadingQuestions({});
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

    // Mark as fetching
    fetchedKeysRef.current.add(batchKey);
    isFetchingRef.current = true;
    
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
      .then(({ results, errors }) => {
        // Process results
        Object.entries(results).forEach(([paperId, data]) => {
          handleResults(paperId, data.responses);
        });

        // Log errors but don't fail
        if (errors.length > 0) {
          console.warn("Batch screening had partial failures:", errors);
        }
      })
      .catch((error) => {
        console.error("Batch screening failed:", error);
        // Remove from fetched so it can be retried
        fetchedKeysRef.current.delete(batchKey);
      })
      .finally(() => {
        isFetchingRef.current = false;
        setLoadingQuestions({});
      });
  }, [
    batchKey,
    canStart,
    isConfigured,
    papers,
    screeningQuestions,
    missingResponses,
    execute,
    handleResults,
  ]);

  return { loadingQuestions, isConfigured };
}
