# Phase 97: Extraction UI Polish - Research

**Researched:** 2026-04-15
**Domain:** React/Next.js UI development -- dialog-based job creation, real-time progress, results rendering, export, i18n, accessibility (WCAG AAA), Convex reactive queries
**Confidence:** HIGH

## Summary

Phase 97 is a **UI-only wiring phase** that connects the fully stabilized extraction backend (Phases 88-96) to user-facing surfaces. The codebase already provides: (1) five extraction components (`ConfidenceBadge`, `CriticVerdictBadge`, `EvidenceQuote`, `InsufficientEvidenceCard`, `JobMetricsPanel`), (2) a complete screening feature as the reference pattern for dialog-based job creation, sidebar progress ring, job history, and export, (3) OKLCH design tokens including AI-specific violet accents, (4) a tested export infrastructure with CSV/JSON/XLSX support via `exceljs`, and (5) existing i18n keys in the `extraction` namespace across 6 locale files.

The primary work is cloning established screening patterns for extraction-specific counterparts, creating two new Convex queries (`getExtractionResults`, `getExtractionResultsForExport`), seeding i18n keys, and building the results route with paper cards. No new libraries are needed. All dependencies are already installed and current.

**Primary recommendation:** Clone screening patterns verbatim for job creation/progress/history/export, create the two missing Convex queries, seed all i18n keys first, then build the results page reusing the 5 existing extraction components.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Dialog-based job creation flow (not a dedicated route), consistent with screening pattern
- **D-02:** Inline add/remove/edit question list with text inputs
- **D-03:** Radio group with 3 model tier options (Auto/Cheap/Accurate) mapping to cascade tiers
- **D-04:** Estimated cost preview inline below model selector, reusing credit balance check
- **D-05:** Dialog calls `api.extraction.mutations.createExtractionJob`, captures PostHog analytics, shows sonner toast
- **D-06:** Sidebar footer button with circular SVG progress ring (identical to `ScreeningFooterButton`)
- **D-07:** Job history dialog follows `ScreeningJobHistory` pattern
- **D-08:** Per-paper status badges with specific OKLCH colors: parsing=blue, extracting=violet, done=green, failed=red
- **D-09:** Cancel button calls `api.extraction.mutations.cancelExtractionJob` with confirmation dialog
- **D-10:** Real-time counters consume `api.extraction.queries.getExtractionProgress`
- **D-11:** Results on dedicated route at `app/extraction/[jobId]/page.tsx`
- **D-12:** Results grouped by paper with nested question rows using existing 5 extraction components
- **D-13:** `EvidenceQuote` renders `bodyText.slice(startChar, endChar)` -- never LLM's `evidenceQuote`
- **D-14:** `InsufficientEvidenceCard` for `answer === "insufficient_evidence"`
- **D-15:** `JobMetricsPanel` at top of results page
- **D-16:** New Convex query needed: `getExtractionResults({ jobId })`
- **D-17:** Export follows screening export pattern from `lib/screening/export.ts`
- **D-18:** No new export infrastructure -- reuses `downloadAsFile` and `exceljs`
- **D-19:** Export triggers in job history dropdown and results page header
- **D-20:** New Convex query needed: `getExtractionResultsForExport({ jobId })`
- **D-21:** i18n in 6 locale files BEFORE component development: `en-US`, `en-GB`, `zh`, `fr`, `hi`, `ja`
- **D-22:** Extend existing `extraction` namespace (~25 keys) with nested structure
- **D-23:** `useTranslations("extraction")` in all new components
- **D-24:** Dual entry: sidebar footer button + sidebar nav item "Extraction"
- **D-25:** `/extraction` shows job list, `/extraction/[jobId]` shows results
- **D-26:** Add extraction to `getCurrentPage()` in `app-sidebar.tsx`
- **D-27:** All OKLCH color tokens from `globals.css`, no hardcoded hex/rgb
- **D-28:** Outfit variable font via `--font-outfit`
- **D-29:** Spring-based Framer Motion via `motion/react` using `lib/animation-config.ts` presets
- **D-30:** WCAG AAA (7:1 contrast), `focus-visible:ring-[3px]`, `prefers-reduced-motion`, `aria-live`, `sr-only`, `role="status"`

