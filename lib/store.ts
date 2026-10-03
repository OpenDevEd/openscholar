import { create } from 'zustand'
import { expandShortcuts, type ShortcutExpansions } from './query-shortcuts'
import { persist, createJSONStorage } from 'zustand/middleware'
import { SIDEBAR_STORAGE_KEY, SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from './sidebar-width'
import type {
  SearchField,
  QueryHistoryEntry,
  QuestionHistoryEntry,
  ScreeningQuestionEntry,
  ScreeningResponses,
  AIProvider,
  AIKeyMode,
  SearchResult,
  ViewMode,
  HistorySortBy,
  BookmarkSortBy,
  ExtractionSortBy,
  BookmarkData,
} from './types';
import { MIN_YEAR } from './constants';
import { bindResearchStore } from './research/binding';
import { historySummary, importSearchRecord, withQuestion } from './research/records';

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

const removeQuestionFromResponses = (
  responses: ScreeningResponses | undefined,
  question: string
): ScreeningResponses =>
  Object.fromEntries(
    Object.entries(responses || {}).map(([paperId, paperResponses]) => [
      paperId,
      Object.fromEntries(
        Object.entries(paperResponses || {}).filter(([q]) => q !== question)
      ),
    ])
  );

export interface RatingsState {
  ratings: Record<string, number>
  setRating: (paperId: string, rating: number | null) => void
  /** The person's ratings of these papers, read now: what a download writes, whatever the page has loaded. */
  readRatings: (paperIds: string[]) => Promise<Record<string, number>>
}

/** The search a copy takes its history from, as a list shows it. */
export type CopySource = Pick<SearchResult, 'id' | 'updatedAt' | 'queryHistoryCount' | 'questionCount' | 'latestQuestion' | 'questionText'>;

export interface SearchHistoryState {
  searchHistory: SearchResult[]
  addSearchResult: (result: Omit<SearchResult, 'id' | 'createdAt' | 'updatedAt' | 'queryHistory' | 'screeningQuestions' | 'screeningResponses' | 'questionHistory' | 'queryHistoryCount' | 'questionCount' | 'latestQuestion' | 'questionText'> & { questionHistory?: QuestionHistoryEntry[] }) => string
  updateSearchResult: (id: string, updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>) => void
  addQueryToHistory: (id: string, query: string, field: SearchField) => void
  removeQueryHistoryEntry: (id: string, entry: QueryHistoryEntry) => void
  /** Gives search `id` the history of search `from`. */
  /** Gives a search another search's parameters (`updates`) and history at once. */
  copySearch: (id: string, from: CopySource, updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>) => void
  addQuestionToHistory: (id: string, question: string) => void
  addScreeningQuestion: (id: string, question: string) => void
  updateScreeningQuestion: (id: string, questionIndex: number, updates: Partial<ScreeningQuestionEntry>) => void
  removeScreeningQuestion: (id: string, questionIndex: number) => void
  clearScreeningQuestions: (id: string) => void
  setScreeningResponse: (searchId: string, paperId: string, question: string, response: boolean | null) => void
  /** The model's answers for one paper; `confidences` is its confidence in each, by question. */
  setScreeningResponses: (searchId: string, paperId: string, responses: Record<string, boolean | null>, confidences?: Record<string, number>) => void
  getScreeningResponse: (searchId: string, paperId: string, question: string) => boolean | null | undefined
  /** A search's answers for these papers, read from the account when signed in: a page holds only the answers of the papers it shows. */
  readScreeningResponses: (searchId: string, paperIds: string[]) => Promise<ScreeningResponses>
  clearScreeningResponses: (searchId: string, paperId?: string) => void
  removeScreeningQuestionFromAllPapers: (searchId: string, question: string) => void
  getSearchResult: (id: string) => SearchResult | undefined
  removeSearchResult: (id: string) => void
  clearSearchHistory: () => void
  migrateSearchResult: (result: SearchResult) => string
  importSearchHistory: (data: Record<string, unknown>[]) => number
}

interface UIState {
  isDialogOpen: boolean

  loadingResultIndex: number | null
  isFocusModeOpen: boolean
  focusModeIndex: number
  viewMode: ViewMode
  historyViewMode: ViewMode
  historySortBy: HistorySortBy
  bookmarkViewMode: ViewMode
  bookmarkSortBy: BookmarkSortBy
  extractionViewMode: ViewMode
  extractionSortBy: ExtractionSortBy
  expandedScreeningDetails: Record<string, boolean>
  screeningPanelOpenBySearchId: Record<string, boolean>
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsFocusModeOpen: (open: boolean) => void
  setFocusModeIndex: (index: number | ((prev: number) => number)) => void
  setViewMode: (mode: ViewMode) => void
  setHistoryViewMode: (mode: ViewMode) => void
  setHistorySortBy: (sort: HistorySortBy) => void
  setBookmarkViewMode: (mode: ViewMode) => void
  setBookmarkSortBy: (sort: BookmarkSortBy) => void
  setExtractionViewMode: (mode: ViewMode) => void
  setExtractionSortBy: (sort: ExtractionSortBy) => void
  setScreeningDetailExpanded: (paperId: string, expanded: boolean) => void
  getScreeningDetailExpanded: (paperId: string) => boolean
  getScreeningPanelOpen: (searchId: string) => boolean
  setScreeningPanelOpen: (searchId: string, open: boolean) => void
  toggleScreeningPanel: (searchId: string) => void
}

interface ResultsState {
  expandedAbstracts: Record<string, boolean>
  toggleAbstract: (paperId: string) => void
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

export interface KeywordExpansionState {
  keywords: Record<string, BookmarkData>
  addKeyword: (shorthand: string, expansion: string) => void
  /** Changes a shortcut's expansion; `createdAt` is the shortcut's own, which the list shows it by. */
  updateKeyword: (shorthand: string, expansion: string, createdAt: number) => void
  removeKeyword: (shorthand: string) => void
  clearKeywords: () => void
  /** Expands the shortcuts this store holds: every one in this browser, and for an account those read by name. */
  expandQuery: (query: string) => {
    expandedQuery: string;
    warnings: Array<{ key: string; params?: Record<string, string> }>;
  }
  /** Reads the shortcuts with these names, so `keywords` and `expandQuery` have them for what follows. */
  ensureShortcuts: (names: string[]) => Promise<void>
  /** Adds the shortcuts in an uploaded file whose names aren't taken; says how many. */
  importKeywords: (data: Record<string, unknown>[]) => Promise<number>
}

interface AIConfigState {
  /** The provider whose key the settings page is editing. */
  provider: AIProvider
  /** That provider's key. */
  apiKey: string
  apiKeyMode: AIKeyMode
  /** Every saved key, by provider. */
  providerApiKeys: Record<string, string>
  setProvider: (provider: AIProvider) => void
  setApiKey: (apiKey: string) => void
  setApiKeyMode: (mode: AIKeyMode) => void
  clearConfig: () => void
}

export const localRatingsStore = create<RatingsState>()(
  persist(
    (set, get) => ({
      ratings: {},
      readRatings: async () => get().ratings,
      setRating: (paperId: string, rating: number | null) =>
        set((state) => {
          if (rating === null) {
            const { [paperId]: _, ...rest } = state.ratings
            return { ratings: rest }
          }
          return {
            ratings: {
              ...state.ratings,
              [paperId]: rating,
            },
          }
        }),
    }),
    {
      name: 'paper-ratings-store',
      version: 1,
      migrate: (persistedState) => persistedState,
    }
  )
)

/** Shape of persisted state flowing through search history migrations. */
interface SearchHistoryPersistedState {
  searchHistory?: Array<Record<string, unknown>>;
}

// `unknown` is correct for Zustand persist `migrate` — shape varies by version.
/** A local history without one `entry`, and its count. */
function withoutEntry(queryHistory: QueryHistoryEntry[], entry: QueryHistoryEntry) {
  const index = queryHistory.findIndex((current) => current.timestamp === entry.timestamp && current.query === entry.query && current.field === entry.field);
  const next = index === -1 ? queryHistory : queryHistory.toSpliced(index, 1);
  return { queryHistory: next, queryHistoryCount: next.length };
}

export function migrateSearchHistoryState(persistedState: unknown, version: number): unknown {
  const state = persistedState as SearchHistoryPersistedState;

  // Migration for version 0 -> 1: Add isYearRangeEnabled based on existing yearRange
  if (version === 0) {
    const currentYear = new Date().getFullYear();
    const defaultYearRange = [MIN_YEAR, currentYear];

    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        // If the item has a custom year range (not the default), enable the toggle
        const yearRange = item.yearRange;
        if (yearRange && Array.isArray(yearRange)) {
          const [fromYear, toYear] = yearRange;
          const isCustomRange = fromYear !== defaultYearRange[0] || toYear !== defaultYearRange[1];

          return {
            ...item,
            isYearRangeEnabled: isCustomRange
          };
        }

        // If no yearRange or it's the default, keep toggle disabled
        return {
          ...item,
          isYearRangeEnabled: false
        };
      });
    }
  }

  // Migration for version 1 -> 2: Add queryHistory field
  if (version <= 1) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        return {
          ...item,
          queryHistory: item.queryHistory || [{
            query: item.query || '',
            timestamp: item.createdAt || new Date().toISOString()
          }]
        };
      });
    }
  }

  // Migration for version 2 -> 3: Add questionHistory field
  if (version <= 2) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        return {
          ...item,
          questionHistory: item.questionHistory || []
        };
      });
    }
  }

  // Migration for version 3 -> 4: Add screeningQuestions field
  if (version <= 3) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        return {
          ...item,
          screeningQuestions: item.screeningQuestions || []
        };
      });
    }
  }

  // Migration for version 4 -> 5: Add screeningResponses field
  if (version <= 4) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        return {
          ...item,
          screeningResponses: item.screeningResponses || {}
        };
      });
    }
  }

  // Migration for version 5 -> 6: Add language field
  if (version <= 5) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => {
        return {
          ...item,
          language: item.language || undefined // Default to undefined for backward compatibility
        };
      });
    }
  }

  // Migration for version 6 -> 7: Normalize screening question shape
  if (version <= 6) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => ({
        ...item,
        screeningQuestions: ((item.screeningQuestions || []) as Array<Record<string, unknown>>).map(
          (question: Record<string, unknown>) => ({
            question: typeof question?.question === "string" ? question.question : "",
          })
        ),
      }));
    }
  }

  // Migration for version 7 -> 8: the summary a search keeps of its history (#354)
  if (version <= 7) {
    if (state.searchHistory) {
      state.searchHistory = state.searchHistory.map((item: Record<string, unknown>) => ({
        ...item,
        ...historySummary((item.queryHistory || []) as unknown[], (item.questionHistory || []) as Array<{ question: string }>),
      }));
    }
  }

  return state;
}

