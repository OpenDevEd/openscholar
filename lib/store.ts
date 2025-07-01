import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DateRange } from "react-day-picker";
import type { SearchField, QueryHistoryEntry } from './types';
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
  addSearchResult: (result: Omit<SearchResult, 'id' | 'createdAt' | 'updatedAt' | 'queryHistory'>) => string
  updateSearchResult: (id: string, updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>) => void
  addQueryToHistory: (id: string, query: string) => void
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
      version: 2, // Increment when migrations are needed
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
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      clearConfig: () => set({ provider: 'openai', apiKey: '' }),
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

export const useThemeToggleStore = create<ThemeToggleState>((set) => ({
  mounted: false,
  setMounted: (mounted) => set({ mounted }),
}))

export const useCurrentQueryStore = create<CurrentQueryState>((set) => ({
  currentQuery: '',
  setCurrentQuery: (query) => set({ currentQuery: query }),
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