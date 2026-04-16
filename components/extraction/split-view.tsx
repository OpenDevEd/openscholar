"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import type { Id } from "@/convex/_generated/dataModel";
import { PaperResultCard } from "@/components/extraction/paper-result-card";
import { SplitViewRow } from "@/components/extraction/split-view-row";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  WorkbenchPaper,
  ExtractionQuestion,
} from "@/lib/extraction/workbench-columns";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SplitViewProps {
  table: TanStackTable<WorkbenchPaper>;
  questions: ExtractionQuestion[];
}

// D-05: denser pagination for left panel
const SPLIT_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SplitView({ table, questions }: SplitViewProps) {
  const t = useTranslations("extraction.workbench");
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);

  // Get all filtered/sorted rows from the table
  const allRows = table.getFilteredRowModel().rows;
  const totalPages = Math.max(1, Math.ceil(allRows.length / SPLIT_PAGE_SIZE));
  const pageRows = useMemo(
    () =>
      allRows.slice(
        currentPage * SPLIT_PAGE_SIZE,
        (currentPage + 1) * SPLIT_PAGE_SIZE,
      ),
    [allRows, currentPage],
  );

  // Find the selected paper from all rows (not just current page)
  const selectedPaper = useMemo(
    () =>
      allRows.find((row) => row.original._id === selectedPaperId)?.original ??
      null,
    [allRows, selectedPaperId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedPaperId(id);
    // Scroll right panel to top on paper change (D-05)
    detailRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const rangeStart =
    allRows.length === 0 ? 0 : currentPage * SPLIT_PAGE_SIZE + 1;
  const rangeEnd = Math.min(
    (currentPage + 1) * SPLIT_PAGE_SIZE,
    allRows.length,
  );

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[400px]">
      {/* Left panel: 40% width, paginated list */}
      <div className="w-[40%] border-r border-border flex flex-col">
        <div className="flex-1 overflow-y-auto" role="grid" aria-label="Paper list">
          {pageRows.map((row) => (
            <SplitViewRow
              key={row.original._id}
              paper={row.original}
              isSelected={row.original._id === selectedPaperId}
              onSelect={handleSelect}
            />
          ))}
        </div>
        {/* Left panel pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {rangeStart}-{rangeEnd} / {allRows.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Right panel: 60% width, detail */}
      <div
        ref={detailRef}
        className={cn("w-[60%] overflow-y-auto p-4")}
      >
        {selectedPaper ? (
          <PaperResultCard
            paper={{
              ...selectedPaper,
              _id: selectedPaper._id as Id<"extractionPapers">,
            }}
            questions={questions}
            index={0}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-base font-semibold text-muted-foreground">
              {t("splitEmptyHeading")}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              {t("splitEmptyBody")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
