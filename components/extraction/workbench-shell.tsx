/** Workbench shell owning the single useReactTable instance. Passes table to toolbar and active view via props. Phase 101: D-01, D-02. */
"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useExtractionResultsViewStore } from "@/lib/store/extraction-results-view";
import {
  createWorkbenchColumns,
  type WorkbenchPaper,
  type ExtractionQuestion,
} from "@/lib/extraction/workbench-columns";
import { WorkbenchToolbar } from "@/components/extraction/workbench-toolbar";
import { WorkbenchDataTable } from "@/components/extraction/workbench-data-table";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkbenchShellProps {
  data: WorkbenchPaper[];
  questions: ExtractionQuestion[];
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkbenchShell({
  data,
  questions,
  children,
}: WorkbenchShellProps) {
  const hasHydrated = useExtractionResultsViewStore((s) => s._hasHydrated);

  // Hydration guard: render skeleton until Zustand rehydrates from localStorage
  if (!hasHydrated) {
    return (
      <div className="bg-background min-h-[400px]">
        <div className="bg-muted/50 animate-pulse rounded-lg h-12 w-full mb-4" />
        <div className="bg-muted/50 animate-pulse rounded-lg h-64 w-full" />
      </div>
    );
  }

  return (
    <WorkbenchShellInner data={data} questions={questions}>
      {children}
    </WorkbenchShellInner>
  );
}

// ---------------------------------------------------------------------------
// Inner component (only renders after hydration)
// ---------------------------------------------------------------------------

function WorkbenchShellInner({
  data,
  questions,
  children,
}: WorkbenchShellProps) {
  const { columnVisibility, setColumnVisibility, activeView } =
    useExtractionResultsViewStore();

  // Local state for sorting and column filters
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Column memoization keyed on questions (per D-04)
  const columns = useMemo(
    () => createWorkbenchColumns(questions),
    [questions],
  );

  // Bridge TanStack Updater<VisibilityState> to Zustand's plain-value setter
  const handleColumnVisibilityChange = useCallback(
    (updaterOrValue: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
      if (typeof updaterOrValue === "function") {
        const next = updaterOrValue(columnVisibility);
        setColumnVisibility(next);
      } else {
        setColumnVisibility(updaterOrValue);
      }
    },
    [columnVisibility, setColumnVisibility],
  );

  // Single useReactTable instance shared across all views (per D-01)
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={cn("bg-background min-h-[400px]")}>
      <WorkbenchToolbar table={table} />
      <div className="mt-4">
        <AnimatePresence mode="wait">
          {activeView === "table" && (
            <motion.div
              key="table"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : subtleSpring}
            >
              <WorkbenchDataTable table={table} />
            </motion.div>
          )}
          {activeView === "card" && (
            <motion.div
              key="card"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : subtleSpring}
            >
              {children ?? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Card view -- Phase 103
                </div>
              )}
            </motion.div>
          )}
          {activeView === "split" && (
            <motion.div
              key="split"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : subtleSpring}
            >
              {children ?? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Split view -- Phase 103
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
