import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DateRange } from "react-day-picker";
import { SearchField } from './utils';
import { DEFAULT_YEAR_RANGE } from './constants';

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
  count: number;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType?: "date" | "year";
  sortBy?: string;
  selectedRegions?: string[];
  isCountryFilterActive?: boolean;
  selectedCountryFocus?: string[];
  isCountryFocusActive?: boolean;
  ratingRange?: [number, number];
  isRatingFilterActive?: boolean;
  onlyRatedPapers?: boolean;
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
  addSearchResult: (result: Omit<SearchResult, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateSearchResult: (id: string, updates: Partial<Omit<SearchResult, 'id' | 'createdAt'>>) => void
  getSearchResult: (id: string) => SearchResult | undefined
  removeSearchResult: (index: number) => void
  clearSearchHistory: () => void
  migrateSearchResult: (result: SearchResult) => string
  importSearchHistory: (data: any[]) => number
}

interface SearchFormState {
  currentSearchField: SearchField
  dateRange?: DateRange
  sortBy: string
  filterType: "date" | "year"
  yearRange: [number, number]
  isFilterActive: boolean
  yearFromInput: string
  yearToInput: string
  currentSearchId?: string
  ratingRange: [number, number]
  isRatingFilterActive: boolean
  onlyRatedPapers: boolean
  selectedRegions: string[]
  isCountryFilterActive: boolean
  // Country focus filter (adds country names to search string)
  selectedCountryFocus: string[]
  isCountryFocusActive: boolean
  setCurrentSearchField: (field: SearchField) => void
  setDateRange: (range?: DateRange) => void
  setSortBy: (sortBy: string) => void
  setFilterType: (type: "date" | "year") => void
  setYearRange: (range: [number, number]) => void
  setIsFilterActive: (active: boolean) => void
  setYearFromInput: (value: string) => void
  setYearToInput: (value: string) => void
  setCurrentSearchId: (id?: string) => void
  setRatingRange: (range: [number, number]) => void
  setIsRatingFilterActive: (active: boolean) => void
  setOnlyRatedPapers: (onlyRatedPapers: boolean) => void
  setSelectedRegions: (regions: string[]) => void
  setIsCountryFilterActive: (active: boolean) => void
  addRegion: (region: string) => void
  removeRegion: (region: string) => void
  clearCountryFilter: () => void
  // Country focus filter methods
  setSelectedCountryFocus: (regions: string[]) => void
  setIsCountryFocusActive: (active: boolean) => void
  addCountryFocus: (region: string) => void
  removeCountryFocus: (region: string) => void
  clearCountryFocus: () => void
  clearDateRange: () => void
  clearYearRange: () => void
  clearRatingFilter: () => void
  loadSearchState: (searchResult: SearchResult) => void
}

interface UIState {
  isDialogOpen: boolean
  loadingResultIndex: number | null
  isLoadingResults: boolean
  isLoading: boolean
  isUpdatingCurrentSearch: boolean
  isCreatingNewSearch: boolean
  isFilterLoading: boolean
  isFocusModeOpen: boolean
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsLoadingResults: (loading: boolean) => void
  setIsLoading: (loading: boolean) => void
  setIsUpdatingCurrentSearch: (loading: boolean) => void
  setIsCreatingNewSearch: (loading: boolean) => void
  setIsFilterLoading: (loading: boolean) => void
  setIsFocusModeOpen: (open: boolean) => void
}

interface ResultsState {
  results: any[]
  totalCount: number
  currentQuery: string
  currentPage: number
  resultsSearchField: SearchField
  resultsDateRange?: DateRange
  resultsYearRange?: [number, number]
  expandedAbstracts: Record<string, boolean>
  resultsFilter: string
  setResults: (results: any[], totalCount?: number) => void
  setCurrentQuery: (query: string) => void
  setCurrentPage: (page: number) => void
  setResultsSearchField: (field: SearchField) => void
  setResultsDateRange: (range?: DateRange) => void
  setResultsYearRange: (range?: [number, number]) => void
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
          
          // Skip items without required fields
          if (!query || typeof count !== 'number') {
            return;
          }
          
          // Create a new search result with generated ID and timestamps
          const id = generateUUID();
          const now = new Date().toISOString();
          const newResult: SearchResult = {
            id,
            query,
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
    }
  )
)

