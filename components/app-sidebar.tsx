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
  useSearchHistoryUIStore,
} from "@/lib/store";
import { useEffectiveSearchId } from "@/lib/hooks";
import { restoreFromHistory } from "@/lib/search";
import { SearchHistoryTab } from "./search-history-tab";
import {
  Home,
  BookOpen,
  Clock,
  Settings,
  PanelLeftClose,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Spring animation config for sidebar
const sidebarSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
};

// Stagger delay for nav items
const staggerDelay = 0.03;

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  badge?: number;
  onClick?: () => void;
  index?: number;
}

function NavItem({ 
  href, 
  icon: Icon, 
  label, 
  isActive, 
  isCollapsed,
  badge,
  onClick,
  index = 0
}: NavItemProps) {
  const content = (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-2 py-2.5 rounded-lg transition-all duration-200 h-auto",
        "hover:bg-sidebar-accent group",
        isActive && "bg-sidebar-accent text-sidebar-primary font-medium",
        !isActive && "text-sidebar-foreground",
        isCollapsed && "justify-center"
      )}
    >
      <motion.div
        initial={false}
        animate={{ scale: isCollapsed ? 1.1 : 1 }}
        transition={sidebarSpring}
      >
        <Icon className={cn(
          "h-5 w-5 flex-shrink-0 transition-colors",
          isActive ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
        )} />
      </motion.div>
      <AnimatePresence mode="wait">
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ 
              duration: 0.15, 
              delay: index * staggerDelay,
              ease: [0.32, 0.72, 0, 1]
            }}
            className="flex-1 flex items-center gap-2"
          >
            <span className="flex-1 truncate">{label}</span>
            {badge !== undefined && badge > 0 && (
              <motion.span 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 + index * staggerDelay }}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                    : "bg-muted text-muted-foreground"
                )}
              >
                {badge}
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, isMobile } = useSidebar();
  const { searchHistory } = useSearchHistoryStore();
  const { currentPage, setCurrentPage } = useSearchHistoryUIStore();
  const effectiveSearchId = useEffectiveSearchId();

  // Pagination settings for sidebar
  const itemsPerPage = 5;
  const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
  const displayItems = searchHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Determine current page
  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname === "/") return "home";
    if (pathname.includes("/bookmarks")) return "bookmarks";
    if (pathname.includes("/history")) return "history";
    if (pathname.includes("/ai-enhancement")) return "ai-enhancement";
    return null;
  };

  const currentPageValue = getCurrentPage();

  const handleNavClick = () => {
    onClose?.();
  };

  const handlePrevPage = () => {
    setCurrentPage(Math.max(1, currentPage - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(Math.min(totalPages, currentPage + 1));
  };

  const handleSearchHistoryClick = (searchId: string) => {
    // Navigate to the search result page with full params from storage
    const entry = searchHistory.find(s => s.id === searchId);
    if (entry) {
      router.push(restoreFromHistory(entry));
    } else {
      router.push(`/results/${searchId}`);
    }
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Navigation */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className={cn("h-full py-4", isCollapsed && !isMobile ? "px-2" : "px-4")}>
          {/* Primary Navigation */}
          <div className="space-y-1">
            <NavItem
              href="/"
              icon={Home}
              label="Home"
              isActive={currentPageValue === "home"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
              index={0}
            />

            <NavItem
              href="/bookmarks"
              icon={BookOpen}
              label="Bookmarks"
              isActive={currentPageValue === "bookmarks"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
              index={1}
            />

            <NavItem
              href="/history"
              icon={Clock}
              label="History"
              isActive={currentPageValue === "history"}
              isCollapsed={isCollapsed && !isMobile}
              badge={searchHistory.length}
              onClick={handleNavClick}
              index={2}
            />
          </div>

          {/* Search History Section - Always shown with pagination */}
          {searchHistory.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1">
                {displayItems.map((search) => (
                  <SearchHistoryTab
                    key={search.id}
                    searchId={search.id}
                    query={search.query}
                    count={search.count}
                    field={search.field}
                    dateRange={search.dateRange}
                    yearRange={search.yearRange}
                    selectedRegions={search.selectedRegions}
                    language={search.language}
                    createdAt={search.createdAt}
                    isActive={search.id === effectiveSearchId}
                    isCollapsed={isCollapsed && !isMobile}
                    onClick={() => handleSearchHistoryClick(search.id)}
                  />
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className={cn(
                  "flex items-center justify-center gap-1 pt-2",
                  isCollapsed && !isMobile && "flex-col gap-2"
                )}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevPage}
                    disabled={currentPage === 1}
                    className={cn(
                      "h-7 w-7",
                      isCollapsed && !isMobile ? "h-8 w-8" : ""
                    )}
                    title={isCollapsed && !isMobile ? "Previous page" : undefined}
                  >
                    {isCollapsed && !isMobile ? (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <ChevronLeft className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          Previous page
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        <ChevronLeft className="h-4 w-4" />
                        {!isCollapsed || isMobile && (
                          <span className="sr-only">Previous</span>
                        )}
                      </>
                    )}
                  </Button>

                  {totalPages > 2 && (
                    <div className={cn(
                      "flex items-center justify-center",
                      isCollapsed && !isMobile ? "text-xs" : ""
                    )}>
                      {!isCollapsed || isMobile ? (
                        <span className="text-xs text-muted-foreground px-2">
                          {currentPage} / {totalPages}
                        </span>
                      ) : (
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground">
                              {currentPage}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            Page {currentPage} of {totalPages}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    className={cn(
                      "h-7 w-7",
                      isCollapsed && !isMobile ? "h-8 w-8" : ""
                    )}
                    title={isCollapsed && !isMobile ? "Next page" : undefined}
                  >
                    {isCollapsed && !isMobile ? (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <ChevronRight className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          Next page
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        <ChevronRight className="h-4 w-4" />
                        {!isCollapsed || isMobile && (
                          <span className="sr-only">Next</span>
                        )}
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* "Show all" link (expanded state only) */}
              {!isCollapsed && !isMobile && searchHistory.length > itemsPerPage && (
                <Link
                  href="/history"
                  onClick={handleNavClick}
                  className="flex items-center justify-center gap-2 px-2 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>Show all {searchHistory.length}</span>
                </Link>
              )}
            </>
          )}
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className={cn(
        "border-t border-sidebar-border py-4",
        isCollapsed && !isMobile ? "px-2 flex flex-col items-center gap-2" : "px-4"
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
    <motion.aside
      className={cn(
        "h-full bg-sidebar border-r border-sidebar-border flex flex-col",
        "sticky top-0 left-0 z-40"
      )}
      initial={false}
      animate={{ width: currentWidth }}
      transition={sidebarSpring}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-sidebar-border py-4 min-h-[52px]",
        isCollapsed && !isMobile ? "px-2" : "px-4",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        <AnimatePresence mode="wait">
          {!isCollapsed ? (
            <motion.div
              key="expanded-header"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-between w-full h-full"
            >
              <Logo size="sm" context="navbar" />
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Collapse sidebar (Ctrl+B)
                </TooltipContent>
              </Tooltip>
            </motion.div>
          ) : (
            <motion.div
              key="collapsed-header"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={sidebarSpring}
              className="h-full flex items-center"
            >
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <PanelLeft className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Expand sidebar (Ctrl+B)
                </TooltipContent>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <SidebarContent />
      </div>
    </motion.aside>
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
