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

export const useUIStore = create<UIState>((set) => ({
  isDialogOpen: false,
  loadingResultIndex: null,
  isFocusModeOpen: false,
  focusModeIndex: 0,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
  setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
  setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
  setFocusModeIndex: (index) => set({ focusModeIndex: index }),
}))

export const useResultsStore = create<ResultsState>((set) => ({
  currentPage: 1,
  expandedAbstracts: {},
  resultsFilter: "",
  setCurrentPage: (page) => set({ currentPage: page }),
  toggleAbstract: (paperId) => set((state) => ({
    expandedAbstracts: {
      ...state.expandedAbstracts,
      [paperId]: !state.expandedAbstracts[paperId]
    }
  })),
  setResultsFilter: (filter) => set({ resultsFilter: filter, currentPage: 1 }),
  clearResults: () => set({ 
    currentPage: 1,
    expandedAbstracts: {},
    resultsFilter: ""
  }),
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
          [shorthand]: expansion,
          ...state.keywords,
        },
      })),
      updateKeyword: (shorthand, expansion) => set((state) => ({
        keywords: {
          ...state.keywords,
          [shorthand]: expansion,
        },
      })),
      removeKeyword: (shorthand) => set((state) => {
        const { [shorthand]: _, ...rest } = state.keywords;
        return { keywords: rest };
      }),
      clearKeywords: () => set({ keywords: {} }),
      expandQuery: (query) => {
        const { keywords } = get();
        const warnings: string[] = [];
        const expandedQuery = query.replace(/(\w[\w-]*)\.\.\./g, (match, keyword) => {
          const expansion = keywords[keyword];
          if (expansion) {
            return expansion;
          } else {
            warnings.push(`Bookmark "${keyword}" not found`);
            return match;
          }
        });
        return { expandedQuery, warnings };
      },
    }),
    {
      name: 'keyword-expansion-store',
    }
  )
)

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set) => ({
      provider: 'openai',
      apiKey: '',
      dollarsUsed: 0,
      budget: 0,
      setBudget: (budget) => set({ budget }),
      addDollarsUsed: (amount) => set((state) => ({ dollarsUsed: state.dollarsUsed + amount })),
      resetDollarsUsed: () => set({ dollarsUsed: 0 }),
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      clearConfig: () => set({ provider: 'openai', apiKey: '', dollarsUsed: 0, budget: 0 }),
    }),
    {
      name: 'ai-config-storage',
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

export const useCountryRegionPickerStore = create<CountryRegionPickerState>((set) => ({
  isOpen: false,
  expandedNodes: new Set(['world']),
  searchQuery: '',
  setIsOpen: (open) => set({ isOpen: open }),
  setExpandedNodes: (nodes) => set({ expandedNodes: nodes }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleNode: (nodeId) => set((state) => {
    const newExpanded = new Set(state.expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    return { expandedNodes: newExpanded };
  }),
  resetPicker: () => set({ 
    isOpen: false, 
    expandedNodes: new Set(['world']), 
    searchQuery: '' 
  }),
}))

export const useSearchHistoryUIStore = create<SearchHistoryUIState>((set) => ({
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),
}))

// Removed useNavbarStore - using currentQuery from ResultsStore as single source of truth
// Removed usePageContentStore - using currentQuery from ResultsStore as single source of truth

export const useResultsPageContentStore = create<ResultsPageContentState>((set) => ({
  isSidebarOpen: false,
  setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
}))

export const useScreeningStore = create<ScreeningState>()(
  persist(
    (set, get) => ({
      documents: [],
      questions: [],
      results: [],
      isScreeningStarted: false,
      currentDocumentIndex: 0,

      // Document management
      addDocument: (document) => set((state) => {
        // Check if document already exists
        const existingDoc = state.documents.find(doc => doc.id === document.id || doc.originalWork?.id === document.id);
        if (existingDoc) {
          return state; // Don't add duplicates
        }

        const newDocument: ScreeningDocument = {
          ...document,
          id: document.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          addedAt: new Date().toISOString(),
        };
        return { documents: [...state.documents, newDocument] };
      }),

      // Add document from OpenAlex Work
      addDocumentFromWork: (work: any) => set((state) => {
        // Check if document already exists
        const existingDoc = state.documents.find(doc => doc.id === work.id || doc.originalWork?.id === work.id);
        if (existingDoc) {
          return state; // Don't add duplicates
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

      removeDocument: (documentId) => set((state) => ({
        documents: state.documents.filter(doc => doc.id !== documentId),
        results: state.results.filter(result => result.documentId !== documentId),
      })),

      clearDocuments: () => set({ documents: [], results: [] }),

      // Question management
      addQuestion: (question) => set((state) => {
        const newQuestion: ScreeningQuestion = {
          ...question,
          id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        };
        return { questions: [...state.questions, newQuestion] };
      }),

      updateQuestion: (questionId, updates) => set((state) => ({
        questions: state.questions.map(q => 
          q.id === questionId ? { ...q, ...updates } : q
        ),
      })),

      removeQuestion: (questionId) => set((state) => ({
        questions: state.questions.filter(q => q.id !== questionId),
      })),

      clearQuestions: () => set({ questions: [] }),

      importQuestionsFromText: (text) => {
        const lines = text.trim().split('\n').filter(line => line.trim());
        const errors: string[] = [];
        let imported = 0;

        const newQuestions: ScreeningQuestion[] = [];
        const existingKeys = new Set(get().questions.map((q: ScreeningQuestion) => q.key.toLowerCase()));

        lines.forEach((line, index) => {
          const parts = line.split('|');
          if (parts.length !== 3) {
            errors.push(`Line ${index + 1}: Expected format "key|type|question" but got "${line}"`);
            return;
          }

          const [key, type, question] = parts.map(part => part.trim());
          
          if (!key || !type || !question) {
            errors.push(`Line ${index + 1}: All fields (key, type, question) are required`);
            return;
          }

          if (!['boolean', 'number', 'array', 'string'].includes(type)) {
            errors.push(`Line ${index + 1}: Invalid type "${type}". Must be one of: boolean, number, array, string`);
            return;
          }

          // Check duplicates within existing or newQuestions
          if (existingKeys.has(key.toLowerCase()) || newQuestions.some(q => q.key.toLowerCase() === key.toLowerCase())) {
            errors.push(`Line ${index + 1}: Duplicate key "${key}"`);
            return;
          }

          newQuestions.push({
            id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${index}`,
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
      startScreening: () => set((state) => {
        // Initialize results for all documents
        const newResults = state.documents.map(doc => ({
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

      resetScreening: () => set({
        isScreeningStarted: false,
        currentDocumentIndex: 0,
        results: [],
      }),

      // Results management
      saveAnswer: (documentId, questionKey, answer) => set((state) => {
        const existingResultIndex = state.results.findIndex(r => r.documentId === documentId);
        
        if (existingResultIndex >= 0) {
          // Update existing result
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
          // Create new result
          const newResult: ScreeningResult = {
            documentId,
            answers: { [questionKey]: answer },
            status: 'in_progress' as const,
          };
          return { results: [...state.results, newResult] };
        }
      }),

      completeDocumentScreening: (documentId) => set((state) => ({
        results: state.results.map(result => 
          result.documentId === documentId 
            ? { ...result, status: 'completed' as const, completedAt: new Date().toISOString() }
            : result
        ),
      })),

      getDocumentResult: (documentId) => {
        const state = get();
        return state.results.find(result => result.documentId === documentId);
      },

      addAIScreeningResults: (results) => set((state) => {
        // Merge AI results into existing ones, replacing any previous entry for the same documentId
        const mergedResultsMap = new Map<string, ScreeningResult>();

        // Start with existing results
        state.results.forEach((r) => {
          mergedResultsMap.set(r.documentId, r);
        });

        // Overwrite or add with new AI results
        results.forEach((r) => {
          mergedResultsMap.set(r.documentId, r);
        });

        return {
          results: Array.from(mergedResultsMap.values()),
          isScreeningStarted: true,
        };
      }),

      // Navigation
      goToNextDocument: () => set((state) => ({
        currentDocumentIndex: Math.min(state.currentDocumentIndex + 1, state.documents.length - 1),
      })),

      goToPreviousDocument: () => set((state) => ({
        currentDocumentIndex: Math.max(state.currentDocumentIndex - 1, 0),
      })),

      setCurrentDocument: (index) => set({ currentDocumentIndex: index }),
    }),
    {
      name: 'screening-storage',
      version: 1,
    }
  )
)

export const useAIEnhanceStore = create<AIEnhanceState>((set) => ({
  isDialogOpen: false,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
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

// Zotero configuration store
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

// Review store for managing review workflow steps
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
      previousStep: () => set((state) => ({ step: Math.max(1, state.step - 1) })),
      resetStep: () => set({ step: 1 }),
    }),
    {
      name: 'review-store',
    }
  )
);

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

export const useTranslationStore = create<TranslationState>()(
  (set, get) => ({
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
  })
); 

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
      setCalledFor: (key, value) => set((state) => ({ calledFor: { ...state.calledFor, [key]: value } })),
      myLoadingResponses: {},
      getMyLoadingResponses: (key) => get().myLoadingResponses[key] || false,
      setMyLoadingResponses: (key, value) => set((state) => ({ myLoadingResponses: { ...state.myLoadingResponses, [key]: value } })),
      clearMyLoadingResponses: (key) => set((state) => ({ myLoadingResponses: { ...state.myLoadingResponses, [key]: {} } })),
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