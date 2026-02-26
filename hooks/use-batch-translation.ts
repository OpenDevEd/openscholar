"use client";

import { useCallback, useMemo, useRef } from "react";
import { useBatchTranslations } from "@/lib/ai/client/router";
import { useTranslationStore } from "@/lib/store";
import { useBatchOperation } from "./use-batch-operation";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useLocale } from "next-intl";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  noTranslationNeeded: boolean;
}

interface TranslationError {
  paperId: string;
  error: string;
}

interface UseBatchTranslationOptions {
  searchId: string;
  papers: Paper[];
  canStart: boolean;
  /** When true, blocks results translation (e.g. search refetch in progress) */
  isSearchLoading?: boolean;
  autoTranslateResults: boolean;
  manualRunRequestId: number;
  targetLanguageOverride: string | null;
}

/**
 * Hook that manages batch translation for a set of papers.
 * Uses the generic useBatchOperation factory for common batch processing logic.
 */
interface BatchTranslationContext {
  targetLanguage: string;
}

export function useBatchTranslation({
  searchId,
  papers,
  canStart,
  isSearchLoading = false,
  autoTranslateResults,
  manualRunRequestId,
  targetLanguageOverride,
}: UseBatchTranslationOptions) {
  const locale = useLocale();
  const targetLanguage = targetLanguageOverride ?? localeToLanguageCode(locale);
  const { execute, isConfigured, isPlanEntitled } = useBatchTranslations();
  const { getTranslation, setTranslation, setShowTranslated } = useTranslationStore();
  const lastConsumedManualRunRequestIdRef = useRef(0);

  // Filter papers that need translation
  const filterItemsNeedingProcessing = useCallback(
    (allPapers: Paper[], context: BatchTranslationContext) => {
      return allPapers.filter((paper) => {
        const existing = getTranslation(paper.id, context.targetLanguage);
        return !existing;
      });
    },
    [getTranslation]
  );

  // Compute batch key for deduplication
  const computeBatchKey = useCallback(
    (papersToProcess: Paper[], context: BatchTranslationContext) => {
      if (papersToProcess.length === 0) return null;

      const paperIds = papersToProcess.map((p) => p.id).sort();
      return `${context.targetLanguage}:${paperIds.join(",")}`;
    },
    []
  );

  // Build the input for execute
  const buildExecuteInput = useCallback(
    (papersToFetch: Paper[], context: BatchTranslationContext) => ({
      papers: papersToFetch.map((p) => ({
        id: p.id,
        title: p.title || "",
        abstract: p.abstract || "",
      })),
      targetLanguage: context.targetLanguage,
    }),
    []
  );

  // Handle results
  const handleResult = useCallback(
    (paperId: string, translation: TranslationData, context: BatchTranslationContext) => {
      if (context.targetLanguage === targetLanguage) {
        setTranslation(paperId, { ...translation, targetLanguage: context.targetLanguage });
        setShowTranslated(paperId, true);
      }
    },
    [setTranslation, setShowTranslated, targetLanguage]
  );

  // Create loading state
  const createLoadingState = useCallback(
    (papersToProcess: Paper[]) => new Set(papersToProcess.map((p) => p.id)),
    []
  );

  const clearLoadingState = useCallback(() => new Set<string>(), []);

  const context = useMemo<BatchTranslationContext>(
    () => ({ targetLanguage }),
    [targetLanguage]
  );

  // Stable context ID for O(1) comparison in batch operation
  const contextId = `${searchId}:${targetLanguage}`;
  const hasPendingManualRun =
    manualRunRequestId > lastConsumedManualRunRequestIdRef.current;

  const effectiveCanStart =
    canStart &&
    isPlanEntitled &&
    !isSearchLoading &&
    (autoTranslateResults || hasPendingManualRun);

  const beforeExecute = useCallback(() => {
    if (!autoTranslateResults) {
      lastConsumedManualRunRequestIdRef.current = manualRunRequestId;
    }
  }, [autoTranslateResults, manualRunRequestId]);

  const { loadingState, errors } = useBatchOperation<
    { papers: { id: string; title: string; abstract: string }[]; targetLanguage?: string },
    TranslationData,
    BatchTranslationContext,
    Set<string>
  >({
    execute,
    isConfigured,
    computeBatchKey,
    filterItemsNeedingProcessing,
    buildExecuteInput,
    handleResult,
    contextId,
    context,
    canStart: effectiveCanStart,
    papers,
    beforeExecute,
    createLoadingState,
    clearLoadingState,
  });

  return {
    loadingPaperIds: loadingState,
    errors: errors as TranslationError[],
    isConfigured,
    isPlanEntitled,
  };
}