### Claude's Discretion
- Exact component file structure within `components/extraction/` (subdirectories vs flat)
- Whether `getExtractionResults` uses cursor-based pagination or `.collect()` with bound
- Exact Framer Motion animation timings beyond `lib/animation-config.ts` presets
- Whether extraction route uses `layout.tsx` or self-contained pages
- PostHog event names and properties
- Exact dark mode badge color tuning

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Clean extraction job creation flow with question builder, model tier selector, cost preview, start button | Clone `ScreeningDialog` pattern; new `ExtractionDialog` with `QuestionBuilder`, `TierSelector` sub-components; reuse `api.credits.queries.checkBalance` for cost preview |
| UI-02 | Live job progress with per-paper status badges, real-time counters, cancel button | Clone `ScreeningFooterButton` + `ScreeningJobHistory` patterns; consume `getExtractionProgress` reactive query; `cancelExtractionJob` mutation already exists |
| UI-03 | Per-paper result cards with clickable verbatim quote at source character range | New `PaperResultCard` composing existing `EvidenceQuote`, `ConfidenceBadge`, `CriticVerdictBadge`, `InsufficientEvidenceCard`; requires new `getExtractionResults` query |
| UI-04 | Export as CSV/JSON/XLSX via existing download helper | Clone `lib/screening/export.ts` to `lib/extraction/export.ts`; reuse `exceljs` dynamic import pattern; new `getExtractionResultsForExport` query |
| UI-05 | All extraction UI strings in 6 locale files before component development | Extend existing `extraction` namespace in `messages/*.json`; ~50 new keys per the UI-SPEC copywriting contract |
| UI-06 | Brand-aligned design: OKLCH, Outfit, Framer Motion springs, WCAG AAA | OKLCH tokens verified in `globals.css`; AI accent tokens (`--ai-*`) verified; `motion/react` v12.23.12+ installed; animation presets in `lib/animation-config.ts` verified |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Job creation UI | Browser / Client | -- | Dialog-based form with local state, calls Convex mutation on submit |
| Real-time progress | Browser / Client | Convex Backend | Client subscribes to reactive Convex query (`getExtractionProgress`); backend computes counters |
| Results rendering | Browser / Client | Convex Backend | Client renders data from reactive query; backend joins paper/question/result data |
| Export generation | Browser / Client | -- | Export functions run client-side (CSV string building, XLSX via exceljs in browser) |
| i18n string resolution | Browser / Client | -- | `next-intl` resolves at render time from locale JSON files |
| Auth-gated data access | Convex Backend | -- | All public queries verify user identity server-side via `getCurrentUser()` |
| Cancel job orchestration | Convex Backend | -- | Mutation cancels workflow + workpool items server-side |

## Standard Stack

### Core (Already Installed -- No New Dependencies)

| Library | Installed Version | Registry Latest | Purpose | Why Standard |
|---------|-------------------|-----------------|---------|--------------|
| `motion` | 12.23.12 | 12.38.0 | Spring-based animations | [VERIFIED: npm registry] Project uses `motion/react` imports throughout (10+ components verified) |
| `next-intl` | 4.8.2 | 4.9.1 | i18n with `useTranslations()` hook | [VERIFIED: npm registry, codebase grep] Used in all existing extraction components |
| `exceljs` | 4.4.0 | 4.4.0 | XLSX export with dynamic import | [VERIFIED: npm registry] Same version; screening export uses it via `await import('exceljs')` |
| `sonner` | 2.0.7 | 2.0.7 | Toast notifications via `showStyledToast` | [VERIFIED: npm registry] Used in screening dialog submit flow |
| `lucide-react` | 0.487.0 | 1.8.0 | Icons | [VERIFIED: npm registry] Major version jump available but not relevant -- installed version works |
| `posthog-js` | 1.342.1 | -- | Analytics event capture | [VERIFIED: codebase] `posthog.capture()` used in screening dialog |
| `convex` | -- | -- | Backend queries/mutations, reactive subscriptions | [VERIFIED: codebase] `useQuery`, `useMutation`, `useConvex` patterns established |

### Supporting (Already Available)

| Library/Component | Purpose | When to Use |
|-------------------|---------|-------------|
| `@/components/ui/dialog` | shadcn Dialog (Radix) | Job creation dialog, jobs history dialog |
| `@/components/ui/alert-dialog` | shadcn AlertDialog (Radix) | Cancel confirmation |
| `@/components/ui/radio-group` | shadcn RadioGroup (Radix) | Model tier selector |
| `@/components/ui/badge` | shadcn Badge | Per-paper status badges |
| `@/components/ui/card` | shadcn Card | Paper result cards, metric cards |
| `@/components/ui/progress` | shadcn Progress | Job progress bars, SLO bars |
| `@/components/ui/dropdown-menu` | shadcn DropdownMenu | Export format picker |
| `@/components/ui/input` | shadcn Input | Question text input |
| `@/components/ui/separator` | shadcn Separator | Dialog section dividers |
| `@/components/ui/tooltip` | shadcn Tooltip | Metric explanations |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `exceljs` dynamic import | `xlsx` (SheetJS) | `exceljs` is already installed and proven in screening export -- no reason to switch |
| Inline export in components | Dedicated export service worker | Client-side export is fine for MVP-scale result sets (few hundred rows max) |
| `motion/react` | CSS-only animations | Spring physics not achievable with CSS alone; project convention requires motion |

**Installation:** No new packages required. All dependencies are installed.

## Architecture Patterns

### System Architecture Diagram

