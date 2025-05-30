import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Loader2, X, Trash2, ExternalLink, Download, Copy, Filter, SortAsc, FileText, Hash, Calendar as CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { jsonToCSV, downloadAsFile, SearchField } from "@/lib/utils";
import { sortOptions } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSearchHistoryStore } from "@/lib/store";
import { DateRange } from "react-day-picker";

interface SearchHistoryProps {
  onSearchResults: (query: string, searchField: SearchField, dateRange?: DateRange, sortBy?: string, yearRange?: [number, number], filterType?: "date" | "year", index?: number) => void;
  loadingResultIndex: number | null;
  currentSearchField: SearchField;
}

export function SearchHistory({ onSearchResults, loadingResultIndex, currentSearchField }: SearchHistoryProps) {
  const { searchHistory, removeSearchResult, clearSearchHistory } = useSearchHistoryStore();

  const handleCopyQuery = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
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

  if (searchHistory.length === 0) {
    return null;
  }

  return (
    <Card suppressHydrationWarning className="w-full mt-6">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="items-center gap-2 hidden md:flex">
            <FileText className="h-5 w-5" />  
            Search History
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
              onClick={clearSearchHistory}
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
              <TableHead className="sticky right-0 bg-background"></TableHead>
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
                <TableCell className="text-right sticky right-0 bg-background">
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
                        onSearchResults(result.query, result.field || currentSearchField, result.dateRange, result.sortBy, result.yearRange, result.filterType, index)
                      }}
                      disabled={loadingResultIndex === index}
                      title="View search results"
                    >
                      {loadingResultIndex === index ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSearchResult(index)}
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
              <TableCell className="sticky right-0 bg-background"></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
} 