"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Menu, Home, Clock, Plus, RotateCcw, MoreHorizontal, BookOpen, Sparkles, FileText, Filter, LucideIcon } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { KeywordExpansionTooltip } from "./keyword-expansion-tooltip";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useResultsStore, useSearchHistoryStore, useCurrentQueryStore } from "@/lib/store";
import { useQueryChangeHandler, useEffectiveSearchId, useCurrentSearchFormState, useSearchResults } from "@/lib/hooks";
import { toast } from 'sonner';
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
import { useIsMobile } from '@/lib/hooks';

interface NavbarProps {
  onSearchSubmit: (query: string) => void;
  onNewSearch?: (query: string) => void;
  loadingResultIndex?: number | null;
}

interface NavButtonProps {
  href: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  isMobile?: boolean;
  badge?: number;
  asChild?: boolean;
  onClick?: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ 
  href, 
  icon: Icon, 
  label, 
  isActive, 
  isMobile = false,
  badge,
  asChild = true,
  onClick
}) => {
  const buttonContent = (
    <div className="flex items-center gap-1">
      <Icon className="h-4 w-4" />
      {/* Desktop: Always show text, Mobile: Only show text if active */}
      {(!isMobile || isActive) && <span className={cn(isMobile ? "text-xs" : "")}>{label}</span>}
      {badge && badge > 0 && (
        <span className={cn(
          "text-xs px-1.5 py-0.5 rounded-full",
          isActive 
            ? "bg-primary-foreground/20 text-primary-foreground" 
            : "bg-muted text-muted-foreground",
          isMobile && "px-1"
        )}>
          {badge}
        </span>
      )}
    </div>
  );

  const buttonProps = {
    variant: (isActive ? "default" : "ghost") as "default" | "ghost",
    size: "sm" as const,
    className: cn(
      "flex-shrink-0",
      isMobile ? "h-8" : "h-8",
      isMobile 
        ? (isActive ? "px-3 bg-primary text-primary-foreground" : "px-2")
        : "px-3",
      !isMobile && isActive && "bg-primary text-primary-foreground"
    )
  };

  if (asChild) {
    return (
      <Button {...buttonProps} asChild>
        <Link href={href} onClick={onClick}>
          {buttonContent}
        </Link>
      </Button>
    );
  }

  return (
    <Button {...buttonProps} onClick={onClick}>
      {buttonContent}
    </Button>
  );
};