export const localSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      searchHistory: [],
      addSearchResult: (result) => {
        const id = generateUUID();
        const now = new Date().toISOString();
        const queryHistory = [{ query: result.query, timestamp: now, field: result.field }];
        const questionHistory = result.questionHistory || [];
        const newResult: SearchResult = {
          ...result,
          id,
          queryHistory,
          questionHistory,
          ...historySummary(queryHistory, questionHistory),
          screeningQuestions: [],
          screeningResponses: {},
          createdAt: now,
          updatedAt: now,
        };
        
        set((state) => ({
          searchHistory: [newResult, ...state.searchHistory],
        }));
        
        return id;
      },
      updateSearchResult: (id, updates) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? { ...item, ...updates, updatedAt: new Date().toISOString() }
              : item
          ),
        }));
      },
      addQueryToHistory: (id, query, field) => {
        const now = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  query,
                  queryHistory: [...(item.queryHistory ?? []), { query, timestamp: now, field }],
                  queryHistoryCount: item.queryHistoryCount + 1,
                  updatedAt: now
                }
              : item
          ),
        }));
      },
      removeQueryHistoryEntry: (id, entry) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...withoutEntry(item.queryHistory ?? [], entry),
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        }));
      },
      copySearch: (id, from, updates) => {
        set((state) => {
          const source = state.searchHistory.find((item) => item.id === from.id);
          if (!source) return state;
          const { queryHistory, questionHistory, queryHistoryCount, questionCount, latestQuestion, questionText } = source;
          return { searchHistory: state.searchHistory.map((item) => item.id === id ? { ...item, ...updates, queryHistory, questionHistory, queryHistoryCount, questionCount, latestQuestion, questionText, updatedAt: new Date().toISOString() } : item) };
        });
      },
      addQuestionToHistory: (id, question) => {
        const now = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  questionHistory: [...(item.questionHistory ?? []), { question, timestamp: now }],
                  ...withQuestion(item, question),
                  updatedAt: now
                }
              : item
          ),
        }));
      },
      addScreeningQuestion: (id, question) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: [...(item.screeningQuestions || []), { question }],
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      updateScreeningQuestion: (id, questionIndex, updates) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id !== id
              ? item
              : (() => {
                  const currentQuestions = item.screeningQuestions || [];
                  const previousQuestion = currentQuestions[questionIndex]?.question;
                  const screeningQuestions = currentQuestions.map((q, index) =>
                    index === questionIndex ? { ...q, ...updates } : q
                  );
                  const nextQuestion = screeningQuestions[questionIndex]?.question;
                  const shouldCleanupResponses =
                    typeof previousQuestion === "string" &&
                    typeof nextQuestion === "string" &&
                    previousQuestion !== nextQuestion;

                  return {
                    ...item,
                    screeningQuestions,
                    screeningResponses: shouldCleanupResponses
                      ? removeQuestionFromResponses(item.screeningResponses, previousQuestion)
                      : item.screeningResponses,
                    updatedAt: new Date().toISOString(),
                  };
                })()
          ),
        }));
      },
      removeScreeningQuestion: (id, questionIndex) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id !== id
              ? item
              : (() => {
                  const removedQuestion = (item.screeningQuestions || [])[questionIndex]?.question;
                  return {
                    ...item,
                    screeningQuestions: (item.screeningQuestions || []).filter(
                      (_, index) => index !== questionIndex
                    ),
                    screeningResponses:
                      typeof removedQuestion === "string"
                        ? removeQuestionFromResponses(item.screeningResponses, removedQuestion)
                        : item.screeningResponses,
                    updatedAt: new Date().toISOString(),
                  };
                })()
          ),
        }));
      },
      clearScreeningQuestions: (id) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: [],
                  screeningResponses: {},
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
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
                      [question]: response
                    }
                  },
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      setScreeningResponses: (searchId, paperId, responses) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? { ...item, screeningResponses: { ...item.screeningResponses, [paperId]: {...item.screeningResponses?.[paperId] || {}, ...responses,} } }
              : item,
          ),
        }));
      },
      getScreeningResponse: (searchId, paperId, question) => {
        const searchResult = get().searchHistory.find(item => item.id === searchId);
        return searchResult?.screeningResponses?.[paperId]?.[question];
      },
      // This browser holds every answer of its own searches.
      readScreeningResponses: async (searchId, paperIds) => {
        const responses = get().searchHistory.find(item => item.id === searchId)?.screeningResponses ?? {};
        return Object.fromEntries(paperIds.flatMap(paperId => (responses[paperId] ? [[paperId, responses[paperId]]] : [])));
      },
      clearScreeningResponses: (searchId, paperId) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: paperId
                    ? Object.fromEntries(
                        Object.entries(item.screeningResponses || {}).filter(([key]) => key !== paperId)
                      )
                    : {},
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      removeScreeningQuestionFromAllPapers: (searchId, question) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === searchId
              ? {
                  ...item,
                  screeningResponses: removeQuestionFromResponses(item.screeningResponses, question),
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      getSearchResult: (id) => {
        return get().searchHistory.find((item) => item.id === id);
      },
      removeSearchResult: (id) =>
        set((state) => ({
          searchHistory: state.searchHistory.filter((item) => item.id !== id),
        })),
      clearSearchHistory: () => set({ searchHistory: [] }),
      migrateSearchResult: (result) => {
        // If the result doesn't have an ID, generate one and add timestamps
        if (!result.id) {
          const id = generateUUID();
          const now = new Date().toISOString();
          const migratedResult: SearchResult = {
            ...result,
            id,
            questionHistory: result.questionHistory || [],
            ...historySummary(result.queryHistory || [], result.questionHistory || []),
            screeningQuestions: result.screeningQuestions || [],
            screeningResponses: result.screeningResponses || {},
            createdAt: now,
            updatedAt: now,
          };
          
          // Update the existing result in place
          set((state) => ({
            searchHistory: state.searchHistory.map((item) =>
              item === result ? migratedResult : item
            ),
          }));
          
          return id;
        }
        return result.id;
      },
      importSearchHistory: (data) => {
        const validItems = data.map(item => importSearchRecord(item, generateUUID()));
        
        if (validItems.length > 0) {
          set((state) => ({
            searchHistory: [...validItems, ...state.searchHistory],
          }));
        }
        
        return validItems.length;
      },
    }),
    {
      name: 'search-history-store',
      version: 8, // Increment when migrations are needed
      migrate: migrateSearchHistoryState,
    }
  )
)

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      isDialogOpen: false,
      loadingResultIndex: null,
      isFocusModeOpen: false,
      focusModeIndex: 0,
      viewMode: 'list-detail',
      historyViewMode: 'list-detail',
      historySortBy: 'recent',
      bookmarkViewMode: 'list-detail',
      bookmarkSortBy: 'recent',
      extractionViewMode: 'list-detail',
      extractionSortBy: 'recent',
      expandedScreeningDetails: {},
      screeningPanelOpenBySearchId: {},
      setIsDialogOpen: (open) => set({ isDialogOpen: open }),
      setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
      setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
      setFocusModeIndex: (indexOrUpdater) =>
        set((state) => ({
          focusModeIndex:
            typeof indexOrUpdater === "function"
              ? indexOrUpdater(state.focusModeIndex)
              : indexOrUpdater,
        })),
      setViewMode: (mode) => set({ viewMode: mode }),
      setHistoryViewMode: (mode) => set({ historyViewMode: mode }),
      setHistorySortBy: (sort) => set({ historySortBy: sort }),
      setBookmarkViewMode: (mode) => set({ bookmarkViewMode: mode }),
      setBookmarkSortBy: (sort) => set({ bookmarkSortBy: sort }),
      setExtractionViewMode: (mode) => set({ extractionViewMode: mode }),
      setExtractionSortBy: (sort) => set({ extractionSortBy: sort }),
      setScreeningDetailExpanded: (paperId, expanded) => set((state) => ({
        expandedScreeningDetails: {
          ...state.expandedScreeningDetails,
          [paperId]: expanded,
        },
      })),
      getScreeningDetailExpanded: (paperId) => get().expandedScreeningDetails[paperId] || false,
      getScreeningPanelOpen: (searchId) => {
        const key = searchId || "__active";
        return get().screeningPanelOpenBySearchId[key] || false;
      },
      setScreeningPanelOpen: (searchId, open) => {
        const key = searchId || "__active";
        set((state) => ({
          screeningPanelOpenBySearchId: {
            ...state.screeningPanelOpenBySearchId,
            [key]: open,
          },
        }));
      },
      toggleScreeningPanel: (searchId) => {
        const key = searchId || "__active";
        set((state) => ({
          screeningPanelOpenBySearchId: {
            ...state.screeningPanelOpenBySearchId,
            [key]: !(state.screeningPanelOpenBySearchId[key] || false),
          },
        }));
      },
    }),
    {
      name: 'ui-store',
      version: 1,
      migrate: (persistedState) => persistedState,
      partialize: (state) => ({
        viewMode: state.viewMode,
        historyViewMode: state.historyViewMode,
        historySortBy: state.historySortBy,
        bookmarkViewMode: state.bookmarkViewMode,
        bookmarkSortBy: state.bookmarkSortBy,
        extractionViewMode: state.extractionViewMode,
        extractionSortBy: state.extractionSortBy,
        expandedScreeningDetails: state.expandedScreeningDetails,
        screeningPanelOpenBySearchId: state.screeningPanelOpenBySearchId,
      }),
    }
  )
)

