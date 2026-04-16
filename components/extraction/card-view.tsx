"use client";

import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import type { Id } from "@/convex/_generated/dataModel";
import { PaperResultCard } from "@/components/extraction/paper-result-card";
import type {
  WorkbenchPaper,
  ExtractionQuestion,
} from "@/lib/extraction/workbench-columns";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CardViewProps {
  table: TanStackTable<WorkbenchPaper>;
  questions: ExtractionQuestion[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardView({ table, questions }: CardViewProps) {
  const t = useTranslations("extraction.workbench");
  const parentRef = useRef<HTMLDivElement>(null);

  // Get paginated rows from TanStack Table (D-17: pagination controls how many the virtualizer receives)
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280, // D-02: ~280px estimated card height
    overscan: 5, // D-02: 5 rows above and below viewport
  });

  // Pitfall 2: reset scroll position when data changes (filter/sort/pagination)
  useEffect(() => {
    virtualizer.scrollToIndex(0);
  }, [rows.length, virtualizer]);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {t("splitEmptyHeading")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-[calc(100vh-280px)] overflow-y-auto"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const paper = rows[virtualRow.index].original;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="pb-4">
                <PaperResultCard
                  paper={{
                    ...paper,
                    _id: paper._id as Id<"extractionPapers">,
                  }}
                  questions={questions}
                  index={virtualRow.index}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
