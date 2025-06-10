import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Menu, Loader2 } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { KeywordExpansionDialog } from "./keyword-expansion-dialog";
import { KeywordExpansionPreview } from "./keyword-expansion-preview";
import { KeywordExpansionTooltip } from "./keyword-expansion-tooltip";
import { AIEnhanceButton } from "./ai-enhance-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavbarProps {
  searchQuery?: string;
  onSearchSubmit: (query: string) => void;
  onMenuToggle?: () => void;
  isLoading?: boolean;
  loadingResultIndex?: number | null;
  isFilterLoading?: boolean;
}

export function Navbar({ 
  searchQuery = "", 
  onSearchSubmit, 
  onMenuToggle,
  isLoading = false,
  loadingResultIndex = null,
  isFilterLoading = false
}: NavbarProps) {
  const [query, setQuery] = React.useState(searchQuery);

  React.useEffect(() => {
    setQuery(searchQuery);
  }, [searchQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearchSubmit(query.trim());
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
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search papers..."
                    className="pl-10 pr-4"
                    disabled={isLoading || loadingResultIndex !== null || isFilterLoading}
                  />
                </div>
                <KeywordExpansionTooltip 
                  query={query} 
                  side="bottom" 
                  buttonClassName="ml-2"
                />
                <AIEnhanceButton
                  query={query}
                  onQueryChange={setQuery}
                  className="ml-2"
                />
                <Button 
                  type="submit" 
                  disabled={isLoading || loadingResultIndex !== null || isFilterLoading || !query.trim()} 
                  className="ml-2 flex-shrink-0"
                  size="icon"
                >
                  {isLoading && loadingResultIndex === null ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            <ThemeToggle />
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