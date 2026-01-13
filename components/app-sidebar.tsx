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

const sidebarSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 35,
  mass: 0.8,
};

const hoverSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
  mass: 0.6,
};

const staggerDelay = 0.04;

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
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.2,
        delay: index * staggerDelay,
        ease: [0.32, 0.72, 0, 1]
      }}
    >
      <Link
        href={href}
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg h-auto",
          "group relative overflow-hidden",
          isActive 
            ? "bg-sidebar-accent/80 backdrop-blur-sm" 
            : "hover:bg-sidebar-accent/60 backdrop-blur-sm",
          isActive ? "text-sidebar-primary font-medium" : "text-sidebar-foreground",
          isCollapsed && "justify-center",
          "transition-all duration-200 ease-out",
          isActive && "nav-active"
        )}
      >
        <motion.div
          whileHover={{ scale: isCollapsed ? 1.15 : 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={hoverSpring}
          className="relative z-10"
        >
          <Icon className={cn(
            "h-5 w-5 flex-shrink-0 transition-colors duration-200",
            isActive 
              ? "text-sidebar-primary drop-shadow-sm" 
              : "text-muted-foreground group-hover:text-sidebar-foreground"
          )} />
        </motion.div>
        
        <AnimatePresence mode="wait">
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{
                duration: 0.2,
                delay: index * staggerDelay,
                ease: [0.32, 0.72, 0, 1]
              }}
              className="flex-1 flex items-center gap-2 relative z-10"
            >
              <span className="flex-1 truncate">{label}</span>
              {badge !== undefined && badge > 0 && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  whileHover={{ scale: 1.1 }}
                  transition={{ 
                    delay: 0.1 + index * staggerDelay,
                    type: "spring",
                    stiffness: 400,
                    damping: 20
                  }}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium badge-glow",
                    isActive
                      ? "bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white shadow-md"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {badge}
                </motion.span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        
        {isActive && !isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.1 }}
            className="absolute inset-0 bg-gradient-to-r from-[oklch(0.70_0.17_54)] to-transparent pointer-events-none"
          />
        )}
      </Link>
    </motion.div>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.95 }}
            transition={hoverSpring}
          >
            {content}
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {badge !== undefined && badge > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-xs bg-gradient-to-r from-[oklch(0.75_0.15_55)] to-[oklch(0.62_0.16_52)] text-white px-1.5 py-0.5 rounded-full"
            >
              {badge}
            </motion.span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <motion.div
      whileHover={{ x: 4 }}
      whileTap={{ x: 2, scale: 0.98 }}
      transition={hoverSpring}
    >
      {content}
    </motion.div>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, isMobile } = useSidebar();
  const { searchHistory } = useSearchHistoryStore();
  const { currentPage, setCurrentPage } = useSearchHistoryUIStore();
  const effectiveSearchId = useEffectiveSearchId();

  const itemsPerPage = 10;
  const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
  const displayItems = searchHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

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
      <div className="flex-1 overflow-hidden">
        <ScrollArea className={cn("h-full py-4 sidebar-scrollbar", isCollapsed && !isMobile ? "px-2" : "px-3")}>
          <motion.div 
            className="space-y-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
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
          </motion.div>

          {searchHistory.length > 0 && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.15 }}
              >
                <Separator className="my-4 bg-gradient-to-r from-transparent via-border/60 to-transparent" />
              </motion.div>
              <motion.div 
                className="space-y-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                {displayItems.map((search, idx) => (
                  <SearchHistoryTab
                    key={search.id}
                    searchId={search.id}
                    query={search.query}
                    count={search.count}
                    field={search.field}
                    sortBy={search.sortBy}
                    dateRange={search.dateRange}
                    yearRange={search.yearRange}
                    filterType={search.filterType}
                    isYearRangeEnabled={search.isYearRangeEnabled}
                    selectedRegions={search.selectedRegions}
                    selectedCountryFocus={search.selectedCountryFocus}
                    language={search.language}
                    createdAt={search.createdAt}
                    isActive={search.id === effectiveSearchId}
                    isCollapsed={isCollapsed && !isMobile}
                    reviewFilter={search.reviewFilter}
                    ratingRange={search.ratingRange}
                    onlyRatedPapers={search.onlyRatedPapers}
                    citesItemId={search.citesItemId}
                    citedByItemId={search.citedByItemId}
                    relatedToItemId={search.relatedToItemId}
                    onClick={() => handleSearchHistoryClick(search.id)}
                    index={idx + 3}
                  />
                ))}
              </motion.div>

              {totalPages > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.25 }}
                  className={cn(
                    "flex items-center justify-center gap-1 pt-2",
                    isCollapsed && !isMobile && "flex-col gap-2"
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevPage}
                    disabled={currentPage === 1}
                    className={cn(
                      "h-7 w-7 transition-all duration-200",
                      isCollapsed && !isMobile ? "h-8 w-8" : "",
                      currentPage > 1 && "hover:bg-sidebar-accent/80"
                    )}
                    title={isCollapsed && !isMobile ? "Previous page" : undefined}
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      transition={hoverSpring}
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
                    </motion.div>
                  </Button>

                  {totalPages > 2 && (
                    <div className={cn(
                      "flex items-center justify-center transition-all duration-200",
                      isCollapsed && !isMobile ? "text-xs" : ""
                    )}>
                      {!isCollapsed || isMobile ? (
                        <motion.span
                          key={`page-${currentPage}`}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 300, damping: 20 }}
                          className="text-xs text-muted-foreground px-2 font-medium"
                        >
                          {currentPage} / {totalPages}
                        </motion.span>
                      ) : (
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground font-medium">
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
                      "h-7 w-7 transition-all duration-200",
                      isCollapsed && !isMobile ? "h-8 w-8" : "",
                      currentPage < totalPages && "hover:bg-sidebar-accent/80"
                    )}
                    title={isCollapsed && !isMobile ? "Next page" : undefined}
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      transition={hoverSpring}
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
                    </motion.div>
                  </Button>
                </motion.div>
              )}

              {!isCollapsed && !isMobile && searchHistory.length > itemsPerPage && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.3 }}
                >
                  <Link
                    href="/history"
                    onClick={handleNavClick}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:bg-sidebar-accent/60 rounded-lg"
                  >
                    <motion.span
                      whileHover={{ x: 2 }}
                      transition={hoverSpring}
                    >
                      Show all {searchHistory.length}
                    </motion.span>
                  </Link>
                </motion.div>
              )}
            </>
          )}
        </ScrollArea>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.35 }}
        className={cn(
          "border-t border-sidebar-border py-4 bg-gradient-to-t from-sidebar to-transparent",
          isCollapsed && !isMobile ? "px-2 flex flex-col items-center gap-2" : "px-3"
        )}
      >
        {(!isCollapsed || isMobile) ? (
          <motion.div 
            className="flex items-center justify-between w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <ThemeToggle />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 transition-all duration-200 hover:bg-sidebar-accent/80"
                  disabled
                >
                  <motion.div
                    whileHover={{ rotate: 90 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Settings className="h-5 w-5" />
                  </motion.div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Settings (coming soon)
              </TooltipContent>
            </Tooltip>
          </motion.div>
        ) : (
          <>
            <ThemeToggle />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 transition-all duration-200 hover:bg-sidebar-accent/80"
                  disabled
                >
                  <motion.div
                    whileHover={{ rotate: 90 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Settings className="h-5 w-5" />
                  </motion.div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Settings (coming soon)
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </motion.div>
    </div>
  );
}

export function AppSidebar() {
  const { isOpen, setOpen, isCollapsed, toggle, isMobile, currentWidth } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent 
          side="left" 
          className="w-[280px] p-0 flex flex-col glass-sidebar"
        >
          <motion.div
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <SheetHeader className="px-3 py-4 border-b border-sidebar-border/50 bg-gradient-to-r from-sidebar/50 to-transparent">
              <SheetTitle className="flex items-center">
                <Logo size="sm" context="navbar" clickable={false} />
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden">
              <SidebarContent onClose={() => setOpen(false)} />
            </div>
          </motion.div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <motion.aside
      className={cn(
        "h-full glass-sidebar flex flex-col",
        "sticky top-0 left-0 z-40 transition-shadow duration-300",
        "hover:shadow-lg"
      )}
      initial={false}
      animate={{ 
        width: currentWidth,
        boxShadow: isCollapsed ? 'none' : '0 0 40px oklch(0 0 0 / 0.05)'
      }}
      transition={sidebarSpring}
    >
      <div className={cn(
        "flex items-center border-b border-sidebar-border/50 py-4 min-h-[52px] bg-gradient-to-r from-sidebar/30 to-transparent transition-all duration-300",
        isCollapsed && !isMobile ? "px-2" : "px-3 pl-4",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        <AnimatePresence mode="wait">
          {!isCollapsed ? (
            <motion.div
              key="expanded-header"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className="flex items-center justify-between w-full h-full"
            >
              <Logo size="sm" context="navbar" />
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={hoverSpring}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggle}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                    >
                      <motion.div
                        whileHover={{ rotate: -90 }}
                        transition={{ duration: 0.3 }}
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </motion.div>
                    </Button>
                  </motion.div>
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
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={hoverSpring}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggle}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                    >
                      <motion.div
                        whileHover={{ rotate: 90 }}
                        transition={{ duration: 0.3 }}
                      >
                        <PanelLeft className="h-4 w-4" />
                      </motion.div>
                    </Button>
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Expand sidebar (Ctrl+B)
                </TooltipContent>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 overflow-hidden">
        <SidebarContent />
      </div>
    </motion.aside>
  );
}

export function MobileSidebarTrigger() {
  const { toggle, isMobile } = useSidebar();

  if (!isMobile) return null;

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={hoverSpring}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        className="lg:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
    </motion.div>
  );
}
