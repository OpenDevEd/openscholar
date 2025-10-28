import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DateRange } from "react-day-picker";
import type { SearchField, QueryHistoryEntry, QuestionHistoryEntry, ScreeningQuestionEntry, ScreeningResponses } from './types';
import { DEFAULT_YEAR_RANGE, MIN_YEAR } from './constants';
import { format } from 'date-fns'

// Fallback UUID generator for mobile compatibility
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for older browsers/mobile
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export type SearchResult = {
  id: string;
  query: string;
  queryHistory: QueryHistoryEntry[];
  questionHistory: QuestionHistoryEntry[];
  screeningQuestions: ScreeningQuestionEntry[];
  screeningResponses: ScreeningResponses;
  count: number;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType?: "date" | "year";
  isYearRangeEnabled?: boolean;
  sortBy?: string;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
  language?: string; // ISO 639-1 language code (e.g., 'en', 'es', 'fr')
  createdAt: string;
  updatedAt: string;
};

interface RatingsState {
  ratings: Record<string, number>
  setRating: (paperId: string, rating: number | null) => void
  clearRatings: () => void
}

interface SearchHistoryState {
  searchHistory: SearchResult[]
  addSearchResult: (result: Omit<SearchResult, 'id' | 'createdAt' | 'updatedAt' | 'queryHistory' | 'screeningQuestions' | 'screeningResponses' | 'questionHistory'> & { questionHistory?: QuestionHistoryEntry[] }) => string
  updateSearchResult: (id: string, updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>) => void
  addQueryToHistory: (id: string, query: string) => void
  addQuestionToHistory: (id: string, question: string) => void
  addScreeningQuestion: (id: string, question: string, locked?: boolean) => void
  updateScreeningQuestion: (id: string, questionIndex: number, updates: Partial<ScreeningQuestionEntry>) => void
  removeScreeningQuestion: (id: string, questionIndex: number) => void
  clearScreeningQuestions: (id: string) => void
  setScreeningResponse: (searchId: string, paperId: string, question: string, response: boolean | null) => void
  setScreeningResponses: (searchId: string, paperId: string, responses: Record<string, boolean | null>) => void
  getScreeningResponse: (searchId: string, paperId: string, question: string) => boolean | null | undefined
  clearScreeningResponses: (searchId: string, paperId?: string) => void
  removeScreeningQuestionFromAllPapers: (searchId: string, question: string) => void
  getSearchResult: (id: string) => SearchResult | undefined
  removeSearchResult: (index: number) => void
  clearSearchHistory: () => void
  migrateSearchResult: (result: SearchResult) => string
  importSearchHistory: (data: any[]) => number
}

interface UIState {
  isDialogOpen: boolean
  loadingResultIndex: number | null
  isFocusModeOpen: boolean
  focusModeIndex: number
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsFocusModeOpen: (open: boolean) => void
  setFocusModeIndex: (index: number) => void
}

interface ResultsState {
  currentPage: number
  expandedAbstracts: Record<string, boolean>
  resultsFilter: string
  setCurrentPage: (page: number) => void
  toggleAbstract: (paperId: string) => void
  setResultsFilter: (filter: string) => void
  clearResults: () => void
}

interface FocusModeSettingsState {
  fontSize: 'sm' | 'base' | 'lg' | 'xl'
  maxContentWidth: 'narrow' | 'medium' | 'wide' | 'full'
  lineHeight: 'tight' | 'normal' | 'relaxed'
  showMetadata: boolean
  compactMode: boolean
  setFontSize: (size: 'sm' | 'base' | 'lg' | 'xl') => void
  setMaxContentWidth: (width: 'narrow' | 'medium' | 'wide' | 'full') => void
  setLineHeight: (height: 'tight' | 'normal' | 'relaxed') => void
  setShowMetadata: (show: boolean) => void
  setCompactMode: (compact: boolean) => void
  resetSettings: () => void
}

interface KeywordExpansionState {
  keywords: Record<string, string>
  addKeyword: (shorthand: string, expansion: string) => void
  updateKeyword: (shorthand: string, expansion: string) => void
  removeKeyword: (shorthand: string) => void
  clearKeywords: () => void
  expandQuery: (query: string) => { expandedQuery: string; warnings: string[] }
}

export type AIProvider = 'openai' | 'google';

interface AIConfigState {
  provider: AIProvider;
  apiKey: string;
  /** cumulative USD spent on AI calls (client-side estimate) */
  dollarsUsed: number;
  /** optional spending limit; 0 means unlimited */
  budget: number;
  /** update / set a new budget */
  setBudget: (budget: number) => void;
  /** increment the running cost tracker */
  addDollarsUsed: (amount: number) => void;
  /** reset the tracker back to zero */
  resetDollarsUsed: () => void;
  setProvider: (provider: AIProvider) => void;
  setApiKey: (apiKey: string) => void;
  clearConfig: () => void;
}
// UI Component States
interface ThemeToggleState {
  mounted: boolean
  setMounted: (mounted: boolean) => void
}

interface CurrentQueryState {
  currentQuery: string
  setCurrentQuery: (query: string) => void
}

interface CurrentQuestionState {
  currentQuestion: string
  setCurrentQuestion: (question: string) => void
}

interface KeywordExpansionDialogState {
  isOpen: boolean
  newShorthand: string
  newExpansion: string
  currentKeyword: string
  suggestedQuery: string
  setIsOpen: (open: boolean) => void
  setNewShorthand: (shorthand: string) => void
  setNewExpansion: (expansion: string) => void
  setCurrentKeyword: (keyword: string) => void
  setSuggestedQuery: (query: string) => void
  resetForm: () => void
}

interface CountryRegionPickerState {
  isOpen: boolean
  expandedNodes: Set<string>
  searchQuery: string
  setIsOpen: (open: boolean) => void
  setExpandedNodes: (nodes: Set<string>) => void
  setSearchQuery: (query: string) => void
  toggleNode: (nodeId: string) => void
  resetPicker: () => void
}

interface SearchHistoryUIState {
  currentPage: number
  setCurrentPage: (page: number) => void
}

// Removed NavbarState - using currentQuery from ResultsStore as single source of truth
// Removed PageContentState - using currentQuery from ResultsStore as single source of truth

interface ResultsPageContentState {
  isSidebarOpen: boolean
  setIsSidebarOpen: (open: boolean) => void
}

interface AIEnhanceState {
  isDialogOpen: boolean
  setIsDialogOpen: (open: boolean) => void
}

interface AIConfigDialogState {
  isEnhancing: boolean
  enhancedPreview: {
    enhancedQuery: string
    explanation: string
  } | null
  setIsEnhancing: (enhancing: boolean) => void
  setEnhancedPreview: (preview: { enhancedQuery: string; explanation: string } | null) => void
}

