import React from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Loader2, X, CalendarIcon, Filter, SortAsc } from "lucide-react";
import { format } from "date-fns";
import { cn, SearchField, fields } from "@/lib/utils";
import { sortOptions } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchFormStore } from "@/lib/store";
import { YearRangePicker } from "./year-range-picker";

interface SearchFormProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function SearchForm({ onSubmit, isLoading }: SearchFormProps) {
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    isFilterActive,
    setCurrentSearchField,
    setDateRange,
    setSortBy,
    setFilterType,
    setIsFilterActive,
    clearDateRange,
    clearYearRange
  } = useSearchFormStore();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  return (
    <Card className="sticky top-4 md:top-8 z-10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Search Academic Papers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="w-full space-y-4">
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
              <SelectTrigger className="">
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
              <SelectTrigger className="">
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
                <SelectTrigger className="">
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
                        "flex-1 sm:w-[280px] justify-start text-left font-normal",
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
                <YearRangePicker />
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
                  className="h-8 px-3 flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
} 