export const useResultsStore = create<ResultsState>((set) => ({
  expandedAbstracts: {},
  toggleAbstract: (paperId) => set((state) => ({
    expandedAbstracts: {
      ...state.expandedAbstracts,
      [paperId]: !state.expandedAbstracts[paperId]
    }
  })),
}))

export const useFocusModeSettingsStore = create<FocusModeSettingsState>()(
  persist(
    (set) => ({
      fontSize: 'base',
      maxContentWidth: 'medium',
      lineHeight: 'normal',
      showMetadata: true,
      compactMode: false,
      setFontSize: (size) => set({ fontSize: size }),
      setMaxContentWidth: (width) => set({ maxContentWidth: width }),
      setLineHeight: (height) => set({ lineHeight: height }),
      setShowMetadata: (show) => set({ showMetadata: show }),
      setCompactMode: (compact) => set({ compactMode: compact }),
      resetSettings: () => set({
        fontSize: 'base',
        maxContentWidth: 'medium',
        lineHeight: 'normal',
        showMetadata: true,
        compactMode: false,
      }),
    }),
    {
      name: 'focus-mode-settings-store',
    }
  )
)

export const localKeywordExpansionStore = create<KeywordExpansionState>()(
  persist(
    (set, get) => ({
      keywords: {},
      addKeyword: (shorthand, expansion) => set((state) => ({
        keywords: {
          [shorthand]: { expansion, createdAt: Date.now() },
          ...state.keywords,
        },
      })),
      updateKeyword: (shorthand, expansion) => set((state) => ({
        keywords: {
          ...state.keywords,
          [shorthand]: { 
            ...state.keywords[shorthand],
            expansion,
          },
        },
      })),
      removeKeyword: (shorthand) => set((state) => {
        const { [shorthand]: _, ...rest } = state.keywords;
        return { keywords: rest };
      }),
      clearKeywords: () => set({ keywords: {} }),
      expandQuery: (query) => expandShortcuts(query, shortcutExpansions(get().keywords)),
      // Every shortcut is in this browser already.
      ensureShortcuts: async () => {},
      importKeywords: async (data) => {
        let importedCount = 0;
        const validItems: Record<string, BookmarkData> = {};
        
        data.forEach((item) => {
          // Support both old format (name, expansion) and new format (name, expansion, createdAt)
          const name = String(item.name || item.shorthand || '');
          const expansion = String(item.expansion || '');
          const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();

          // Skip items without required fields
          if (!name || !expansion) {
            return;
          }

          validItems[name] = { expansion, createdAt: createdAt as number };
          importedCount++;
        });
        
        if (Object.keys(validItems).length > 0) {
          set((state) => ({
            keywords: { ...validItems, ...state.keywords },
          }));
        }
        
        return importedCount;
      },
    }),
    {
      name: 'keyword-expansion-store',
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        // Migration from version 0 (old format) to version 1 (new format with timestamps)
        const state = persistedState as { keywords?: Record<string, string | BookmarkData> };
        if (version === 0 && state.keywords) {
          const oldKeywords = state.keywords;
          const newKeywords: Record<string, BookmarkData> = {};
          
          Object.entries(oldKeywords).forEach(([key, value]) => {
            if (typeof value === 'string') {
              // Old format: string value
              newKeywords[key] = { expansion: value, createdAt: Date.now() };
            } else if (value && typeof value === 'object' && 'expansion' in value) {
              // Already new format
              newKeywords[key] = value as BookmarkData;
            }
          });
          
          return { ...state, keywords: newKeywords };
        }
        return state;
      },
    }
  )
)

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set) => ({
      provider: 'openrouter',
      apiKey: '',
      apiKeyMode: 'smart',
      providerApiKeys: {},
      setProvider: (provider) =>
        set((state) => {
          const providerApiKeys = { ...(state.providerApiKeys ?? {}) };
          providerApiKeys[state.provider] = state.apiKey ?? '';

          return {
            provider,
            apiKey: providerApiKeys[provider] ?? '',
            providerApiKeys,
          };
        }),
      setApiKey: (apiKey) =>
        set((state) => ({
          apiKey,
          providerApiKeys: {
            ...(state.providerApiKeys ?? {}),
            [state.provider]: apiKey,
          },
        })),
      setApiKeyMode: (apiKeyMode) => set({ apiKeyMode }),
      clearConfig: () => set({ provider: 'openrouter', apiKey: '', apiKeyMode: 'smart', providerApiKeys: {} }),
    }),
    {
      name: 'ai-config-storage',
      version: 6,
      // Keeps the saved keys and pay mode; older fields (a single key model, budgets) are dropped.
      migrate: (persistedState: unknown) => {
        const state = persistedState as Partial<Pick<AIConfigState, 'provider' | 'apiKey' | 'apiKeyMode' | 'providerApiKeys'>>;
        return {
          provider: state.provider ?? 'openrouter',
          apiKey: state.apiKey ?? '',
          apiKeyMode: state.apiKeyMode ?? 'smart',
          providerApiKeys: state.providerApiKeys ?? {},
        };
      },
    }
  )
);

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