```
User Action                         Browser (React)                    Convex Backend
-----------                         ---------------                    --------------

[Open Dialog] -----> ExtractionDialog
                        |
                        +--> QuestionBuilder (local state)
                        +--> TierSelector (radio group)
                        +--> CostPreview <---- useProtectedQuery(checkBalance)
                        |
[Click Start] -----> useMutation(createExtractionJob) -------> createExtractionJob
                        |                                           |
                        +--> posthog.capture()                      +--> Insert job/papers/questions
                        +--> showStyledToast()                      +--> Start workflow
                                                                    |
                                                                    v
[Sidebar Ring] <---- useProtectedQuery(getExtractionProgress) <--- Reactive subscription
                        |
                        +--> ExtractionFooterButton (SVG ring)
                        +--> ExtractionJobsDialog
                              |
                              +--> ExtractionJobHistory
                                    +--> statusDot + progress bar
                                    +--> Export dropdown
                                    +--> Link to /extraction/[jobId]
                                                                    
[View Results] ----> /extraction/[jobId]/page.tsx
                        |
                        +--> JobMetricsPanel <---- useQuery(getExtractionJobMetrics)
                        +--> PaperResultCard[] <-- useQuery(getExtractionResults) [NEW QUERY]
                              |
                              +--> ConfidenceBadge (existing)
                              +--> CriticVerdictBadge (existing)
                              +--> EvidenceQuote (existing) <---- useQuery(getPaperBodyText)
                              +--> InsufficientEvidenceCard (existing)
                                                                    
[Export] ----------> lib/extraction/export.ts
                        |
                        +--> useConvex().query(getExtractionResultsForExport) [NEW QUERY]
                        +--> exportExtractionToCSV / JSON / XLSX
                        +--> downloadFile (browser)
```

### Recommended Project Structure

```
components/extraction/
  confidence-badge.tsx          # EXISTS
  critic-verdict-badge.tsx      # EXISTS
  evidence-quote.tsx            # EXISTS
  insufficient-evidence-card.tsx # EXISTS
  job-metrics-panel.tsx         # EXISTS
  extraction-dialog.tsx         # NEW: job creation dialog
  extraction-job-history.tsx    # NEW: job list with status/export
  extraction-jobs-dialog.tsx    # NEW: dialog wrapper for history
  paper-result-card.tsx         # NEW: per-paper results card
  status-badge.tsx              # NEW: per-paper status badge
  tier-selector.tsx             # NEW: model tier radio group
  question-builder.tsx          # NEW: inline question list

app/extraction/
  page.tsx                      # NEW: job list page
  [jobId]/
    page.tsx                    # NEW: results page
    error.tsx                   # NEW: error boundary (CRASH-01)

lib/extraction/
  export.ts                     # NEW: CSV/JSON/XLSX export functions

convex/extraction/
  queries.ts                    # EXTEND: add getExtractionResults, getExtractionResultsForExport

messages/
  en-US.json                    # EXTEND: extraction.* namespace
  en-GB.json                    # EXTEND: extraction.* namespace
  zh.json                       # EXTEND: extraction.* namespace
  fr.json                       # EXTEND: extraction.* namespace
  hi.json                       # EXTEND: extraction.* namespace
  ja.json                       # EXTEND: extraction.* namespace
```

**Discretion recommendation:** Keep components flat in `components/extraction/` rather than creating subdirectories. The component count (12 total) does not warrant nesting, and the flat structure matches the existing `components/screening/` convention. [ASSUMED]

### Pattern 1: Dialog-Based Job Creation (Clone from Screening)

**What:** Job creation via modal dialog opened from sidebar/page, with local form state, credit check, and mutation submit.
**When to use:** All job creation flows in this project.
**Example:**
```typescript
// Source: components/screening/screening-dialog.tsx (verified in codebase)
"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { showStyledToast } from "@/components/ui/sonner";
import posthog from "posthog-js";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExtractionDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("extraction");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localQuestions, setLocalQuestions] = useState<string[]>([]);
  const [tier, setTier] = useState<"auto" | "cheap" | "accurate">("auto");

  // Credit check (matches screening pattern exactly)
  const estimatedCredits = computeEstimate(localQuestions.length, paperCount, tier);
  const { data: balanceCheck } = useProtectedQuery(
    api.credits.queries.checkBalance,
    open ? { requiredAmount: estimatedCredits } : "skip"
  );

  const createJob = useMutation(api.extraction.mutations.createExtractionJob);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await createJob({ papers, questions: keyedQuestions });
      showStyledToast("success", t("jobCreation.success"));
      onOpenChange(false);
      posthog.capture("extraction_job_created", { paperCount, questionCount });
    } catch (error) {
      showStyledToast("error", t("jobCreation.error"));
    } finally {
      setIsSubmitting(false);
    }
  }, [/* deps */]);

  // Reset form state when dialog opens (ref-based guard)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) { /* reset state */ }
    prevOpenRef.current = open;
  }, [open]);
}
```
[VERIFIED: components/screening/screening-dialog.tsx -- pattern extracted from codebase]

### Pattern 2: Sidebar Footer Button with Progress Ring

