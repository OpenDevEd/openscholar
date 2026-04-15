---
phase: 97-extraction-ui-polish
plan: 03
subsystem: extraction-results-ui
tags: [components, route, error-boundary, oklch, animation, i18n]
dependency_graph:
  requires:
    - "extraction i18n keys (Plan 01)"
    - "getExtractionResults query (Plan 01)"
    - "getExtractionResultsForExport query (Plan 01)"
    - "ExtractionExportData type + export functions (Plan 01)"
    - "ConfidenceBadge, CriticVerdictBadge, EvidenceQuote, InsufficientEvidenceCard, JobMetricsPanel (Plan 02)"
  provides:
    - "StatusBadge component with 6-status OKLCH colors"
    - "PaperResultCard composing all 5 existing extraction components"
    - "Results route at /extraction/[jobId] with loading/empty/notFound/results states"
    - "Export dropdown with CSV/JSON/XLSX"
    - "Error boundaries on /extraction and /extraction/[jobId]"
  affects:
    - "components/extraction/status-badge.tsx"
    - "components/extraction/paper-result-card.tsx"
    - "app/extraction/[jobId]/page.tsx"
    - "app/extraction/[jobId]/extraction-results-client.tsx"
    - "app/extraction/[jobId]/error.tsx"
    - "app/extraction/error.tsx"
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
tech_stack:
  added: []
  patterns:
    - "OKLCH badge color config with dark mode variants"
    - "motion.div staggered card entrance with useReducedMotion"
    - "Server component wrapper + client component route pattern"
    - "useProtectedQuery with undefined/null/empty state guards (CRASH-02)"
    - "useConvex().query() for on-demand export fetch"
    - "Error boundary with unstable_retry and focused heading"
key_files:
  created:
    - "components/extraction/status-badge.tsx"
    - "components/extraction/paper-result-card.tsx"
    - "app/extraction/[jobId]/page.tsx"
    - "app/extraction/[jobId]/extraction-results-client.tsx"
    - "app/extraction/[jobId]/error.tsx"
    - "app/extraction/error.tsx"
  modified:
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
decisions:
  - "StatusBadge uses extraction.progress namespace for i18n keys, consistent with existing progress status labels"
  - "PaperResultCard skips motion.div wrapper when useReducedMotion returns true (accessibility)"
  - "Export button label reuses existing export.csv key with prefix stripped for compact header display"
  - "Error boundaries link to /extraction (not /) to keep users in extraction context"
  - "Export uses as ExtractionExportData cast because convex.query return type is wider than the typed interface"
metrics:
  duration: "322s"
  completed: "2026-04-15"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 6
---

# Phase 97 Plan 03: Results Page, Paper Cards, Error Boundaries Summary

StatusBadge with 6-status OKLCH colors and pulse animation for active states, PaperResultCard composing all existing extraction components with staggered entrance animation, full results route at /extraction/[jobId] with 4-state rendering and CSV/JSON/XLSX export, plus two error boundaries for crash prevention.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create StatusBadge and PaperResultCard components | 68d2934 | components/extraction/status-badge.tsx, components/extraction/paper-result-card.tsx |
| 2 | Create results route page and error boundaries | ead68a3 | app/extraction/[jobId]/page.tsx, app/extraction/[jobId]/extraction-results-client.tsx, app/extraction/[jobId]/error.tsx, app/extraction/error.tsx |

## What Was Built

### Task 1: StatusBadge and PaperResultCard

**StatusBadge** (`components/extraction/status-badge.tsx`):
- Config object mapping 6 paper statuses (pending, parsing, extracting, completed, failed, cancelled) to OKLCH class strings
- `animate-pulse` applied to parsing and extracting statuses (active processing)
- Uses `useTranslations("extraction")` with `progress.status{Status}` keys
- Follows exact ConfidenceBadge pattern: Badge variant="outline", rounded-full, text-xs font-semibold

**PaperResultCard** (`components/extraction/paper-result-card.tsx`):
- Composes 4 of the 5 existing extraction components: ConfidenceBadge, CriticVerdictBadge, EvidenceQuote, InsufficientEvidenceCard (JobMetricsPanel is used at page level, not per-card)
- Staggered entrance animation via `motion.div` with `cardEntrance` preset and `index * 0.05` delay
- `useReducedMotion()` check skips animation wrapper entirely when user prefers reduced motion
- Per-question rows: InsufficientEvidenceCard when answer is "insufficient_evidence", otherwise answer + ConfidenceBadge + CriticVerdictBadge + EvidenceQuote + reasoning
- Card header with paper title, StatusBadge, parsing source badge, DOI link

**i18n keys added** (Rule 3 -- blocking dependency):
- `statusParsing` and `statusExtracting` added to `extraction.progress` namespace across all 6 locales
- These paper-level statuses were missing from the Plan 01 i18n seeding (only job-level statuses were included)

### Task 2: Results Route and Error Boundaries

**Results Route** (`app/extraction/[jobId]/page.tsx` + `extraction-results-client.tsx`):
- Server component wrapper with `generateMetadata()` using `extractionResultsTitle` key
- Client component uses `useProtectedQuery(api.extraction.queries.getExtractionResults)` -- no bare useQuery (CRASH-02)
- 4-state rendering: loading skeleton (3 placeholder cards), not found (AlertTriangle + back link), empty (heading + body text), results (header + metrics + cards)
- Export dropdown with CSV/JSON/XLSX using `convex.query(getExtractionResultsForExport)` then export functions
- Incomplete job warning banner in export dropdown when status is not "completed"
- Error toast via `showStyledToast` on export failure

**Error Boundaries** (`app/extraction/error.tsx` and `app/extraction/[jobId]/error.tsx`):
- Cloned from `app/results/error.tsx` reference pattern
- Both: `"use client"`, `role="alert"`, retry button, link to `/extraction`
- Difference: console.error log prefix distinguishes `[app/extraction/error]` from `[app/extraction/[jobId]/error]`
- `headingRef.current?.focus()` on error for screen reader accessibility
- T-97-10 mitigation: `unstable_retry` is single retry, not infinite loop

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing statusParsing and statusExtracting i18n keys**
- **Found during:** Task 1
- **Issue:** StatusBadge references `progress.statusParsing` and `progress.statusExtracting` keys, but Plan 01's i18n seeding only included job-level statuses (pending, processing, completed, cancelled, failed). Paper-level statuses (parsing, extracting) were missing.
- **Fix:** Added both keys to `extraction.progress` namespace in all 6 locale files
- **Files modified:** messages/{en-US,en-GB,zh,fr,hi,ja}.json
- **Commit:** 68d2934

## Verification Results

1. `npx tsc --noEmit`: Zero errors in plan files (10 pre-existing errors in unrelated files: mutations.test.ts, mutations.ts, prompt-delimiters.test.ts)
2. Both error boundary files: `"use client"` + `role="alert"` confirmed
3. Results client: undefined/null/empty guards at lines 72, 89, 109 before any data destructuring
4. StatusBadge: 6 status OKLCH classes with pulse on parsing/extracting
5. PaperResultCard: Composes ConfidenceBadge, CriticVerdictBadge, EvidenceQuote, InsufficientEvidenceCard, StatusBadge

## Known Stubs

None -- all components are fully wired to their data sources.

## Self-Check: PASSED