export const useSearchFormStore = create<SearchFormState>((set, get) => ({
  currentSearchField: "title_and_abstract",
  dateRange: undefined,
  sortBy: "relevance_score:desc",
  filterType: "year",
  yearRange: DEFAULT_YEAR_RANGE,
  isFilterActive: false,
  yearFromInput: DEFAULT_YEAR_RANGE[0].toString(),
  yearToInput: new Date().getFullYear().toString(),
  currentSearchId: undefined,
  ratingRange: [0, 5],
  isRatingFilterActive: false,
  onlyRatedPapers: false,
  selectedRegions: [],
  isCountryFilterActive: false,
  // Country focus filter initial state
  selectedCountryFocus: [],
  isCountryFocusActive: false,
  setCurrentSearchField: (field) => set({ currentSearchField: field }),
  setDateRange: (range) => set({ dateRange: range }),
  setSortBy: (sortBy) => set({ sortBy }),
  setFilterType: (type) => set({ filterType: type }),
  setYearRange: (range) => set({ yearRange: range }),
  setIsFilterActive: (active) => set({ isFilterActive: active }),
  setYearFromInput: (value) => set({ yearFromInput: value }),
  setYearToInput: (value) => set({ yearToInput: value }),
  setCurrentSearchId: (id) => set({ currentSearchId: id }),
  setRatingRange: (range) => set({ ratingRange: range }),
  setIsRatingFilterActive: (active) => set({ isRatingFilterActive: active }),
  setOnlyRatedPapers: (onlyRatedPapers) => set({ onlyRatedPapers }),
  setSelectedRegions: (regions) => set({ selectedRegions: regions }),
  setIsCountryFilterActive: (active) => set({ isCountryFilterActive: active }),
  addRegion: (region) => set((state) => ({
    selectedRegions: [...state.selectedRegions, region],
  })),
  removeRegion: (region) => set((state) => ({
    selectedRegions: state.selectedRegions.filter((r) => r !== region),
  })),
  clearCountryFilter: () => set({ selectedRegions: [], isCountryFilterActive: false }),
  // Country focus filter implementations
  setSelectedCountryFocus: (regions) => set({ selectedCountryFocus: regions }),
  setIsCountryFocusActive: (active) => set({ isCountryFocusActive: active }),
  addCountryFocus: (region) => set((state) => ({
    selectedCountryFocus: [...state.selectedCountryFocus, region],
  })),
  removeCountryFocus: (region) => set((state) => ({
    selectedCountryFocus: state.selectedCountryFocus.filter((r) => r !== region),
  })),
  clearCountryFocus: () => set({ selectedCountryFocus: [], isCountryFocusActive: false }),
  clearDateRange: () => set({ dateRange: undefined, isFilterActive: false }),
  clearYearRange: () => {
    const currentYear = new Date().getFullYear();
    set({ 
      yearRange: [1900, currentYear],
      yearFromInput: "1900",
      yearToInput: currentYear.toString(),
      isFilterActive: false 
    });
  },
  clearRatingFilter: () => set({ ratingRange: [0, 5], isRatingFilterActive: false, onlyRatedPapers: false }),
  loadSearchState: (searchResult) => {
    set({
      currentSearchField: searchResult.field,
      dateRange: searchResult.dateRange,
      sortBy: searchResult.sortBy || "relevance_score:desc",
      filterType: searchResult.filterType || "year",
      yearRange: searchResult.yearRange || DEFAULT_YEAR_RANGE,
      isFilterActive: !!(searchResult.dateRange || searchResult.yearRange),
      yearFromInput: searchResult.yearRange?.[0]?.toString() || DEFAULT_YEAR_RANGE[0].toString(),
      yearToInput: searchResult.yearRange?.[1]?.toString() || new Date().getFullYear().toString(),
      currentSearchId: searchResult.id,
      selectedRegions: searchResult.selectedRegions || [],
      isCountryFilterActive: searchResult.isCountryFilterActive || false,
      selectedCountryFocus: searchResult.selectedCountryFocus || [],
      isCountryFocusActive: searchResult.isCountryFocusActive || false,
      ratingRange: searchResult.ratingRange || [0, 5],
      isRatingFilterActive: searchResult.isRatingFilterActive || false,
      onlyRatedPapers: searchResult.onlyRatedPapers || false,
    });
  },
}))

export const useUIStore = create<UIState>((set) => ({
  isDialogOpen: false,
  loadingResultIndex: null,
  isLoadingResults: false,
  isLoading: false,
  isUpdatingCurrentSearch: false,
  isCreatingNewSearch: false,
  isFilterLoading: false,
  isFocusModeOpen: false,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
  setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
  setIsLoadingResults: (loading) => set({ isLoadingResults: loading }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsUpdatingCurrentSearch: (loading) => set({ isUpdatingCurrentSearch: loading }),
  setIsCreatingNewSearch: (loading) => set({ isCreatingNewSearch: loading }),
  setIsFilterLoading: (loading) => set({ isFilterLoading: loading }),
  setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
}))

export const useResultsStore = create<ResultsState>((set) => ({
  results: [],
  totalCount: 0,
  currentQuery: "",
  currentPage: 1,
  resultsSearchField: "title_and_abstract",
  resultsDateRange: undefined,
  resultsYearRange: undefined,
  expandedAbstracts: {},
  resultsFilter: "",
  setResults: (results, totalCount) => set({ results, totalCount }),
  setCurrentQuery: (query) => set({ currentQuery: query }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setResultsSearchField: (field) => set({ resultsSearchField: field }),
  setResultsDateRange: (range) => set({ resultsDateRange: range }),
  setResultsYearRange: (range) => set({ resultsYearRange: range }),
  toggleAbstract: (paperId) => set((state) => ({
    expandedAbstracts: {
      ...state.expandedAbstracts,
      [paperId]: !state.expandedAbstracts[paperId]
    }
  })),
  setResultsFilter: (filter) => set({ resultsFilter: filter, currentPage: 1 }),
  clearResults: () => set({ 
    results: [], 
    totalCount: 0,
    currentQuery: "", 
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
            warnings.push(`Keyword "${keyword}" not found`);
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

interface NavbarState {
  query: string
  setQuery: (query: string) => void
}

interface PageContentState {
  currentQuery: string
  setCurrentQuery: (query: string) => void
}

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

export const useThemeToggleStore = create<ThemeToggleState>((set) => ({
  mounted: false,
  setMounted: (mounted) => set({ mounted }),
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

export const useNavbarStore = create<NavbarState>((set) => ({
  query: '',
  setQuery: (query) => set({ query: query }),
}))

export const usePageContentStore = create<PageContentState>((set) => ({
  currentQuery: '',
  setCurrentQuery: (query) => set({ currentQuery: query }),
}))

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