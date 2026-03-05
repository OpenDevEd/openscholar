"use client";

import { parseAsInteger, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchHistoryStore } from "@/lib/store";

interface SearchHistoryPaginationProps {
  variant?: "compact" | "full";
}

export function SearchHistoryPagination({ variant = "compact" }: SearchHistoryPaginationProps) {
  const t = useTranslations();
  const { searchHistory } = useSearchHistoryStore();
  const [currentPage, setCurrentPage] = useQueryState(
    "historyPage",
    parseAsInteger.withDefault(1).withOptions({ scroll: true }),
  );
  const itemsPerPage = variant === "compact" ? 5 : 10;

  const totalPages = Math.ceil(searchHistory.length / itemsPerPage);
  const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));

  if (totalPages <= 1) return null;

  if (variant === "compact") {
    return (
      <>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="h-9 w-9 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 sm:hidden">
            {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 3) {
                pageNum = i + 1;
              } else if (currentPage <= 2) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 1) {
                pageNum = totalPages - 2 + i;
              } else {
                pageNum = currentPage - 1 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "ghost"}
                  size="sm"
                  onClick={() => goToPage(pageNum)}
                  className="h-9 w-9 p-0 text-xs"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "ghost"}
                  size="sm"
                  onClick={() => goToPage(pageNum)}
                  className="h-9 w-9 p-0 text-xs"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="h-9 w-9 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {searchHistory.length > itemsPerPage && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              {t("common.showingStartEnd", {
                start: (currentPage - 1) * itemsPerPage + 1,
                end: Math.min(currentPage * itemsPerPage, searchHistory.length),
                total: searchHistory.length,
                label: t("commandCenter.searchPlural"),
              })}
            </p>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6">
      <p className="text-sm text-muted-foreground text-center sm:text-left">
        {t("common.showingStartEnd", {
          start: (currentPage - 1) * itemsPerPage + 1,
          end: Math.min(currentPage * itemsPerPage, searchHistory.length),
          total: searchHistory.length,
          label: t("commandCenter.searchPlural"),
        })}
      </p>
      <div className="flex items-center gap-2 justify-center sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          className="flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden xs:inline">{t("common.previous")}</span>
          <span className="xs:hidden">{t("common.previous")}</span>
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (currentPage <= 4) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = currentPage - 3 + i;
            }
            return (
              <Button
                key={pageNum}
                variant={currentPage === pageNum ? "default" : "outline"}
                size="sm"
                onClick={() => goToPage(pageNum)}
                className="h-9 w-9 p-0"
              >
                {pageNum}
              </Button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="flex items-center gap-1"
        >
          <span className="hidden xs:inline">{t("common.next")}</span>
          <span className="xs:hidden">{t("common.next")}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
