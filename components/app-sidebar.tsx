"use client";

"use no memo"; // try/finally in handlers

import { useOrganizationFeatures } from "@/lib/auth/use-organization-features";

import React, { useState, useEffect, Suspense } from "react";
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
  useCurrentQueryStore,
  useKeywordExpansionStore,
} from "@/lib/store";
import { useSearchList } from "@/lib/research/search-list";
import { usePreloadSearch, useQueryShortcuts } from "@/lib/research/reads";
import { useEffectiveSearchId } from "@/lib/hooks";
import { restoreFromHistory } from "@/lib/search";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { SearchHistoryTab } from "./search-history-tab";
import { KeywordExpansionPreview } from "./keyword-expansion-preview";
import { AuthButton } from "./auth-button";
import {
  ListChecks,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  HomeIcon,
  LibraryIcon,
  BookmarksIcon,
  HistoryIcon,
  ExtractionIcon,
  TopicsIcon,
  AuthorsIcon,
  EvidenceLibrariesIcon,
} from "@/components/icons";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { ScreeningJobsDialog } from "@/components/screening/screening-jobs-dialog";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";

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
    <Link
      href={href}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg h-auto",
        "group relative overflow-hidden",
        isActive
          ? "bg-sidebar-accent/80"
          : "hover:bg-sidebar-accent/60",
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
        tabIndex={-1}
      >
        <Icon
          className={cn(
            "h-5 w-5 flex-shrink-0 transition-colors duration-200",
            isActive
              ? "text-sidebar-primary drop-shadow-sm"
              : "text-sidebar-primary/65 group-hover:text-sidebar-primary",
          )}
        />
        {/* Badge overlay when collapsed */}
        {isCollapsed && badge !== undefined && badge > 0 && (
          <motion.span
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center text-3xs font-bold bg-gradient-to-r from-primary-bright to-primary-deep text-primary-foreground rounded-full"
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
                    ? "bg-gradient-to-r from-primary-bright via-primary to-primary-deep text-primary-foreground shadow-md"
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
          className="absolute inset-0 bg-gradient-to-r from-primary to-transparent pointer-events-none"
        />
      )}
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * staggerDelay, ease: [0.32, 0.72, 0, 1] }}
    >
      <motion.div
        tabIndex={-1}
        whileHover={{ x: isCollapsed ? 2 : 4 }}
        whileTap={isCollapsed ? { scale: 0.95 } : { x: 2, scale: 0.98 }}
        transition={hoverSpring}
      >
        {isCollapsed || customTooltipContent ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent
              side="right"
              className={customTooltipContent
                ? "w-80 bg-background text-foreground border shadow-lg p-0 max-w-xs max-h-96 overflow-y-auto"
                : "flex items-center gap-2"}
              arrowClassName={customTooltipContent ? "bg-background fill-background" : undefined}
            >
              {customTooltipContent ? <div className="p-3">{customTooltipContent}</div> : (
                <>
                  {label}
                  {badge !== undefined && badge > 0 && (
                    <motion.span
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1 }}
                      className="text-xs bg-gradient-to-r from-primary-bright to-primary-deep text-primary-foreground px-1.5 py-0.5 rounded-full"
                    >{badge}</motion.span>
                  )}
                </>
              )}
            </TooltipContent>
          </Tooltip>
        ) : content}
      </motion.div>
    </motion.div>
  );
}

