"use client";

import { useCallback, useMemo } from "react";
import { useBatchScreeningResponses } from "@/lib/ai/client/router";
import { useTransientScreeningStore } from "@/lib/store";
import { buildScreeningBatchKey } from "@/lib/screening-utils";
import { useBatchOperation } from "./use-batch-operation";

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
  /**
   * Stable identifier for the active question set. Changes whenever the
   * questions themselves change, so a question-set edit invalidates the
   * dedup ref and surfaces a new batch. Independent of testRunKey, which
   * folds in per-question test indices.
   */
  questionSetKey: string;
  canStart: boolean;
  onResults: (paperId: string, responses: Record<string, boolean | null>) => void;
}

/**
 * Hook that manages batch screening for a set of papers.
 * Uses the generic useBatchOperation factory for common batch processing logic.
 */
export function useBatchScreening({
  searchId,
  papers,
  missingResponses,
  questionSetKey,
  canStart,
  onResults,
}: UseBatchScreeningOptions) {
  const { execute, isConfigured } = useBatchScreeningResponses();
  const { testIndexPerQuestion } = useTransientScreeningStore();

  // Compute batch key for deduplication
  const computeBatchKey = useCallback(
    (papersToProcess: Paper[], _context: { searchId: string }) =>
      buildScreeningBatchKey(papersToProcess, missingResponses, testIndexPerQuestion),
    [missingResponses, testIndexPerQuestion]
  );

  // Filter papers that need screening
  const filterItemsNeedingProcessing = useCallback(
    (allPapers: Paper[], _context: { searchId: string }) => {
      return allPapers.filter((p) => missingResponses[p.id]?.length > 0);
    },
    [missingResponses]
  );

  // Build the input for execute
  const buildExecuteInput = useCallback(
    (papersToFetch: Paper[], _context: { searchId: string }) => {
      const questionsToFetch = [
        ...new Set(papersToFetch.flatMap((p) => missingResponses[p.id] || [])),
      ];
      return {
        papers: papersToFetch.map((p) => ({
          id: p.id,
          title: p.title || "",
          abstract: p.abstract || "",
        })),
        questions: questionsToFetch,
      };
    },
    [missingResponses]
  );

  // Handle results
  const handleResult = useCallback(
    (
      paperId: string,
      data: { responses: Record<string, boolean | null> },
      context: { searchId: string }
    ) => {
      if (context.searchId === searchId) {
        onResults(paperId, data.responses);
      }
    },
    [onResults, searchId]
  );

  // Create loading state (per-question for each paper)
  const createLoadingState = useCallback(
    (papersToProcess: Paper[]) => {
      const newLoadingQuestions: Record<string, Set<string>> = {};
      papersToProcess.forEach((p) => {
        newLoadingQuestions[p.id] = new Set(missingResponses[p.id] || []);
      });
      return newLoadingQuestions;
    },
    [missingResponses]
  );

  const clearLoadingState = useCallback(
    () => ({} as Record<string, Set<string>>),
    []
  );

  const context = useMemo(() => ({ searchId }), [searchId]);

  // testRunKey collapses the per-question test indices into a single
  // string. A "Test" click on a question bumps its index, which
  // invalidates the contextId and forces a fresh batch.
  const testRunKey = useMemo(
    () =>
      Object.entries(testIndexPerQuestion)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([question, testIndex]) => `${question}:${testIndex}`)
        .join("|"),
    [testIndexPerQuestion]
  );

  // Stable context ID for O(1) comparison in batch operation. Combines
  // searchId, questionSetKey, and testRunKey so any of: switching
  // searches, editing the question set, or toggling a test run, will
  // clear the dedup ref and force a fresh batch.
  const contextId = useMemo(
    () => [searchId, questionSetKey, testRunKey].join("::"),
    [searchId, questionSetKey, testRunKey]
  );

  const { loadingState, errors } = useBatchOperation<
    { papers: { id: string; title: string; abstract: string }[]; questions: string[] },
    { responses: Record<string, boolean | null> },
    { searchId: string },
    Record<string, Set<string>>
  >({
    execute,
    isConfigured,
    computeBatchKey,
    filterItemsNeedingProcessing,
    buildExecuteInput,
    handleResult,
    contextId,
    context,
    canStart,
    papers,
    retryFailedItems: false,
    createLoadingState,
    clearLoadingState,
  });

  return {
    loadingQuestions: loadingState,
    errors: errors as ScreeningError[],
    isConfigured,
  };
}
