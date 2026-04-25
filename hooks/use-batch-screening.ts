"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useBatchScreeningResponses } from "@/lib/ai/client/router";
import { useTransientScreeningStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast/use-app-toast";
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
  questionSetKey: string;
  canStart: boolean;
  onResults: (paperId: string, responses: Record<string, boolean | null>) => void;
}

function buildScreeningBatchKey(
  papersToProcess: Paper[],
  missingResponses: Record<string, string[]>,
  testIndexPerQuestion: Record<string, number>
): string | null {
  const paperIds = papersToProcess
    .map((paper) => paper.id)
    .filter((paperId) => (missingResponses[paperId]?.length ?? 0) > 0)
    .sort();

  if (paperIds.length === 0) return null;

  const keyParts = paperIds.map((id) => {
    const questions = missingResponses[id] || [];
    const questionsWithIndex = questions
      .map((question) => `${question}#${testIndexPerQuestion[question] || 0}`)
      .sort();
    return `${id}:${questionsWithIndex.join(",")}`;
  });

  return keyParts.join("|");
}

function isInsufficientCreditsScreeningError(error: ScreeningError): boolean {
  const normalized = error.error.toLowerCase();
  return (
    normalized.includes("ai_insufficient_credits") ||
    normalized.includes("aiinsufficientcreditserror") ||
    normalized.includes("insufficient credits") ||
    (normalized.includes("not enough") && normalized.includes("credits"))
  );
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
  const toast = useAppToast();
  const tc = useTranslations("common");
  const lastInsufficientCreditsToastKeyRef = useRef<string | null>(null);

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
  const testRunKey = useMemo(
    () =>
      Object.entries(testIndexPerQuestion)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([question, testIndex]) => `${question}:${testIndex}`)
        .join("|"),
    [testIndexPerQuestion]
  );

  // Stable context ID for O(1) comparison in batch operation
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

  const insufficientCreditsToastKey = useMemo(() => {
    const creditErrors = errors
      .filter(isInsufficientCreditsScreeningError)
      .map((error) => `${error.paperId}:${error.error}`)
      .sort();
    return creditErrors.length > 0 ? creditErrors.join("|") : null;
  }, [errors]);

  useEffect(() => {
    if (!insufficientCreditsToastKey) {
      lastInsufficientCreditsToastKeyRef.current = null;
      return;
    }
    if (lastInsufficientCreditsToastKeyRef.current === insufficientCreditsToastKey) {
      return;
    }

    lastInsufficientCreditsToastKeyRef.current = insufficientCreditsToastKey;
    toast.ai.failed(tc("screening"), {
      data: {
        code: "AI_INSUFFICIENT_CREDITS",
        message: "Insufficient credits for AI operation",
      },
    });
  }, [insufficientCreditsToastKey, toast, tc]);

  return {
    loadingQuestions: loadingState,
    errors: errors as ScreeningError[],
    isConfigured,
  };
}
