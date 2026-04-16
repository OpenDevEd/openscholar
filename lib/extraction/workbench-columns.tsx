/** Workbench column definitions for TanStack React Table v8. Hoisted at module level to prevent re-render storms (PITFALL 4). Phase 101: WB-01, WB-03. */

import React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { StatusBadge } from "@/components/extraction/status-badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Row data shape matching getExtractionResults return.
 * One row per extraction paper with its question results.
 */
export interface WorkbenchPaper {
  _id: string;
  title: string;
  openalexId: string;
  doi?: string;
  status:
    | "pending"
    | "parsing"
    | "extracting"
    | "completed"
    | "failed"
    | "cancelled";
  parsingSource?: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";
  results: Array<{
    questionId: string;
    answer: string | null;
    confidence?: "high" | "medium" | "low";
    evidenceStartChar?: number;
    evidenceEndChar?: number;
    reasoning?: string;
    modelUsed?: string;
    criticVerdict?: string;
  }>;
}

/**
 * Extraction question shape matching convex/extraction/validators.ts.
 */
export interface ExtractionQuestion {
  key: string;
  question: string;
  expectedType?: string;
}

// ---------------------------------------------------------------------------
// Memoized cell renderers (hoisted at module level per D-03)
// ---------------------------------------------------------------------------

export const MemoizedConfidenceBadge = React.memo(ConfidenceBadge);
export const MemoizedStatusBadge = React.memo(StatusBadge);

// ---------------------------------------------------------------------------
// Static columns (defined once at module scope)
// ---------------------------------------------------------------------------

const staticColumns: ColumnDef<WorkbenchPaper>[] = [
  {
    accessorKey: "title",
    enableHiding: false,
  },
  {
    accessorKey: "status",
    filterFn: "equals",
    cell: ({ row }) => (
      <MemoizedStatusBadge status={row.original.status} />
    ),
  },
  {
    id: "confidence",
    filterFn: "equals",
    accessorFn: (row) => {
      const confs = row.results
        .map((r) => r.confidence)
        .filter(Boolean) as Array<"high" | "medium" | "low">;
      if (confs.includes("low")) return "low";
      if (confs.includes("medium")) return "medium";
      if (confs.includes("high")) return "high";
      return undefined;
    },
    cell: ({ getValue }) => {
      const value = getValue<"high" | "medium" | "low" | undefined>();
      if (!value) return null;
      return <MemoizedConfidenceBadge confidence={value} />;
    },
  },
  {
    accessorKey: "doi",
    enableSorting: true,
  },
  {
    accessorKey: "parsingSource",
    filterFn: "equals",
  },
];

// ---------------------------------------------------------------------------
// Column factory
// ---------------------------------------------------------------------------

/**
 * Creates workbench column definitions for TanStack Table v8.
 *
 * Returns static columns (title, status, confidence, doi, parsingSource)
 * plus one dynamic column per extraction question.
 *
 * @param questions - Extraction questions to generate dynamic columns for
 * @returns Array of ColumnDef for use with useReactTable
 */
export function createWorkbenchColumns(
  questions: ExtractionQuestion[],
): ColumnDef<WorkbenchPaper>[] {
  const questionColumns: ColumnDef<WorkbenchPaper>[] = questions.map((q) => ({
    id: `question-${q.key}`,
    header: q.question,
    accessorFn: (row: WorkbenchPaper) =>
      row.results.find((r) => r.questionId === q.key)?.answer ?? null,
    filterFn: "includesString" as const,
  }));

  return [...staticColumns, ...questionColumns];
}
