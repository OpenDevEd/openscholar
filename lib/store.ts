import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  SearchField,
  QueryHistoryEntry,
  QuestionHistoryEntry,
  ScreeningQuestionEntry,
  ScreeningResponses,
  AIProvider,
  SearchResult,
  ViewMode,
  HistorySortBy,
  BookmarkSortBy,
  ExtractionSortBy,
  BookmarkData,
} from './types';
import { MIN_YEAR } from './constants';

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
  viewMode: ViewMode
  historyViewMode: ViewMode
  historySortBy: HistorySortBy
  bookmarkViewMode: ViewMode
  bookmarkSortBy: BookmarkSortBy
  extractionViewMode: ViewMode
  extractionSortBy: ExtractionSortBy
  expandedScreeningDetails: Record<string, boolean>
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsFocusModeOpen: (open: boolean) => void
  setFocusModeIndex: (index: number) => void
  setViewMode: (mode: ViewMode) => void
  setHistoryViewMode: (mode: ViewMode) => void
  setHistorySortBy: (sort: HistorySortBy) => void
  setBookmarkViewMode: (mode: ViewMode) => void
  setBookmarkSortBy: (sort: BookmarkSortBy) => void
  setExtractionViewMode: (mode: ViewMode) => void
  setExtractionSortBy: (sort: ExtractionSortBy) => void
  setScreeningDetailExpanded: (paperId: string, expanded: boolean) => void
  getScreeningDetailExpanded: (paperId: string) => boolean
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

interface KeywordExpansionState {
  keywords: Record<string, BookmarkData>
  addKeyword: (shorthand: string, expansion: string) => void
  updateKeyword: (shorthand: string, expansion: string) => void
  removeKeyword: (shorthand: string) => void
  clearKeywords: () => void
  expandQuery: (query: string) => {
    expandedQuery: string;
    warnings: Array<{ key: string; params?: Record<string, string> }>;
  }
  importKeywords: (data: any[]) => number
}

interface AIConfigState {
  provider: AIProvider
  model: string
  apiKey: string
  apiKeyMode: 'local' | 'credits'
  providerApiKeys: Record<string, string>
  setProvider: (provider: AIProvider) => void
  setModel: (model: string) => void
  setApiKey: (apiKey: string) => void
  setApiKeyMode: (mode: 'local' | 'credits') => void
  clearConfig: () => void
}

