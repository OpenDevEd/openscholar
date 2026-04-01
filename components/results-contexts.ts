"use client";

import { createContext } from "react";
import { ScreeningResponses } from "@/lib/types";

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
