/** Workbench shell owning the single useReactTable instance. Passes table to toolbar and active view via props. Phase 101: D-01, D-02. Phase 103: D-08 (evidence drawer), D-17 (pagination). */
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type PaginationState,
} from "@tanstack/react-table";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useExtractionResultsViewStore } from "@/lib/store/extraction-results-view";
import {
  createWorkbenchColumns,
  type WorkbenchPaper,
  type ExtractionQuestion,
} from "@/lib/extraction/workbench-columns";
import { WorkbenchToolbar } from "@/components/extraction/workbench-toolbar";
import { WorkbenchDataTable } from "@/components/extraction/workbench-data-table";
import { CardView } from "@/components/extraction/card-view";
import { SplitView } from "@/components/extraction/split-view";
import { EvidenceDrawer } from "@/components/extraction/evidence-drawer";
import { PaginationControls } from "@/components/extraction/pagination-controls";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Evidence drawer state (D-08: single mount, not per-row)
// ---------------------------------------------------------------------------

export interface EvidenceDrawerProps {
  paperId: string;
  startChar: number;
  endChar: number;
  questionText: string;
  parsingSource?: string;
  modelUsed?: string;
  criticVerdict?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkbenchShellProps {
  data: WorkbenchPaper[];
  questions: ExtractionQuestion[];
  jobId?: string;
  jobStatus?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkbenchShell({
  data,
  questions,
  jobId,
  jobStatus,
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
    <WorkbenchShellInner data={data} questions={questions} jobId={jobId} jobStatus={jobStatus} />
  );
}

// ---------------------------------------------------------------------------
// Inner component (only renders after hydration)
// ---------------------------------------------------------------------------

function WorkbenchShellInner({
  data,
  questions,
  jobId,
  jobStatus,
}: WorkbenchShellProps) {
  const { columnVisibility, setColumnVisibility, activeView, setActiveView, pageSize } =
    useExtractionResultsViewStore();
  const isMobile = useIsMobile();
  const t = useTranslations("extraction.workbench");

  // D-06 + Phase 105 D-14: split AND card fall back to table on mobile.
  useEffect(() => {
    if (isMobile && activeView !== "table") {
      setActiveView("table");
      toast.info(t("mobileViewFallbackToast"));
    }
  }, [isMobile, activeView, setActiveView, t]);

  // Local state for sorting and column filters
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Pagination state (D-17)
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });

  // Evidence drawer state (D-08: single mount, not per-row)
  const [drawerState, setDrawerState] = useState<{
    open: boolean;
    props: EvidenceDrawerProps | null;
  }>({ open: false, props: null });

  // openEvidence: callback for views to trigger the evidence drawer (D-08)
  // Currently wired to drawerState; views will call this when evidence click support is added
  const openEvidence = useCallback((props: EvidenceDrawerProps) => {
    setDrawerState({ open: true, props });
  }, []);
  void openEvidence; // Prepared for CardView/SplitView onEvidenceClick integration

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
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    autoResetPageIndex: true,
  });

  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={cn("bg-background min-h-[400px]")}>
      <WorkbenchToolbar table={table} jobId={jobId} jobStatus={jobStatus} />
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
              <CardView
                table={table}
                questions={questions}
              />
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
              <SplitView
                table={table}
                questions={questions}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pagination controls below the view */}
      <PaginationControls table={table} />

      {/* Evidence drawer: single mount outside view branches (D-08) */}
      <EvidenceDrawer
        open={drawerState.open}
        onOpenChange={(open) => setDrawerState((prev) => ({ ...prev, open }))}
        {...drawerState.props}
      />
    </div>
  );
}
