"use client";

import { useCallback, useMemo } from "react";
import { useBatchScreeningResponses } from "@/lib/ai/client/router";
import { useTransientScreeningStore } from "@/lib/store";
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
  canStart,
  onResults,
}: UseBatchScreeningOptions) {
  const { execute, isConfigured } = useBatchScreeningResponses();
  const { testIndexPerQuestion } = useTransientScreeningStore();

  // Compute batch key for deduplication
  const computeBatchKey = useCallback(
    (papersToProcess: Paper[], _context: { searchId: string }) => {
      const paperIds = Object.keys(missingResponses).sort();
      if (paperIds.length === 0) return null;

      const keyParts = paperIds.map((id) => {
        const questions = missingResponses[id] || [];
        const questionsWithIndex = questions
          .map((q) => `${q}#${testIndexPerQuestion[q] || 0}`)
          .sort();
        return `${id}:${questionsWithIndex.join(",")}`;
      });
      return keyParts.join("|");
    },
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
    resetDeps: [searchId],
    context,
    canStart,
    papers,
    createLoadingState,
    clearLoadingState,
  });

  return {
    loadingQuestions: loadingState,
    errors: errors as ScreeningError[],
    isConfigured,
  };
}
