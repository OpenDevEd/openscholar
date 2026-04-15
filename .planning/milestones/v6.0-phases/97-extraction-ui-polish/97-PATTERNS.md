# Phase 97: Extraction UI Polish - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 18 new/modified files
**Analogs found:** 18 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `components/extraction/extraction-dialog.tsx` | component | request-response | `components/screening/screening-dialog.tsx` | exact |
| `components/extraction/question-builder.tsx` | component | CRUD | `components/screening/screening-dialog.tsx` (question handlers) | exact |
| `components/extraction/tier-selector.tsx` | component | request-response | `components/screening/screening-dialog.tsx` (slider/config) | role-match |
| `components/extraction/extraction-jobs-dialog.tsx` | component | request-response | `components/screening/screening-jobs-dialog.tsx` | exact |
| `components/extraction/extraction-job-history.tsx` | component | CRUD | `components/screening/screening-job-history.tsx` | exact |
| `components/extraction/status-badge.tsx` | component | transform | `components/extraction/confidence-badge.tsx` | exact |
| `components/extraction/paper-result-card.tsx` | component | request-response | `components/extraction/insufficient-evidence-card.tsx` | role-match |
| `app/extraction/page.tsx` | route | request-response | `app/library/page.tsx` | exact |
| `app/extraction/[jobId]/page.tsx` | route | request-response | `app/library/page.tsx` | role-match |
| `app/extraction/error.tsx` | route | request-response | `app/results/error.tsx` | exact |
| `app/extraction/[jobId]/error.tsx` | route | request-response | `app/results/error.tsx` | exact |
| `lib/extraction/export.ts` | utility | transform | `lib/screening/export.ts` | exact |
| `convex/extraction/queries.ts` (extend) | service | CRUD | `convex/extraction/queries.ts` (existing) | exact |
| `components/app-sidebar.tsx` (modify) | component | request-response | `components/app-sidebar.tsx` (ScreeningFooterButton) | exact |
| `messages/en-US.json` (extend) | config | transform | `messages/en-US.json` (extraction namespace) | exact |
| `messages/en-GB.json` (extend) | config | transform | `messages/en-US.json` | exact |
| `messages/zh.json` (extend) | config | transform | `messages/en-US.json` | exact |
| `messages/fr.json`, `hi.json`, `ja.json` (extend) | config | transform | `messages/en-US.json` | exact |

## Pattern Assignments

### `components/extraction/extraction-dialog.tsx` (component, request-response)

**Analog:** `components/screening/screening-dialog.tsx`

**Imports pattern** (lines 0-32):
```typescript
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import posthog from "posthog-js";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle, Coins } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
```

**Props + state initialization pattern** (lines 62-130):
```typescript
interface ExtractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Dialog uses open/onOpenChange controlled pattern
// Local form state with useState, reset on dialog open via ref guard
const [localQuestions, setLocalQuestions] = useState<string[]>([]);
const [isSubmitting, setIsSubmitting] = useState(false);

// Reset all form state when dialog opens
const prevOpenRef = useRef(false);
useEffect(() => {
  if (open && !prevOpenRef.current) {
    setLocalQuestions([]);
    // ... reset other state
  }
  prevOpenRef.current = open;
}, [open]);
```

**Credit balance check pattern** (lines 210-215):
```typescript
const estimatedCredits = Math.ceil(paperCount * ESTIMATED_CREDITS_PER_PAPER);
const { data: balanceCheck } = useProtectedQuery(
  api.credits.queries.checkBalance,
  open ? { requiredAmount: estimatedCredits } : "skip"
);
```