**What:** SVG circular progress indicator wrapping an icon in the sidebar footer.
**When to use:** Background job monitoring without leaving current page.
**Example:**
```typescript
// Source: components/app-sidebar.tsx:276-365 (verified in codebase)
function ExtractionFooterButton({ onClick, isCollapsed, progressPercent, label }) {
  const circumference = 2 * Math.PI * 10;
  const icon = (
    <span className="relative inline-flex items-center justify-center">
      <FlaskConical className="h-[1.1rem] w-[1.1rem]" />
      {progressPercent !== null && (
        <svg viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[2] origin-center" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.1" />
          <circle cx="12" cy="12" r="10"
            stroke="oklch(0.70 0.17 54)"
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * progressPercent) / 100}
            strokeLinecap="round"
            transform="rotate(-90 12 12)"
            className="transition-[stroke-dashoffset] duration-500 ease-out" />
        </svg>
      )}
    </span>
  );
  // ... collapsed/expanded variants exactly like ScreeningFooterButton
}
```
[VERIFIED: components/app-sidebar.tsx lines 276-365]

### Pattern 3: Export Infrastructure Clone

**What:** Pure-function export module generating CSV/JSON/XLSX from typed data.
**When to use:** Any feature needing multi-format file export.
**Example:**
```typescript
// Source: lib/screening/export.ts (verified in codebase)
// Clone pattern for lib/extraction/export.ts:

export interface ExtractionExportData {
  job: { _id: string; status: string; questions: Array<{ key: string; question: string }>; /* ... */ };
  results: Array<{
    paperTitle: string; openalexId: string; doi?: string; parsingSource?: string;
    questionKey: string; question: string; answer: string | null;
    confidence?: string; criticVerdict?: string;
    evidenceQuote?: string; evidenceStartChar?: number; evidenceEndChar?: number;
    reasoning?: string; modelUsed?: string;
  }>;
}

// CSV: dynamic question columns, same escapeCSVCell pattern
// JSON: envelope with metadata + results array
// XLSX: dynamic import('exceljs'), Results + Summary sheets
```
[VERIFIED: lib/screening/export.ts -- full pattern read from codebase]

### Pattern 4: Convex Query with Auth + Ownership Guard

**What:** Public query that verifies authentication and resource ownership before returning data.
**When to use:** All user-facing Convex queries in extraction.
**Example:**
```typescript
// Source: convex/extraction/queries.ts (verified in codebase)
export const getExtractionResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(v.null(), v.object({ /* result shape */ })),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;
    // ... query extractionPapers + extractionResults, join data
  },
});
```
[VERIFIED: convex/extraction/queries.ts -- getExtractionProgress, getExtractionJobMetrics follow this pattern]

### Anti-Patterns to Avoid

- **Bare `const { foo } = useQuery(...)`:** Always handle `undefined` (loading) and `null` (not found/unauthorized) before destructuring. Every existing extraction component does this correctly. [VERIFIED: CRASH-02 compliance in all 5 existing extraction components]
- **Hardcoded color values:** Never use hex/rgb. Always use OKLCH tokens from `globals.css` or inline `oklch()` values matching the established badge patterns. [VERIFIED: confidence-badge.tsx, critic-verdict-badge.tsx use inline OKLCH]
- **Ad-hoc spring definitions:** Always use presets from `lib/animation-config.ts`. [VERIFIED: codebase convention per UI-SPEC animation contract]
- **Importing from `framer-motion`:** Project uses `motion/react` (the Motion library v12+ import). [VERIFIED: all 10+ component imports use `from "motion/react"`]
- **Uncaught mutation rejections:** Every `useMutation` call-site must catch and route to toast. [VERIFIED: CRASH-04 requirement, screening dialog pattern]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XLSX generation | Custom spreadsheet builder | `exceljs` via `await import('exceljs')` | Dynamic import keeps bundle size down; ExcelJS handles cell types, sheets, formatting. [VERIFIED: screening already uses this] |
| CSV escaping | Manual string concatenation | `escapeCSVCell()` from screening pattern | Handles commas, quotes, newlines correctly. [VERIFIED: lib/screening/export.ts] |
| File download trigger | Custom blob/URL logic | `downloadFile()` helper pattern from screening | Handles blob creation, link click, URL cleanup. [VERIFIED: lib/screening/export.ts] |
| Progress ring SVG | Custom canvas/SVG from scratch | Clone `ScreeningFooterButton` SVG exactly | Proven pattern with correct math, transitions, collapsed/expanded states. [VERIFIED: app-sidebar.tsx:276-365] |
| Auth-gated queries | Client-side auth checks | `getCurrentUser(ctx)` in Convex query handler | Server-side auth is the project convention -- client just handles `null` return. [VERIFIED: all extraction queries] |
| Date formatting | `new Date().toLocaleDateString()` | `useFormatter()` from `next-intl` | Locale-aware formatting consistent across the app. [VERIFIED: screening-job-history.tsx] |
| Toast notifications | `window.alert()` or custom | `showStyledToast()` from `@/components/ui/sonner` | Styled, accessible, consistent with project pattern. [VERIFIED: screening dialog] |

