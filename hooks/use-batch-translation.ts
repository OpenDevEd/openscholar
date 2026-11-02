"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useBatchTranslations } from "@/lib/ai/client/router";
import { useResultsTranslationSettingsStore, useTranslationStore } from "@/lib/store";
import { useBatchOperation } from "./use-batch-operation";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useLocale } from "next-intl";

function translationKey(paperId: string, targetLanguage: string): string {
  return `${paperId}:${targetLanguage}`;
}

// The server refuses a person's second batch while the first runs. Every use of this hook
// in the tab takes turns, as focus mode's control unmounts while its batch runs on.
// ponytail: per tab; a second tab is still refused, and retrying works.
let lastBatch: Promise<unknown> = Promise.resolve();
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const turn = lastBatch.then(run);
  lastBatch = turn.catch(() => {});
  return turn;
}

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
  manualRunRequestId: number;
  /** The whole batch was refused, such as for want of credits. */
  onBatchRejected?: (error: unknown) => void;
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
  manualRunRequestId,
  onBatchRejected,
}: UseBatchTranslationOptions) {
  const localeLanguage = localeToLanguageCode(useLocale());
  const targetLanguageOverride = useResultsTranslationSettingsStore((state) => state.targetLanguageOverride);
  const targetLanguage = targetLanguageOverride ?? localeLanguage;
  const autoTranslateResults = useResultsTranslationSettingsStore((state) => state.autoTranslateResults);
  const { execute, isConfigured } = useBatchTranslations();
  const { getTranslation, setShowTranslated } = useTranslationStore();
  // The run count outlives this hook, as the results page mounts again on a new search.
  // A run from before this mount isn't its own to start.
  const lastConsumedManualRunRequestIdRef = useRef(manualRunRequestId);

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

  // Compute batch key for deduplication. Each run has its own, so a run can send
  // papers again that an earlier one was refused.
  const computeBatchKey = useCallback(
    (papersToProcess: Paper[], context: BatchTranslationContext) => {
      if (papersToProcess.length === 0) return null;

      const paperIds = papersToProcess.map((p) => p.id).sort();
      return `${context.targetLanguage}:${manualRunRequestId}:${paperIds.join(",")}`;
    },
    [manualRunRequestId]
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

  // Show results in the language still chosen; executeBatch has stored them
  const handleResult = useCallback(
    (paperId: string, _translation: TranslationData, context: BatchTranslationContext) => {
      if (context.targetLanguage === targetLanguage) {
        setShowTranslated(paperId, true);
      }
    },
    [setShowTranslated, targetLanguage]
  );

  const executeBatch = useCallback<typeof execute>(
    async (input) => {
      const askedByRun = manualRunRequestId > lastConsumedManualRunRequestIdRef.current;
      try {
        return await inTurn(async () => {
          // Auto-translate may have been switched off while this waited, and nothing else asked for it.
          if (!askedByRun && !useResultsTranslationSettingsStore.getState().autoTranslateResults) {
            return { results: {}, errors: [] };
          }
          // The batch ahead may have translated some of these, so they're read at this turn.
          // Stored here, before the next turn reads them, in whichever language was paid for.
          const { getTranslation: stored, setTranslation } = useTranslationStore.getState();
          const papersLeft = input.papers.filter((paper) => !stored(paper.id, input.targetLanguage));
          if (papersLeft.length === 0) return { results: {}, errors: [] };
          const batch = await execute({ ...input, papers: papersLeft });
          for (const [paperId, translation] of Object.entries(batch.results)) {
            setTranslation(paperId, { ...translation, targetLanguage: input.targetLanguage });
          }
          return batch;
        });
      } catch (error) {
        onBatchRejected?.(error);
        throw error;
      } finally {
        // A run ends when its batch settles, either way, so it doesn't carry on to the next
        // papers that show up. A language picked meanwhile carries it over to that language.
        const latestOverride = useResultsTranslationSettingsStore.getState().targetLanguageOverride;
        if ((latestOverride ?? localeLanguage) === input.targetLanguage) {
          lastConsumedManualRunRequestIdRef.current = manualRunRequestId;
        }
      }
    },
    [execute, localeLanguage, manualRunRequestId, onBatchRejected]
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
    !isSearchLoading &&
    (autoTranslateResults || hasPendingManualRun);

  // All-cached path: when the user clicked "Translate" but every visible
  // paper already has a translation cached, no batch fires and
  // `handleResult` never runs. This effect consumes the manual-run id in
  // that case so a subsequent unrelated render with the same request id
  // doesn't keep `hasPendingManualRun=true` indefinitely.
  const papersNeedingTranslation = useMemo(
    () => papers.filter((paper) => !getTranslation(paper.id, targetLanguage)),
    [papers, getTranslation, targetLanguage]
  );

  useEffect(() => {
    if (
      hasPendingManualRun &&
      papersNeedingTranslation.length === 0 &&
      effectiveCanStart
    ) {
      lastConsumedManualRunRequestIdRef.current = manualRunRequestId;
    }
  }, [hasPendingManualRun, papersNeedingTranslation.length, effectiveCanStart, manualRunRequestId]);

  // Reactive count of papers already translated for the current target language.
  // Uses a store selector so it re-renders when new translations land.
  const translatedPaperCount = useTranslationStore(
    useCallback(
      (state) =>
        papers.filter(
          (p) => state.translations[translationKey(p.id, targetLanguage)] != null
        ).length,
      [papers, targetLanguage]
    )
  );

  const { loadingState, errors } = useBatchOperation<
    { papers: { id: string; title: string; abstract: string }[]; targetLanguage?: string },
    TranslationData,
    BatchTranslationContext,
    Set<string>
  >({
    execute: executeBatch,
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
    translatedPaperCount,
    totalPaperCount: papers.length,
  };
}
