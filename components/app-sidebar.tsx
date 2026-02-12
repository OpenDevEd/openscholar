"use client";

import React, { useEffect, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSidebarStore, getSidebarDimensions } from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
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
  useSearchHistoryUIStore,
  useCurrentQueryStore,
  useKeywordExpansionStore,
} from "@/lib/store";
import { useEffectiveSearchId } from "@/lib/hooks";
import { restoreFromHistory } from "@/lib/search";
import { SearchHistoryTab } from "./search-history-tab";
import { KeywordExpansionPreview } from "./keyword-expansion-preview";
import { AuthButton } from "./auth-button";
import {
  Home,
  BookOpen,
  Clock,
  Database,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";

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

const staggerDelay = 0;

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  badge?: number;
  onClick?: () => void;
  index?: number;
  customTooltipContent?: React.ReactNode;
}

function NavItem({
  href,
  icon: Icon,
  label,
  isActive,
  isCollapsed,
  badge,
  onClick,
  index = 0,
  customTooltipContent,
}: NavItemProps) {
  const content = (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.2,
        delay: index * staggerDelay,
        ease: [0.32, 0.72, 0, 1],
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
          isActive
            ? "text-sidebar-primary font-medium"
            : "text-sidebar-foreground",
          isCollapsed && "justify-center",
          "transition-all duration-200 ease-out",
          isActive && "nav-active",
        )}
      >
        <motion.div
          whileHover={{ scale: isCollapsed ? 1.15 : 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={hoverSpring}
          className="relative z-10"
        >
          <Icon
            className={cn(
              "h-5 w-5 flex-shrink-0 transition-colors duration-200",
              isActive
                ? "text-sidebar-primary drop-shadow-sm"
                : "text-muted-foreground group-hover:text-sidebar-foreground",
            )}
          />
          {/* Badge overlay when collapsed */}
          {isCollapsed && badge !== undefined && badge > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center text-[10px] font-bold bg-gradient-to-r from-[oklch(0.75_0.15_55)] to-[oklch(0.62_0.16_52)] text-white rounded-full"
            >
              {badge > 9 ? "9+" : badge}
            </motion.span>
          )}
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
                ease: [0.32, 0.72, 0, 1],
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
                    damping: 20,
                  }}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium badge-glow",
                    isActive
                      ? "bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white shadow-md"
                      : "bg-muted text-muted-foreground",
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
        <TooltipContent
          side="right"
          className={
            customTooltipContent
              ? "w-80 bg-background text-foreground border shadow-lg p-0 max-w-xs max-h-96 overflow-y-auto"
              : "flex items-center gap-2"
          }
        >
          {customTooltipContent ? (
            <div className="p-3">{customTooltipContent}</div>
          ) : (
            <>
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
            </>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // When expanded with custom tooltip, show tooltip on hover
  if (customTooltipContent) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={{ x: 4 }}
            whileTap={{ x: 2, scale: 0.98 }}
            transition={hoverSpring}
          >
            {content}
          </motion.div>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="w-80 bg-background text-foreground border shadow-lg p-0 max-w-xs max-h-96 overflow-y-auto"
        >
          <div className="p-3">{customTooltipContent}</div>
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
  const tc = useTranslations("common");
  const ts = useTranslations("sidebar");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const { searchHistory } = useSearchHistoryStore();
  const { currentPage, setCurrentPage } = useSearchHistoryUIStore();
  const { currentQuery } = useCurrentQueryStore();
  const { keywords } = useKeywordExpansionStore();
  const effectiveSearchId = useEffectiveSearchId();

  // Determine active query - now uses store for real-time updates on all pages
  // Fallback to URL params if store is empty (shouldn't happen but safety first)
  const activeQuery = currentQuery || searchParams.get("q") || "";

  // Calculate expandable keywords count
  const getExpandableCount = (query: string) => {
    const keywordMatches = [...query.matchAll(/(\w[\w-]*)\.\.\./g)];
    let count = 0;
    keywordMatches.forEach((match) => {
      const keyword = match[1];
      if (keywords[keyword]) {
        count++;
      }
    });
    return count;
  };

  const expandableCount = getExpandableCount(activeQuery);
  const hasBookmarkSyntax = /(\w[\w-]*)\.\.\./g.test(activeQuery);

  const itemsPerPage = 10;
  const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
  const displayItems = searchHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname === "/") return "home";
    if (pathname.includes("/bookmarks")) return "bookmarks";
    if (pathname.includes("/history")) return "history";
    if (pathname.includes("/extraction")) return "extraction";
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
    const entry = searchHistory.find((s) => s.id === searchId);
    if (entry) {
      router.push(restoreFromHistory(entry));
    } else {
      router.push(`/results/${searchId}`);
    }
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Navigation - fixed, not scrollable */}
      <div className={cn("py-4", isCollapsed && !isMobile ? "px-2" : "px-3")}>
        <motion.div
          className="space-y-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <NavItem
            href="/"
            icon={Home}
            label={tc("home")}
            isActive={currentPageValue === "home"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={0}
          />

          <NavItem
            href="/bookmarks"
            icon={BookOpen}
            label={tc("bookmarks")}
            isActive={currentPageValue === "bookmarks"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={1}
            badge={expandableCount > 0 ? expandableCount : undefined}
            customTooltipContent={
              hasBookmarkSyntax ? (
                <KeywordExpansionPreview query={activeQuery} />
              ) : undefined
            }
          />

          <NavItem
            href="/history"
            icon={Clock}
            label={tc("history")}
            isActive={currentPageValue === "history"}
            isCollapsed={isCollapsed && !isMobile}
            index={2}
          />

          <NavItem
            href="/extraction"
            icon={Database}
            label={tc("extraction")}
            isActive={currentPageValue === "extraction"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={3}
          />
        </motion.div>
      </div>

      {/* Search history - scrollable */}
      <div className="flex-1 min-h-0 flex flex-col">
        {searchHistory.length > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className={cn(
                "shrink-0",
                isCollapsed && !isMobile ? "px-2" : "px-3",
              )}
            >
              <Separator className="bg-gradient-to-r from-transparent via-border/60 to-transparent" />
            </motion.div>
            <ScrollArea className="h-full sidebar-scrollbar">
              <div
                className={cn(
                  "py-4",
                  isCollapsed && !isMobile ? "px-2" : "px-3",
                )}
              >
                <motion.div
                  className="space-y-1 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  {displayItems.map((search, idx) => (
                    <SearchHistoryTab
                      key={search.id}
                      id={search.id}
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
                      updatedAt={search.updatedAt}
                      isActive={search.id === effectiveSearchId}
                      isCollapsed={isCollapsed && !isMobile}
                      reviewFilter={search.reviewFilter}
                      ratingRange={search.ratingRange}
                      onlyRatedPapers={search.onlyRatedPapers}
                      citesItemId={search.citesItemId}
                      citedByItemId={search.citedByItemId}
                      relatedToItemId={search.relatedToItemId}
                      queryHistory={search.queryHistory}
                      questionHistory={search.questionHistory}
                      screeningQuestions={search.screeningQuestions}
                      screeningResponses={search.screeningResponses}
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
                      isCollapsed && !isMobile && "flex-col gap-2",
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
                        currentPage > 1 && "hover:bg-sidebar-accent/80",
                      )}
                      title={
                        isCollapsed && !isMobile ? tc("previousPage") : undefined
                      }
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
                              {tc("previousPage")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            <ChevronLeft className="h-4 w-4" />
                            {!isCollapsed ||
                              (isMobile && (
                                <span className="sr-only">{tc("previous")}</span>
                              ))}
                          </>
                        )}
                      </motion.div>
                    </Button>

                    {totalPages > 2 && (
                      <div
                        className={cn(
                          "flex items-center justify-center transition-all duration-200",
                          isCollapsed && !isMobile ? "text-xs" : "",
                        )}
                      >
                        {!isCollapsed || isMobile ? (
                          <motion.span
                            key={`page-${currentPage}`}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 300,
                              damping: 20,
                            }}
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
                              {tc("pageOf", { current: currentPage, total: totalPages })}
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
                        currentPage < totalPages &&
                          "hover:bg-sidebar-accent/80",
                      )}
                      title={isCollapsed && !isMobile ? tc("nextPage") : undefined}
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
                              {tc("nextPage")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            <ChevronRight className="h-4 w-4" />
                            {!isCollapsed ||
                              (isMobile && (
                                <span className="sr-only">{tc("next")}</span>
                              ))}
                          </>
                        )}
                      </motion.div>
                    </Button>
                  </motion.div>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.35 }}
        className={cn(
          "mt-auto border-t border-sidebar-border py-4",
          isMobile
            ? "bg-sidebar"
            : "bg-gradient-to-t from-sidebar to-transparent",
          isCollapsed && !isMobile
            ? "px-2 flex flex-col items-center gap-2"
            : "px-3",
        )}
      >
        {!isCollapsed || isMobile ? (
          <motion.div
            className="flex flex-col w-full gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LanguageSwitcher isCollapsed={false} />
            </div>
            <AuthButton isCollapsed={false} />
          </motion.div>
        ) : (
          <>
            <ThemeToggle />
            <LanguageSwitcher isCollapsed={true} />
            <AuthButton isCollapsed={true} />
          </>
        )}
      </motion.div>
    </div>
  );
}