interface YearRangePickerState {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

// Screening interfaces
export type ScreeningQuestionType = 'boolean' | 'number' | 'array' | 'string';

export interface ScreeningQuestion {
  id: string;
  key: string;
  type: ScreeningQuestionType;
  question: string;
}

export interface ScreeningDocument {
  id: string;
  title: string;
  publication_year?: number;
  abstract?: string;
  doi?: string;
  authorships?: Array<{
    author: {
      display_name: string;
    };
  }>;
  open_access?: {
    is_oa: boolean;
    oa_url?: string;
  };
  /** Zotero group id if imported from Zotero */
  zotero_group_id?: string;
  /** Direct link to open document in Zotero app */
  zotero_uri?: string;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count?: number;
  referenced_works_count?: number;
  addedAt: string;
  // Store the original OpenAlex work data
  originalWork?: any;
  /** source of import, e.g., 'zotero' */
  source?: string;
}

export interface ScreeningResult {
  documentId: string;
  answers: Record<string, any>; // key -> answer value
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  pdfStatus?: 'used' | 'metadata' | 'error';
  pdfErrorMessage?: string;
  aiMetadata?: {
    reasoning: string;
    confidence: number;
    flags: string[];
    provider: string;
    model: string;
    processedAt: string;
  };
  cost?: number; // USD cost for this screening
}

interface ScreeningState {
  documents: ScreeningDocument[];
  questions: ScreeningQuestion[];
  results: ScreeningResult[];
  isScreeningStarted: boolean;
  currentDocumentIndex: number;
  
  // Document management
  addDocument: (document: Omit<ScreeningDocument, 'addedAt'>) => void;
  addDocumentFromWork: (work: any) => void;
  removeDocument: (documentId: string) => void;
  clearDocuments: () => void;
  
  // Question management
  addQuestion: (question: Omit<ScreeningQuestion, 'id'>) => void;
  updateQuestion: (questionId: string, updates: Partial<Omit<ScreeningQuestion, 'id'>>) => void;
  removeQuestion: (questionId: string) => void;
  clearQuestions: () => void;
  importQuestionsFromText: (text: string) => { success: boolean; imported: number; errors: string[] };
  
  // Screening process
  startScreening: () => void;
  stopScreening: () => void;
  resetScreening: () => void;
  
  // Results management
  saveAnswer: (documentId: string, questionKey: string, answer: any) => void;
  completeDocumentScreening: (documentId: string) => void;
  getDocumentResult: (documentId: string) => ScreeningResult | undefined;
  addAIScreeningResults: (results: ScreeningResult[]) => void;
  