**Key insight:** Phase 97 is an assembly phase, not an invention phase. Every UI pattern needed already exists in the screening feature. The work is adapting, not creating.

## Common Pitfalls

### Pitfall 1: Forgetting to Seed i18n Keys Before Component Development
**What goes wrong:** Components reference `t("extraction.jobCreation.title")` but the key does not exist in locale files, causing runtime fallback text or build warnings.
**Why it happens:** Developers start with component code and add i18n keys reactively.
**How to avoid:** D-21 explicitly requires seeding ALL locale files BEFORE any component work. The UI-SPEC contains the complete copywriting contract (~50 keys). Implement i18n seeding as the very first task.
**Warning signs:** Any `t()` call returning the key string instead of translated text.

### Pitfall 2: Missing `undefined`/`null` Guards on `useQuery` Results
**What goes wrong:** Destructuring `useQuery` result without checking for `undefined` (loading) or `null` (not found/unauthorized) causes runtime crash.
**Why it happens:** TypeScript may not catch this if the query return type includes the actual shape alongside `null`.
**How to avoid:** Follow the pattern in every existing extraction component: explicit `if (data === undefined) return <Skeleton />` then `if (data === null) return null`. CRASH-02 is a hard requirement.
**Warning signs:** Component renders then immediately crashes on fresh page load.

### Pitfall 3: Using `.collect()` Without Bound on Convex Queries
**What goes wrong:** Unbounded `.collect()` scans entire table, hitting Convex transaction limits.
**Why it happens:** Convex guideline says "always return a bounded collection." [VERIFIED: convex/_generated/ai/guidelines.md]
**How to avoid:** Use `.take(MAX_EXTRACTION_PAPERS_PER_JOB)` or pagination. For `getExtractionResults`, papers per job are bounded by `MAX_EXTRACTION_PAPERS_PER_JOB` (likely 500), and results per paper are bounded by question count (typically 1-20). A `.take()` with generous bound is safe.
**Warning signs:** Query fails with "Too many documents read in a single query" error.

### Pitfall 4: OCC Conflict on Extraction Progress Ring Query
**What goes wrong:** Multiple reactive subscriptions to `getExtractionProgress` across different UI surfaces (sidebar button + job history dialog) cause excessive re-renders.
**Why it happens:** Convex queries are deduplicated by args, but if each call site passes slightly different args or conditional skip, they become separate subscriptions.
**How to avoid:** Ensure both the footer button and the job history dialog consume the exact same query with identical args. Convex's query dedup handles this automatically when args match.
**Warning signs:** UI feels laggy during active extraction jobs.

### Pitfall 5: Forgetting `prefers-reduced-motion` for Animations
**What goes wrong:** Users with motion sensitivity preferences see distracting animations.
**Why it happens:** `motion.div` from `motion/react` does not automatically respect `prefers-reduced-motion`.
**How to avoid:** Use `motion-safe:` Tailwind prefix for CSS transitions (D-30). For Framer Motion `motion.div`, use `useReducedMotion()` hook to conditionally skip animation props. Several codebase components (`ai-setup-gate.tsx`, `language-selector.tsx`) already import and use `useReducedMotion`. [VERIFIED: codebase grep]
**Warning signs:** Animations play for all users regardless of OS accessibility settings.

### Pitfall 6: Forgetting Error Boundary for New Routes
**What goes wrong:** An unhandled error in `/extraction/[jobId]/page.tsx` crashes the entire app.
**Why it happens:** Next.js route segments without `error.tsx` propagate errors to the nearest parent boundary.
**How to avoid:** Create `app/extraction/[jobId]/error.tsx` as required by CRASH-01. Follow the pattern of other error boundaries in the project. Also add `app/extraction/error.tsx` for the list page.
**Warning signs:** White screen of death on the extraction results page.

### Pitfall 7: Export Data Query Returning Incorrect Shape
**What goes wrong:** `getExtractionResultsForExport` returns nested data but the export functions expect flat/denormalized rows.
**Why it happens:** The backend stores data normalized (papers table + results table), but CSV/XLSX need flat rows.
**How to avoid:** The export query must JOIN papers + results + questions into a flat array, as the screening export query does. Design the query output to match the export function input type exactly.
**Warning signs:** CSV has empty columns or wrong data alignment.

## Code Examples

### New Convex Query: `getExtractionResults`