export const useRatingsStore = create<RatingsState>()(
  persist(
    (set) => ({
      ratings: {},
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
      clearRatings: () => set({ ratings: {} }),
    }),
    {
      name: 'paper-ratings-store',
    }
  )
)

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      searchHistory: [],
      addSearchResult: (result) => {
        const id = generateUUID();
        const now = new Date().toISOString();
        const newResult: SearchResult = {
          ...result,
          id,
          queryHistory: [{ query: result.query, timestamp: now }],
          questionHistory: result.questionHistory || [],
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
      addQueryToHistory: (id, query) => {
        const now = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  query,
                  queryHistory: [...item.queryHistory, { query, timestamp: now }],
                  updatedAt: now
                }
              : item
          ),
        }));
      },
      addQuestionToHistory: (id, question) => {
        const now = new Date().toISOString();
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  questionHistory: [...item.questionHistory, { question, timestamp: now }],
                  updatedAt: now
                }
              : item
          ),
        }));
      },
      addScreeningQuestion: (id, question, locked = false) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: [...(item.screeningQuestions || []), { question, locked }],
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      updateScreeningQuestion: (id, questionIndex, updates) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: (item.screeningQuestions || []).map((q, index) =>
                    index === questionIndex ? { ...q, ...updates } : q
                  ),
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      removeScreeningQuestion: (id, questionIndex) => {
        set((state) => ({
          searchHistory: state.searchHistory.map((item) =>
            item.id === id
              ? {
                  ...item,
                  screeningQuestions: (item.screeningQuestions || []).filter((_, index) => index !== questionIndex),
                  updatedAt: new Date().toISOString()
                }
              : item
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
                  screeningResponses: Object.fromEntries(
                    Object.entries(item.screeningResponses || {}).map(([paperId, responses]) => [
                      paperId,
                      Object.fromEntries(
                        Object.entries(responses).filter(([q]) => q !== question)
                      )
                    ])
                  ),
                  updatedAt: new Date().toISOString()
                }
              : item
          ),
        }));
      },
      getSearchResult: (id) => {
        return get().searchHistory.find((item) => item.id === id);
      },
      removeSearchResult: (index) =>
        set((state) => ({
          searchHistory: state.searchHistory.filter((_, i) => i !== index),
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
        let importedCount = 0;
        const validItems: SearchResult[] = [];
        
        data.forEach((item) => {
          // Map different possible field names to our expected format
          const query = item.search_query || item.query || '';
          const count = item.count || 0;
          const field = item.field || 'title_and_abstract';
          
          // Skip items without required fields (allow empty query but require count)
          if (query === undefined || query === null || typeof count !== 'number') {
            return;
          }
          
          // Create a new search result with generated ID and timestamps
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
        
        return importedCount;
      },
    }),
    {
      name: 'search-history-store',
      version: 6, // Increment when migrations are needed
      migrate: (persistedState: any, version: number) => {
        // Migration for version 0 -> 1: Add isYearRangeEnabled based on existing yearRange
        if (version === 0) {
          const currentYear = new Date().getFullYear();
          const defaultYearRange = [MIN_YEAR, currentYear];
          
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
              // If the item has a custom year range (not the default), enable the toggle
              if (item.yearRange && Array.isArray(item.yearRange)) {
                const [fromYear, toYear] = item.yearRange;
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
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
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
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
              return {
                ...item,
                questionHistory: item.questionHistory || []
              };
            });
          }
        }

        // Migration for version 3 -> 4: Add screeningQuestions field
        if (version <= 3) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
              return {
                ...item,
                screeningQuestions: item.screeningQuestions || []
              };
            });
          }
        }

        // Migration for version 4 -> 5: Add screeningResponses field
        if (version <= 4) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
              return {
                ...item,
                screeningResponses: item.screeningResponses || {}
              };
            });
          }
        }

        // Migration for version 5 -> 6: Add language field
        if (version <= 5) {
          if (persistedState.searchHistory) {
            persistedState.searchHistory = persistedState.searchHistory.map((item: any) => {
              return {
                ...item,
                language: item.language || undefined // Default to undefined for backward compatibility
              };
            });
          }
        }

        return persistedState;
      },
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
      setIsDialogOpen: (open) => set({ isDialogOpen: open }),
      setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
      setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
      setFocusModeIndex: (index) => set({ focusModeIndex: index }),
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
    }),
    {
      name: 'ui-store',
      partialize: (state) => ({ 
        viewMode: state.viewMode,
        historyViewMode: state.historyViewMode,
        historySortBy: state.historySortBy,
        bookmarkViewMode: state.bookmarkViewMode,
        bookmarkSortBy: state.bookmarkSortBy,
        extractionViewMode: state.extractionViewMode,
        extractionSortBy: state.extractionSortBy,
        expandedScreeningDetails: state.expandedScreeningDetails,
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

export const useKeywordExpansionStore = create<KeywordExpansionState>()(
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
      expandQuery: (query) => {
        const { keywords } = get();
        const warnings: Array<{ key: string; params?: Record<string, string> }> = [];
        const expandedQuery = query.replace(/(\w[\w-]*)\.\.\./g, (match, keyword) => {
          const bookmarkData = keywords[keyword];
          if (bookmarkData?.expansion) {
            return bookmarkData.expansion;
          } else {
            warnings.push({ key: 'bookmarkNotFound', params: { keyword } });
            return match;
          }
        });
        return { expandedQuery, warnings };
      },
      importKeywords: (data) => {
        let importedCount = 0;
        const validItems: Record<string, BookmarkData> = {};
        
        data.forEach((item) => {
          // Support both old format (name, expansion) and new format (name, expansion, createdAt)
          const name = item.name || item.shorthand || '';
          const expansion = item.expansion || '';
          const createdAt = item.createdAt || Date.now();
          
          // Skip items without required fields
          if (!name || !expansion) {
            return;
          }
          
          validItems[name] = { expansion, createdAt };
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
      migrate: (persistedState: any, version: number) => {
        // Migration from version 0 (old format) to version 1 (new format with timestamps)
        if (version === 0 && persistedState.keywords) {
          const oldKeywords = persistedState.keywords as Record<string, string | BookmarkData>;
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
          
          return { ...persistedState, keywords: newKeywords };
        }
        return persistedState;
      },
    }
  )
)

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set) => ({
      provider: 'openrouter',
      model: 'openrouter/free',
      apiKey: '',
      apiKeyMode: 'local',
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
      setModel: (model) => set({ model }),
      setApiKey: (apiKey) =>
        set((state) => ({
          apiKey,
          providerApiKeys: {
            ...(state.providerApiKeys ?? {}),
            [state.provider]: apiKey,
          },
        })),
      setApiKeyMode: (apiKeyMode) => set({ apiKeyMode }),
      clearConfig: () => set({ provider: 'openrouter', model: 'openrouter/free', apiKey: '', apiKeyMode: 'local', providerApiKeys: {} }),
    }),
    {
      name: 'ai-config-storage',
      version: 4,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          return {
            ...persistedState,
            model: persistedState.provider === 'openai' ? 'o4-mini-2025-04-16' : persistedState.provider === 'google' ? 'gemini-2.5-flash' : undefined,
          };
        }
        if (version === 1 || version === 2) {
          return {
            ...persistedState,
            apiKeyMode: 'local',
          };
        }
        if (version === 3) {
          // Remove budget tracking fields
          const { dollarsUsed, budget, ...rest } = persistedState;
          return rest;
        }
        return persistedState;
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

interface SearchHistoryUIState {
  currentPage: number
  setCurrentPage: (page: number) => void
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

interface YearRangePickerState {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
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

export const useSearchHistoryUIStore = create<SearchHistoryUIState>((set) => ({
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),
}))

export const useAIConfigDialogStore = create<AIConfigDialogState>((set) => ({
  isEnhancing: false,
  enhancedPreview: null,
  setIsEnhancing: (enhancing) => set({ isEnhancing: enhancing }),
  setEnhancedPreview: (preview) => set({ enhancedPreview: preview }),
}))

export const useYearRangePickerStore = create<YearRangePickerState>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
})) 

// Add a global store to persist the DateRangePicker popover state across rerenders
export const useDateRangePickerStore = create<{ isOpen: boolean; setIsOpen: (open: boolean) => void }>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
}))