**Submit handler pattern** (lines 253-331):
```typescript
const handleSubmit = useCallback(async () => {
  setIsSubmitting(true);
  try {
    await createExtractionJob({ papers, questions: keyedQuestions });
    toast.success(t("jobCreation.success"), { duration: 3000 });
    onOpenChange(false);
    posthog.capture("extraction_job_created", {
      paperCount: papers.length,
      questionCount: keyedQuestions.length,
    });
  } catch (error: unknown) {
    const msg = getErrorMessage(error, t("jobCreation.error"));
    if (
      typeof error === "object" && error !== null &&
      "data" in error &&
      typeof (error as { data?: unknown }).data === "string" &&
      ((error as { data: string }).data).includes("EXTRACTION_JOB_ALREADY_ACTIVE")
    ) {
      showStyledToast("error", t("jobCreation.activeJobWarning"));
    } else {
      showStyledToast("error", msg);
    }
  } finally {
    setIsSubmitting(false);
  }
}, [/* deps */]);
```

**Dialog dismiss guard pattern** (lines 358-369):
```typescript
<DialogContent
  onEscapeKeyDown={(e) => { if (isSubmitting) e.preventDefault(); }}
  onPointerDownOutside={(e) => { if (isSubmitting) e.preventDefault(); }}
  onInteractOutside={(e) => { if (isSubmitting) e.preventDefault(); }}
  showCloseButton={!isSubmitting}
  className="sm:max-w-xl max-h-[85vh] flex flex-col"
>
```

---

### `components/extraction/question-builder.tsx` (component, CRUD)

**Analog:** `components/screening/screening-dialog.tsx` lines 136-172 (question management handlers)

**Question add/remove/edit pattern**:
```typescript
const handleAddQuestion = useCallback(
  (question: string) => {
    const duplicate = localQuestions.some(
      (q) => q.toLowerCase() === question.toLowerCase()
    );
    if (duplicate) return;
    setLocalQuestions((prev) => [...prev, question]);
  },
  [localQuestions]
);

const handleRemoveQuestion = useCallback(
  (index: number) => {
    setLocalQuestions((prev) => prev.filter((_, i) => i !== index));
  },
  []
);

const handleEditQuestion = useCallback(
  (index: number, newQuestion: string) => {
    setLocalQuestions((prev) =>
      prev.map((q, i) => (i === index ? newQuestion : q))
    );
  },
  []
);
```

---

### `components/extraction/tier-selector.tsx` (component, request-response)

**Analog:** `components/screening/screening-dialog.tsx` (config section pattern) + shadcn RadioGroup

**Component structure pattern** (from existing extraction components):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Three options: "auto" | "cheap" | "accurate"
// User-friendly labels, no model names exposed (D-03)
// Maps to cascade tiers from Phase 91
```

---

### `components/extraction/extraction-jobs-dialog.tsx` (component, request-response)

**Analog:** `components/screening/screening-jobs-dialog.tsx` (entire file)

**Exact clone pattern** (all 47 lines):
```typescript
"use client";

import { useTranslations } from "next-intl";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FlaskConical } from "lucide-react";
import { ExtractionJobHistory } from "@/components/extraction/extraction-job-history";