```typescript
// Source: Pattern derived from convex/extraction/queries.ts (getExtractionJobMetrics)
// [VERIFIED: follows existing auth/ownership guard pattern]
export const getExtractionResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        _id: v.id("extractionJobs"),
        status: extractionJobStatusValidator,
        questions: v.array(extractionQuestionValidator),
        totalPapers: v.number(),
      }),
      papers: v.array(v.object({
        _id: v.id("extractionPapers"),
        title: v.string(),
        openalexId: v.string(),
        doi: v.optional(v.string()),
        status: extractionPaperStatusValidator,
        parsingSource: v.optional(parsingSourceValidator),
        results: v.array(v.object({
          questionId: v.string(),
          answer: v.union(v.string(), v.null()),
          confidence: v.optional(extractionConfidenceValidator),
          evidenceStartChar: v.optional(v.number()),
          evidenceEndChar: v.optional(v.number()),
          reasoning: v.optional(v.string()),
          modelUsed: v.optional(v.string()),
          criticVerdict: v.optional(v.string()),
        })),
      })),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    const papersWithResults = [];
    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(100); // bounded by question count

      papersWithResults.push({
        _id: paper._id,
        title: paper.title,
        openalexId: paper.openalexId,
        doi: paper.doi,
        status: paper.status,
        parsingSource: paper.parsingSource,
        results: results.map((r) => ({
          questionId: r.questionId,
          answer: r.answer,
          confidence: r.confidence,
          evidenceStartChar: r.evidenceStartChar,
          evidenceEndChar: r.evidenceEndChar,
          reasoning: r.reasoning,
          modelUsed: r.modelUsed,
          criticVerdict: r.criticVerdict,
        })),
      });
    }

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        totalPapers: job.totalPapers,
      },
      papers: papersWithResults,
    };
  },
});
```

### Per-Paper Status Badge Component

```typescript
// Source: Pattern from confidence-badge.tsx OKLCH approach + D-08 color spec
// [VERIFIED: OKLCH values from 97-CONTEXT.md D-08]
"use client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PaperStatus = "pending" | "parsing" | "extracting" | "completed" | "failed" | "cancelled";

const statusConfig: Record<PaperStatus, { classes: string }> = {
  pending: { classes: "bg-muted border-border text-muted-foreground" },
  parsing: {
    classes: "bg-[oklch(0.95_0.08_250/0.15)] border-[oklch(0.55_0.15_250/0.3)] text-[oklch(0.4_0.12_250)] dark:bg-[oklch(0.3_0.08_250/0.2)] dark:border-[oklch(0.55_0.15_250/0.3)] dark:text-[oklch(0.7_0.12_250)]",
  },
  extracting: {
    classes: "ai-surface", // Uses --ai-* tokens (violet)
  },
  completed: {
    classes: "bg-[oklch(0.95_0.08_145/0.15)] border-[oklch(0.55_0.15_145/0.3)] text-[oklch(0.4_0.12_145)] dark:bg-[oklch(0.3_0.08_145/0.2)] dark:border-[oklch(0.55_0.15_145/0.3)] dark:text-[oklch(0.7_0.12_145)]",
  },
  failed: {
    classes: "bg-[oklch(0.95_0.06_27/0.15)] border-[oklch(0.6_0.15_27/0.3)] text-[oklch(0.5_0.15_27)] dark:bg-[oklch(0.3_0.08_27/0.2)] dark:border-[oklch(0.6_0.15_27/0.3)] dark:text-[oklch(0.7_0.12_27)]",
  },
  cancelled: { classes: "bg-muted border-border text-muted-foreground/50" },
};

export function StatusBadge({ status, className }: { status: PaperStatus; className?: string }) {
  const t = useTranslations("extraction");
  return (
    <Badge variant="outline" className={cn("rounded-full text-xs font-semibold", statusConfig[status].classes, className)}>
      {t(`progress.status${status.charAt(0).toUpperCase() + status.slice(1)}`)}
    </Badge>
  );
}
```

### i18n Key Structure (Extend Existing Namespace)