// Translation Store - for storing translation data by paper ID
export interface TranslationData {
  translatedTitle: string;
  translatedAbstract: string;
  sourceLanguage: string;
  noTranslationNeeded: boolean;
  targetLanguage?: string;
}

function translationKey(paperId: string, sourceLanguage: string, targetLanguage: string): string {
  return `${paperId}:${sourceLanguage}:${targetLanguage}`;
}

interface TranslationState {
  translations: Record<string, TranslationData>;
  showTranslations: Record<string, boolean>;
  setTranslation: (paperId: string, data: TranslationData) => void;
  getTranslation: (paperId: string, sourceLanguage?: string, targetLanguage?: string) => TranslationData | null;
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
      const key = translationKey(paperId, data.sourceLanguage, target);
      set((state) => ({
        translations: {
          ...state.translations,
          [key]: data,
        },
      }));
    },

    getTranslation: (paperId: string, sourceLanguage?: string, targetLanguage?: string) => {
      if (sourceLanguage && targetLanguage) {
        const key = translationKey(paperId, sourceLanguage, targetLanguage);
        return get().translations[key] || null;
      }
      // Fallback: find any translation for this paper (legacy)
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

// Sidebar Store - Main navigation sidebar
const SIDEBAR_WIDTH_EXPANDED = 280;
const SIDEBAR_WIDTH_COLLAPSED = 72;

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
      isCollapsed: false,
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
      name: 'openalex-sidebar',
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
}>()(
  persist(
    (set, get) => ({
      testIndexPerQuestion: {},
      setTestIndexPerQuestion: (key, value) => set((state) => ({ testIndexPerQuestion: { ...state.testIndexPerQuestion, [key]: value } })),
      incrementTestIndexPerQuestion: (key) => set((state) => ({ testIndexPerQuestion: { ...state.testIndexPerQuestion, [key]: (state.testIndexPerQuestion[key] || 0) + 1 } })),
    }),
    {
      name: 'transient-screening-store',
      partialize: (state) => ({ testIndexPerQuestion: state.testIndexPerQuestion }),
    }
  )
);
