---
phase: 97-extraction-ui-polish
plan: 01
subsystem: extraction-data-foundation
tags: [i18n, convex-queries, export, data-layer]
dependency_graph:
  requires: []
  provides:
    - "extraction i18n keys (~50 new keys across 6 locales)"
    - "getExtractionResults query (per-paper results with nested answers)"
    - "getExtractionResultsForExport query (flat denormalized rows for export)"
    - "ExtractionExportData type + CSV/JSON/XLSX export functions"
  affects:
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
    - "convex/extraction/queries.ts"
    - "lib/extraction/export.ts"
tech_stack:
  added: []
  patterns:
    - "Convex query with auth + ownership guard"
    - "Flat denormalized export query for CSV/JSON/XLSX"
    - "Dynamic import('exceljs') for XLSX generation"
    - "Blob URL download pattern"
key_files:
  created:
    - "lib/extraction/export.ts"
  modified:
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
    - "convex/extraction/queries.ts"
decisions:
  - "Non-English locales use en-US text as placeholder (existing project convention D-21)"
  - "Export query returns v.optional(v.string()) for parsingSource instead of parsingSourceValidator to simplify CSV serialization"
  - "Export module is self-contained -- no imports from lib/utils.ts (matches screening export pattern)"
metrics:
  duration: "461s"
  completed: "2026-04-15"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 7
---

# Phase 97 Plan 01: Data Foundation (i18n, queries, export) Summary

Seeded all i18n keys, created two Convex queries for results and export, and built the extraction export module with CSV/JSON/XLSX functions -- the complete data foundation for Plans 02-04.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Seed i18n keys in all 6 locale files | ef09653 | messages/{en-US,en-GB,zh,fr,hi,ja}.json |
| 2 | Create getExtractionResults and getExtractionResultsForExport queries | 2c8002b | convex/extraction/queries.ts |
| 3 | Create extraction export module | 5874a1f | lib/extraction/export.ts |

## What Was Built

### Task 1: i18n Key Seeding
Extended the `extraction` namespace in all 6 locale files with ~50 new keys organized into 4 nested groups:
- **jobCreation**: 17 keys for job creation dialog (title, description, tiers, submit, errors)
- **progress**: 14 keys for progress tracking (status labels, counters, cancel confirmation)
- **results**: 10 keys for results page (empty states, labels, error states)
- **export**: 4 keys for export dropdown (CSV/JSON/XLSX labels, incomplete warning)
- Plus 2 root-level keys (jobsDialogTitle, jobsDialogDescription) and 3 metadata namespace keys.

All existing ~25 extraction keys (badges, jobMetrics) preserved unchanged.

### Task 2: Convex Queries
Added two new public queries to `convex/extraction/queries.ts`:

**getExtractionResults** -- Per-paper results with nested question answers for the results page. Returns `{ job, papers[] }` where each paper has a `results[]` array of answer objects.

**getExtractionResultsForExport** -- Flat denormalized rows for export serialization. Returns `{ job, results[] }` with one row per paper-question pair, including resolved question text from the job's questions array.

Both queries follow the established pattern: `getCurrentUser` auth guard, `job.userId !== user._id` ownership check, `.take(MAX_EXTRACTION_PAPERS_PER_JOB)` for papers, `.take(100)` for results per paper.

### Task 3: Export Module
Created `lib/extraction/export.ts` cloning the pattern from `lib/screening/export.ts`:
- `ExtractionExportData` interface matching `getExtractionResultsForExport` return shape
- `generateExtractionCSV` / `exportExtractionToCSV` -- CSV with 10 columns, proper escaping
- `generateExtractionJSON` / `exportExtractionToJSON` -- JSON envelope with metadata
- `generateExtractionXLSXWorkbook` / `exportExtractionToXLSX` -- Two-sheet workbook (Results + Summary) via dynamic `import('exceljs')`

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Non-English locale placeholder strategy**: All 6 locales use en-US English text as placeholder values for the new keys, per the established project convention (D-21). Professional translation is a separate concern.

2. **Export parsingSource as v.string()**: The export query uses `v.optional(v.string())` for parsingSource instead of `parsingSourceValidator` to simplify CSV/JSON serialization. The display value is a plain string.

3. **Self-contained export module**: No imports from `lib/utils.ts` -- the module has its own `downloadFile`, `escapeCSVCell`, and `buildFilename` helpers, matching the screening export pattern for module independence.

## Verification Results

- All 6 locale files: valid JSON, all required keys present, existing keys preserved
- `convex/extraction/queries.ts`: both queries exported with auth + ownership guards
- `lib/extraction/export.ts`: all 4 export functions + interface + 2 generate functions exported
- TypeScript: zero errors in modified/created files (pre-existing errors in unrelated files documented below)

## Known Issues (Pre-existing, Out of Scope)

- `convex/extraction/mutations.test.ts`: 7 TypeScript errors related to generic document type narrowing
- `convex/extraction/mutations.ts`: 2 TypeScript errors (null vs undefined for optional number)
- `tests/crash-prevention/prompt-delimiters.test.ts`: 1 TypeScript error (regex flag target)

These are pre-existing issues not introduced by this plan.

## Threat Surface

No new threat surfaces introduced beyond what was planned. Both queries implement T-97-01 and T-97-02 mitigations (ownership guard returning null for unauthorized access). The export module is a pure-function client-side utility with no network access.

## Self-Check: PASSED
