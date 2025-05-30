import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DateRange } from "react-day-picker";
import { SearchField } from './utils';
import { DEFAULT_YEAR_RANGE } from './constants';

export type SearchResult = {
  query: string;
  count: number;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType?: "date" | "year";
  sortBy?: string;
};

interface RatingsState {
  ratings: Record<string, number>
  setRating: (paperId: string, rating: number | null) => void
  clearRatings: () => void
}

interface SearchHistoryState {
  searchHistory: SearchResult[]
  addSearchResult: (result: SearchResult) => void
  removeSearchResult: (index: number) => void
  clearSearchHistory: () => void
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
  setCurrentSearchField: (field: SearchField) => void
  setDateRange: (range?: DateRange) => void
  setSortBy: (sortBy: string) => void
  setFilterType: (type: "date" | "year") => void
  setYearRange: (range: [number, number]) => void
  setIsFilterActive: (active: boolean) => void
  setYearFromInput: (value: string) => void
  setYearToInput: (value: string) => void
  clearDateRange: () => void
  clearYearRange: () => void
}

interface UIState {
  isDialogOpen: boolean
  loadingResultIndex: number | null
  isLoadingResults: boolean
  isLoading: boolean
  isFocusModeOpen: boolean
  setIsDialogOpen: (open: boolean) => void
  setLoadingResultIndex: (index: number | null) => void
  setIsLoadingResults: (loading: boolean) => void
  setIsLoading: (loading: boolean) => void
  setIsFocusModeOpen: (open: boolean) => void
}

interface ResultsState {
  results: any[]
  currentQuery: string
  currentPage: number
  resultsSearchField: SearchField
  resultsDateRange?: DateRange
  resultsYearRange?: [number, number]
  expandedAbstracts: Record<string, boolean>
  resultsFilter: string
  setResults: (results: any[]) => void
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
    (set) => ({
      searchHistory: [],
      addSearchResult: (result: SearchResult) =>
        set((state) => ({
          searchHistory: [result, ...state.searchHistory],
        })),
      removeSearchResult: (index: number) =>
        set((state) => ({
          searchHistory: state.searchHistory.filter((_, i) => i !== index),
        })),
      clearSearchHistory: () => set({ searchHistory: [] }),
    }),
    {
      name: 'search-history-store',
    }
  )
)

export const useSearchFormStore = create<SearchFormState>((set) => ({
  currentSearchField: "title_and_abstract",
  dateRange: undefined,
  sortBy: "relevance_score:desc",
  filterType: "year",
  yearRange: DEFAULT_YEAR_RANGE,
  isFilterActive: false,
  yearFromInput: DEFAULT_YEAR_RANGE[0].toString(),
  yearToInput: new Date().getFullYear().toString(),
  setCurrentSearchField: (field) => set({ currentSearchField: field }),
  setDateRange: (range) => set({ dateRange: range }),
  setSortBy: (sortBy) => set({ sortBy }),
  setFilterType: (type) => set({ filterType: type }),
  setYearRange: (range) => set({ yearRange: range }),
  setIsFilterActive: (active) => set({ isFilterActive: active }),
  setYearFromInput: (value) => set({ yearFromInput: value }),
  setYearToInput: (value) => set({ yearToInput: value }),
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
}))

export const useUIStore = create<UIState>((set) => ({
  isDialogOpen: false,
  loadingResultIndex: null,
  isLoadingResults: false,
  isLoading: false,
  isFocusModeOpen: false,
  setIsDialogOpen: (open) => set({ isDialogOpen: open }),
  setLoadingResultIndex: (index) => set({ loadingResultIndex: index }),
  setIsLoadingResults: (loading) => set({ isLoadingResults: loading }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsFocusModeOpen: (open) => set({ isFocusModeOpen: open }),
}))

export const useResultsStore = create<ResultsState>((set) => ({
  results: [],
  currentQuery: "",
  currentPage: 1,
  resultsSearchField: "title_and_abstract",
  resultsDateRange: undefined,
  resultsYearRange: undefined,
  expandedAbstracts: {},
  resultsFilter: "",
  setResults: (results) => set({ results }),
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