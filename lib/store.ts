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
  isFilterLoading: boolean
  isFocusModeOpen: boolean
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsLoadingResults: (loading: boolean) => void
  setIsLoading: (loading: boolean) => void
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
    });
  },
}))

export const useUIStore = create<UIState>((set) => ({
  isDialogOpen: false,
  loadingResultIndex: null,
  isLoadingResults: false,
  isLoading: false,
  isFilterLoading: false,
  isFocusModeOpen: false,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
  setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
  setIsLoadingResults: (loading) => set({ isLoadingResults: loading }),
  setIsLoading: (loading) => set({ isLoading: loading }),
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