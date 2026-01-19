"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useBatchTranslations } from "@/lib/ai/client/router";
import { useTranslationStore } from "@/lib/store";

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

interface UseBatchTranslationOptions {
  searchId: string;
  papers: Paper[];
  selectedLanguage: string;
  canStart: boolean;
}

/**
 * Hook that manages batch translation for a set of papers.
 * 
 * Key anti-infinite-loop safeguards:
 * 1. Uses a stable batchKey derived from paper IDs + selectedLanguage
 * 2. Tracks fetched keys in a ref to prevent duplicate fetches
 * 3. Clears the ref on searchId change
 * 4. Only triggers when batchKey changes AND isn't already fetched
 */
export function useBatchTranslation({
  searchId,
  papers,
  selectedLanguage,
  canStart,
}: UseBatchTranslationOptions) {
  const { execute, isConfigured } = useBatchTranslations();
  const { getTranslation, setTranslation, setShowTranslated } = useTranslationStore();
  
  const [loadingPaperIds, setLoadingPaperIds] = useState<Set<string>>(new Set());
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);

  // Find papers that need translation
  const papersNeedingTranslation = useMemo(() => {
    if (!selectedLanguage || selectedLanguage === "en") return [];
    
    return papers.filter((paper) => {
      const existing = getTranslation(paper.id);
      // Needs translation if no translation exists or it's for a different language
      return !existing || existing.sourceLanguage !== selectedLanguage;
    });
  }, [papers, selectedLanguage, getTranslation]);

  // Create a stable key for deduplication
  const batchKey = useMemo(() => {
    if (papersNeedingTranslation.length === 0) return null;
    
    const paperIds = papersNeedingTranslation.map((p) => p.id).sort();
    return `${selectedLanguage}:${paperIds.join(",")}`;
  }, [papersNeedingTranslation, selectedLanguage]);

  // Stable callback for results
  const handleResults = useCallback(
    (paperId: string, translation: TranslationData) => {
      setTranslation(paperId, translation);
      setShowTranslated(paperId, true);
    },
    [setTranslation, setShowTranslated]
  );

  // Reset fetched keys when searchId or language changes
  useEffect(() => {
    fetchedKeysRef.current.clear();
    setLoadingPaperIds(new Set());
  }, [searchId, selectedLanguage]);

  // Main effect to trigger batch translation
  useEffect(() => {
    // Guard conditions
    if (!canStart || !isConfigured || !batchKey) return;
    if (!selectedLanguage || selectedLanguage === "en") return;
    if (fetchedKeysRef.current.has(batchKey)) return;
    if (isFetchingRef.current) return;
    if (papersNeedingTranslation.length === 0) return;

    // Mark as fetching
    fetchedKeysRef.current.add(batchKey);
    isFetchingRef.current = true;
    setLoadingPaperIds(new Set(papersNeedingTranslation.map((p) => p.id)));

    // Execute batch translation
    execute({
      papers: papersNeedingTranslation.map((p) => ({
        id: p.id,
        title: p.title || "",
        abstract: p.abstract || "",
      })),
      sourceLanguage: selectedLanguage,
    })
      .then(({ results, errors }) => {
        // Process results
        Object.entries(results).forEach(([paperId, data]) => {
          handleResults(paperId, data);
        });

        // Log errors but don't fail
        if (errors.length > 0) {
          console.warn("Batch translation had partial failures:", errors);
        }
      })
      .catch((error) => {
        console.error("Batch translation failed:", error);
        // Remove from fetched so it can be retried
        fetchedKeysRef.current.delete(batchKey);
      })
      .finally(() => {
        isFetchingRef.current = false;
        setLoadingPaperIds(new Set());
      });
  }, [
    batchKey,
    canStart,
    isConfigured,
    selectedLanguage,
    papersNeedingTranslation,
    execute,
    handleResults,
  ]);

  return { loadingPaperIds, isConfigured };
}
