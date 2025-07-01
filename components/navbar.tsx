"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Menu, Home, Clock, MoreHorizontal, BookOpen, Sparkles, FileText, Filter, LucideIcon, Languages, List, Table, Shield, Settings, LogIn, Code } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { SearchHistory } from "./search-history";
import { useIsMobile } from '@/lib/hooks';
import { ApiButton } from "./api-button";

interface NavbarProps {
  onSearchSubmit: (query: string) => void;
  loadingResultIndex?: number | null;
}

interface NavButtonProps {
  href: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  badge?: number;
  asChild?: boolean;
  onClick?: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ 
  href, 
  icon: Icon, 
  label, 
  isActive, 
  badge,
  asChild = true,
  onClick
}) => {
  const buttonContent = (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badge && badge > 0 && (
        <span className={cn(
          "text-xs px-1.5 py-0.5 rounded-full",
          isActive 
            ? "bg-primary-foreground/20 text-primary-foreground" 
            : "bg-muted text-muted-foreground"
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
      "flex-shrink-0 h-8 px-3",
      isActive && "bg-primary text-primary-foreground"
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
  loadingResultIndex = null
}: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { searchHistory } = useSearchHistoryStore();
  const isMobile = useIsMobile();
  const effectiveSearchId = useEffectiveSearchId();
  const { currentSearchField } = useCurrentSearchFormState();
  
  // Get SWR loading states for disabling form
  const { isLoading, isValidating, apiUrl } = useSearchResults();
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
  const [sheetOpen, setSheetOpen] = useState(false);
  
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



  // Function to close the mobile sheet when navigation items are clicked
  const closeSheet = () => {
    setSheetOpen(false);
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
                  {/* Search Button */}
                  <Button 
                    type="submit" 
                    disabled={isFormDisabled} 
                    className="ml-2 flex-shrink-0"
                    size="icon"
                  >
                    <Search className="h-4 w-4" />
                  </Button>

                  {/* API Button */}
                  <ApiButton
                    apiUrl={apiUrl}
                    disabled={isFormDisabled}
                  />
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

            {/* AI Enhancement Button */}
            <NavButton 
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"} 
              icon={Sparkles} 
              label="AI Enhance" 
              isActive={currentPage === 'ai-enhancement'}
            />

            {/* Keywords Button with Preview Tooltip */}
            <KeywordExpansionTooltip 
              query={currentQuery} 
              side="bottom" 
              variant={currentPage === 'bookmarks' ? "default" : "ghost"}
              buttonClassName="h-8 px-3"
              asLink
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/bookmarks` : "/bookmarks"}
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

        {/* Mobile: Single row with hamburger menu */}
        <div className="lg:hidden">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Hamburger Menu */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <div className="flex flex-col h-full">
                  <SheetHeader className="p-6 pb-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <Logo size="md" context="general" />
                      <span className="sr-only">Navigation Menu</span>
                    </SheetTitle>
                  </SheetHeader>
                  
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-1">
                      {/* Home */}
                      <Button 
                        variant={currentPage === 'home' ? "default" : "ghost"} 
                        className="w-full justify-start" 
                        asChild 
                        onClick={closeSheet}
                      >
                        <Link href="/">
                          <Home className="mr-3 h-4 w-4" />
                          Home
                        </Link>
                      </Button>
                      
                      {/* Results - Show when we have search results or are on results page */}
                      {(isOnResultsPage || effectiveSearchId) && (
                        <Button 
                          variant={currentPage === 'results' ? "default" : "ghost"} 
                          className="w-full justify-start" 
                          asChild 
                          onClick={closeSheet}
                        >
                          <Link href={effectiveSearchId ? `/results/${effectiveSearchId}` : "/results"}>
                            <FileText className="mr-3 h-4 w-4" />
                            Results
                          </Link>
                        </Button>
                      )}
                      
                      {/* Filters */}
                      {isOnResultsPage && effectiveSearchId && (
                        <Button 
                          variant={currentPage === 'filters' ? "default" : "ghost"} 
                          className="w-full justify-start" 
                          asChild 
                          onClick={closeSheet}
                        >
                          <Link href={`/results/${effectiveSearchId}/filters`}>
                            <Filter className="mr-3 h-4 w-4" />
                            Filters
                          </Link>
                        </Button>
                      )}
                      
                      {/* AI Enhancement */}
                      <Button 
                        variant={currentPage === 'ai-enhancement' ? "default" : "ghost"} 
                        className="w-full justify-start" 
                        asChild 
                        onClick={closeSheet}
                      >
                        <Link href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/ai-enhancement` : "/ai-enhancement"}>
                          <Sparkles className="mr-3 h-4 w-4" />
                          AI Enhancement
                        </Link>
                      </Button>
                      
                      {/* Translate (disabled) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <Languages className="mr-3 h-4 w-4" />
                        Translate
                      </Button>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="space-y-1">
                      {/* Bookmarks */}
                      <Button 
                        variant={currentPage === 'bookmarks' ? "default" : "ghost"} 
                        className="w-full justify-start" 
                        asChild 
                        onClick={closeSheet}
                      >
                        <Link href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/bookmarks` : "/bookmarks"}>
                          <BookOpen className="mr-3 h-4 w-4" />
                          Bookmarks
                        </Link>
                      </Button>
                      
                      {/* History */}
                      <Button 
                        variant={currentPage === 'history' ? "default" : "ghost"} 
                        className="w-full justify-start" 
                        asChild 
                        onClick={closeSheet}
                      >
                        <Link href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/history` : "/history"}>
                          <Clock className="mr-3 h-4 w-4" />
                          History
                          {searchHistory.length > 0 && (
                            <span className={`ml-auto text-xs rounded-full px-2 py-0.5 ${currentPage === 'history' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary text-primary-foreground'}`}>
                              {searchHistory.length}
                            </span>
                          )}
                        </Link>
                      </Button>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="space-y-1">
                      <div className="px-3 py-2 text-sm font-medium text-muted-foreground">
                        View Options
                      </div>
                      
                      {/* List View (disabled for now) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <List className="mr-3 h-4 w-4" />
                        List View
                      </Button>
                      
                      {/* Table View (disabled for now) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <Table className="mr-3 h-4 w-4" />
                        Table View
                      </Button>
                      
                      {/* Screening Results (disabled for now) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <Shield className="mr-3 h-4 w-4" />
                        Screening Results
                      </Button>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="space-y-1">
                      {/* Preferences (disabled for now) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <Settings className="mr-3 h-4 w-4" />
                        Preferences
                      </Button>
                      
                      {/* Login (disabled for now) */}
                      <Button variant="ghost" className="w-full justify-start text-muted-foreground" disabled>
                        <LogIn className="mr-3 h-4 w-4" />
                        Login
                      </Button>
                    </div>
                  </div>
                  
                  {/* Theme Toggle at bottom */}
                  <div className="p-6 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Theme</span>
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

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
                  {/* Search Button */}
                  <Button 
                    type="submit" 
                    disabled={isFormDisabled} 
                    className="ml-2 flex-shrink-0"
                    size="icon"
                  >
                    <Search className="h-4 w-4" />
                  </Button>

                  {/* API Button */}
                  <ApiButton
                    apiUrl={apiUrl}
                    disabled={isFormDisabled}
                  />
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
} 