```json
// Source: UI-SPEC copywriting contract + existing messages/en-US.json:1460-1493
// [VERIFIED: existing keys at messages/en-US.json lines 1460-1493]
{
  "extraction": {
    // ~25 EXISTING keys (confidenceHigh, confidenceLow, etc.)
    "insufficientEvidence": "Insufficient evidence",
    "evidenceUnavailable": "Evidence unavailable",
    // ...existing keys preserved...

    // NEW: Job Creation (UI-01)
    "jobCreation": {
      "title": "New Extraction Job",
      "description": "Define questions to extract answers from your papers using AI.",
      "questionPlaceholder": "e.g., What sample size was used?",
      "addQuestion": "Add question",
      "modelTierLabel": "Processing tier",
      "tierAuto": "Auto (recommended)",
      "tierAutoDesc": "System picks the best model per question",
      "tierCheap": "Fast",
      "tierCheapDesc": "Lower cost, good for simple questions",
      "tierAccurate": "Thorough",
      "tierAccurateDesc": "Full cascade for maximum accuracy",
      "costPreview": "Estimated: ~{credits} credits",
      "insufficientBalance": "Not enough credits for this job",
      "submit": "Start Extraction",
      "submitting": "Starting...",
      "dismiss": "Discard Draft",
      "success": "Extraction job started",
      "error": "Failed to start extraction. Please try again.",
      "activeJobWarning": "An extraction job is already running",
      "noQuestions": "Add at least one question"
    },

    // NEW: Progress (UI-02)
    "progress": { /* ... keys from UI-SPEC ... */ },

    // NEW: Results (UI-03)
    "results": { /* ... keys from UI-SPEC ... */ },

    // NEW: Export (UI-04)
    "export": { /* ... keys from UI-SPEC ... */ }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `framer-motion` package | `motion` package (v12+) with `motion/react` imports | 2024-Q4 | [VERIFIED: codebase] Project already migrated -- all imports use `from "motion/react"` |
| `next-intl` v3 server-only | `next-intl` v4 with `useTranslations()` client hook | 2025-Q1 | [VERIFIED: package.json v4.8.2] Project uses v4 patterns throughout |
| CSS color functions (hsl/rgb) | OKLCH color space | Ongoing | [VERIFIED: globals.css] Entire design system uses OKLCH for perceptual uniformity |

**Deprecated/outdated:**
- `framer-motion` import path: Use `motion/react` instead. [VERIFIED: all codebase imports confirm this]
- `next-intl` `getTranslations()` server function for client components: Use `useTranslations()` hook. [VERIFIED: all extraction components use hook pattern]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Keep components flat in `components/extraction/` (no subdirectories) | Architecture Patterns | Low -- reorganization is trivial if flat becomes unwieldy |
| A2 | `getExtractionResults` can use `.take(MAX)` rather than cursor pagination | Architecture Patterns | Medium -- if jobs routinely have 500+ papers, pagination would improve UX. However, MVP paper limits make `.take()` safe |
| A3 | PostHog event name `extraction_job_created` follows project naming convention | Code Examples | Low -- naming is Claude's discretion per CONTEXT.md |
| A4 | Credit cost estimation for extraction can reuse the screening credit constant pattern | Architecture Patterns | Medium -- extraction may have different per-paper costs than screening. The `ESTIMATED_CREDITS_PER_PAPER` constant may need an extraction-specific counterpart |

## Open Questions

1. **Credit Cost Estimation for Extraction**
   - What we know: Screening uses `ESTIMATED_CREDITS_PER_PAPER` constant from `convex/lib/constants.ts`. Extraction has different per-paper costs (parsing + LLM extraction + critic pass).
   - What's unclear: Whether an `ESTIMATED_CREDITS_PER_EXTRACTION_PAPER` constant exists or needs to be created, and what the per-paper cost factor should be.
   - Recommendation: Check `convex/lib/constants.ts` during planning. If no extraction-specific constant exists, create one. The cost preview is an estimate, so an approximate value is acceptable for MVP.

2. **Question `expectedType` Usage in Job Creation**
   - What we know: The `extractionQuestionValidator` includes `expectedType: v.optional(v.string())` for guiding LLM output format (e.g., "number", "date", "boolean").
   - What's unclear: Whether the job creation UI should expose `expectedType` selection to users or default to unset.
   - Recommendation: For MVP, omit `expectedType` from the UI (keep it optional/unset). The LLM handles free-text questions well. Can add type hints in a future iteration.

## Project Constraints (from CLAUDE.md)

- **Convex backend:** Always read `convex/_generated/ai/guidelines.md` first for Convex patterns. [VERIFIED: read during research]
- **Brand personality:** Clean, Friendly, Approachable -- warm orange primary, violet AI accent, OKLCH tokens, Outfit font, spring animations, WCAG AAA
- **DRY principle:** Check codebase before implementing -- reuse screening patterns, existing extraction components, export infrastructure
- **No legacy code:** Destructive rebuild ethos -- no backward compatibility concerns
- **Modern standards only:** Use latest patterns (motion/react, next-intl v4, OKLCH)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.x (with `@vitejs/plugin-react`) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run tests/extraction/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Job creation dialog renders with question builder, tier selector, cost preview | Component test (jsdom) | `npx vitest run tests/components/extraction-dialog.test.tsx -x` | No -- Wave 0 |
| UI-02 | Progress ring updates reactively; cancel confirmation works | Component test (jsdom) | `npx vitest run tests/components/extraction-progress.test.tsx -x` | No -- Wave 0 |
| UI-03 | Paper result card renders evidence quote at correct char range | Component test (jsdom) | `npx vitest run tests/components/paper-result-card.test.tsx -x` | No -- Wave 0 |
| UI-04 | Export generates valid CSV/JSON/XLSX from extraction data | Unit test (node) | `npx vitest run tests/export-extraction.test.ts -x` | No -- Wave 0 |
| UI-04 | Export reuses screening pattern (no new infrastructure) | Reuse validation test | `npx vitest run tests/export-extraction-reuse.test.ts -x` | No -- Wave 0 |
| UI-05 | All 6 locale files have extraction.jobCreation/progress/results/export keys | Unit test (node) | `npx vitest run tests/extraction-i18n.test.ts -x` | No -- Wave 0 |
| UI-06 | OKLCH tokens used, no hardcoded hex/rgb in new components | Static analysis / grep | `grep -rn 'oklch\|#[0-9a-fA-F]' components/extraction/` | Manual |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/extraction/ -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/export-extraction.test.ts` -- covers UI-04 (export function correctness)
- [ ] `tests/extraction-i18n.test.ts` -- covers UI-05 (locale completeness)
- [ ] `tests/components/extraction-dialog.test.tsx` -- covers UI-01 (dialog rendering)
- [ ] `tests/components/paper-result-card.test.tsx` -- covers UI-03 (evidence rendering)