  // Navigation
  goToNextDocument: () => void;
  goToPreviousDocument: () => void;
  setCurrentDocument: (index: number) => void;
}

// Zotero configuration store
interface ZoteroConfigState {
  zoteroApiKey: string;
  zoteroGroupId: string;
  setZoteroApiKey: (key: string) => void;
  setZoteroGroupId: (id: string) => void;
}
// Review store for managing review workflow steps
interface ReviewStoreState {
  step: number;
  setStep: (step: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  resetStep: () => void;
}


// Translation Store - for storing translation data by paper ID
interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  sourceLanguage: string;
  isAlreadyInEnglish: boolean;
}

interface TranslationState {
  translations: Record<string, TranslationData>;
  showTranslations: Record<string, boolean>;
  setTranslation: (id: string, data: TranslationData) => void;
  getTranslation: (id: string) => TranslationData | null;
  getShowTranslated: (id: string) => boolean;
  setShowTranslated: (id: string, show: boolean) => void;
  clearTranslation: (id: string) => void;
  clearAllTranslations: () => void;
}


// Server actions (fire-and-forget, do not await)
import {
  // Ratings
  upsertRating as saUpsertRating,
  clearRatings as saClearRatings,
  // Searches
  createSearch as saCreateSearch,
  updateSearch as saUpdateSearch,
  addSearchQuery as saAddSearchQuery,
  addSearchQuestion as saAddSearchQuestion,
  addSearchScreeningQuestion as saAddSearchScreeningQuestion,
  clearSearchScreeningQuestions as saClearSearchScreeningQuestions,
  upsertSearchScreeningResponse as saUpsertSearchScreeningResponse,
  upsertSearchScreeningResponses as saUpsertSearchScreeningResponses,
  clearSearchScreeningResponses as saClearSearchScreeningResponses,
  removeSearchScreeningQuestionFromAllPapers as saRemoveScreeningQuestionFromAllPapers,
  deleteSearch as saDeleteSearch,
  clearSearches as saClearSearches,
  importSearches as saImportSearches,
  // Focus mode settings
  upsertFocusModeSettings as saUpsertFocusModeSettings,
  resetFocusModeSettings as saResetFocusModeSettings,
  // Keywords
  upsertKeyword as saUpsertKeyword,
  removeKeyword as saRemoveKeyword,
  clearKeywords as saClearKeywords,
  // AI config
  setAIProvider as saSetAIProvider,
  setAIKeyCiphertext as saSetAIKeyCiphertext,
  setAIBudget as saSetAIBudget,
  addAIDollarsUsed as saAddAIDollarsUsed,
  resetAIDollarsUsed as saResetAIDollarsUsed,
  clearAIConfig as saClearAIConfig,
  // User screening questions (library)
  clearUserScreeningQuestions as saClearUserScreeningQuestions,
  addUserScreeningQuestion as saAddUserScreeningQuestion,
} from '@/db/actions';



// Helpers
const toIsoOrNull = (d: unknown): string | null => {
  if (!d) return null;
  try {
    if (typeof d === 'string') return new Date(d).toISOString();
    // @ts-ignore
    if (d instanceof Date) return d.toISOString();
    return new Date(String(d)).toISOString();
  } catch {
    return null;
  }
};

const normalizeDateRange = (
  dateRange?: DateRange
):
  | { from?: string | null; to?: string | null }
  | null
  | undefined => {
  if (!dateRange) return null;
  return {
    from: toIsoOrNull(dateRange.from ?? null),
    to: toIsoOrNull(dateRange.to ?? null),
  };
};

interface RatingsState {
  ratings: Record<string, number>;
  setRating: (paperId: string, rating: number | null) => void;
  clearRatings: () => void;
}

interface SearchHistoryState {
  searchHistory: SearchResult[];
  addSearchResult: (
    result: Omit<
      SearchResult,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'queryHistory'
      | 'screeningQuestions'
      | 'screeningResponses'
      | 'questionHistory'
    > & { questionHistory?: QuestionHistoryEntry[] }
  ) => string;
  updateSearchResult: (
    id: string,
    updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>
  ) => void;
  addQueryToHistory: (id: string, query: string) => void;
  addQuestionToHistory: (id: string, question: string) => void;
  addScreeningQuestion: (
    id: string,
    question: string,
    locked?: boolean
  ) => void;
  updateScreeningQuestion: (
    id: string,
    questionIndex: number,
    updates: Partial<ScreeningQuestionEntry>
  ) => void;
  removeScreeningQuestion: (id: string, questionIndex: number) => void;
  clearScreeningQuestions: (id: string) => void;
  setScreeningResponse: (
    searchId: string,
    paperId: string,
    question: string,
    response: boolean | null
  ) => void;
  setScreeningResponses: (
    searchId: string,
    paperId: string,
    responses: Record<string, boolean | null>
  ) => void;
  getScreeningResponse: (
    searchId: string,
    paperId: string,
    question: string
  ) => boolean | null | undefined;
  clearScreeningResponses: (searchId: string, paperId?: string) => void;
  removeScreeningQuestionFromAllPapers: (
    searchId: string,
    question: string
  ) => void;
  getSearchResult: (id: string) => SearchResult | undefined;
  removeSearchResult: (index: number) => void;
  clearSearchHistory: () => void;
  migrateSearchResult: (result: SearchResult) => string;
  importSearchHistory: (data: any[]) => number;
}

interface UIState {
  isDialogOpen: boolean;
  loadingResultIndex: number | null;
  isFocusModeOpen: boolean;
  focusModeIndex: number;
  setIsDialogOpen: (open: boolean) => void;
  setLoadingResultIndex: (index: number | null) => void;
  setIsFocusModeOpen: (open: boolean) => void;
  setFocusModeIndex: (index: number) => void;
}

interface ResultsState {
  currentPage: number;
  expandedAbstracts: Record<string, boolean>;
  resultsFilter: string;
  setCurrentPage: (page: number) => void;
  toggleAbstract: (paperId: string) => void;
  setResultsFilter: (filter: string) => void;
  clearResults: () => void;
}

interface FocusModeSettingsState {
  fontSize: 'sm' | 'base' | 'lg' | 'xl';
  maxContentWidth: 'narrow' | 'medium' | 'wide' | 'full';
  lineHeight: 'tight' | 'normal' | 'relaxed';
  showMetadata: boolean;
  compactMode: boolean;
  setFontSize: (size: 'sm' | 'base' | 'lg' | 'xl') => void;
  setMaxContentWidth: (width: 'narrow' | 'medium' | 'wide' | 'full') => void;
  setLineHeight: (height: 'tight' | 'normal' | 'relaxed') => void;
  setShowMetadata: (show: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  resetSettings: () => void;
}

interface KeywordExpansionState {
  keywords: Record<string, string>;
  addKeyword: (shorthand: string, expansion: string) => void;
  updateKeyword: (shorthand: string, expansion: string) => void;
  removeKeyword: (shorthand: string) => void;
  clearKeywords: () => void;
  expandQuery: (query: string) => { expandedQuery: string; warnings: string[] };
}

interface AIConfigState {
  provider: AIProvider;
  apiKey: string;
  dollarsUsed: number;
  budget: number;
  setBudget: (budget: number) => void;
  addDollarsUsed: (amount: number) => void;
  resetDollarsUsed: () => void;
  setProvider: (provider: AIProvider) => void;
  setApiKey: (apiKey: string) => void;
  clearConfig: () => void;
}

export const useRatingsStore = create<RatingsState>()(
  persist(
    (set) => ({
      ratings: {},
      setRating: (paperId: string, rating: number | null) => {
        set((state) => {
          if (rating === null) {
            const { [paperId]: _, ...rest } = state.ratings;
            return { ratings: rest };
          }
          return {
            ratings: {
              ...state.ratings,
              [paperId]: rating,
            },
          };
        });
        // Background server sync
        saUpsertRating(paperId, rating).catch(() => {});
      },
      clearRatings: () => {
        set({ ratings: {} });
        // Background server sync
        saClearRatings().catch(() => {});
      },
    }),
    {
      name: 'paper-ratings-store',
    }
  )
);

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      searchHistory: [],
      addSearchResult: (result) => {
        const id = generateUUID();
        const nowIso = new Date().toISOString();
        const newResult: SearchResult = {
          ...result,
          id,
          queryHistory: [{ query: result.query, timestamp: nowIso }],
          questionHistory: result.questionHistory || [],
          screeningQuestions: [],
          screeningResponses: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        set((state) => ({
          searchHistory: [newResult, ...state.searchHistory],
        }));

        // Background server sync
        saCreateSearch({
          id,
          query: result.query,
          count: result.count ?? 0,
          field: result.field,
          dateRange: normalizeDateRange(result.dateRange) ?? null,
          yearRange: result.yearRange ?? null,
          filterType: result.filterType ?? null,
          isYearRangeEnabled: result.isYearRangeEnabled ?? false,
          sortBy: result.sortBy ?? null,
          selectedRegions: result.selectedRegions ?? null,
          selectedCountryFocus: result.selectedCountryFocus ?? null,
          ratingRange: result.ratingRange ?? null,
          onlyRatedPapers: result.onlyRatedPapers ?? false,
          citesItemId: result.citesItemId ?? null,
          citedByItemId: result.citedByItemId ?? null,
          relatedToItemId: result.relatedToItemId ?? null,
          reviewFilter: result.reviewFilter ?? null,
          language: result.language ?? null,
        }).catch(() => {});

        return id;
      },
      updateSearchResult: (id, updates) => {
        const nowIso = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? { ...item, ...updates, updatedAt: nowIso }
              : item
          ),
        }));

        // Prepare server patch
        const patch: any = { ...updates };
        if ('dateRange' in updates) {
          patch.dateRange = normalizeDateRange(
            updates.dateRange as DateRange | undefined
          );
        }
        // Background server sync
        saUpdateSearch(id, patch).catch(() => {});
      },
      addQueryToHistory: (id, query) => {
        const nowIso = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  query,
                  queryHistory: [
                    ...item.queryHistory,
                    { query, timestamp: nowIso },
                  ],
                  updatedAt: nowIso,
                }
              : item
          ),
        }));
        // Background server sync
        saAddSearchQuery(id, query).catch(() => {});
      },
      addQuestionToHistory: (id, question) => {
        const nowIso = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  questionHistory: [
                    ...item.questionHistory,
                    { question, timestamp: nowIso },
                  ],
                  updatedAt: nowIso,
                }
              : item
          ),
        }));
        // Background server sync
        saAddSearchQuestion(id, question).catch(() => {});
      },
      addScreeningQuestion: (id, question, locked = false) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: [
                    ...(item.screeningQuestions || []),
                    { question, locked },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
        // Background server sync (append)
        saAddSearchScreeningQuestion({ searchId: id, question, locked }).catch(
          () => {}
        );
      },
      updateScreeningQuestion: (id, questionIndex, updates) => {
        let nextQuestions: ScreeningQuestionEntry[] = [];
        set((state) => {
          const res = state.searchHistory.map((item) => {
            if (item.id !== id) return item;
            const updated = (item.screeningQuestions || []).map((q, idx) =>
              idx === questionIndex ? { ...q, ...updates } : q
            );
            nextQuestions = updated;
            return {
              ...item,
              screeningQuestions: updated,
              updatedAt: new Date().toISOString(),
            };
          });
          return { searchHistory: res };
        });
        // Background server sync (rebuild entire set for simplicity)
        saClearSearchScreeningQuestions(id)
          .then(() => {
            nextQuestions.forEach((q) =>
              saAddSearchScreeningQuestion({
                searchId: id,
                question: q.question,
                locked: q.locked ?? false,
              }).catch(() => {})
            );
          })
          .catch(() => {});
      },
      removeScreeningQuestion: (id, questionIndex) => {
        let nextQuestions: ScreeningQuestionEntry[] = [];
        set((state) => {
          const res = state.searchHistory.map((item) => {
            if (item.id !== id) return item;
            const updated = (item.screeningQuestions || []).filter(
              (_, idx) => idx !== questionIndex
            );
            nextQuestions = updated;
            return {
              ...item,
              screeningQuestions: updated,
              updatedAt: new Date().toISOString(),
            };
          });
          return { searchHistory: res };
        });
        // Background server sync (rebuild)
        saClearSearchScreeningQuestions(id)
          .then(() => {
            nextQuestions.forEach((q) =>
              saAddSearchScreeningQuestion({
                searchId: id,
                question: q.question,
                locked: q.locked ?? false,
              }).catch(() => {})
            );
          })
          .catch(() => {});
      },
      clearScreeningQuestions: (id) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: [],
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
        // Background server sync
        saClearSearchScreeningQuestions(id).catch(() => {});
      },
      setScreeningResponse: (searchId, paperId, question, response) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: {
                    ...item.screeningResponses,
                    [paperId]: {
                      ...(item.screeningResponses?.[paperId] || {}),
                      [question]: response,
                    },
                  },
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
        // Background server sync
        saUpsertSearchScreeningResponse({
          searchId,
          paperId,
          question,
          response,
        }).catch(() => {});
      },
      setScreeningResponses: (searchId, paperId, responses) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: {
                    ...item.screeningResponses,
                    [paperId]: {
                      ...(item.screeningResponses?.[paperId] || {}),
                      ...responses,
                    },
                  },
                }
              : item
          ),
        }));
        // Background server sync (batch)
        saUpsertSearchScreeningResponses({ searchId, paperId, responses }).catch(
          () => {}
        );
      },
      getScreeningResponse: (searchId, paperId, question) => {
        const searchResult = get().searchHistory.find(
          (item) => item.id === searchId
        );
        return searchResult?.screeningResponses?.[paperId]?.[question];
      },
      clearScreeningResponses: (searchId, paperId) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: paperId
                    ? Object.fromEntries(
                        Object.entries(item.screeningResponses || {}).filter(
                          ([key]) => key !== paperId
                        )
                      )
                    : {},
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
        // Background server sync
        saClearSearchScreeningResponses(searchId, paperId).catch(() => {});
      },
      removeScreeningQuestionFromAllPapers: (searchId, question) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: Object.fromEntries(
                    Object.entries(item.screeningResponses || {}).map(
                      ([paperId, responses]) => [
                        paperId,
                        Object.fromEntries(
                          Object.entries(responses).filter(
                            ([q]) => q !== question
                          )
                        ),
                      ]
                    )
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
        // Background server sync
        saRemoveScreeningQuestionFromAllPapers(searchId, question).catch(
          () => {}
        );
      },
      getSearchResult: (id) => {
        return get().searchHistory.find((item) => item.id === id);
      },
      removeSearchResult: (index) =>
        set((state) => {
          const toRemove = state.searchHistory[index];
          if (toRemove) {
            // Background server sync
            saDeleteSearch(toRemove.id).catch(() => {});
          }
          return {
            searchHistory: state.searchHistory.filter((_, i) => i !== index),
          };
        }),
      clearSearchHistory: () => {
        set({ searchHistory: [] });
        // Background server sync
        saClearSearches().catch(() => {});
      },
      migrateSearchResult: (result) => {
        if (!result.id) {
          const id = generateUUID();
          const now = new Date().toISOString();
          const migratedResult: SearchResult = {
            ...result,
            id,
            questionHistory: result.questionHistory || [],
            screeningQuestions: result.screeningQuestions || [],
            screeningResponses: result.screeningResponses || {},
            createdAt: now,
            updatedAt: now,
          };

          set((state) => ({
            searchHistory: state.searchHistory.map((item) =>
              item === result ? migratedResult : item
            ),
          }));

          // Optional: push to server as a new search
          saCreateSearch({
            id,
            query: migratedResult.query,
            count: migratedResult.count ?? 0,
            field: migratedResult.field,
            dateRange: normalizeDateRange(migratedResult.dateRange) ?? null,
            yearRange: migratedResult.yearRange ?? null,
            filterType: migratedResult.filterType ?? null,
            isYearRangeEnabled: migratedResult.isYearRangeEnabled ?? false,
            sortBy: migratedResult.sortBy ?? null,
            selectedRegions: migratedResult.selectedRegions ?? null,
            selectedCountryFocus: migratedResult.selectedCountryFocus ?? null,
            ratingRange: migratedResult.ratingRange ?? null,
            onlyRatedPapers: migratedResult.onlyRatedPapers ?? false,
            citesItemId: migratedResult.citesItemId ?? null,
            citedByItemId: migratedResult.citedByItemId ?? null,
            relatedToItemId: migratedResult.relatedToItemId ?? null,
            reviewFilter: migratedResult.reviewFilter ?? null,
            language: migratedResult.language ?? null,
          }).catch(() => {});
          return id;
        }
        return result.id;
      },
      importSearchHistory: (data) => {
        let importedCount = 0;
        const validItems: SearchResult[] = [];

        data.forEach((item) => {
          const query = item.search_query || item.query || '';
          const count = item.count || 0;
          const field = item.field || 'title_and_abstract';

          if (
            query === undefined ||
            query === null ||
            typeof count !== 'number'
          ) {
            return;
          }

          const id = generateUUID();
          const now = new Date().toISOString();
          const newResult: SearchResult = {
            id,
            query,
            queryHistory: [{ query, timestamp: now }],
            questionHistory: [],
            screeningQuestions: [],
            screeningResponses: {},
            count,
            field: field as SearchField,
            createdAt: now,
            updatedAt: now,
          };

          validItems.push(newResult);
          importedCount++;
        });

        if (validItems.length > 0) {
          set((state) => ({
            searchHistory: [...validItems, ...state.searchHistory],
          }));
        }

        // Background server sync (raw payload)
        saImportSearches(data).catch(() => {});

        return importedCount;
      },
    }),
    {
      name: 'search-history-store',
      version: 6, // Keep for local migrations if needed
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          const currentYear = new Date().getFullYear();
          const defaultYearRange = [MIN_YEAR, currentYear];

          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                if (item.yearRange && Array.isArray(item.yearRange)) {
                  const [fromYear, toYear] = item.yearRange;
                  const isCustomRange =
                    fromYear !== defaultYearRange[0] ||
                    toYear !== defaultYearRange[1];

                  return {
                    ...item,
                    isYearRangeEnabled: isCustomRange,
                  };
                }

                return {
                  ...item,
                  isYearRangeEnabled: false,
                };
              });
          }
        }

        if (version <= 1) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                return {
                  ...item,
                  queryHistory: item.queryHistory || [
                    {
                      query: item.query || '',
                      timestamp: item.createdAt || new Date().toISOString(),
                    },
                  ],
                };
              });
          }
        }

        if (version <= 2) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                return {
                  ...item,
                  questionHistory: item.questionHistory || [],
                };
              });
          }
        }

        if (version <= 3) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                return {
                  ...item,
                  screeningQuestions: item.screeningQuestions || [],
                };
              });
          }
        }

        if (version <= 4) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                return {
                  ...item,
                  screeningResponses: item.screeningResponses || {},
                };
              });
          }
        }

        if (version <= 5) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory =
              persistedState.searchHistory.map((item: any) => {
                return {
                  ...item,
                  language: item.language || undefined,
                };
              });
          }
        }

        return persistedState;
      },
    }
  )
);