// Removed NavbarState - using currentQuery from ResultsStore as single source of truth
// Removed PageContentState - using currentQuery from ResultsStore as single source of truth

interface AIConfigDialogState {
  isEnhancing: boolean
  enhancedPreview: {
    enhancedQuery: string
    explanation: string
  } | null
  setIsEnhancing: (enhancing: boolean) => void
  setEnhancedPreview: (preview: { enhancedQuery: string; explanation: string } | null) => void
}


export const useThemeToggleStore = create<ThemeToggleState>((set) => ({
  mounted: false,
  setMounted: (mounted) => set({ mounted }),
}))

export const useCurrentQueryStore = create<CurrentQueryState>((set) => ({
  currentQuery: '',
  setCurrentQuery: (query) => set({ currentQuery: query }),
}))

export const useCurrentQuestionStore = create<CurrentQuestionState>((set) => ({
  currentQuestion: '',
  setCurrentQuestion: (question) => set({ currentQuestion: question }),
}))

export const useKeywordExpansionDialogStore = create<KeywordExpansionDialogState>((set) => ({
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
  resetForm: () => set({ newShorthand: '', newExpansion: '', currentKeyword: '', suggestedQuery: '' }),
}))

export const useAIConfigDialogStore = create<AIConfigDialogState>((set) => ({
  isEnhancing: false,
  enhancedPreview: null,
  setIsEnhancing: (enhancing) => set({ isEnhancing: enhancing }),
  setEnhancedPreview: (preview) => set({ enhancedPreview: preview }),
}))

