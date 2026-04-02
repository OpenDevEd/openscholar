"use client";

import { createContext, useContext } from "react";
import { ScreeningResponses } from "@/lib/types";
import { useRatingsStore } from "@/lib/store";

export interface ScreeningContextValue {
  missingResponses?: Record<string, string[]>;
  loadingQuestions?: Record<string, Set<string>>;
  existingResponses?: ScreeningResponses;
  errors?: Array<{ paperId: string; error: string }>;
  setScreeningResponse?: (paperId: string, question: string, response: boolean) => void;
  setScreeningResponses?: (paperId: string, responses: Record<string, boolean | null>) => void;
  canStartScreening?: boolean;
}

export interface TranslationContextValue {
  loadingPaperIds?: Set<string>;
  errors?: Array<{ paperId: string; error: string }>;
  isConfigured?: boolean;
}

export const ScreeningContext = createContext<ScreeningContextValue>({});
export const TranslationContext = createContext<TranslationContextValue>({});

/**
 * Server-authoritative ratings from the database (openalexId → rating).
 * Provided on the library page where Convex query data is available.
 * Undefined on the search page (falls back to Zustand cache).
 */
export const ServerRatingsContext = createContext<Map<string, number> | undefined>(undefined);

/**
 * Resolves the effective rating for a paper.
 * DB (via ServerRatingsContext) wins when available; Zustand cache is the fallback.
 */
export function useEffectiveRating(paperId: string): number | undefined {
  const serverRatings = useContext(ServerRatingsContext);
  const cachedRating = useRatingsStore((state) => state.ratings[paperId]);
  return serverRatings?.get(paperId) ?? cachedRating;
}