export const useUIStore = create<UIState>((set) => ({
  isDialogOpen: false,
  loadingResultIndex: null,
  isFocusModeOpen: false,
  focusModeIndex: 0,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
  setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
  setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
  setFocusModeIndex: (index) => set({ focusModeIndex: index }),
}));

export const useResultsStore = create<ResultsState>((set) => ({
  currentPage: 1,
  expandedAbstracts: {},
  resultsFilter: '',
  setCurrentPage: (page) => set({ currentPage: page }),
  toggleAbstract: (paperId) =>
    set((state) => ({
      expandedAbstracts: {
        ...state.expandedAbstracts,
        [paperId]: !state.expandedAbstracts[paperId],
      },
    })),
  setResultsFilter: (filter) => set({ resultsFilter: filter, currentPage: 1 }),
  clearResults: () =>
    set({
      currentPage: 1,
      expandedAbstracts: {},
      resultsFilter: '',
    }),
}));

export const useFocusModeSettingsStore = create<FocusModeSettingsState>()(
  persist(
    (set, get) => ({
      fontSize: 'base',
      maxContentWidth: 'medium',
      lineHeight: 'normal',
      showMetadata: true,
      compactMode: false,
      setFontSize: (size) => {
        set({ fontSize: size });
        saUpsertFocusModeSettings({ fontSize: size }).catch(() => {});
      },
      setMaxContentWidth: (width) => {
        set({ maxContentWidth: width });
        saUpsertFocusModeSettings({ maxContentWidth: width }).catch(() => {});
      },
      setLineHeight: (height) => {
        set({ lineHeight: height });
        saUpsertFocusModeSettings({ lineHeight: height }).catch(() => {});
      },
      setShowMetadata: (show) => {
        set({ showMetadata: show });
        saUpsertFocusModeSettings({ showMetadata: show }).catch(() => {});
      },
      setCompactMode: (compact) => {
        set({ compactMode: compact });
        saUpsertFocusModeSettings({ compactMode: compact }).catch(() => {});
      },
      resetSettings: () => {
        set({
          fontSize: 'base',
          maxContentWidth: 'medium',
          lineHeight: 'normal',
          showMetadata: true,
          compactMode: false,
        });
        saResetFocusModeSettings().catch(() => {});
      },
    }),
    {
      name: 'focus-mode-settings-store',
    }
  )
);

