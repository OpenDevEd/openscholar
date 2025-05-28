"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Loader2, X, Trash2, ExternalLink, Download, CalendarIcon, Copy, Star, Filter, SortAsc, FileText, Hash, Calendar as CalendarDays, Users, Quote, TrendingUp, Award, BookOpen, Globe, Lock, Unlock, BarChart3, Target, Layers, Building, Leaf } from "lucide-react";
import { startSearch, getSearchResults } from "@/app/actions/openalex";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn, jsonToCSV, downloadAsFile, SearchField, fields } from "@/lib/utils";
import { SortByWork } from "openalex-sdk/dist/src/types/work";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type SearchResult = {
  query: string;
  count: number;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType?: "date" | "year";
  sortBy?: string;
};

const STORAGE_KEY = "search-history";
const RATINGS_STORAGE_KEY = "paper-ratings";
const ITEMS_PER_PAGE = 20;

const sortOptions = [
  { value: "relevance_score:desc", label: "Relevance (Most Relevant)" },
  { value: "cited_by_count:desc", label: "Citations (Most Cited)" },
  { value: "cited_by_count:asc", label: "Citations (Least Cited)" },
  { value: "publication_date:desc", label: "Publication Date (Newest)" },
  { value: "publication_date:asc", label: "Publication Date (Oldest)" },
  { value: "display_name:desc", label: "Title (Z-A)" },
  { value: "display_name:asc", label: "Title (A-Z)" },
];