interface ExtractionJobsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtractionJobsDialog({ open, onOpenChange }: ExtractionJobsDialogProps) {
  const t = useTranslations("extraction");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            {t("jobsDialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("jobsDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <ExtractionJobHistory onClose={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

### `components/extraction/extraction-job-history.tsx` (component, CRUD)

**Analog:** `components/screening/screening-job-history.tsx`

**Imports pattern** (lines 0-35):
```typescript
"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { FileText, Download, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportExtractionToCSV,
  exportExtractionToJSON,
  exportExtractionToXLSX,
} from "@/lib/extraction/export";
```

**Data fetching pattern** (lines 65-73):
```typescript
const t = useTranslations("extraction");
const format = useFormatter();
const convex = useConvex();
const [exportingJobId, setExportingJobId] = useState<string | null>(null);
const { data: jobs } = useProtectedQuery(
  api.extraction.queries.listUserExtractionJobs,
  { limit: 10 }
);
```

**Export handler pattern** (lines 75-103):
```typescript
async function handleExport(
  jobId: Id<"extractionJobs">,
  fmt: "csv" | "json" | "xlsx"
) {
  setExportingJobId(jobId);
  try {
    const data = await convex.query(
      api.extraction.queries.getExtractionResultsForExport,
      { jobId }
    );
    if (!data) return;
    switch (fmt) {
      case "csv":  exportExtractionToCSV(data);  break;
      case "json": exportExtractionToJSON(data); break;
      case "xlsx": await exportExtractionToXLSX(data); break;
    }
  } catch (err) {
    console.error("Export failed:", err);
  } finally {
    setExportingJobId(null);
  }
}
```

**Status dot pattern** (lines 45-59):
```typescript
// Extraction uses OKLCH colors per D-08
function statusDot(status: ExtractionPaperStatus) {
  switch (status) {
    case "pending":    return "bg-muted-foreground";
    case "parsing":    return "bg-[oklch(0.55_0.15_250)] animate-pulse";    // blue
    case "extracting": return "bg-[oklch(0.55_0.15_293)] animate-pulse";    // violet AI accent
    case "completed":  return "bg-[oklch(0.55_0.15_145)]";                  // green
    case "failed":     return "bg-[oklch(0.6_0.15_27)]";                    // red
    case "cancelled":  return "bg-muted-foreground/50";
  }
}
```

**Job card layout pattern** (lines 130-200):
```typescript
<div
  key={job._id}
  className="rounded-lg border border-border/50 bg-card px-3.5 py-3 transition-colors hover:bg-accent/30"
>
  {/* Row 1: Status + date + actions */}
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2 min-w-0">
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(job.status)}`} />
      <span className="text-xs font-medium text-foreground truncate">
        {t(`jobStatus.${job.status}`)}
      </span>
      <span className="text-xs text-muted-foreground/60">&middot;</span>
      <time className="text-xs text-muted-foreground shrink-0">
        {format.dateTime(new Date(job.createdAt), { dateStyle: "medium" })}
      </time>
    </div>
    {/* Export dropdown + link to results */}
  </div>
</div>
```

---

### `components/extraction/status-badge.tsx` (component, transform)

**Analog:** `components/extraction/confidence-badge.tsx`

**OKLCH badge config pattern** (entire file):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Config object mapping status -> i18n key + OKLCH classes
// Follows exact structure from confidence-badge.tsx
const statusConfig = {
  parsing: {
    i18nKey: "statusParsing" as const,
    classes:
      "bg-[oklch(0.95_0.08_250/0.15)] border-[oklch(0.55_0.15_250/0.3)] text-[oklch(0.4_0.12_250)] dark:bg-[oklch(0.3_0.08_250/0.2)] dark:border-[oklch(0.55_0.15_250/0.3)] dark:text-[oklch(0.7_0.12_250)]",
  },
  extracting: {
    i18nKey: "statusExtracting" as const,
    classes:
      "bg-[oklch(0.95_0.08_293/0.15)] border-[oklch(0.55_0.15_293/0.3)] text-[oklch(0.4_0.12_293)] dark:bg-[oklch(0.3_0.08_293/0.2)] dark:border-[oklch(0.55_0.15_293/0.3)] dark:text-[oklch(0.7_0.12_293)]",
  },
  completed: {
    i18nKey: "statusCompleted" as const,
    classes:
      "bg-[oklch(0.95_0.08_145/0.15)] border-[oklch(0.55_0.15_145/0.3)] text-[oklch(0.4_0.12_145)] dark:bg-[oklch(0.3_0.08_145/0.2)] dark:border-[oklch(0.55_0.15_145/0.3)] dark:text-[oklch(0.7_0.12_145)]",
  },
  failed: {
    i18nKey: "statusFailed" as const,
    classes:
      "bg-[oklch(0.95_0.06_27/0.15)] border-[oklch(0.6_0.15_27/0.3)] text-[oklch(0.5_0.15_27)] dark:bg-[oklch(0.3_0.08_27/0.2)] dark:border-[oklch(0.6_0.15_27/0.3)] dark:text-[oklch(0.7_0.12_27)]",
  },
  // ... pending, cancelled use muted
} as const;

// Badge component follows exact ConfidenceBadge structure:
// variant="outline", rounded-full, text-xs font-semibold
<Badge
  variant="outline"
  className={cn("rounded-full text-xs font-semibold gap-1", config.classes, className)}
>
  {t(config.i18nKey)}
</Badge>
```

---

### `components/extraction/paper-result-card.tsx` (component, request-response)

**Analog:** `components/extraction/insufficient-evidence-card.tsx` (Card structure) + `components/extraction/evidence-quote.tsx` (data fetching)

**Card structure pattern** (from insufficient-evidence-card.tsx):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { CriticVerdictBadge } from "@/components/extraction/critic-verdict-badge";
import { EvidenceQuote } from "@/components/extraction/evidence-quote";
import { InsufficientEvidenceCard } from "@/components/extraction/insufficient-evidence-card";

// Card with paper title header, then per-question rows
<Card className={cn("...", className)} role="article">
  <CardHeader className="pb-2">
    <CardTitle className="text-base font-semibold">{paperTitle}</CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    {/* Per-question answer rows composing existing 5 components */}
  </CardContent>
</Card>
```

**Loading state pattern** (from evidence-quote.tsx lines 34-41):
```typescript
// Loading state: skeleton shimmer
if (data === undefined) {
  return (
    <div className={cn("space-y-2 rounded-md p-2", className)}>
      <div className="h-[14px] w-full animate-pulse rounded bg-muted" />
      <div className="h-[14px] w-[85%] animate-pulse rounded bg-muted" />
    </div>
  );
}
// Null state: not found or unauthorized
if (data === null) return null;
```

**Animation pattern** (from `lib/animation-config.ts`):
```typescript
import { motion } from "motion/react";
import { cardEntrance, cardEntranceTransition } from "@/lib/animation-config";

// Staggered card entrance for list of paper cards
<motion.div
  {...cardEntrance}
  transition={cardEntranceTransition(index * 0.05)}
>
  <Card>...</Card>
</motion.div>
```

---

### `app/extraction/page.tsx` (route, request-response)

**Analog:** `app/library/page.tsx`

**Page route pattern** (entire file):
```typescript
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
// Client component does the heavy lifting
import { ExtractionPageClient } from "@/components/extraction/extraction-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("extractionTitle"),
    description: t("extractionDescription"),
  };
}

export default function ExtractionPage() {
  return <ExtractionPageClient />;
}
```

---

### `app/extraction/[jobId]/page.tsx` (route, request-response)

**Analog:** `app/library/page.tsx` (structure) + dynamic route with `params`

**Dynamic route pattern**:
```typescript
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("extractionResultsTitle"),
  };
}

