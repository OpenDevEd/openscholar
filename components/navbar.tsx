import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Menu, Loader2, Home, Clock, Plus, RotateCcw, MoreHorizontal, BookOpen, Sparkles } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { KeywordExpansionDialog } from "./keyword-expansion-dialog";
import { KeywordExpansionPreview } from "./keyword-expansion-preview";
import { KeywordExpansionTooltip } from "./keyword-expansion-tooltip";
import { AIEnhanceButton } from "./ai-enhance-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useNavbarStore, useSearchHistoryStore, useSearchFormStore, useKeywordExpansionDialogStore, useAIEnhanceStore } from "@/lib/store";
import { useQueryChangeHandler } from "@/lib/hooks";
import { handleSearchHistoryClick as sharedHandleSearchHistoryClick } from "@/lib/search-actions";
import { usePathname, useRouter } from 'next/navigation';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchHistory } from "./search-history";

interface NavbarProps {
  searchQuery?: string;
  onSearchSubmit: (query: string) => void;
  onNewSearch?: (query: string) => void;
  onMenuToggle?: () => void;
  isLoading?: boolean;
  isUpdatingCurrentSearch?: boolean;
  isCreatingNewSearch?: boolean;
  loadingResultIndex?: number | null;
  isFilterLoading?: boolean;
}

export function Navbar({ 
  searchQuery = "", 
  onSearchSubmit, 
  onNewSearch,
  onMenuToggle,
  isLoading = false,
  isUpdatingCurrentSearch = false,
  isCreatingNewSearch = false,
  loadingResultIndex = null,
  isFilterLoading = false
}: NavbarProps) {
  const { query, setQuery } = useNavbarStore();
  const handleQueryChange = useQueryChangeHandler(setQuery);
  const pathname = usePathname();
  const router = useRouter();
  const { searchHistory } = useSearchHistoryStore();
  const { currentSearchId } = useSearchFormStore();
  
  // State for mobile menu interactions
  const { setIsOpen: setKeywordDialogOpen } = useKeywordExpansionDialogStore();
  const { setIsDialogOpen: setAIDialogOpen } = useAIEnhanceStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Check if we're on a results page
  const isOnResultsPage = pathname?.startsWith('/results');

  useEffect(() => {
    setQuery(searchQuery);
  }, [searchQuery, setQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearchSubmit(query.trim());
    }
  };

  const handleNewSearch = () => {
    if (query.trim() && onNewSearch) {
      onNewSearch(query.trim());
    }
  };

  const handleSearchHistoryClick = async (
    query: string,
    searchField: any,
    dateRange?: any,
    sortBy?: string,
    yearRange?: [number, number],
    filterType?: "date" | "year",
    index?: number
  ) => {
    const searchId = await sharedHandleSearchHistoryClick(
      query,
      searchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      index
    );
    
    // Only navigate if loading was successful (searchId is not null)
    if (searchId) {
      router.push(`/results/${searchId}`);
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Left side - Logo and Search */}
          <div className="flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0">
            <Logo size="sm" className="flex-shrink-0" context="navbar" />
            
            <form onSubmit={handleSubmit} className="flex-1 max-w-2xl">
              <div className="relative flex items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Search papers..."
                    className="pl-10 pr-4"
                    disabled={isUpdatingCurrentSearch || isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading}
                  />
                </div>
                
                {/* Desktop: Show all buttons */}
                <div className="hidden sm:flex items-center">
                  <KeywordExpansionTooltip 
                    query={query} 
                    side="bottom" 
                    buttonClassName="ml-2"
                  />
                  <AIEnhanceButton
                    query={query}
                    onQueryChange={handleQueryChange}
                    className="ml-2"
                  />
                  {/* Update Current Search Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        type="submit" 
                        disabled={isUpdatingCurrentSearch || isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading || !query.trim()} 
                        className="ml-2 flex-shrink-0"
                        size="icon"
                        variant="outline"
                      >
                        {isUpdatingCurrentSearch ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Update current search</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* New Search Button */}
                  {onNewSearch && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          type="button"
                          onClick={handleNewSearch}
                          disabled={isUpdatingCurrentSearch || isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading || !query.trim()} 
                          className="ml-2 flex-shrink-0"
                          size="icon"
                        >
                          {isCreatingNewSearch ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Create new search</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Mobile: Show only essential search button and more menu */}
                <div className="sm:hidden flex items-center">
                  {/* Primary action button - Update Current Search */}
                  <Button 
                    type="submit" 
                    disabled={isUpdatingCurrentSearch || isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading || !query.trim()} 
                    className="ml-2 flex-shrink-0"
                    size="icon"
                    variant="outline"
                  >
                    {isUpdatingCurrentSearch ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </Button>

                  {/* Mobile More Menu */}
                  <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="ml-1">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-background border border-border shadow-lg">
                      {onNewSearch && (
                        <>
                          <DropdownMenuItem
                            onClick={() => {
                              handleNewSearch();
                              setDropdownOpen(false);
                            }}
                            disabled={isUpdatingCurrentSearch || isCreatingNewSearch || loadingResultIndex !== null || isFilterLoading || !query.trim()}
                            className="cursor-pointer focus:bg-accent"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            {isCreatingNewSearch ? "Creating..." : "Create new search"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => {
                          setKeywordDialogOpen(true);
                          setDropdownOpen(false);
                        }}
                        disabled={!query.trim()}
                        className="cursor-pointer focus:bg-accent"
                      >
                        <BookOpen className="mr-2 h-4 w-4" />
                        Keywords...
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setAIDialogOpen(true);
                          setDropdownOpen(false);
                        }}
                        disabled={!query.trim()}
                        className="cursor-pointer focus:bg-accent"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        AI Enhance...
                      </DropdownMenuItem>
                      {isOnResultsPage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setDropdownOpen(false);
                              router.push('/');
                            }}
                            className="cursor-pointer focus:bg-accent"
                          >
                            <Home className="mr-2 h-4 w-4" />
                            Back to Home
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </form>
          </div>

          {/* Right side - Navigation and Actions */}
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            {/* Home Button - Show on results pages (desktop only) */}
            {isOnResultsPage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="sm" className="hidden sm:flex h-8 w-8 px-0">
                    <Link href="/">
                      <Home className="h-4 w-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Back to Home</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Search History Button */}
            <Sheet>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 px-0">
                      <Clock className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Search History {searchHistory.length > 0 ? `(${searchHistory.length})` : ''}</p>
                </TooltipContent>
              </Tooltip>
              <SheetContent side="right" className="w-[400px] sm:w-[500px] flex flex-col">
                <SheetHeader className="flex-shrink-0">
                  <SheetTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Search History
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <SearchHistory
                    onSearchResults={handleSearchHistoryClick}
                    loadingResultIndex={loadingResultIndex}
                    currentSearchField="title_and_abstract"
                    compact={true}
                    currentSearchId={currentSearchId}
                  />
                </div>
              </SheetContent>
            </Sheet>

            {/* Theme Toggle - Desktop only */}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            
            {/* Mobile Menu Button (for sidebar) */}
            {onMenuToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMenuToggle}
                className="lg:hidden h-8 w-8 px-0"
              >
                <Menu className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
} 