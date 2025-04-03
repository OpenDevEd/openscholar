"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X, Trash2, ExternalLink, Download } from "lucide-react";
import { startSearch, getSearchResults } from "@/app/actions/openalex";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
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
};

const STORAGE_KEY = "search-history";
const ITEMS_PER_PAGE = 20;

function PageContent() {
  const [results, setResults] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [currentSearchField, setCurrentSearchField] = useState<SearchField>(fields[0]);

  const [searchHistory, setSearchHistory] = useState<SearchResult[]>(() => {
    // Initialize from localStorage if available
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);

  // Update localStorage whenever searchHistory changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      const formData = new FormData(e.currentTarget);
      const count = await startSearch(formData, currentSearchField);
      const query = formData.get("query") as string;
      setSearchHistory((prev) => [...prev, { query, count, field: currentSearchField }]);
      // Clear the form input after successful search
      (e.target as HTMLFormElement).reset();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchResults = async (query: string, searchField: SearchField) => {
    try {
      setIsLoadingResults(true);
      setCurrentQuery(query);
      setCurrentPage(1);
      const results = await getSearchResults(query, searchField);
      setResults(results.results);
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

  const handleDownloadItem = async (item: any, format: 'json' | 'csv') => {
    const filename = `${item.title.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${format}`;
    if (format === 'json') {
      downloadAsFile(JSON.stringify(item, null, 2), filename, 'json');
    } else {
      const csv = await jsonToCSV(item);
      downloadAsFile(csv, filename, 'csv');
    }
  };

  const handleDownloadAll = async (format: 'json' | 'csv') => {
    const filename = `${currentQuery.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_all.${format}`;
    if (format === 'json') {
      downloadAsFile(JSON.stringify(results, null, 2), filename, 'json');
    } else {
      const csv = await jsonToCSV(results);
      downloadAsFile(csv, filename, 'csv');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-background">
      <div className="w-full max-w-xl space-y-6">
        <form
          onSubmit={handleSubmit}
          className="flex w-full items-center space-x-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              name="query"
              placeholder="Search papers..."
              className="pl-10"
              disabled={isLoading}
            />
          </div>
          <Select
            value={currentSearchField}
            onValueChange={(value) => setCurrentSearchField(value as SearchField)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Search in..." />
            </SelectTrigger>
            <SelectContent>
              {fields.map((field) => (
                <SelectItem key={field} value={field}>
                  {field.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              "Search"
            )}
          </Button>
        </form>

        {searchHistory.length > 0 && (
          <div suppressHydrationWarning className="w-full mt-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Results</h2>
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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Search Query</th>
                  <th className="text-right p-2">Count</th>
                  <th className="text-right p-2">Field</th>
                  <th className="w-24 p-2"></th>
                </tr>
              </thead>
              <tbody>
                {searchHistory.map((result, index) => (
                  <tr key={index} className="border-b">
                    <td className="p-2">{result.query}</td>
                    <td className="text-right p-2">
                      {formatNumber(result.count)}
                    </td>
                    <td className="p-2 text-right">
                      {result.field}
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => {
                            handleSearchResults(result.query, result.field || currentSearchField)
                          }}
                          disabled={isLoadingResults}
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
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-[90%] md:max-w-4xl lg:max-w-6xl w-full overflow-hidden">
          <DialogHeader className="flex flex-row justify-between items-center pr-12">
            <DialogTitle className="break-words mr-4">Search Results for "{currentQuery}"</DialogTitle>
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
                              <span className="font-medium">Year: {result.publication_year}</span>
                            </div>
                            {result.abstract && (
                              <p className="mt-3 text-sm text-muted-foreground break-words hyphens-auto overflow-wrap-anywhere">
                                {result.abstract}
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