Note: Component tests in this project use jsdom environment (configured in `vitest.config.ts` environmentMatchGlobs). The export test uses node environment. Both patterns are established.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Convex `getCurrentUser(ctx)` in all public queries/mutations [VERIFIED] |
| V3 Session Management | No | Handled by Clerk at provider level, not in this phase |
| V4 Access Control | Yes | Job ownership check (`job.userId !== user._id`) on every query [VERIFIED] |
| V5 Input Validation | Yes | Convex validators on all function args (`v.id()`, `v.string()`, `v.array()`) [VERIFIED] |
| V6 Cryptography | No | No cryptographic operations in UI phase |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-user data access | Information Disclosure | Server-side ownership check in every Convex query (`job.userId !== user._id` -> return null) [VERIFIED] |
| Client-side auth bypass | Elevation of Privilege | Never accept userId as function argument; derive from `ctx.auth.getUserIdentity()` [VERIFIED: Convex guidelines] |
| XSS via paper titles/evidence text | Tampering | React auto-escapes JSX text content; no `dangerouslySetInnerHTML` in any extraction component [VERIFIED] |
| Uncaught mutation errors | Denial of Service (UX) | Every `useMutation` call-site catches and routes to toast (CRASH-04) [VERIFIED: screening pattern] |

## Sources

### Primary (HIGH confidence)
- **Codebase files read directly:**
  - `components/screening/screening-dialog.tsx` -- Job creation dialog pattern
  - `components/screening/screening-job-history.tsx` -- Job history with export dropdown
  - `components/screening/screening-jobs-dialog.tsx` -- Dialog wrapper pattern
  - `components/screening/screening-progress.tsx` -- Progress card pattern
  - `components/app-sidebar.tsx` lines 276-365 -- `ScreeningFooterButton` SVG ring
  - `components/app-sidebar.tsx` lines 426-434 -- `getCurrentPage()` nav detection
  - `components/extraction/evidence-quote.tsx` -- Verbatim quote renderer
  - `components/extraction/confidence-badge.tsx` -- OKLCH badge pattern
  - `components/extraction/critic-verdict-badge.tsx` -- AI surface badge
  - `components/extraction/insufficient-evidence-card.tsx` -- Muted dashed card
  - `components/extraction/job-metrics-panel.tsx` -- 2x2 metric grid
  - `components/download-menu.tsx` -- Generic download dropdown
  - `lib/screening/export.ts` -- CSV/JSON/XLSX export infrastructure
  - `lib/animation-config.ts` -- Spring presets
  - `lib/auth/use-auth-query.ts` -- `useProtectedQuery` hook
  - `lib/utils.ts` lines 144-220 -- `downloadAsFile`, `jsonToCSV`, `generateFilename`
  - `convex/extraction/queries.ts` -- All existing extraction queries
  - `convex/extraction/mutations.ts` -- `createExtractionJob`, `cancelExtractionJob`
  - `convex/extraction/validators.ts` -- All extraction validators
  - `convex/schema.ts` lines 410-514 -- Extraction table schema
  - `convex/_generated/ai/guidelines.md` -- Convex API patterns
  - `app/globals.css` -- Full OKLCH design token system
  - `i18n/config.ts` -- Locale configuration
  - `messages/en-US.json` lines 1460-1493 -- Existing extraction i18n keys
  - `vitest.config.ts` -- Test framework configuration
  - `.planning/phases/97-extraction-ui-polish/97-UI-SPEC.md` -- Design contract
  - `.planning/phases/97-extraction-ui-polish/97-CONTEXT.md` -- User decisions

- **npm registry (verified via `npm view`):**
  - `motion` latest: 12.38.0 (installed: 12.23.12)
  - `exceljs` latest: 4.4.0 (installed: 4.4.0 -- current)
  - `next-intl` latest: 4.9.1 (installed: 4.8.2)
  - `sonner` latest: 2.0.7 (installed: 2.0.7 -- current)
  - `lucide-react` latest: 1.8.0 (installed: 0.487.0)

### Secondary (MEDIUM confidence)
- None needed -- all claims verified from primary codebase sources.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified as already installed; no new dependencies needed
- Architecture: HIGH -- every pattern exists in the codebase (screening feature provides complete reference)
- Pitfalls: HIGH -- derived from reading actual codebase patterns and existing CRASH-0X requirements
- i18n: HIGH -- locale config, existing key structure, and UI-SPEC copywriting contract all verified

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- no fast-moving dependencies)