export function Navbar({ 
  onSearchSubmit, 
  onNewSearch,
  loadingResultIndex = null
}: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { searchHistory } = useSearchHistoryStore();
  const isMobile = useIsMobile();
  const effectiveSearchId = useEffectiveSearchId();
  const { currentSearchField } = useCurrentSearchFormState();
  
  // Get SWR loading states for disabling form
  const { isLoading, isValidating } = useSearchResults();
  const isFormDisabled = isLoading || isValidating || loadingResultIndex !== null;
  
  // Use shared current query state for navbar/home page synchronization
  const { currentQuery, setCurrentQuery } = useCurrentQueryStore();
  const handleQueryChange = useQueryChangeHandler(setCurrentQuery);
  
  // Get query directly from search history for syncing
  const searchState = effectiveSearchId ? searchHistory.find(item => item.id === effectiveSearchId) : null;
  const historyQuery = searchState?.query || '';
  
  // Sync current query with search history when navigating to different search results
  React.useEffect(() => {
    if (effectiveSearchId) {
      setCurrentQuery(historyQuery);
    }
  }, [historyQuery, effectiveSearchId, setCurrentQuery]);

  
  // State for mobile menu interactions
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Check if we're on a results page
  const isOnResultsPage = pathname?.startsWith('/results');
  
  // Determine current page for navigation indicators
  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname === '/') return 'home';
    if (pathname.startsWith('/results') && !pathname.includes('/bookmarks') && !pathname.includes('/ai-enhancement') && !pathname.includes('/history') && !pathname.includes('/filters')) return 'results';
    if (pathname.includes('/bookmarks')) return 'bookmarks';
    if (pathname.includes('/ai-enhancement')) return 'ai-enhancement';
    if (pathname.includes('/history')) return 'history';
    if (pathname.includes('/filters')) return 'filters';
    return null;
  };

  const currentPage = getCurrentPage();

  // Note: All query initialization and synchronization is now handled centrally by QuerySyncProvider
  // No local useEffect needed - the provider handles everything

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit(currentQuery);
  };

  const handleNewSearch = () => {
    if (onNewSearch) {
      onNewSearch(currentQuery);
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
    // With SWR, we just need to navigate to the search result
    // The data will be automatically loaded by the SWR hook
    const { searchHistory } = useSearchHistoryStore.getState();
    const searchResult = searchHistory[index || 0];
    
    if (searchResult?.id) {
      router.push(`/results/${searchResult.id}`);
    } else {
      toast.error('Search not found', {
        description: 'The requested search could not be found in your history.'
      });
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Desktop: Single row layout (lg and above) */}
        <div className="hidden lg:flex h-16 items-center justify-between gap-4">
          {/* Left side - Logo and Search */}
          <div className="flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0">
            <Logo size="sm" className="flex-shrink-0" context="navbar" />
            
            <form onSubmit={handleSubmit} className="flex-1 max-w-2xl">
              <div className="relative flex items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={currentQuery}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Search papers..."
                    className="pl-10 pr-4"
                    disabled={isFormDisabled}
                  />
                </div>
                
                {/* Desktop: Show all buttons */}
                <div className="flex items-center">
                  {/* Update Current Search Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        type="submit" 
                        disabled={isFormDisabled} 
                        className="ml-2 flex-shrink-0"
                        size="icon"
                        variant="outline"
                      >
                        <RotateCcw className="h-4 w-4" />
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
                          disabled={isFormDisabled} 
                          className="ml-2 flex-shrink-0"
                          size="icon"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Create new search</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </form>
          </div>

          {/* Right side - Navigation and Actions */}
          <div className="flex items-center space-x-1 lg:space-x-2 flex-shrink-0">
            {/* Results Button - Show when we have search results or are on results page */}
            {(isOnResultsPage || effectiveSearchId) && (
              <NavButton 
                href={effectiveSearchId ? `/results/${effectiveSearchId}` : "/results"} 
                icon={FileText} 
                label="Results" 
                isActive={currentPage === 'results'}
              />
            )}

            {/* Keywords Button with Preview Tooltip */}
            <KeywordExpansionTooltip 
              query={currentQuery} 
              side="bottom" 
              variant={currentPage === 'bookmarks' ? "default" : "ghost"}
              buttonClassName="h-8 px-3"
              asLink
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/bookmarks` : "/bookmarks"}
            />

            {/* AI Enhancement Button */}
            <NavButton 
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"} 
              icon={Sparkles} 
              label="AI Enhance" 
              isActive={currentPage === 'ai-enhancement'}
            />

            {/* Search History Button */}
            {isOnResultsPage ? (
              effectiveSearchId ? (
                <NavButton 
                  href={`/results/${effectiveSearchId}/history`} 
                  icon={Clock} 
                  label="History" 
                  isActive={currentPage === 'history'}
                  badge={searchHistory.length}
                />
              ) : (
                <NavButton 
                  href="/history" 
                  icon={Clock} 
                  label="History" 
                  isActive={currentPage === 'history'}
                  badge={searchHistory.length}
                />
              )
            ) : (
              <Sheet>
                <SheetTrigger asChild>
                  <NavButton 
                    href="/history" 
                    icon={Clock} 
                    label="History" 
                    isActive={currentPage === 'history'}
                    badge={searchHistory.length}
                  />
                </SheetTrigger>
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
                      currentSearchId={effectiveSearchId}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Theme Toggle */}
              <ThemeToggle />
            </div>
        </div>

        {/* Mobile: Two-row layout (below lg) */}
        <div className="lg:hidden">
          {/* First row: Logo, Search, Search buttons, Theme toggle */}
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Logo */}
            <Logo size="sm" className="flex-shrink-0" context="navbar" />
            
            {/* Search form */}
            <form onSubmit={handleSubmit} className="flex-1 mx-2">
              <div className="relative flex items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={currentQuery}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Search papers..."
                    className="pl-10 pr-4"
                    disabled={isFormDisabled}
                  />
                </div>
                
                {/* Search action buttons */}
                <div className="flex items-center">
                  {/* Update Current Search Button */}
                  <Button 
                    type="submit" 
                    disabled={isFormDisabled} 
                    className="ml-2 flex-shrink-0"
                    size="icon"
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>

                  {/* New Search Button */}
                  {onNewSearch && (
                    <Button 
                      type="button"
                      onClick={handleNewSearch}
                      disabled={isFormDisabled} 
                      className="ml-2 flex-shrink-0"
                      size="icon"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
            
            {/* Theme Toggle */}
            <ThemeToggle />
          </div>

          {/* Second row: Navigation buttons */}
          <div className="border-t border-border/50 px-2 py-2">
            <div className="flex items-center justify-center gap-1 overflow-x-auto">
              {/* Results Button */}
              {(isOnResultsPage || effectiveSearchId) && (
                <NavButton 
                  href={effectiveSearchId ? `/results/${effectiveSearchId}` : "/results"} 
                  icon={FileText} 
                  label="Results" 
                  isActive={currentPage === 'results'}
                  isMobile={true}
                />
              )}

              {/* Keywords Button */}
              <NavButton 
                href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/bookmarks` : "/bookmarks"} 
                icon={BookOpen} 
                label="Bookmarks" 
                isActive={currentPage === 'bookmarks'}
                isMobile={true}
              />

              {/* AI Enhancement Button */}
              <NavButton 
                href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"} 
                icon={Sparkles} 
                label="AI Enhance" 
                isActive={currentPage === 'ai-enhancement'}
                isMobile={true}
              />

              {/* History Button */}
              {isOnResultsPage ? (
                effectiveSearchId ? (
                  <NavButton 
                    href={`/results/${effectiveSearchId}/history`} 
                    icon={Clock} 
                    label="History" 
                    isActive={currentPage === 'history'}
                    isMobile={true}
                    badge={searchHistory.length}
                  />
                ) : (
                  <NavButton 
                    href="/history" 
                    icon={Clock} 
                    label="History" 
                    isActive={currentPage === 'history'}
                    isMobile={true}
                    badge={searchHistory.length}
                  />
                )
              ) : (
                <Sheet>
                  <SheetTrigger asChild>
                    <NavButton 
                      href="/history" 
                      icon={Clock} 
                      label="History" 
                      isActive={currentPage === 'history'}
                      isMobile={true}
                      badge={searchHistory.length}
                    />
                  </SheetTrigger>
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
                        currentSearchId={effectiveSearchId}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              )}

              {/* Filters Button - Only on results pages */}
              {isOnResultsPage && effectiveSearchId && (
                <NavButton 
                  href={`/results/${effectiveSearchId}/filters`} 
                  icon={Filter} 
                  label="Filters" 
                  isActive={currentPage === 'filters'}
                  isMobile={true}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
} 