function PageContent() {
  const [results, setResults] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [currentSearchField, setCurrentSearchField] = useState<SearchField>(fields[0].value);
  const [resultsSearchField, setResultsSearchField] = useState<SearchField>(fields[0].value);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [resultsDateRange, setResultsDateRange] = useState<DateRange | undefined>();
  const [sortBy, setSortBy] = useState<string>("relevance_score:desc");
  const [filterType, setFilterType] = useState<"date" | "year">("date");
  const [yearRange, setYearRange] = useState<[number, number]>([2020, new Date().getFullYear()]);
  const [resultsYearRange, setResultsYearRange] = useState<[number, number] | undefined>();
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchResult[]>(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(RATINGS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    }
    return {};
  });
  const [expandedAbstracts, setExpandedAbstracts] = useState<Record<string, boolean>>({});
  const [resultsFilter, setResultsFilter] = useState<string>("");

  // Update localStorage whenever searchHistory changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);

  // Update localStorage whenever ratings change
  useEffect(() => {
    localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratings));
  }, [ratings]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      const formData = new FormData(e.currentTarget);
      const rawQuery = formData.get("query") as string;
      // Normalize whitespace: replace newlines, tabs, and multiple spaces with single spaces
      const normalizedQuery = rawQuery.replace(/\s+/g, ' ').trim();
      
      // Create new FormData with normalized query
      const normalizedFormData = new FormData();
      normalizedFormData.set("query", normalizedQuery);
      
      // Determine which range to use based on filter type
      const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
      const effectiveYearRange = (filterType === "year" && isFilterActive) ? yearRange : undefined;
      
      const count = await startSearch(normalizedFormData, currentSearchField, effectiveDateRange, sortBy, effectiveYearRange);
      setSearchHistory((prev) => [...prev, { 
        query: normalizedQuery, 
        count, 
        field: currentSearchField, 
        dateRange: effectiveDateRange,
        yearRange: effectiveYearRange,
        filterType,
        sortBy 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  const handleSearchResults = async (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], filterType?: "date" | "year") => {
    try {
      setIsLoadingResults(true);
      setCurrentQuery(query);
      setCurrentPage(1);
      const results = await getSearchResults(query, searchField, dateRange, sortBy, yearRange);
      setResults(results.results);
      setResultsSearchField(searchField);
      setResultsDateRange(dateRange);
      setResultsYearRange(yearRange);
      setIsDialogOpen(true);
    } finally {
      setIsLoadingResults(false);
    }
  };

  const removeHistoryItem = (index: number) => {
    setSearchHistory((prev) => prev.filter((_, i) => i !== index));
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleRatingChange = (paperId: string, rating: string) => {
    if (rating === "no-rating") {
      setRatings(prev => {
        const newRatings = { ...prev };
        delete newRatings[paperId];
        return newRatings;
      });
    } else {
      setRatings(prev => ({
        ...prev,
        [paperId]: parseInt(rating)
      }));
    }
  };

  const toggleAbstract = (paperId: string) => {
    setExpandedAbstracts(prev => ({
      ...prev,
      [paperId]: !prev[paperId]
    }));
  };

  const handleCopyQuery = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      // You could add a toast notification here if desired
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = query;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const totalCount = searchHistory.reduce((sum, item) => sum + item.count, 0);

  const filteredResults = results.filter(result => {
    if (!resultsFilter.trim()) return true;
    
    const searchTerm = resultsFilter.toLowerCase();
    return (
      result.title?.toLowerCase().includes(searchTerm) ||
      result.abstract?.toLowerCase().includes(searchTerm) ||
      result.authorships?.some((authorship: any) => 
        authorship.author?.display_name?.toLowerCase().includes(searchTerm)
      ) ||
      result.primary_topic?.display_name?.toLowerCase().includes(searchTerm) ||
      result.primary_topic?.subfield?.display_name?.toLowerCase().includes(searchTerm) ||
      result.primary_topic?.field?.display_name?.toLowerCase().includes(searchTerm) ||
      result.primary_topic?.domain?.display_name?.toLowerCase().includes(searchTerm)
    );
  });

  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    resultsContainerRef.current?.scrollTo(0, 0);
  };

  const handleFilterChange = (value: string) => {
    setResultsFilter(value);
    setCurrentPage(1); // Reset to first page when filtering
  };

  const createSearchMetadata = (query: string, searchField: SearchField, dateRange?: DateRange, yearRange?: [number, number]) => {
    const searchParams: any = {
      search: query,
      searchField: searchField,
      perPage: 200,
      AbstractArrayToString: true
    };

    // Add date range filtering if provided
    if (dateRange?.from || dateRange?.to) {
      searchParams.filter = {};
      
      if (dateRange?.from) {
        const fromDate = dateRange.from.toISOString().split('T')[0];
        searchParams.filter.from_publication_date = fromDate;
      }
      
      if (dateRange?.to) {
        const toDate = dateRange.to.toISOString().split('T')[0];
        searchParams.filter.to_publication_date = toDate;
      }
    } else if (yearRange) {
      searchParams.filter = {};
      searchParams.filter.from_publication_date = `${yearRange[0]}-01-01`;
      searchParams.filter.to_publication_date = `${yearRange[1]}-12-31`;
    }

    return {
      search: {
        query: query,
        field: searchField,
        date_range: dateRange ? {
          from: dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : null,
          to: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : null
        } : null,
        year_range: yearRange ? {
          from: yearRange[0],
          to: yearRange[1]
        } : null,
        timestamp: new Date().toISOString(),
        sdk_version: "1.1.6",
        parameters: searchParams
      }
    };
  };

  const handleDownloadItem = async (item: any, format: 'json' | 'csv') => {
    const filename = `${item.title.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${format}`;
    if (format === 'json') {
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
      const itemWithRating = {
        ...item,
        rating: ratings[item.id] !== undefined ? ratings[item.id] : null
      };
      const dataWithMetadata = {
        ...metadata,
        res: itemWithRating
      };
      downloadAsFile(JSON.stringify(dataWithMetadata, null, 2), filename, 'json');
    } else {
      const itemWithRating = {
        ...item,
        rating: ratings[item.id] !== undefined ? ratings[item.id] : null
      };
      const csv = await jsonToCSV(itemWithRating);
      downloadAsFile(csv, filename, 'csv');
    }
  };

  const getEssentialInfo = (item: any) => ({
    id: item.id,
    title: item.title,
    authors: item.authorships?.map((a: { author: { display_name: string } }) => a.author.display_name).join(', ') || '',
    year: item.publication_year,
    abstract: item.abstract || '',
    rating: ratings[item.id] !== undefined ? ratings[item.id] : null
  });

  const handleDownloadEssentialItem = async (item: any, format: 'json' | 'csv') => {
    const essentialInfo = getEssentialInfo(item);
    const filename = `${item.title.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}_essential.${format}`;
    if (format === 'json') {
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
      const dataWithMetadata = {
        ...metadata,
        res: essentialInfo
      };
      downloadAsFile(JSON.stringify(dataWithMetadata, null, 2), filename, 'json');
    } else {
      const csv = await jsonToCSV(essentialInfo);
      downloadAsFile(csv, filename, 'csv');
    }
  };

  const handleDownloadAll = async (format: 'json' | 'csv', onlyEssential: boolean = false) => {
    const filename = `${currentQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${onlyEssential ? 'essential_' : ''}all.${format}`;
    const dataToDownload = onlyEssential 
      ? results.map(getEssentialInfo) 
      : results.map(item => ({
          ...item,
          rating: ratings[item.id] !== undefined ? ratings[item.id] : null
        }));
    if (format === 'json') {
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange, resultsYearRange);
      const dataWithMetadata = {
        ...metadata,
        res: dataToDownload
      };
      downloadAsFile(JSON.stringify(dataWithMetadata, null, 2), filename, 'json');
    } else {
      const csv = await jsonToCSV(dataToDownload);
      downloadAsFile(csv, filename, 'csv');
    }
  };

  // Year range helper functions
  const currentYear = new Date().getFullYear();
  const getYearRangePresets = () => [
    { label: "This Year", range: [currentYear, currentYear] as [number, number] },
    { label: "Last Year", range: [currentYear - 1, currentYear - 1] as [number, number] },
    { label: "Last 5 Years", range: [currentYear - 5, currentYear] as [number, number] },
    { label: "Last 10 Years", range: [currentYear - 10, currentYear] as [number, number] },
    { label: "Last 15 Years", range: [currentYear - 15, currentYear] as [number, number] },
    { label: "Last 20 Years", range: [currentYear - 20, currentYear] as [number, number] },
  ];

  const handleYearRangeChange = (values: number[]) => {
    setYearRange([values[0], values[1]]);
    setIsFilterActive(true);
  };

  const applyYearPreset = (preset: [number, number]) => {
    setYearRange(preset);
    setIsFilterActive(true);
  };

  const clearYearRange = () => {
    setYearRange([2000, currentYear]);
    setIsFilterActive(false);
  };

  const clearDateRange = () => {
    setDateRange(undefined);
    setIsFilterActive(false);
  };

  return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
      <div className="w-full space-y-6">
        <Card className="sticky top-4 md:top-8 z-10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Academic Papers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="w-full space-y-4"
            >
          <div className="flex w-full items-start space-x-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" />
              <Textarea
                name="query"
                placeholder="Search papers... (Enter to search, Shift+Enter for new line)"
                className="pl-10 min-h-12 resize-none w-full"
                disabled={isLoading}
                onKeyDown={handleKeyDown}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="h-12 w-12 flex-shrink-0" size="icon">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          <div className="flex flex-col sm:flex-row w-full items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
            <Select
              value={currentSearchField}
              onValueChange={(value) => setCurrentSearchField(value as SearchField)}
            >
              <SelectTrigger className=" h-10">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  <SelectValue placeholder="Search in..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                {fields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select
              value={sortBy}
              onValueChange={setSortBy}
            >
              <SelectTrigger className="h-10">
                <div className="flex items-center gap-2">
                  <SortAsc className="h-4 w-4" />
                  <SelectValue placeholder="Sort by..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="flex w-full sm:w-auto items-center space-x-2">
              <Select
                value={filterType}
                onValueChange={(value) => setFilterType(value as "date" | "year")}
              >
                <SelectTrigger className="h-10">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Date Range</SelectItem>
                  <SelectItem value="year">Year Range</SelectItem>
                </SelectContent>
              </Select>

              {filterType === "date" ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 sm:w-[280px] h-10 justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {isFilterActive ? (
                        dateRange?.from ? (
                          dateRange.to ? (
                            <>
                              {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                            </>
                          ) : (
                            `From ${format(dateRange.from, "MMM dd, yyyy")}`
                          )
                        ) : (
                          <span>Pick a date range</span>
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={(range) => {
                        setDateRange(range);
                        setIsFilterActive(!!range?.from);
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 sm:w-[280px] h-10 justify-start text-left font-normal",
                        !isFilterActive && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      <span>{isFilterActive ? `${yearRange[0]} - ${yearRange[1]}` : "Pick a year range"}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-4" align="start">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Year Range: {yearRange[0]} - {yearRange[1]}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={clearYearRange}
                          className="h-6 px-2 text-xs"
                        >
                          Reset
                        </Button>
                      </div>
                      
                      <div className="px-2">
                        <Slider
                          value={yearRange}
                          onValueChange={handleYearRangeChange}
                          min={1900}
                          max={currentYear}
                          step={1}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>1900</span>
                          <span>{currentYear}</span>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">Quick presets:</div>
                        <div className="grid grid-cols-2 gap-1">
                          {getYearRangePresets().map((preset) => (
                            <Button
                              key={preset.label}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => applyYearPreset(preset.range)}
                              className="h-7 px-2 text-xs"
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              
              {isFilterActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (filterType === "date") {
                      clearDateRange();
                    } else {
                      clearYearRange();
                    }
                  }}
                  className="h-10 px-3 flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
          </CardContent>
        </Card>

        {searchHistory.length > 0 && (
          <Card suppressHydrationWarning className="w-full mt-6">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Search Results
                </CardTitle>
                <div className="flex gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Download Table
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        const data = searchHistory.map(item => ({
                          search_query: item.query,
                          count: item.count,
                          field: item.field,
                        }));
                        const totalRow = { search_query: 'Total', count: totalCount, field: "" };
                        data.push(totalRow as any);
                        downloadAsFile(JSON.stringify(data, null, 2), 'search_history.json', 'json');
                      }}>
                        Download as JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        const data = searchHistory.map(item => ({
                          search_query: item.query,
                          count: item.count,
                          field: item.field,
                        }));
                        const totalRow = { search_query: 'Total', count: totalCount, field: "" };
                        data.push(totalRow as any);
                        const csv = await jsonToCSV(data);
                        downloadAsFile(csv, 'search_history.csv', 'csv');
                      }}>
                        Download as CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={clearHistory}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4" />
                        Search Query
                      </div>
                    </TableHead>
                    <TableHead className="text-right w-1/8">
                      <div className="flex items-center justify-end gap-2">
                        <Hash className="h-4 w-4" />
                        Count
                      </div>
                    </TableHead>
                    <TableHead className="text-right w-1/8">
                      <div className="flex items-center justify-end gap-2">
                        <Filter className="h-4 w-4" />
                        Field
                      </div>
                    </TableHead>
                    <TableHead className="text-right w-1/8">
                      <div className="flex items-center justify-end gap-2">
                        <CalendarDays className="h-4 w-4" />
                        Date/Year Range
                      </div>
                    </TableHead>
                    <TableHead className="text-right w-1/8">
                      <div className="flex items-center justify-end gap-2">
                        <SortAsc className="h-4 w-4" />
                        Sort
                      </div>
                    </TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchHistory.map((result, index) => (
                    <TableRow key={index}>
                      <TableCell className="max-w-0">
                        <div className="truncate" title={result.query}>
                          {result.query}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatNumber(result.count)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {result.field}
                      </TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap">
                        {result.filterType === "year" && result.yearRange ? (
                          `${result.yearRange[0]} - ${result.yearRange[1]}`
                        ) : result.dateRange?.from ? (
                          result.dateRange.to ? (
                            <>
                              {format(result.dateRange.from, "MMM dd, yyyy")} - {format(result.dateRange.to, "MMM dd, yyyy")}
                            </>
                          ) : (
                            `From ${format(result.dateRange.from, "MMM dd, yyyy")}`
                          )
                        ) : (
                          "All dates"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap">
                        {result.sortBy ? sortOptions.find(opt => opt.value === result.sortBy)?.label || result.sortBy : "Relevance"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => handleCopyQuery(result.query)}
                            title="Copy search query"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => {
                              handleSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType)
                            }}
                            disabled={isLoadingResults}
                            title="View search results"
                          >
                            {isLoadingResults ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ExternalLink className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeHistoryItem(index)}
                            title="Remove from history"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{formatNumber(totalCount)}</TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <ResponsiveModal 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        title={`Search Results for "${currentQuery}" in ${fields.find(f => f.value === resultsSearchField)?.label || resultsSearchField}`}
        searchQuery={currentQuery}
        searchField={fields.find(f => f.value === resultsSearchField)?.label || resultsSearchField}
        resultCount={results.length}
        dateRange={resultsDateRange?.from && resultsDateRange?.to ? (
          `${format(resultsDateRange.from, "MMM dd, yyyy")} - ${format(resultsDateRange.to, "MMM dd, yyyy")}`
        ) : resultsDateRange?.from ? (
          `From ${format(resultsDateRange.from, "MMM dd, yyyy")}`
        ) : resultsYearRange ? (
          `${resultsYearRange[0]} - ${resultsYearRange[1]}`
        ) : undefined}
        sortBy={sortOptions.find(opt => opt.value === sortBy)?.label || "Relevance"}
        headerActions={results.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Download All
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownloadAll('json')}>
                Download as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownloadAll('csv')}>
                Download as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownloadAll('json', true)}>
                Download Essential Info as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownloadAll('csv', true)}>
                Download Essential Info as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined}
      >
        <div className="flex flex-col md:h-auto h-full">
          <div className="flex-shrink-0 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search within results..."
                value={resultsFilter}
                onChange={(e) => handleFilterChange(e.target.value)}
                className="pl-10"
              />
            </div>
            {resultsFilter && (
              <div className="mt-2 text-xs text-muted-foreground">
                Showing {filteredResults.length} of {results.length} results
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto md:max-h-[60vh]" ref={resultsContainerRef}>
            <div className="space-y-4">
              {isLoadingResults ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <>
                  {paginatedResults.map((result, index) => (
                    <div
                      key={index}
                      className="border rounded-lg hover:bg-accent/50 transition-colors group"
                    >
                      <div className="p-4 overflow-hidden">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Select
                                value={ratings[result.id]?.toString() || "no-rating"}
                                onValueChange={(value) => handleRatingChange(result.id, value)}
                              >
                                <SelectTrigger className="min-w-48">
                                  <div className="flex items-center gap-2">
                                    <Star className="h-4 w-4" />
                                    <SelectValue />
                                  </div>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="no-rating">No Rating</SelectItem>
                                  <SelectItem value="0">☆ 0 Stars</SelectItem>
                                  <SelectItem value="1">⭐ 1 Star</SelectItem>
                                  <SelectItem value="2">⭐⭐ 2 Stars</SelectItem>
                                  <SelectItem value="3">⭐⭐⭐ 3 Stars</SelectItem>
                                  <SelectItem value="4">⭐⭐⭐⭐ 4 Stars</SelectItem>
                                  <SelectItem value="5">⭐⭐⭐⭐⭐ 5 Stars</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <a
                              href={result.id}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group-hover:underline"
                            >
                              <h3 className="font-medium text-lg break-all hyphens-auto">
                                {result.title}
                              </h3>
                            </a>
                            
                            {/* Authors and Year */}
                            <div className="text-sm text-muted-foreground mt-2 space-y-1">
                              {result.authorships && (
                                <div className="flex items-center gap-2">
                                  <Users className="h-4 w-4 flex-shrink-0" />
                                  <span>{result.authorships
                                    .map((author: { author: { display_name: string } }) => author.author.display_name)
                                    .join(', ')}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 flex-shrink-0" />
                                <span className="font-medium">Year: {result.publication_year}</span>
                              </div>
                            </div>

                            {/* Citation Metrics */}
                            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Quote className="h-3 w-3" />
                                <span className="font-medium">Cites:</span>
                                <span>{result.referenced_works_count || 0}</span>
                              </div>
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <TrendingUp className="h-3 w-3" />
                                <span className="font-medium">Cited by:</span>
                                <span>{result.cited_by_count || 0}</span>
                              </div>
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <BookOpen className="h-3 w-3" />
                                <span className="font-medium">Related:</span>
                                <span>{result.related_works_count || 0}</span>
                              </div>
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <BarChart3 className="h-3 w-3" />
                                <span className="font-medium">FWCI:</span>
                                <span>{result.fwci ? result.fwci.toFixed(2) : 'N/A'}</span>
                              </div>
                            </div>

                            {/* Percentiles */}
                            {(result.cited_by_percentile_year || result.cited_by_percentile_year) && (
                              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                {result.cited_by_percentile_year && (
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <Award className="h-3 w-3" />
                                    <span className="font-medium">Citation Percentile (Year):</span>
                                    <span>{result.cited_by_percentile_year.min}-{result.cited_by_percentile_year.max}%</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Academic Classification */}
                            <div className="mt-3 space-y-2">
                              {result.primary_topic && (
                                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <Target className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-medium">Topic:</span>
                                    <span className="ml-1">{result.primary_topic.display_name}</span>
                                  </div>
                                </div>
                              )}
                              
                              {result.primary_topic?.subfield && (
                                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <Layers className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-medium">Subfield:</span>
                                    <span className="ml-1">{result.primary_topic.subfield.display_name}</span>
                                  </div>
                                </div>
                              )}
                              
                              {result.primary_topic?.field && (
                                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <BookOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-medium">Field:</span>
                                    <span className="ml-1">{result.primary_topic.field.display_name}</span>
                                  </div>
                                </div>
                              )}
                              
                              {result.primary_topic?.domain && (
                                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <Building className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-medium">Domain:</span>
                                    <span className="ml-1">{result.primary_topic.domain.display_name}</span>
                                  </div>
                                </div>
                              )}
                              
                              {result.sustainable_development_goals && result.sustainable_development_goals.length > 0 && (
                                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <Leaf className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <span className="font-medium">SDGs:</span>
                                    <div className="ml-1 flex flex-wrap gap-1 mt-1">
                                      {result.sustainable_development_goals.map((sdg: { id: string; display_name: string; score: number }, index: number) => (
                                        <span 
                                          key={sdg.id}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                                          title={`${sdg.display_name} (Score: ${sdg.score?.toFixed(2) || 'N/A'})`}
                                        >
                                          {sdg.display_name}
                                          {sdg.score && (
                                            <span className="text-green-600 font-medium">
                                              {sdg.score.toFixed(2)}
                                            </span>
                                          )}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Open Access Status */}
                            {result.open_access && (
                              <div className="mt-3 flex items-center gap-2 text-xs">
                                {result.open_access.is_oa ? (
                                  <div className="flex items-center gap-1 text-green-600">
                                    <Unlock className="h-3 w-3" />
                                    <span className="font-medium">Open Access</span>
                                    {result.open_access.oa_type && (
                                      <span className="text-muted-foreground">({result.open_access.oa_type})</span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <Lock className="h-3 w-3" />
                                    <span className="font-medium">Closed Access</span>
                                  </div>
                                )}
                                {result.open_access.oa_url && (
                                  <a 
                                    href={result.open_access.oa_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-blue-600 hover:underline"
                                  >
                                    <Globe className="h-3 w-3" />
                                    <span>View PDF</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {result.abstract && (
                              <div className="mt-3">
                                <p className="text-sm text-muted-foreground break-words hyphens-auto overflow-wrap-anywhere">
                                  {expandedAbstracts[result.id] 
                                    ? result.abstract
                                    : result.abstract.length > 500 
                                      ? `${result.abstract.slice(0, 500)}...` 
                                      : result.abstract
                                  }
                                </p>
                                {result.abstract.length > 500 && (
                                  <button
                                    onClick={() => toggleAbstract(result.id)}
                                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                  >
                                    {expandedAbstracts[result.id] ? 'Show Less' : 'Show More'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Download className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleDownloadItem(result, 'json')}>
                                Download as JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownloadItem(result, 'csv')}>
                                Download as CSV
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownloadEssentialItem(result, 'json')}>
                                Download Essential Info as JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownloadEssentialItem(result, 'csv')}>
                                Download Essential Info as CSV
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  ))}
                  {paginatedResults.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      {resultsFilter ? 'No results match your search' : 'No results found'}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          {filteredResults.length > 0 && (
            <div className="flex-shrink-0 pt-4 md:pt-4 border-t md:border-t-0">
              <Pagination>
                <PaginationContent className="flex-wrap justify-center">
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                      className={cn(
                        "cursor-pointer",
                        currentPage === 1 && "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => handlePageChange(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                      className={cn(
                        "cursor-pointer",
                        currentPage === totalPages &&
                          "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      </ResponsiveModal>
    </main>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });

