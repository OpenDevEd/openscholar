"use client";

import { useCallback, useMemo } from "react";
import { useBatchTranslations } from "@/lib/ai/client/router";
import { useTranslationStore } from "@/lib/store";
import { useBatchOperation } from "./use-batch-operation";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  sourceLanguage: string;
  isAlreadyInEnglish: boolean;
}

interface TranslationError {
  paperId: string;
  error: string;
}

interface UseBatchTranslationOptions {
  searchId: string;
  papers: Paper[];
  selectedLanguage: string;
  canStart: boolean;
}

/**
 * Hook that manages batch translation for a set of papers.
 * Uses the generic useBatchOperation factory for common batch processing logic.
 */
export function useBatchTranslation({
  searchId,
  papers,
  selectedLanguage,
  canStart,
}: UseBatchTranslationOptions) {
  const { execute, isConfigured } = useBatchTranslations();
  const { getTranslation, setTranslation, setShowTranslated } = useTranslationStore();

  // Filter papers that need translation
  const filterItemsNeedingProcessing = useCallback(
    (allPapers: Paper[], context: { selectedLanguage: string }) => {
      if (!context.selectedLanguage || context.selectedLanguage === "en") return [];

      return allPapers.filter((paper) => {
        const existing = getTranslation(paper.id);
        return !existing || existing.sourceLanguage !== context.selectedLanguage;
      });
    },
    [getTranslation]
  );

  // Compute batch key for deduplication
  const computeBatchKey = useCallback(
    (papersToProcess: Paper[], context: { selectedLanguage: string }) => {
      if (papersToProcess.length === 0) return null;

      const paperIds = papersToProcess.map((p) => p.id).sort();
      return `${context.selectedLanguage}:${paperIds.join(",")}`;
    },
    []
  );

  // Build the input for execute
  const buildExecuteInput = useCallback(
    (papersToFetch: Paper[], context: { selectedLanguage: string }) => ({
      papers: papersToFetch.map((p) => ({
        id: p.id,
        title: p.title || "",
        abstract: p.abstract || "",
      })),
      sourceLanguage: context.selectedLanguage,
    }),
    []
  );

  // Handle results
  const handleResult = useCallback(
    (paperId: string, translation: TranslationData, context: { selectedLanguage: string }) => {
      if (context.selectedLanguage === selectedLanguage) {
        setTranslation(paperId, translation);
        setShowTranslated(paperId, true);
      }
    },
    [setTranslation, setShowTranslated, selectedLanguage]
  );

  // Create loading state
  const createLoadingState = useCallback(
    (papersToProcess: Paper[]) => new Set(papersToProcess.map((p) => p.id)),
    []
  );

  const clearLoadingState = useCallback(() => new Set<string>(), []);

  const context = useMemo(
    () => ({ selectedLanguage }),
    [selectedLanguage]
  );

  const effectiveCanStart = canStart && !!selectedLanguage && selectedLanguage !== "en";

  const { loadingState, errors } = useBatchOperation<
    { papers: { id: string; title: string; abstract: string }[]; sourceLanguage: string },
    TranslationData,
    { selectedLanguage: string },
    Set<string>
  >({
    execute,
    isConfigured,
    computeBatchKey,
    filterItemsNeedingProcessing,
    buildExecuteInput,
    handleResult,
    resetDeps: [searchId, selectedLanguage],
    context,
    canStart: effectiveCanStart,
    papers,
    createLoadingState,
    clearLoadingState,
  });

  return {
    loadingPaperIds: loadingState,
    errors: errors as TranslationError[],
    isConfigured,
  };
}