export const useKeywordExpansionStore = create<KeywordExpansionState>()(
  persist(
    (set, get) => ({
      keywords: {},
      addKeyword: (shorthand, expansion) => {
        set((state) => ({
          keywords: {
            [shorthand]: expansion,
            ...state.keywords,
          },
        }));
        saUpsertKeyword(shorthand, expansion).catch(() => {});
      },
      updateKeyword: (shorthand, expansion) => {
        set((state) => ({
          keywords: {
            ...state.keywords,
            [shorthand]: expansion,
          },
        }));
        saUpsertKeyword(shorthand, expansion).catch(() => {});
      },
      removeKeyword: (shorthand) => {
        set((state) => {
          const { [shorthand]: _, ...rest } = state.keywords;
          return { keywords: rest };
        });
        saRemoveKeyword(shorthand).catch(() => {});
      },
      clearKeywords: () => {
        set({ keywords: {} });
        saClearKeywords().catch(() => {});
      },
      expandQuery: (query) => {
        const { keywords } = get();
        const warnings: string[] = [];
        const expandedQuery = query.replace(
          /(\w[\w-]*)\.\.\./g,
          (match, keyword) => {
            const expansion = keywords[keyword];
            if (expansion) {
              return expansion;
            } else {
              warnings.push(`Bookmark "${keyword}" not found`);
              return match;
            }
          }
        );
        return { expandedQuery, warnings };
      },
    }),
    {
      name: 'keyword-expansion-store',
    }
  )
);

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set) => ({
      provider: 'openai',
      apiKey: '',
      dollarsUsed: 0,
      budget: 0,
      setBudget: (budget) => {
        set({ budget });
        saSetAIBudget(budget).catch(() => {});
      },
      addDollarsUsed: (amount) =>
        set((state) => {
          const next = state.dollarsUsed + amount;
          // background sync
          saAddAIDollarsUsed(amount).catch(() => {});
          return { dollarsUsed: next };
        }),
      resetDollarsUsed: () => {
        set({ dollarsUsed: 0 });
        saResetAIDollarsUsed().catch(() => {});
      },
      setProvider: (provider) => {
        set({ provider });
        saSetAIProvider(provider).catch(() => {});
      },
      setApiKey: (apiKey) => {
        set({ apiKey });
        // Send plaintext; server should encrypt
        saSetAIKeyCiphertext(apiKey).catch(() => {});
      },
      clearConfig: () => {
        set({ provider: 'openai', apiKey: '', dollarsUsed: 0, budget: 0 });
        saClearAIConfig().catch(() => {});
      },
    }),
    {
      name: 'ai-config-storage',
    }
  )
);

// UI Component States
interface ThemeToggleState {
  mounted: boolean;
  setMounted: (mounted: boolean) => void;
}

interface CurrentQueryState {
  currentQuery: string;
  setCurrentQuery: (query: string) => void;
}

interface CurrentQuestionState {
  currentQuestion: string;
  setCurrentQuestion: (question: string) => void;
}

interface KeywordExpansionDialogState {
  isOpen: boolean;
  newShorthand: string;
  newExpansion: string;
  currentKeyword: string;
  suggestedQuery: string;
  setIsOpen: (open: boolean) => void;
  setNewShorthand: (shorthand: string) => void;
  setNewExpansion: (expansion: string) => void;
  setCurrentKeyword: (keyword: string) => void;
  setSuggestedQuery: (query: string) => void;
  resetForm: () => void;
}

interface CountryRegionPickerState {
  isOpen: boolean;
  expandedNodes: Set<string>;
  searchQuery: string;
  setIsOpen: (open: boolean) => void;
  setExpandedNodes: (nodes: Set<string>) => void;
  setSearchQuery: (query: string) => void;
  toggleNode: (nodeId: string) => void;
  resetPicker: () => void;
}

interface SearchHistoryUIState {
  currentPage: number;
  setCurrentPage: (page: number) => void;
}

// Removed NavbarState - using currentQuery from ResultsStore as single source of truth
// Removed PageContentState - using currentQuery from ResultsStore as single source of truth

interface ResultsPageContentState {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
}

interface AIEnhanceState {
  isDialogOpen: boolean;
  setIsDialogOpen: (open: boolean) => void;
}

interface AIConfigDialogState {
  isEnhancing: boolean;
  enhancedPreview: {
    enhancedQuery: string;
    explanation: string;
  } | null;
  setIsEnhancing: (enhancing: boolean) => void;
  setEnhancedPreview: (
    preview: { enhancedQuery: string; explanation: string } | null
  ) => void;
}

