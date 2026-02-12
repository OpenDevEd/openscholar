"use client";

import { useCallback, useMemo } from "react";
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
  sourceLanguage: string;
  noTranslationNeeded: boolean;
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
  targetLanguage?: string;
}

/**
 * Hook that manages batch translation for a set of papers.
 * Uses the generic useBatchOperation factory for common batch processing logic.
 */
interface BatchTranslationContext {
  selectedLanguage: string;
  targetLanguage: string;
}

export function useBatchTranslation({
  searchId,
  papers,
  selectedLanguage,
  canStart,
  targetLanguage: targetLanguageProp,
}: UseBatchTranslationOptions) {
  const locale = useLocale();
  const targetLanguage = targetLanguageProp ?? localeToLanguageCode(locale);
  const { execute, isConfigured } = useBatchTranslations();
  const { getTranslation, setTranslation, setShowTranslated } = useTranslationStore();

  // Filter papers that need translation (only when a language is selected)
  const filterItemsNeedingProcessing = useCallback(
    (allPapers: Paper[], context: BatchTranslationContext) => {
      if (!context.selectedLanguage) return [];

      return allPapers.filter((paper) => {
        const existing = getTranslation(paper.id, context.selectedLanguage, context.targetLanguage);
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
      return `${context.selectedLanguage}:${context.targetLanguage}:${paperIds.join(",")}`;
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
      sourceLanguage: context.selectedLanguage,
      targetLanguage: context.targetLanguage,
    }),
    []
  );

  // Handle results
  const handleResult = useCallback(
    (paperId: string, translation: TranslationData, context: BatchTranslationContext) => {
      if (context.selectedLanguage === selectedLanguage && context.targetLanguage === targetLanguage) {
        setTranslation(paperId, { ...translation, targetLanguage: context.targetLanguage });
        setShowTranslated(paperId, true);
      }
    },
    [setTranslation, setShowTranslated, selectedLanguage, targetLanguage]
  );

  // Create loading state
  const createLoadingState = useCallback(
    (papersToProcess: Paper[]) => new Set(papersToProcess.map((p) => p.id)),
    []
  );

  const clearLoadingState = useCallback(() => new Set<string>(), []);

  const context = useMemo<BatchTranslationContext>(
    () => ({ selectedLanguage, targetLanguage }),
    [selectedLanguage, targetLanguage]
  );

  // Stable context ID for O(1) comparison in batch operation
  const contextId = `${searchId}:${selectedLanguage}:${targetLanguage}`;

  const effectiveCanStart = canStart && !!selectedLanguage;

  const { loadingState, errors } = useBatchOperation<
    { papers: { id: string; title: string; abstract: string }[]; sourceLanguage: string; targetLanguage?: string },
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
    createLoadingState,
    clearLoadingState,
  });

  return {
    loadingPaperIds: loadingState,
    errors: errors as TranslationError[],
    isConfigured,
  };
}
