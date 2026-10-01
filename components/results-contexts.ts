"use client";

import { createContext, useContext } from "react";
import { ScreeningResponses } from "@/lib/types";
import { useRatingsStore } from "@/lib/store";

export interface ScreeningContextValue {
  missingResponses?: Record<string, string[]>;
  loadingQuestions?: Record<string, Set<string>>;
  existingResponses?: ScreeningResponses;
  setScreeningResponse?: (paperId: string, question: string, response: boolean) => void;
  setScreeningResponses?: (paperId: string, responses: Record<string, boolean | null>) => void;
  canStartScreening?: boolean;
  /**
   * Whether the screening panel is currently open for the active
   * search. Sourced from `useUIStore.screeningPanelOpenBySearchId`.
   * When false, the per-paper screening UI hides itself and the batch
   * action does not fire. Threaded through the context so paper-cards
   * read it via `useScreening` rather than each subscribing to the
   * Zustand store directly.
   */
  isScreeningPanelOpen?: boolean;
}

export interface TranslationContextValue {
  loadingPaperIds?: Set<string>;
  errors?: Array<{ paperId: string; error: string }>;
  isConfigured?: boolean;
  /** Number of visible papers that already have a translation for the active target language */
  translatedPaperCount?: number;
  /** Total number of visible papers eligible for translation */
  totalPaperCount?: number;
}

export const ScreeningContext = createContext<ScreeningContextValue>({});
export const TranslationContext = createContext<TranslationContextValue>({});

/**
 * Server-authoritative ratings from the database (openalexId → rating, or null for a
 * paper saved without one). Provided on the library page where Convex query data is
 * available. Undefined on the search page (falls back to Zustand cache).
 */
export const ServerRatingsContext = createContext<Map<string, number | null> | undefined>(undefined);

/**
 * Resolves the effective rating for a paper.
 * DB (via ServerRatingsContext) wins when available; Zustand cache is the fallback.
 */
export function useEffectiveRating(paperId: string): number | undefined {
  const serverRatings = useContext(ServerRatingsContext);
  const cachedRating = useRatingsStore((state) => state.ratings[paperId]);
  if (serverRatings?.has(paperId)) return serverRatings.get(paperId) ?? undefined;
  return cachedRating;
}