interface YearRangePickerState {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export interface ScreeningQuestion {
  id: string;
  key: string;
  type: ScreeningQuestionType;
  question: string;
}

export interface ScreeningDocument {
  id: string;
  title: string;
  publication_year?: number;
  abstract?: string;
  doi?: string;
  authorships?: Array<{
    author: {
      display_name: string;
    };
  }>;
  open_access?: {
    is_oa: boolean;
    oa_url?: string;
  };
  /** Zotero group id if imported from Zotero */
  zotero_group_id?: string;
  /** Direct link to open document in Zotero app */
  zotero_uri?: string;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count?: number;
  referenced_works_count?: number;
  addedAt: string;
  // Store the original OpenAlex work data
  originalWork?: any;
  /** source of import, e.g., 'zotero' */
  source?: string;
}

export interface ScreeningResult {
  documentId: string;
  answers: Record<string, any>; // key -> answer value
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  pdfStatus?: 'used' | 'metadata' | 'error';
  pdfErrorMessage?: string;
  aiMetadata?: {
    reasoning: string;
    confidence: number;
    flags: string[];
    provider: string;
    model: string;
    processedAt: string;
  };
  cost?: number; // USD cost for this screening
}

interface ScreeningState {
  documents: ScreeningDocument[];
  questions: ScreeningQuestion[];
  results: ScreeningResult[];
  isScreeningStarted: boolean;
  currentDocumentIndex: number;

  // Document management
  addDocument: (document: Omit<ScreeningDocument, 'addedAt'>) => void;
  addDocumentFromWork: (work: any) => void;
  removeDocument: (documentId: string) => void;
  clearDocuments: () => void;

  // Question management
  addQuestion: (question: Omit<ScreeningQuestion, 'id'>) => void;
  updateQuestion: (
    questionId: string,
    updates: Partial<Omit<ScreeningQuestion, 'id'>>
  ) => void;
  removeQuestion: (questionId: string) => void;
  clearQuestions: () => void;
  importQuestionsFromText: (
    text: string
  ) => { success: boolean; imported: number; errors: string[] };

  // Screening process
  startScreening: () => void;
  stopScreening: () => void;
  resetScreening: () => void;

  // Results management
  saveAnswer: (documentId: string, questionKey: string, answer: any) => void;
  completeDocumentScreening: (documentId: string) => void;
  getDocumentResult: (documentId: string) => ScreeningResult | undefined;
  addAIScreeningResults: (results: ScreeningResult[]) => void;

