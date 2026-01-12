"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSidebar } from "./sidebar-provider";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useSearchHistoryStore,
  useCurrentQueryStore,
} from "@/lib/store";
import { useEffectiveSearchId } from "@/lib/hooks";
import {
  Home,
  FileText,
  BookOpen,
  Clock,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Search,
  ChevronRight,
} from "lucide-react";

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  badge?: number;
  onClick?: () => void;
}

function NavItem({ 
  href, 
  icon: Icon, 
  label, 
  isActive, 
  isCollapsed,
  badge,
  onClick 
}: NavItemProps) {
  const content = (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
        "hover:bg-sidebar-accent group",
        isActive && "bg-sidebar-accent text-sidebar-primary font-medium",
        !isActive && "text-sidebar-foreground",
        isCollapsed && "justify-center px-2"
      )}
    >
      <Icon className={cn(
        "h-5 w-5 flex-shrink-0 transition-colors",
        isActive ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
      )} />
      {!isCollapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              isActive 
                ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                : "bg-muted text-muted-foreground"
            )}>
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {badge !== undefined && badge > 0 && (
            <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

interface SearchHistoryItemProps {
  query: string;
  searchId: string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}

function SearchHistoryItem({ 
  query, 
  searchId, 
  isActive, 
  isCollapsed,
  onClick 
}: SearchHistoryItemProps) {
  const truncatedQuery = query.length > 30 ? query.slice(0, 30) + "..." : query;

  const content = (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-left",
        "hover:bg-sidebar-accent group",
        isActive && "bg-sidebar-accent/70",
        isCollapsed && "justify-center px-2"
      )}
    >
      <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      {!isCollapsed && (
        <span className="flex-1 truncate text-sm text-sidebar-foreground">
          {truncatedQuery}
        </span>
      )}
    </button>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right">
          {query}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, isMobile } = useSidebar();
  const { searchHistory } = useSearchHistoryStore();
  const effectiveSearchId = useEffectiveSearchId();

  // Determine if we're on a results page
  const isOnResultsPage = pathname?.startsWith("/results");

  // Determine current page
  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname === "/") return "home";
    if (pathname.startsWith("/results") && !pathname.includes("/bookmarks") && !pathname.includes("/history"))
      return "results";
    if (pathname.includes("/bookmarks")) return "bookmarks";
    if (pathname.includes("/history")) return "history";
    if (pathname.includes("/ai-enhancement")) return "ai-enhancement";
    return null;
  };

  const currentPage = getCurrentPage();

  const handleHistoryClick = (searchId: string) => {
    router.push(`/results/${searchId}`);
    onClose?.();
  };

  const handleNavClick = () => {
    onClose?.();
  };

  // Get last 5 searches for the sidebar
  const recentSearches = searchHistory.slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      {/* Navigation */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full px-3 py-2">
          {/* Primary Navigation */}
          <div className="space-y-1">
            <NavItem
              href="/"
              icon={Home}
              label="Home"
              isActive={currentPage === "home"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
            />

            {(isOnResultsPage || effectiveSearchId) && (
              <NavItem
                href={effectiveSearchId ? `/results/${effectiveSearchId}` : "/results"}
                icon={FileText}
                label="Results"
                isActive={currentPage === "results"}
                isCollapsed={isCollapsed && !isMobile}
                onClick={handleNavClick}
              />
            )}

            <NavItem
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/bookmarks` : "/bookmarks"}
              icon={BookOpen}
              label="Bookmarks"
              isActive={currentPage === "bookmarks"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
            />

            <NavItem
              href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/history` : "/history"}
              icon={Clock}
              label="History"
              isActive={currentPage === "history"}
              isCollapsed={isCollapsed && !isMobile}
              badge={searchHistory.length}
              onClick={handleNavClick}
            />
          </div>

          {/* Search History Section */}
          {recentSearches.length > 0 && (!isCollapsed || isMobile) && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="px-3 py-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Recent Searches
                  </span>
                </div>
                <div className="space-y-1">
                  {recentSearches.map((search) => (
                    <SearchHistoryItem
                      key={search.id}
                      query={search.query}
                      searchId={search.id}
                      isActive={search.id === effectiveSearchId}
                      isCollapsed={isCollapsed && !isMobile}
                      onClick={() => handleHistoryClick(search.id)}
                    />
                  ))}
                </div>
                {searchHistory.length > 5 && (
                  <Link
                    href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/history` : "/history"}
                    onClick={handleNavClick}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Show all</span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </>
          )}

          {/* Collapsed state - just show search icon */}
          {isCollapsed && !isMobile && recentSearches.length > 0 && (
            <>
              <Separator className="my-4" />
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={isOnResultsPage && effectiveSearchId ? `/results/${effectiveSearchId}/history` : "/history"}
                    className="flex items-center justify-center p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
                  >
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {searchHistory.length} recent searches
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className={cn(
        "border-t border-sidebar-border p-3",
        isCollapsed && !isMobile && "flex flex-col items-center gap-2"
      )}>
        {(!isCollapsed || isMobile) ? (
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" disabled>
                  <Settings className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Settings (coming soon)
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <>
            <ThemeToggle />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" disabled>
                  <Settings className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Settings (coming soon)
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

export function AppSidebar() {
  const { isOpen, setOpen, isCollapsed, toggle, isMobile, currentWidth } = useSidebar();

  // Mobile: Render as Sheet
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="flex items-center">
              <Logo size="sm" context="navbar" clickable={false} />
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <SidebarContent onClose={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Render as sidebar
  return (
    <aside
      className={cn(
        "h-full bg-sidebar border-r border-sidebar-border flex flex-col sidebar-transition",
        "sticky top-0 left-0 z-40"
      )}
      style={{ width: currentWidth }}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-sidebar-border p-4",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {!isCollapsed ? (
          <>
            <Logo size="sm" context="navbar" />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggle}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Collapse sidebar (Ctrl+B)
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                className="h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Expand sidebar (Ctrl+B)
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <SidebarContent />
      </div>
    </aside>
  );
}

// Mobile trigger button - to be used in headers/elsewhere
export function MobileSidebarTrigger() {
  const { toggle, isMobile } = useSidebar();

  if (!isMobile) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className="lg:hidden"
    >
      <PanelLeft className="h-5 w-5" />
    </Button>
  );
}