function ScreeningFooterButton({
  onClick,
  isCollapsed,
  progressPercent,
  label,
}: {
  onClick: () => void;
  isCollapsed: boolean;
  progressPercent: number | null;
  label: string;
}) {
  const circumference = 2 * Math.PI * 10;
  const accessibleLabel = progressPercent === null
    ? label
    : `${label} ${Math.round(progressPercent)}%`;

  const icon = (
    <span className="relative inline-flex items-center justify-center">
      <ListChecks className="h-[1.1rem] w-[1.1rem]" />
      {progressPercent !== null && (
        <svg
          viewBox="0 0 24 24"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[2] origin-center"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.1"
          />
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={
              circumference - (circumference * progressPercent) / 100
            }
            strokeLinecap="round"
            transform="rotate(-90 12 12)"
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
      )}
    </span>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            aria-label={accessibleLabel}
            className="h-8 w-8 px-0 transition-all duration-200 hover:bg-sidebar-accent/80"
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {progressPercent !== null && (
            <span className="text-xs text-muted-foreground">
              {Math.round(progressPercent)}%
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={accessibleLabel}
      className="h-8 w-auto px-2 transition-all duration-200 hover:bg-sidebar-accent/80"
    >
      {icon}
      {progressPercent !== null && (
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
          {Math.round(progressPercent)}%
        </span>
      )}
    </Button>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const tc = useTranslations("common");
  const ts = useTranslations("sidebar");
  const pathname = usePathname();
  const extractionEnabled = useFeatureFlag("extraction.enabled");
  const canStartExtraction = useFeatureFlag("extraction.start");
  const { data: organizationFeatures } = useOrganizationFeatures();
  const hasExtractionAccess = organizationFeatures?.extraction && extractionEnabled && canStartExtraction;
  const { phase } = useAuthReadiness();
  const hasEvidenceLibrariesAccess = organizationFeatures?.evidenceLibraries;
  const goToSignIn = useSignInRedirect();
  const [isScreeningJobsOpen, setIsScreeningJobsOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const recents = useSearchList({ sort: "recent", pageSize: 10 });
  const preloadSearch = usePreloadSearch();
  const currentPage = recents.page;
  const { currentQuery } = useCurrentQueryStore();
  const { keywords } = useKeywordExpansionStore();
  const effectiveSearchId = useEffectiveSearchId();

  // Screening job progress for footer button
  const { data: activeJob } = useProtectedQuery(
    api.screening.queries.getActiveScreeningJobProgress,
    {},
  );
  const progressPercent = activeJob?.percentComplete ?? null;

  // Determine active query - now uses store for real-time updates on all pages
  // Fallback to URL params if store is empty (shouldn't happen but safety first)
  const activeQuery = currentQuery || searchParams.get("q") || "";
  useQueryShortcuts(activeQuery);

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

  const totalPages = Math.max(currentPage, recents.pageCount ?? currentPage);
  const displayItems = recents.items;

  const getCurrentPage = () => {
    if (!pathname) return null;
    if (pathname.startsWith("/topics")) return "topics";
    if (pathname.startsWith("/authors")) return "authors";
    if (pathname.startsWith("/evidence-libraries")) return "evidence-libraries";
    if (pathname === "/") return "home";
    if (pathname.includes("/bookmarks")) return "bookmarks";
    if (pathname.includes("/library")) return "library";
    if (pathname.includes("/history")) return "history";
    if (hasExtractionAccess && pathname.includes("/extraction"))
      return "extraction";
    if (pathname.includes("/ai-enhancement")) return "ai-enhancement";
    return null;
  };

  const currentPageValue = getCurrentPage();

  const handleNavClick = () => {
    onClose?.();
  };

  const handlePrevPage = recents.previous;
  const handleNextPage = recents.next;

  const handleSearchHistoryClick = (search: (typeof recents.items)[number]) => {
    preloadSearch(search);
    router.push(restoreFromHistory(search));
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
            icon={HomeIcon}
            label={tc("home")}
            isActive={currentPageValue === "home"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={0}
          />

          <NavItem
            href="/library"
            icon={LibraryIcon}
            label={tc("library")}
            isActive={currentPageValue === "library"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={1}
          />

          <NavItem
            href="/bookmarks"
            icon={BookmarksIcon}
            label={tc("bookmarks")}
            isActive={currentPageValue === "bookmarks"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={2}
            badge={expandableCount > 0 ? expandableCount : undefined}
            customTooltipContent={
              hasBookmarkSyntax ? (
                <KeywordExpansionPreview query={activeQuery} />
              ) : undefined
            }
          />

          <NavItem
            href="/history"
            icon={HistoryIcon}
            label={tc("history")}
            isActive={currentPageValue === "history"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={3}
          />

          {hasExtractionAccess && (
            <NavItem
              href="/extraction"
              icon={ExtractionIcon}
              label={tc("extraction")}
              isActive={currentPageValue === "extraction"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
              index={4}
            />
          )}

          <NavItem href="/topics" icon={TopicsIcon} label="Topics" isActive={currentPageValue === "topics"} isCollapsed={isCollapsed && !isMobile} onClick={handleNavClick} index={5} />

          {organizationFeatures?.authors && <NavItem
            href="/authors"
            icon={AuthorsIcon}
            label="Authors"
            isActive={currentPageValue === "authors"}
            isCollapsed={isCollapsed && !isMobile}
            onClick={handleNavClick}
            index={5}
          />}

          {hasEvidenceLibrariesAccess && (
            <NavItem
              href="/evidence-libraries"
              icon={EvidenceLibrariesIcon}
              label={tc("evidenceLibraries")}
              isActive={currentPageValue === "evidence-libraries"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
              index={5}
            />
          )}
        </motion.div>
      </div>

      {/* Search history - scrollable */}
      <div className="flex-1 min-h-0 flex flex-col">
        {(recents.items.length > 0 || recents.hasPages) && (
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
                      filters={search}
                      createdAt={search.createdAt}
                      updatedAt={search.updatedAt}
                      isActive={search.id === effectiveSearchId}
                      isCollapsed={isCollapsed && !isMobile}
                      search={search}
                      onClick={() => handleSearchHistoryClick(search)}
                      index={idx + 3}
                    />
                  ))}
                </motion.div>

                {recents.hasPages && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.25 }}
                    className={cn(
                      "flex items-center justify-center gap-1 pt-2",
                      isCollapsed && !isMobile && "flex-col gap-2",
                    )}
                  >
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePrevPage}
                            aria-label={tc("previousPage")}
                            disabled={!recents.canPrevious}
                            className={cn(
                              "h-7 w-7 transition-all duration-200",
                              isCollapsed && !isMobile ? "h-8 w-8" : "",
                              currentPage > 1 && "hover:bg-sidebar-accent/80",
                            )}
                          >
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              transition={hoverSpring}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </motion.div>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {isCollapsed && !isMobile ? (
                        <TooltipContent side="right">{tc("previousPage")}</TooltipContent>
                      ) : null}
                    </Tooltip>

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

                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleNextPage}
                            aria-label={tc("nextPage")}
                            disabled={!recents.canNext}
                            className={cn(
                              "h-7 w-7 transition-all duration-200",
                              isCollapsed && !isMobile ? "h-8 w-8" : "",
                              recents.canNext &&
                                "hover:bg-sidebar-accent/80",
                            )}
                          >
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              transition={hoverSpring}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </motion.div>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {isCollapsed && !isMobile ? (
                        <TooltipContent side="right">{tc("nextPage")}</TooltipContent>
                      ) : null}
                    </Tooltip>
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
              <ScreeningFooterButton
                onClick={() => phase === "authenticated" ? setIsScreeningJobsOpen(true) : goToSignIn()}
                isCollapsed={false}
                progressPercent={progressPercent}
                label={tc("screening")}
              />
              <ThemeToggle />
              <LanguageSwitcher isCollapsed={false} />
            </div>
            <AuthButton isCollapsed={false} />
          </motion.div>
        ) : (
          <>
            <ScreeningFooterButton
              onClick={() => phase === "authenticated" ? setIsScreeningJobsOpen(true) : goToSignIn()}
              isCollapsed={true}
              progressPercent={progressPercent}
              label={tc("screening")}
            />
            <ThemeToggle />
            <LanguageSwitcher isCollapsed={true} />
            <AuthButton isCollapsed={true} />
          </>
        )}
      </motion.div>

      <ScreeningJobsDialog
        open={isScreeningJobsOpen}
        onOpenChange={setIsScreeningJobsOpen}
      />
    </div>
  );
}

/** Check if the current route should be chromeless (no sidebar).
 *  - /connect is always chromeless
 *  - /sign-in and /sign-up are only chromeless when redirecting to /connect
 */
function useIsChromeless() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname?.startsWith("/connect")) return true;

  if (pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up")) {
    const redirect = searchParams.get("redirect_url") ?? "";
    return redirect.startsWith("/connect");
  }

  return false;
}

export function AppSidebar() {
  const ts = useTranslations("sidebar");
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const { isOpen, setOpen, isCollapsed, toggle, setCollapsed, _hasHydrated } =
    useSidebarStore();
  const { currentWidth } = getSidebarDimensions(isCollapsed);

  const isChromeless = useIsChromeless();

  // Keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    if (isChromeless) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle(isMobile);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle, isMobile, isChromeless]);

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

  // Hide sidebar on chromeless routes (consent flow, auth)
  if (isChromeless) {
    return null;
  }

  // The saved width is only known after hydration. Until then hold the space
  // the head script measured, so the page does not shift when the sidebar mounts.
  if (!_hasHydrated) {
    return <div aria-hidden className="sticky top-0 hidden h-screen w-(--app-sidebar-width) shrink-0 border-r border-sidebar-border bg-sidebar md:block" />;
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
            <SheetHeader className="px-3 py-4 border-b border-sidebar-border bg-sidebar shrink-0">
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
        "h-screen flex flex-col border-r border-sidebar-border bg-sidebar",
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
          "relative flex items-center border-b border-sidebar-border py-4 min-h-[52px] bg-gradient-to-r from-sidebar/30 to-transparent overflow-hidden px-4",
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
          <motion.div
            tabIndex={-1}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={hoverSpring}
            className="shrink-0"
          >
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggle(isMobile)}
                aria-label={isCollapsed ? ts("expandSidebar") : ts("collapseSidebar")}
                aria-expanded={!isCollapsed}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
              >
                <motion.div
                  animate={{ rotate: isCollapsed ? 0 : 180 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                  <PanelLeft className="h-4 w-4" />
                </motion.div>
              </Button>
            </TooltipTrigger>
          </motion.div>
          <TooltipContent side="right">
            {isCollapsed ? ts("expandSidebar") : ts("collapseSidebar")}
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
  const t = useTranslations("accessibility");
  const isOpen = useSidebarStore((s) => s.isOpen);
  const toggle = useSidebarStore((s) => s.toggle);

  if (!isMobile) return null;

  return (
    <motion.div
      tabIndex={-1}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={hoverSpring}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => toggle(true)}
        aria-label={isOpen ? t("collapsePanel") : t("expandPanel")}
        aria-expanded={isOpen}
        className="lg:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
    </motion.div>
  );
}