  // Navigation
  goToNextDocument: () => void;
  goToPreviousDocument: () => void;
  setCurrentDocument: (index: number) => void;
}

export const useThemeToggleStore = create<ThemeToggleState>((set) => ({
  mounted: false,
  setMounted: (mounted) => set({ mounted }),
}));

export const useCurrentQueryStore = create<CurrentQueryState>((set) => ({
  currentQuery: '',
  setCurrentQuery: (query) => set({ currentQuery: query }),
}));

export const useCurrentQuestionStore = create<CurrentQuestionState>((set) => ({
  currentQuestion: '',
  setCurrentQuestion: (question) => set({ currentQuestion: question }),
}));

export const useKeywordExpansionDialogStore =
  create<KeywordExpansionDialogState>((set) => ({
    isOpen: false,
    newShorthand: '',
    newExpansion: '',
    currentKeyword: '',
    suggestedQuery: '',
    setIsOpen: (open) => set({ isOpen: open }),
    setNewShorthand: (shorthand) => set({ newShorthand: shorthand }),
    setNewExpansion: (expansion) => set({ newExpansion: expansion }),
    setCurrentKeyword: (keyword) => set({ currentKeyword: keyword }),
    setSuggestedQuery: (query) => set({ suggestedQuery: query }),
    resetForm: () =>
      set({
        newShorthand: '',
        newExpansion: '',
        currentKeyword: '',
        suggestedQuery: '',
      }),
  }));

export const useCountryRegionPickerStore =
  create<CountryRegionPickerState>((set) => ({
    isOpen: false,
    expandedNodes: new Set(['world']),
    searchQuery: '',
    setIsOpen: (open) => set({ isOpen: open }),
    setExpandedNodes: (nodes) => set({ expandedNodes: nodes }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    toggleNode: (nodeId) =>
      set((state) => {
        const newExpanded = new Set(state.expandedNodes);
        if (newExpanded.has(nodeId)) {
          newExpanded.delete(nodeId);
        } else {
          newExpanded.add(nodeId);
        }
        return { expandedNodes: newExpanded };
      }),
    resetPicker: () =>
      set({
        isOpen: false,
        expandedNodes: new Set(['world']),
        searchQuery: '',
      }),
  }));

export const useSearchHistoryUIStore = create<SearchHistoryUIState>((set) => ({
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),
}));

// Removed useNavbarStore - using currentQuery from ResultsStore as single source of truth
// Removed usePageContentStore - using currentQuery from ResultsStore as single source of truth

export const useResultsPageContentStore =
  create<ResultsPageContentState>((set) => ({
    isSidebarOpen: false,
    setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
  }));

export const useScreeningStore = create<ScreeningState>()(
  persist(
    (set, get) => ({
      documents: [],
      questions: [],
      results: [],
      isScreeningStarted: false,
      currentDocumentIndex: 0,

      // Document management
      addDocument: (document) =>
        set((state) => {
          const existingDoc = state.documents.find(
            (doc) =>
              doc.id === document.id || doc.originalWork?.id === document.id
          );
          if (existingDoc) {
            return state;
          }

          const newDocument: ScreeningDocument = {
            ...document,
            id:
              document.id ||
              `doc_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
            addedAt: new Date().toISOString(),
          };
          return { documents: [...state.documents, newDocument] };
        }),

      // Add document from OpenAlex Work
      addDocumentFromWork: (work: any) =>
        set((state) => {
          const existingDoc = state.documents.find(
            (doc) => doc.id === work.id || doc.originalWork?.id === work.id
          );
          if (existingDoc) {
            return state;
          }

          const newDocument: ScreeningDocument = {
            id: work.id,
            title: work.title,
            publication_year: work.publication_year,
            abstract: work.abstract,
            doi: work.doi,
            authorships: work.authorships,
            open_access: work.open_access,
            primary_location: work.primary_location,
            cited_by_count: work.cited_by_count,
            referenced_works_count: work.referenced_works_count,
            addedAt: new Date().toISOString(),
            originalWork: work,
          };
          return { documents: [...state.documents, newDocument] };
        }),

      removeDocument: (documentId) =>
        set((state) => ({
          documents: state.documents.filter((doc) => doc.id !== documentId),
          results: state.results.filter(
            (result) => result.documentId !== documentId
          ),
        })),

      clearDocuments: () => set({ documents: [], results: [] }),

      // Question management (local workflow questions, not the user library)
      addQuestion: (question) =>
        set((state) => {
          const newQuestion: ScreeningQuestion = {
            ...question,
            id: `q_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          };
          return { questions: [...state.questions, newQuestion] };
        }),

      updateQuestion: (questionId, updates) =>
        set((state) => ({
          questions: state.questions.map((q) =>
            q.id === questionId ? { ...q, ...updates } : q
          ),
        })),

      removeQuestion: (questionId) =>
        set((state) => ({
          questions: state.questions.filter((q) => q.id !== questionId),
        })),

      clearQuestions: () => set({ questions: [] }),

      importQuestionsFromText: (text) => {
        const lines = text
          .trim()
          .split('\n')
          .filter((line) => line.trim());
        const errors: string[] = [];
        let imported = 0;

        const newQuestions: ScreeningQuestion[] = [];
        const existingKeys = new Set(
          get().questions.map((q: ScreeningQuestion) => q.key.toLowerCase())
        );

        lines.forEach((line, index) => {
          const parts = line.split('|');
          if (parts.length !== 3) {
            errors.push(
              `Line ${index + 1}: Expected format "key|type|question" but got "${line}"`
            );
            return;
          }

          const [key, type, question] = parts.map((part) => part.trim());

          if (!key || !type || !question) {
            errors.push(
              `Line ${index + 1}: All fields (key, type, question) are required`
            );
            return;
          }

          if (!['boolean', 'number', 'array', 'string'].includes(type)) {
            errors.push(
              `Line ${index + 1}: Invalid type "${type}". Must be one of: boolean, number, array, string`
            );
            return;
          }

          if (
            existingKeys.has(key.toLowerCase()) ||
            newQuestions.some(
              (q) => q.key.toLowerCase() === key.toLowerCase()
            )
          ) {
            errors.push(`Line ${index + 1}: Duplicate key "${key}"`);
            return;
          }

          newQuestions.push({
            id: `q_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}_${index}`,
            key,
            type: type as ScreeningQuestionType,
            question,
          });
          existingKeys.add(key.toLowerCase());
          imported++;
        });

        if (newQuestions.length > 0) {
          set((state) => ({
            questions: [...state.questions, ...newQuestions],
          }));
        }

        return { success: errors.length === 0, imported, errors };
      },

      // Screening process
      startScreening: () =>
        set((state) => {
          const newResults = state.documents.map((doc) => ({
            documentId: doc.id,
            answers: {},
            status: 'pending' as const,
          }));

          return {
            isScreeningStarted: true,
            currentDocumentIndex: 0,
            results: newResults,
          };
        }),

      stopScreening: () => set({ isScreeningStarted: false }),

      resetScreening: () =>
        set({
          isScreeningStarted: false,
          currentDocumentIndex: 0,
          results: [],
        }),

      // Results management
      saveAnswer: (documentId, questionKey, answer) =>
        set((state) => {
          const existingResultIndex = state.results.findIndex(
            (r) => r.documentId === documentId
          );

          if (existingResultIndex >= 0) {
            const updatedResults = [...state.results];
            updatedResults[existingResultIndex] = {
              ...updatedResults[existingResultIndex],
              answers: {
                ...updatedResults[existingResultIndex].answers,
                [questionKey]: answer,
              },
              status: 'in_progress' as const,
            };
            return { results: updatedResults };
          } else {
            const newResult: ScreeningResult = {
              documentId,
              answers: { [questionKey]: answer },
              status: 'in_progress' as const,
            };
            return { results: [...state.results, newResult] };
          }
        }),

      completeDocumentScreening: (documentId) =>
        set((state) => ({
          results: state.results.map((result) =>
            result.documentId === documentId
              ? {
                  ...result,
                  status: 'completed' as const,
                  completedAt: new Date().toISOString(),
                }
              : result
          ),
        })),

      getDocumentResult: (documentId) => {
        const state = get();
        return state.results.find((result) => result.documentId === documentId);
      },

      addAIScreeningResults: (results) =>
        set((state) => {
          const mergedResultsMap = new Map<string, ScreeningResult>();
          state.results.forEach((r) => {
            mergedResultsMap.set(r.documentId, r);
          });
          results.forEach((r) => {
            mergedResultsMap.set(r.documentId, r);
          });

          return {
            results: Array.from(mergedResultsMap.values()),
            isScreeningStarted: true,
          };
        }),

      // Navigation
      goToNextDocument: () =>
        set((state) => ({
          currentDocumentIndex: Math.min(
            state.currentDocumentIndex + 1,
            state.documents.length - 1
          ),
        })),

      goToPreviousDocument: () =>
        set((state) => ({
          currentDocumentIndex: Math.max(state.currentDocumentIndex - 1, 0),
        })),

      setCurrentDocument: (index) => set({ currentDocumentIndex: index }),
    }),
    {
      name: 'screening-storage',
      version: 1,
    }
  )
);

export const useAIEnhanceStore = create<AIEnhanceState>((set) => ({
  isDialogOpen: false,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
}));

export const useAIConfigDialogStore = create<AIConfigDialogState>((set) => ({
  isEnhancing: false,
  enhancedPreview: null,
  setIsEnhancing: (enhancing) => set({ isEnhancing: enhancing }),
  setEnhancedPreview: (preview) => set({ enhancedPreview: preview }),
}));

export const useYearRangePickerStore = create<YearRangePickerState>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
}));

// Add a global store to persist the DateRangePicker popover state across rerenders
export const useDateRangePickerStore = create<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
}));

// Zotero configuration store (no server sync per your hydration selection)
interface ZoteroConfigState {
  zoteroApiKey: string;
  zoteroGroupId: string;
  setZoteroApiKey: (key: string) => void;
  setZoteroGroupId: (id: string) => void;
}

export const useZoteroConfigStore = create<ZoteroConfigState>()(
  persist(
    (set) => ({
      zoteroApiKey: '',
      zoteroGroupId: '',
      setZoteroApiKey: (key) => set({ zoteroApiKey: key }),
      setZoteroGroupId: (id) => set({ zoteroGroupId: id }),
    }),
    {
      name: 'zotero-config-storage',
      version: 1,
    }
  )
);

// Review store (no server sync per your hydration selection)
interface ReviewStoreState {
  step: number;
  setStep: (step: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  resetStep: () => void;
}

export const useReviewStore = create<ReviewStoreState>()(
  persist(
    (set, get) => ({
      step: 1,
      setStep: (step) => set({ step }),
      nextStep: () => set((state) => ({ step: state.step + 1 })),
      previousStep: () =>
        set((state) => ({ step: Math.max(1, state.step - 1) })),
      resetStep: () => set({ step: 1 }),
    }),
    {
      name: 'review-store',
    }
  )
);

// Translation Store - local only (not part of current hydration set)
interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  sourceLanguage: string;
  isAlreadyInEnglish: boolean;
}

interface TranslationState {
  translations: Record<string, TranslationData>;
  showTranslations: Record<string, boolean>;
  setTranslation: (id: string, data: TranslationData) => void;
  getTranslation: (id: string) => TranslationData | null;
  getShowTranslated: (id: string) => boolean;
  setShowTranslated: (id: string, show: boolean) => void;
  clearTranslation: (id: string) => void;
  clearAllTranslations: () => void;
}