export function AppSidebar() {
  const ts = useTranslations("sidebar");
  const isMobile = useIsMobile();
  const { isOpen, setOpen, isCollapsed, toggle, setCollapsed, _hasHydrated } =
    useSidebarStore();
  const { currentWidth } = getSidebarDimensions(isCollapsed);

  // Keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle(isMobile);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle, isMobile]);

  // Close mobile sheet when resizing to desktop
  useEffect(() => {
    if (!isMobile && isOpen) {
      setOpen(false);
    }
  }, [isMobile, isOpen, setOpen]);

  // Auto-collapse on lg breakpoint (1024-1279px) on initial hydration
  useEffect(() => {
    if (!_hasHydrated) return;

    const width = window.innerWidth;
    if (width >= 1024 && width < 1280) {
      setCollapsed(true);
    }
  }, [_hasHydrated, setCollapsed]);

  // Don't render until hydrated to prevent flash
  if (!_hasHydrated) {
    return null;
  }

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[280px] p-0 flex flex-col bg-sidebar"
        >
          <motion.div
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="h-full flex flex-col"
          >
            <SheetHeader className="px-3 py-4 border-b border-sidebar-border/50 bg-sidebar shrink-0">
              <SheetTitle className="flex items-center">
                <Logo size="sm" context="general" clickable={false} />
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-hidden">
              <Suspense fallback={null}>
                <SidebarContent onClose={() => setOpen(false)} />
              </Suspense>
            </div>
          </motion.div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <motion.aside
      className={cn(
        "h-screen glass-sidebar flex flex-col",
        "sticky top-0 left-0 z-40 transition-shadow duration-300",
        "hover:shadow-lg",
      )}
      initial={false}
      animate={{
        width: currentWidth,
        boxShadow: isCollapsed ? "none" : "0 0 40px oklch(0 0 0 / 0.05)",
      }}
      transition={sidebarSpring}
    >
      <div
        className={cn(
          "relative flex items-center border-b border-sidebar-border/50 py-4 min-h-[52px] bg-gradient-to-r from-sidebar/30 to-transparent overflow-hidden px-4",
          "relative justify-center",
          !isCollapsed && "justify-end",
        )}
      >
        {/* Logo - only visible when expanded */}
        <AnimatePresence initial={false} mode="sync">
          {!isCollapsed && (
            <motion.div
              key="logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className="shrink-0 absolute left-4"
            >
              <Logo size="sm" context="navbar" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle button - always visible, animates rotation */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={hoverSpring}
              className="shrink-0"
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggle(isMobile)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
              >
                <motion.div
                  animate={{ rotate: isCollapsed ? 0 : 180 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                  <PanelLeft className="h-4 w-4" />
                </motion.div>
              </Button>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isCollapsed
              ? ts("expandSidebar")
              : ts("collapseSidebar")}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <SidebarContent />
        </Suspense>
      </div>
    </motion.aside>
  );
}

export function MobileSidebarTrigger() {
  const isMobile = useIsMobile();
  const toggle = useSidebarStore((s) => s.toggle);

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
        onClick={() => toggle(true)}
        className="lg:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
    </motion.div>
  );
}