// Translation Store - for storing translation data by paper ID
export interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  noTranslationNeeded: boolean;
  targetLanguage?: string;
}

function translationKey(paperId: string, targetLanguage: string): string {
  return `${paperId}:${targetLanguage}`;
}

interface TranslationState {
  translations: Record<string, TranslationData>;
  showTranslations: Record<string, boolean>;
  setTranslation: (paperId: string, data: TranslationData) => void;
  getTranslation: (paperId: string, targetLanguage?: string) => TranslationData | null;
  getShowTranslated: (id: string) => boolean;
  setShowTranslated: (id: string, show: boolean) => void;
  clearTranslation: (id: string) => void;
  clearAllTranslations: () => void;
}

export const useTranslationStore = create<TranslationState>()(
  (set, get) => ({
    translations: {},
    showTranslations: {},
    setTranslation: (paperId: string, data: TranslationData) => {
      const target = data.targetLanguage ?? "en";
      const key = translationKey(paperId, target);
      set((state) => ({
        translations: {
          ...state.translations,
          [key]: data,
        },
      }));
    },

    getTranslation: (paperId: string, targetLanguage?: string) => {
      if (targetLanguage) {
        const key = translationKey(paperId, targetLanguage);
        return get().translations[key] || null;
      }
      // Fallback: find any translation for this paper
      const entries = Object.entries(get().translations);
      const match = entries.find(([k]) => k.startsWith(`${paperId}:`));
      return match ? match[1] : null;
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

    clearTranslation: (paperId: string) => {
      set((state) => {
        const newTranslations = { ...state.translations };
        const prefix = `${paperId}:`;
        for (const key of Object.keys(newTranslations)) {
          if (key.startsWith(prefix)) delete newTranslations[key];
        }
        return { translations: newTranslations };
      });
    },

    clearAllTranslations: () => {
      set({ translations: {} });
    },
  })
);

interface ResultsTranslationSettingsState {
  autoTranslateResults: boolean;
  targetLanguageOverride: string | null;
  manualRunRequestId: number;
  setAutoTranslateResults: (enabled: boolean) => void;
  setTargetLanguageOverride: (language: string | null) => void;
  clearTargetLanguageOverride: () => void;
  requestManualRun: () => void;
}

export const useResultsTranslationSettingsStore = create<ResultsTranslationSettingsState>()(
  persist(
    (set) => ({
      autoTranslateResults: false,
      targetLanguageOverride: null,
      manualRunRequestId: 0,
      setAutoTranslateResults: (enabled) => set({ autoTranslateResults: enabled }),
      setTargetLanguageOverride: (language) => set({ targetLanguageOverride: language }),
      clearTargetLanguageOverride: () => set({ targetLanguageOverride: null }),
      requestManualRun: () =>
        set((state) => ({ manualRunRequestId: state.manualRunRequestId + 1 })),
    }),
    {
      name: "results-translation-settings-store",
      version: 1,
      migrate: (persistedState) => persistedState,
      partialize: (state) => ({
        autoTranslateResults: state.autoTranslateResults,
        targetLanguageOverride: state.targetLanguageOverride,
      }),
    }
  )
);

// Sidebar Store - Main navigation sidebar

interface SidebarState {
  isOpen: boolean;
  isCollapsed: boolean;
  _hasHydrated: boolean;
  setOpen: (open: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggle: (isMobile: boolean) => void;
  setHasHydrated: (state: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      isCollapsed: true,
      _hasHydrated: false,
      setOpen: (open) => set({ isOpen: open }),
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggle: (isMobile) => {
        if (isMobile) {
          set((state) => ({ isOpen: !state.isOpen }));
        } else {
          set((state) => ({ isCollapsed: !state.isCollapsed }));
        }
      },
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: SIDEBAR_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Derived values for sidebar dimensions
export const getSidebarDimensions = (isCollapsed: boolean) => ({
  expandedWidth: SIDEBAR_WIDTH_EXPANDED,
  collapsedWidth: SIDEBAR_WIDTH_COLLAPSED,
  currentWidth: isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
});

// Filter Sidebar Store - Search filters sidebar
const FILTER_SIDEBAR_WIDTH_EXPANDED = 320;
const FILTER_SIDEBAR_WIDTH_COLLAPSED = 48;

interface FilterSidebarState {
  isCollapsed: boolean;
  _hasHydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useFilterSidebarStore = create<FilterSidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      _hasHydrated: false,
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'openalex-filter-sidebar',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Derived values for filter sidebar dimensions
export const getFilterSidebarDimensions = (isCollapsed: boolean) => ({
  expandedWidth: FILTER_SIDEBAR_WIDTH_EXPANDED,
  collapsedWidth: FILTER_SIDEBAR_WIDTH_COLLAPSED,
  currentWidth: isCollapsed ? FILTER_SIDEBAR_WIDTH_COLLAPSED : FILTER_SIDEBAR_WIDTH_EXPANDED,
});

/**
 * Factory for creating independent sidebar collapse stores.
 * Each page gets its own store instance with separate localStorage persistence.
 * Usage: const useMyStore = createSidebarStore('my-persist-key');
 */
export function createSidebarStore(persistKey: string) {
  return create<FilterSidebarState>()(
    persist(
      (set) => ({
        isCollapsed: false,
        _hasHydrated: false,
        setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
        toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
        setHasHydrated: (state) => set({ _hasHydrated: state }),
      }),
      {
        name: persistKey,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ isCollapsed: state.isCollapsed }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      }
    )
  );
}

/**
 * Factory for creating sidebar dimension calculators.
 * Returns a function that computes current dimensions based on collapse state.
 */
export function createSidebarDimensions(expandedWidth: number, collapsedWidth: number) {
  return (isCollapsed: boolean) => ({
    expandedWidth,
    collapsedWidth,
    currentWidth: isCollapsed ? collapsedWidth : expandedWidth,
  });
}

// Library filter sidebar store (independent collapse state from search sidebar)
export const useLibrarySidebarStore = createSidebarStore('openalex-library-sidebar');
export const getLibrarySidebarDimensions = createSidebarDimensions(320, 48);

// Bucket sidebar store — staged-papers sidebar on job-creator
export const useBucketSidebarStore = createSidebarStore('openalex-bucket-sidebar');
export const getBucketSidebarDimensions = createSidebarDimensions(360, 48);

// Chat papers-in-context sidebar — same visual shell as bucket, read-only,
// independent collapse persistence so users can prefer it open in chat
// even if they collapsed bucket on the creator.
export const useChatPapersSidebarStore = createSidebarStore('openalex-chat-papers-sidebar');
export const getChatPapersSidebarDimensions = createSidebarDimensions(320, 48);

// Extraction source sidebar — collection picker inside the Library tab
export const useExtractionSourceSidebarStore = createSidebarStore('openalex-extraction-source-sidebar');
export const getExtractionSourceSidebarDimensions = createSidebarDimensions(240, 48);

// Extraction citation panel store
const EXTRACTION_CITATION_PANEL_WIDTH_EXPANDED = 460;
const EXTRACTION_CITATION_PANEL_WIDTH_COLLAPSED = 48;

interface ExtractionCitationPanelState {
  isCollapsed: boolean;
  _hasHydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  expand: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useExtractionCitationPanelStore = create<ExtractionCitationPanelState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      _hasHydrated: false,
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      expand: () => set({ isCollapsed: false }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: "openalex-extraction-citation-panel",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export const getExtractionCitationPanelDimensions = (isCollapsed: boolean) => ({
  expandedWidth: EXTRACTION_CITATION_PANEL_WIDTH_EXPANDED,
  collapsedWidth: EXTRACTION_CITATION_PANEL_WIDTH_COLLAPSED,
  currentWidth: isCollapsed
    ? EXTRACTION_CITATION_PANEL_WIDTH_COLLAPSED
    : EXTRACTION_CITATION_PANEL_WIDTH_EXPANDED,
});

export const useTransientScreeningStore = create<{
  testIndexPerQuestion: Record<string, number>;
  setTestIndexPerQuestion: (key: string, value: number) => void;
  incrementTestIndexPerQuestion: (key: string) => void;
  clearTestIndexPerQuestion: (key: string) => void;
  clearAllTestIndexPerQuestion: () => void;
}>()(
  persist(
    (set) => ({
      testIndexPerQuestion: {},
      setTestIndexPerQuestion: (key, value) => set((state) => ({ testIndexPerQuestion: { ...state.testIndexPerQuestion, [key]: value } })),
      incrementTestIndexPerQuestion: (key) => set((state) => ({ testIndexPerQuestion: { ...state.testIndexPerQuestion, [key]: (state.testIndexPerQuestion[key] || 0) + 1 } })),
      clearTestIndexPerQuestion: (key) =>
        set((state) => {
          const { [key]: _ignored, ...remaining } = state.testIndexPerQuestion;
          return { testIndexPerQuestion: remaining };
        }),
      clearAllTestIndexPerQuestion: () => set({ testIndexPerQuestion: {} }),
    }),
    {
      name: 'transient-screening-store',
      version: 1,
      migrate: (persistedState) => persistedState,
      partialize: (state) => ({ testIndexPerQuestion: state.testIndexPerQuestion }),
    }
  )
);

export const useSearchHistoryStore = Object.assign(bindResearchStore(localSearchHistoryStore, 'history'), { persist: localSearchHistoryStore.persist });
export const useKeywordExpansionStore = Object.assign(bindResearchStore(localKeywordExpansionStore, 'shortcuts'), { persist: localKeywordExpansionStore.persist });
export const useRatingsStore = Object.assign(bindResearchStore(localRatingsStore, 'ratings'), { persist: localRatingsStore.persist });

/** The Bookmarks page's shortcuts as expansions by name. */
export function shortcutExpansions(keywords: Record<string, { expansion: string }>): ShortcutExpansions {
  return Object.fromEntries(Object.entries(keywords).map(([name, { expansion }]) => [name, expansion]))
}