export const useTranslationStore = create<TranslationState>()((set, get) => ({
  translations: {},
  showTranslations: {},
  setTranslation: (id: string, data: TranslationData) => {
    set((state) => ({
      translations: {
        ...state.translations,
        [id]: data,
      },
    }));
  },

  getTranslation: (id: string) => {
    return get().translations[id] || null;
  },

  getShowTranslated: (id: string) => {
    return get().showTranslations[id] || false;
  },

  setShowTranslated: (id: string, show: boolean) => {
    set((state) => ({
      showTranslations: {
        ...state.showTranslations,
        [id]: show,
      },
    }));
  },

  clearTranslation: (id: string) => {
    set((state) => {
      const newTranslations = { ...state.translations };
      delete newTranslations[id];
      return { translations: newTranslations };
    });
  },

  clearAllTranslations: () => {
    set({ translations: {} });
  },
}));

// Transient screening store - only testIndexPerQuestion persisted (not hydrated from server)
export const useTransientScreeningStore = create<{
  calledFor: Record<string, boolean>;
  setCalledFor: (key: string, value: boolean) => void;
  myLoadingResponses: Record<string, Record<string, boolean>>;
  getMyLoadingResponses: (key: string) => Record<string, boolean>;
  setMyLoadingResponses: (key: string, value: Record<string, boolean>) => void;
  clearMyLoadingResponses: (key: string) => void;
  testIndexPerQuestion: Record<string, number>;
  setTestIndexPerQuestion: (key: string, value: number) => void;
  incrementTestIndexPerQuestion: (key: string) => void;
}>()(
  persist(
    (set, get) => ({
      calledFor: {},
      setCalledFor: (key, value) =>
        set((state) => ({
          calledFor: { ...state.calledFor, [key]: value },
        })),
      myLoadingResponses: {},
      getMyLoadingResponses: (key) => get().myLoadingResponses[key] || false,
      setMyLoadingResponses: (key, value) =>
        set((state) => ({
          myLoadingResponses: { ...state.myLoadingResponses, [key]: value },
        })),
      clearMyLoadingResponses: (key) =>
        set((state) => ({
          myLoadingResponses: { ...state.myLoadingResponses, [key]: {} },
        })),
      testIndexPerQuestion: {},
      setTestIndexPerQuestion: (key, value) =>
        set((state) => ({
          testIndexPerQuestion: {
            ...state.testIndexPerQuestion,
            [key]: value,
          },
        })),
      incrementTestIndexPerQuestion: (key) =>
        set((state) => ({
          testIndexPerQuestion: {
            ...state.testIndexPerQuestion,
            [key]: (state.testIndexPerQuestion[key] || 0) + 1,
          },
        })),
    }),
    {
      name: 'transient-screening-store',
      partialize: (state) => ({ testIndexPerQuestion: state.testIndexPerQuestion }),
    }
  )
);

// New: User Screening Questions Library (server-hydrated "userQuestions")
interface UserScreeningQuestionsState {
  userQuestions: ScreeningQuestion[];
  setAll: (qs: ScreeningQuestion[]) => void;
  add: (q: Omit<ScreeningQuestion, 'id'>) => void;
  update: (
    id: string,
    updates: Partial<Omit<ScreeningQuestion, 'id'>>
  ) => void;
  remove: (id: string) => void;
  clear: () => void;
  importFromText: (
    text: string
  ) => { success: boolean; imported: number; errors: string[] };
}

export const useUserScreeningQuestionsStore =
  create<UserScreeningQuestionsState>()(
    persist(
      (set, get) => ({
        userQuestions: [],
        setAll: (qs) => set({ userQuestions: qs }),
        add: (q) => {
          const local: ScreeningQuestion = {
            id: generateUUID(),
            ...q,
          };
          set((state) => ({
            userQuestions: [local, ...state.userQuestions],
          }));
          // Background server sync (append)
          saAddUserScreeningQuestion({
            key: q.key,
            type: q.type,
            question: q.question,
          }).catch(() => {});
        },
        update: (id, updates) => {
          let next: ScreeningQuestion[] = [];
          set((state) => {
            const updated = state.userQuestions.map((qq) =>
              qq.id === id ? { ...qq, ...updates } : qq
            );
            next = updated;
            return { userQuestions: updated };
          });
          // Background server sync: rebuild all for consistency without ids
          saClearUserScreeningQuestions()
            .then(() => {
              next.forEach((qq) =>
                saAddUserScreeningQuestion({
                  key: qq.key,
                  type: qq.type,
                  question: qq.question,
                }).catch(() => {})
              );
            })
            .catch(() => {});
        },
        remove: (id) => {
          let next: ScreeningQuestion[] = [];
          set((state) => {
            const updated = state.userQuestions.filter((qq) => qq.id !== id);
            next = updated;
            return { userQuestions: updated };
          });
          // Background server sync: rebuild all
          saClearUserScreeningQuestions()
            .then(() => {
              next.forEach((qq) =>
                saAddUserScreeningQuestion({
                  key: qq.key,
                  type: qq.type,
                  question: qq.question,
                }).catch(() => {})
              );
            })
            .catch(() => {});
        },
        clear: () => {
          set({ userQuestions: [] });
          saClearUserScreeningQuestions().catch(() => {});
        },
        importFromText: (text: string) => {
          const lines = text
            .trim()
            .split('\n')
            .filter((l) => l.trim());
          const errors: string[] = [];
          let imported = 0;

          const newQs: ScreeningQuestion[] = [];
          const existingKeys = new Set(
            get().userQuestions.map((q) => q.key.toLowerCase())
          );

          lines.forEach((line, index) => {
            const parts = line.split('|');
            if (parts.length !== 3) {
              errors.push(
                `Line ${index + 1}: Expected "key|type|question" but got "${line}"`
              );
              return;
            }
            const [key, type, question] = parts.map((p) => p.trim());
            if (!key || !type || !question) {
              errors.push(`Line ${index + 1}: All fields are required`);
              return;
            }
            if (!['boolean', 'number', 'array', 'string'].includes(type)) {
              errors.push(`Line ${index + 1}: Invalid type "${type}"`);
              return;
            }
            const lower = key.toLowerCase();
            if (
              existingKeys.has(lower) ||
              newQs.some((q) => q.key.toLowerCase() === lower)
            ) {
              errors.push(`Line ${index + 1}: Duplicate key "${key}"`);
              return;
            }
            const local: ScreeningQuestion = {
              id: generateUUID(),
              key,
              type: type as ScreeningQuestionType,
              question,
            };
            newQs.push(local);
            existingKeys.add(lower);
            imported++;
          });

          if (newQs.length) {
            set((state) => ({
              userQuestions: [...newQs, ...state.userQuestions],
            }));
            // Background server sync (append only)
            newQs.forEach((qq) =>
              saAddUserScreeningQuestion({
                key: qq.key,
                type: qq.type,
                question: qq.question,
              }).catch(() => {})
            );
          }

          return { success: errors.length === 0, imported, errors };
        },
      }),
      {
        name: 'user-screening-questions-store',
      }
    )
  );