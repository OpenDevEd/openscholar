"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import {
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  FlaskConical,
  Plus,
  Database,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { CommandCenterHeader } from "@/components/command-center/command-center-header";
import { ExtractionJobHistory } from "@/components/extraction/extraction-job-history";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

const PAGE_SIZE = 15;

type SortKey = "recent" | "oldest" | "status" | "papers";
const SORT_KEYS = ["recent", "oldest", "status", "papers"] as const;
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  processing: 1,
  completed: 2,
  failed: 3,
  cancelled: 4,
};

function isSortKey(v: string | null): v is SortKey {
  return v !== null && (SORT_KEYS as readonly string[]).includes(v);
}

export function ExtractionCommandCenter() {
  const t = useTranslations("extraction.listPage");
  const tc = useTranslations("common");
  const tExt = useTranslations("extraction");
  const tcc = useTranslations("commandCenter");

  const { data: jobs } = useProtectedQuery(
    api.extraction.queries.listUserExtractionJobs,
    { limit: 100 },
  );

  const [search, setSearch] = useQueryState(
    "q",
    parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  );
  const [sortRaw, setSort] = useQueryState(
    "sort",
    parseAsString.withDefault("recent").withOptions({ clearOnDefault: true }),
  );
  const sort: SortKey = isSortKey(sortRaw) ? sortRaw : "recent";
  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ clearOnDefault: true }),
  );

  const [searchInput, setSearchInput] = useState(search);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = search.trim().toLowerCase();
    const filteredJobs = q
      ? jobs.filter((j) => {
          if (j.firstQuestion?.toLowerCase().includes(q)) return true;
          if (j.status.toLowerCase().includes(q)) return true;
          return false;
        })
      : jobs.slice();
    switch (sort) {
      case "recent":
        filteredJobs.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "oldest":
        filteredJobs.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "status":
        filteredJobs.sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
        );
        break;
      case "papers":
        filteredJobs.sort((a, b) => b.totalPapers - a.totalPapers);
        break;
    }
    return filteredJobs;
  }, [jobs, search, sort]);

  const totalCount = jobs?.length ?? 0;
  const filteredCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageJobs = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const sortLabel = (k: SortKey) => {
    switch (k) {
      case "recent":
        return t("sortRecent");
      case "oldest":
        return t("sortOldest");
      case "status":
        return t("sortStatus");
      case "papers":
        return t("sortPapers");
    }
  };

  const showToolbar = totalCount > 0;
  const showPagination = totalPages > 1;

  const emptyFiltered = (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted/50 p-3 mb-3">
        <Search className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="text-sm font-medium text-foreground">
        {t("emptyFilteredHeading")}
      </h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        {t("emptyFilteredBody")}
      </p>
    </div>
  );

  const emptyAll = (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted/50 p-3 mb-3">
        <FlaskConical className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="text-sm font-medium text-foreground">
        {t("emptyHeading")}
      </h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs mb-4">
        {t("emptyBody")}
      </p>
      <Button asChild size="sm">
        <Link href="/extraction/new">
          <Plus className="h-4 w-4" />
          <span>{t("newJob")}</span>
        </Link>
      </Button>
    </div>
  );

  return (
    <CommandCenterContainer>
      <CommandCenterHeader
        icon={Database}
        title={t("title")}
        description={t("description")}
        count={totalCount}
        singular={tcc("jobSingular")}
        plural={tcc("jobPlural")}
      />

      {showToolbar && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...subtleSpring, delay: 0.15 }}
          className={cn(
            "px-4 md:px-6 py-3",
            "border-b border-border/40",
            "flex flex-col sm:flex-row items-stretch sm:items-center gap-3",
          )}
        >
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSearch(e.target.value || null);
                setPage(1);
              }}
              className={cn(
                "pl-9 pr-9 h-9",
                "bg-muted/30 dark:bg-muted/20",
                "border-border/50",
                "placeholder:text-muted-foreground/60",
              )}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch(null);
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={tc("clear")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{sortLabel(sort)}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(SORT_KEYS as readonly SortKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => {
                      setSort(key === "recent" ? null : key);
                      setPage(1);
                    }}
                    className={cn(sort === key && "bg-muted")}
                  >
                    {sortLabel(key)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button asChild size="sm">
              <Link href="/extraction/new">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("newJob")}</span>
              </Link>
            </Button>
          </div>
        </motion.div>
      )}

      <div className="px-4 md:px-6 py-4">
        {jobs === undefined ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/50 bg-card px-3.5 py-3 animate-pulse"
              >
                <div className="h-3 w-2/3 rounded bg-muted mb-2" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : totalCount === 0 ? (
          emptyAll
        ) : (
          <ExtractionJobHistory
            jobs={pageJobs}
            emptyState={emptyFiltered}
          />
        )}

        {showPagination && (
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-border/40">
            <span className="text-xs text-muted-foreground tabular-nums">
              {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filteredCount)}{" "}
              {t("paginationOf")} {filteredCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="h-8"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {t("paginationPrevious")}
                </span>
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                className="h-8"
              >
                <span className="hidden sm:inline">{t("paginationNext")}</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </CommandCenterContainer>
  );
}