export default async function ExtractionResultsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <ExtractionResultsClient jobId={jobId} />;
}
```

---

### `app/extraction/error.tsx` and `app/extraction/[jobId]/error.tsx` (route, request-response)

**Analog:** `app/results/error.tsx` (entire file)

**Error boundary pattern** (all 51 lines):
```typescript
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error("[app/extraction/error]", error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center" role="alert">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-semibold outline-none">
          {tc("somethingWentWrong")}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("unexpectedIssue")}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={unstable_retry}>{tc("retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{tc("goHome")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

### `lib/extraction/export.ts` (utility, transform)

**Analog:** `lib/screening/export.ts` (entire file)

**Type definition pattern** (lines 0-44):
```typescript
/**
 * Extraction export functions - pure formatting for CSV, JSON, and XLSX.
 * These receive already-fetched ExtractionExportData and produce downloadable files.
 */

export interface ExtractionExportData {
  job: {
    _id: string;
    status: string;
    questions: Array<{ key: string; question: string }>;
    totalPapers: number;
    createdAt: number;
    completedAt?: number;
  };
  results: Array<{
    paperTitle: string;
    openalexId: string;
    doi?: string;
    questionKey: string;
    question: string;
    answer: string | null;
    confidence?: string;
    criticVerdict?: string;
    evidenceStartChar?: number;
    evidenceEndChar?: number;
    reasoning?: string;
    modelUsed?: string;
  }>;
}
```

**Download helper pattern** (lines 50-68):
```typescript
function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string,
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

**CSV generation pattern** (lines 86-172):
```typescript
function escapeCSVCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildFilename(data: ExtractionExportData, ext: string): string {
  const date = new Date(data.job.createdAt).toISOString().slice(0, 10);
  return `extraction-export-${date}-${data.job.status}.${ext}`;
}

// CSV with dynamic question columns + answer/confidence/verdict columns
// JSON with envelope wrapping metadata + results
```

**XLSX dynamic import pattern** (lines 230-242):
```typescript
export async function generateExtractionXLSXWorkbook(
  data: ExtractionExportData,
): Promise<import('exceljs').Workbook> {
  const mod = await import('exceljs');
  const ExcelJSModule =
    'default' in mod
      ? (mod as unknown as { default: typeof mod }).default
      : mod;
  const workbook = new ExcelJSModule.Workbook();
  // Results sheet + Summary sheet
  return workbook;
}
```

---

### `convex/extraction/queries.ts` -- extend (service, CRUD)

**Analog:** `convex/extraction/queries.ts` (existing `getExtractionJobMetrics` at lines 75-152)

**Auth + ownership guard pattern** (lines 89-95):
```typescript
const user = await getCurrentUser(ctx);
if (!user) return null;

const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

**Query with bounded collection pattern** (lines 98-103):
```typescript
const completedPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) =>
    q.eq("jobId", args.jobId).eq("status", "completed")
  )
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);
```

**Imports pattern** (lines 0-11):
```typescript
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  parsingSourceValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
```

**Return type with `v.union(v.null(), v.object({...}))` pattern** (lines 76-88):
```typescript
export const getExtractionResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      // ... typed result shape
    })
  ),
  handler: async (ctx, args) => { /* ... */ },
});
```

**Nested query join pattern** (from getExtractionJobMetrics):
```typescript
// Query extractionPapers by jobId, then for each paper query extractionResults by paperId
// Use .take() with bounded limits: MAX_EXTRACTION_PAPERS_PER_JOB for papers, 100 for results per paper
// Index usage: "by_job" on extractionPapers, "by_paper" on extractionResults
```

**`listUserExtractionJobs` query pattern** (lines 160-193) -- for the export query to mirror:
```typescript
export const listUserExtractionJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ /* ... */ })),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const jobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);
    return jobs.map((j) => ({ /* selected fields */ }));
  },
});
```

---

### `components/app-sidebar.tsx` -- modify (component, request-response)

**Analog:** `components/app-sidebar.tsx` (self -- ScreeningFooterButton at lines 276-365, nav items at lines 470-514, getCurrentPage at lines 426-434, footer area at lines 720-767)

**ExtractionFooterButton clone** (lines 276-365): Clone `ScreeningFooterButton` exactly, replacing `ListChecks` icon with `FlaskConical`, and using violet AI accent stroke `oklch(0.55 0.15 293)` instead of orange `oklch(0.70 0.17 54)`.

**Nav item addition pattern** (lines 470-514):
```typescript
<NavItem
  href="/extraction"
  icon={FlaskConical}
  label={tc("extraction")}
  isActive={currentPageValue === "extraction"}
  isCollapsed={isCollapsed && !isMobile}
  onClick={handleNavClick}
  index={4}  // next after existing nav items
/>
```

**getCurrentPage extension** (lines 426-434):
```typescript
const getCurrentPage = () => {
  if (!pathname) return null;
  if (pathname === "/") return "home";
  if (pathname.includes("/bookmarks")) return "bookmarks";
  if (pathname.includes("/library")) return "library";
  if (pathname.includes("/history")) return "history";
  if (pathname.includes("/extraction")) return "extraction";  // ADD THIS
  if (pathname.includes("/ai-enhancement")) return "ai-enhancement";
  return null;
};
```

**Footer integration pattern** (lines 720-767):
```typescript
// Expanded state: add ExtractionFooterButton alongside ScreeningFooterButton
<div className="flex items-center gap-1">
  <ScreeningFooterButton ... />
  <ExtractionFooterButton
    onClick={() => phase === "authenticated" ? setIsExtractionJobsOpen(true) : goToSignIn()}
    isCollapsed={false}
    progressPercent={extractionProgressPercent}
    label={tc("extraction")}
  />
  <ThemeToggle />
  <LanguageSwitcher isCollapsed={false} />
</div>

// Data fetching for extraction progress (mirror screening at lines 385-397):
const { data: extractionJobs } = useProtectedQuery(
  api.extraction.queries.listUserExtractionJobs,
  { limit: 1 },
);
const activeExtractionJob = extractionJobs?.find(
  (j) => j.status === "pending" || j.status === "processing",
);
const extractionProgressPercent = activeExtractionJob
  ? activeExtractionJob.totalPapers > 0
    ? (activeExtractionJob.processedPapers / activeExtractionJob.totalPapers) * 100
    : 0
  : null;
```

---

### `messages/*.json` -- extend (config, transform)

**Analog:** `messages/en-US.json` lines 1460-1493 (existing extraction namespace)

**Existing namespace structure**:
```json
"extraction": {
  "insufficientEvidence": "Insufficient evidence",
  "evidenceUnavailable": "Evidence unavailable",
  "confidenceHigh": "High confidence",
  "confidenceMedium": "Medium confidence",
  "confidenceLow": "Low confidence",
  "criticVerified": "Verified",
  "criticUnverified": "Unverified",
  "criticPartial": "Partially verified",
  "criticTimeout": "Review pending",
  "viewInSource": "View in source",
  "jobMetrics": { /* nested keys */ }
}
```

**Extension pattern** -- add nested groups per D-22:
```json
"extraction": {
  /* ... existing 25 keys preserved ... */
  "jobCreation": {
    "title": "...",
    "description": "...",
    "questionsLabel": "...",
    "addQuestion": "...",
    "tierLabel": "...",
    "tierAuto": "...",
    "tierCheap": "...",
    "tierAccurate": "...",
    "estimatedCredits": "...",
    "insufficientBalance": "...",
    "submit": "...",
    "success": "...",
    "error": "...",
    "activeJobWarning": "..."
  },
  "progress": {
    "statusPending": "...",
    "statusParsing": "...",
    "statusExtracting": "...",
    "statusCompleted": "...",
    "statusFailed": "...",
    "statusCancelled": "...",
    "cancelConfirmTitle": "...",
    "cancelConfirmDescription": "...",
    "cancelConfirm": "...",
    "cancelCancel": "..."
  },
  "results": {
    "title": "...",
    "emptyState": "...",
    "paperCount": "...",
    "questionLabel": "...",
    "answerLabel": "..."
  },
  "export": {
    "csv": "...",
    "json": "...",
    "xlsx": "...",
    "downloading": "...",
    "incompleteWarning": "..."
  },
  "jobsDialogTitle": "...",
  "jobsDialogDescription": "...",
  "jobStatus": {
    "pending": "...",
    "processing": "...",
    "completed": "...",
    "cancelled": "...",
    "failed": "..."
  }
}
```

---

## Shared Patterns

### Authentication (Client-Side)
**Source:** `lib/auth/use-auth-query.ts` -- `useProtectedQuery` hook
**Apply to:** All components consuming Convex queries (`extraction-dialog.tsx`, `extraction-job-history.tsx`, `paper-result-card.tsx`, `app-sidebar.tsx`)
```typescript
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
const { data } = useProtectedQuery(api.extraction.queries.someQuery, args);
// Returns undefined while loading, then the query result
// Automatically handles auth state transitions
```

### Authentication (Convex Server-Side)
**Source:** `convex/extraction/queries.ts` lines 33-38
**Apply to:** Both new Convex queries (`getExtractionResults`, `getExtractionResultsForExport`)
```typescript
import { getCurrentUser } from "../lib/auth";
const user = await getCurrentUser(ctx);
if (!user) return null;
const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

### Error Handling (Mutation Call Sites)
**Source:** `components/screening/screening-dialog.tsx` lines 312-328
**Apply to:** `extraction-dialog.tsx` submit handler, any cancel mutation call
```typescript
catch (error: unknown) {
  const msg = getErrorMessage(error, t("jobCreation.error"));
  if (
    typeof error === "object" && error !== null &&
    "data" in error &&
    typeof (error as { data?: unknown }).data === "string" &&
    ((error as { data: string }).data).includes("EXTRACTION_JOB_ALREADY_ACTIVE")
  ) {
    showStyledToast("error", t("jobCreation.activeJobWarning"));
  } else {
    showStyledToast("error", msg);
  }
}
```

### Loading / Null State Guards
**Source:** `components/extraction/evidence-quote.tsx` lines 34-76, `components/extraction/job-metrics-panel.tsx` lines 41-59
**Apply to:** All components using `useQuery` or `useProtectedQuery`
```typescript
// ALWAYS guard both undefined (loading) and null (not found/unauthorized)
if (data === undefined) {
  return (
    <div className="animate-pulse ...">
      <div className="h-[14px] w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
if (data === null) return null;
// Only then render the actual content
```

### i18n
**Source:** All existing extraction components (`confidence-badge.tsx`, `critic-verdict-badge.tsx`, etc.)
**Apply to:** Every new component
```typescript
import { useTranslations } from "next-intl";
const t = useTranslations("extraction");
// Nested keys: t("jobCreation.title"), t("progress.statusParsing"), etc.
```

### Animation
**Source:** `lib/animation-config.ts` (entire file)
**Apply to:** `paper-result-card.tsx` (card entrance), dialog transitions, any animated lists
```typescript
import { motion, AnimatePresence } from "motion/react";
import { cardEntrance, cardEntranceTransition, subtleSpring } from "@/lib/animation-config";

// Staggered list:
<AnimatePresence mode="wait">
  {items.map((item, index) => (
    <motion.div
      key={item.id}
      {...cardEntrance}
      transition={cardEntranceTransition(index * 0.05)}
    >
      {/* content */}
    </motion.div>
  ))}
</AnimatePresence>
```

### OKLCH Color System
**Source:** `components/extraction/confidence-badge.tsx` lines 13-31, `components/extraction/critic-verdict-badge.tsx` lines 20-38
**Apply to:** `status-badge.tsx`, any new colored UI elements
```typescript
// Pattern: bg + border + text, with separate dark: overrides
// Light: oklch(0.95 chroma hue/0.15) bg, oklch(0.55 chroma hue/0.3) border, oklch(0.4 chroma hue) text
// Dark:  oklch(0.3  chroma hue/0.2) bg, oklch(0.55 chroma hue/0.3) border, oklch(0.7 chroma hue) text
// Hue values from D-08: blue=250, violet=293, green=145, red=27
```

### Accessibility
**Source:** `components/extraction/evidence-quote.tsx` lines 81-94, `components/extraction/insufficient-evidence-card.tsx` lines 27-28
**Apply to:** All new components
```typescript
// Focus indicators:
"focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

// ARIA attributes:
role="status"      // progress indicators
role="alert"       // error boundaries
role="article"     // paper result cards
aria-live="polite" // dynamic status updates
aria-hidden="true" // decorative icons

// Screen reader text:
<span className="sr-only">{label}</span>
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| -- | -- | -- | All 18 files have close analogs in the codebase |

Every new file has an exact or role-match analog. The screening feature provides a complete 1:1 reference for job creation, progress, history, and export. The existing extraction components provide the badge/card/OKLCH patterns. No files require inventing new patterns from scratch.

## Metadata

**Analog search scope:** `components/screening/`, `components/extraction/`, `components/app-sidebar.tsx`, `lib/screening/`, `convex/extraction/`, `app/`, `messages/`, `lib/animation-config.ts`
**Files scanned:** 22 analog files read
**Pattern extraction date:** 2026-04-15
