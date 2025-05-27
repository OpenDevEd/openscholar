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
import { Search, Loader2, X, Trash2, ExternalLink, Download, CalendarIcon, Copy, Star, Filter, SortAsc, FileText, Hash, Calendar as CalendarDays, Users } from "lucide-react";
import { startSearch, getSearchResults } from "@/app/actions/openalex";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type SearchResult = {
  query: string;
  count: number;
  field: SearchField;
  dateRange?: DateRange;
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
  const [currentSearchField, setCurrentSearchField] = useState<SearchField>(fields[0]);
  const [resultsSearchField, setResultsSearchField] = useState<SearchField>(fields[0]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [resultsDateRange, setResultsDateRange] = useState<DateRange | undefined>();
  const [sortBy, setSortBy] = useState<string>("relevance_score:desc");
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
      
      const count = await startSearch(normalizedFormData, currentSearchField, dateRange, sortBy);
      setSearchHistory((prev) => [...prev, { query: normalizedQuery, count, field: currentSearchField, dateRange, sortBy }]);
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

  const handleSearchResults = async (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string) => {
    try {
      setIsLoadingResults(true);
      setCurrentQuery(query);
      setCurrentPage(1);
      const results = await getSearchResults(query, searchField, dateRange, sortBy);
      setResults(results.results);
      setResultsSearchField(searchField);
      setResultsDateRange(dateRange);
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

  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
  const paginatedResults = results.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    resultsContainerRef.current?.scrollTo(0, 0);
  };

  const createSearchMetadata = (query: string, searchField: SearchField, dateRange?: DateRange) => {
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
    }

    return {
      search: {
        query: query,
        field: searchField,
        date_range: dateRange ? {
          from: dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : null,
          to: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : null
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
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange);
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
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange);
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
      const metadata = createSearchMetadata(currentQuery, resultsSearchField, resultsDateRange);
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
                  <SelectItem key={field} value={field}>
                    {field.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
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
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                        </>
                      ) : (
                        `From ${format(dateRange.from, "MMM dd, yyyy")}`
                      )
                    ) : (
                      <span>Filter by publication date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
              
              {dateRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateRange(undefined)}
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
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[600px]">
                                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 w-1/3">
                        <div className="flex items-center gap-2">
                          <Search className="h-4 w-4" />
                          Search Query
                        </div>
                      </th>
                      <th className="text-right p-2 w-1/8">
                        <div className="flex items-center justify-end gap-2">
                          <Hash className="h-4 w-4" />
                          Count
                        </div>
                      </th>
                      <th className="text-right p-2 w-1/8">
                        <div className="flex items-center justify-end gap-2">
                          <Filter className="h-4 w-4" />
                          Field
                        </div>
                      </th>
                      <th className="text-right p-2 w-1/8">
                        <div className="flex items-center justify-end gap-2">
                          <CalendarDays className="h-4 w-4" />
                          Date Range
                        </div>
                      </th>
                      <th className="text-right p-2 w-1/8">
                        <div className="flex items-center justify-end gap-2">
                          <SortAsc className="h-4 w-4" />
                          Sort
                        </div>
                      </th>
                      <th className="w-24 p-2"></th>
                    </tr>
                  </thead>
                <tbody>
                  {searchHistory.map((result, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 max-w-0">
                        <div className="truncate" title={result.query}>
                          {result.query}
                        </div>
                      </td>
                      <td className="text-right p-2 whitespace-nowrap">
                        {formatNumber(result.count)}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {result.field}
                      </td>
                      <td className="p-2 text-right text-sm whitespace-nowrap">
                        {result.dateRange?.from ? (
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
                      </td>
                      <td className="p-2 text-right text-sm whitespace-nowrap">
                        {result.sortBy ? sortOptions.find(opt => opt.value === result.sortBy)?.label || result.sortBy : "Relevance"}
                      </td>
                      <td className="p-2 text-right">
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
                              handleSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy)
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
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="p-2">Total</td>
                    <td className="text-right p-2">{formatNumber(totalCount)}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-[90%] md:max-w-4xl lg:max-w-6xl w-full overflow-hidden">
          <DialogHeader className="flex flex-row justify-between items-center pr-12">
            <DialogTitle className="break-words mr-4">
              Search Results for "{currentQuery}" in {resultsSearchField.split('_').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
              ).join(' ')}
            </DialogTitle>
            {results.length > 0 && (
              <div className="flex-shrink-0">
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
              </div>
            )}
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh]" ref={resultsContainerRef}>
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
                            <div className="text-sm text-muted-foreground mt-2">
                              {result.authorships && (
                                <div className="mb-1 flex items-center gap-2">
                                  <Users className="h-4 w-4" />
                                  {result.authorships
                                    .map((author: { author: { display_name: string } }) => author.author.display_name)
                                    .join(', ')}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4" />
                                <span className="font-medium">Year: {result.publication_year}</span>
                              </div>
                            </div>
                            {result.abstract && (
                              <p className="mt-3 text-sm text-muted-foreground break-words hyphens-auto overflow-wrap-anywhere">
                                {result.abstract.length > 500 
                                  ? `${result.abstract.slice(0, 500)}...` 
                                  : result.abstract}
                              </p>
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
                  {results.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      No results found
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          {results.length > 0 && (
            <div>
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
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });

