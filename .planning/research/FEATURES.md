# Feature Landscape

**Domain:** Screening result export (CSV/JSON/XLSX download) for academic screening job history
**Researched:** 2026-03-09
**Milestone:** v4.1 Screening Export

## Table Stakes

Features users expect. Missing = export feels broken or incomplete.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| CSV export with paper metadata + answers | Researchers need screening results in spreadsheets for PRISMA reporting, further analysis, and sharing with collaborators | Low | New `getJobResultsForExport` Convex query, `downloadFile` utility from `lib/extraction/export.ts` | Columns: title, authors, year, DOI, OpenAlex ID, per-question answers (Yes/No/Null), score, stars, qualified (Yes/No), status |
| JSON export with full structured data | Machine-readable output for systematic review pipelines, meta-analysis tools, and reimport into other platforms | Low | Same query as CSV, existing `downloadFile` utility | Nested structure: job metadata envelope + results array with answers object, scoring, AI metadata |
| XLSX export with multiple sheets | Excel is dominant in academic workflows; multi-sheet separates results from config/summary for cleaner analysis | Medium | Dynamic ExcelJS import (existing pattern in `lib/extraction/export.ts`) | Sheet 1: Results, Sheet 2: Summary stats, Sheet 3: Scoring config. Reuse exact same ExcelJS dynamic import pattern |
| Per-question answer columns | Each screening question must be its own column so researchers can sort/filter per criterion in their spreadsheet | Low | Job `questions` array already stored on `screeningJobs` record | Iterate `job.questions` to generate headers; map `result.answers[key]` to "Yes"/"No"/"" cells. Same pattern as extraction export |
| Score and star rating columns | Users configured scoring rules specifically to quantify relevance; scores must appear in the export | Low | `score`, `stars` already computed and stored on each `screeningResults` record | Two columns: "Score" (number) and "Rating" (0-5 stars). No recomputation needed |
| Qualified/not-qualified column | The primary purpose of screening is inclusion decisions; qualification status is the most important output | Low | `qualified` boolean already on each `screeningResults` record | Render as "Yes"/"No". This is effectively the PRISMA include/exclude decision |
| Export button on completed job cards | Users expect to download from the job they just ran without navigating to a separate page | Low | `ScreeningJobHistory` component (`components/screening/screening-job-history.tsx`) | Add download icon button on jobs with status: completed, cancelled, or creditsExhausted. Disable for pending/processing jobs |
| Paper metadata columns (title, authors, year, DOI) | Papers must be identifiable; researchers cross-reference screening exports with reference managers and other review tools | Low | All fields already stored on `screeningResults` records: `title`, `authors`, `publicationYear`, `doi`, `openalexId` | Authors stored as `string[]` -- join with "; " for CSV/XLSX, keep array for JSON |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| AI reasoning column (optional) | Transparency into why AI answered yes/no for each paper -- auditable screening trail for methodology sections in systematic reviews | Low | `aiMetadata.reasoning` already stored on `screeningResults` | Toggle via checkbox in export dialog. In CSV/XLSX: one "AI Reasoning" column. In JSON: nested in each result |
| AI confidence column (optional) | Quantifies AI certainty per paper -- researchers can flag low-confidence screenings for manual review | Low | `aiMetadata.confidence` already stored on `screeningResults` | Render as percentage (0-100%). Optional checkbox in export dialog |
| Format selection dialog with toggles | Consistent UX with existing extraction export dialog; lets users control what's included without overwhelming defaults | Low | Clone and simplify `components/extraction/export-dialog.tsx` | Fewer options than extraction (no citations). Checkboxes: "Include AI metadata" (reasoning + confidence), format radio (CSV/JSON/XLSX) |
| Export from partial/cancelled jobs | Jobs that ran out of credits or were cancelled still produced useful partial results that should not be lost | Low | Query `screeningResults` with status "completed" for the job; partial data better than nothing | Show paper count in export dialog so user knows it is partial (e.g., "Export 47 of 200 screened papers") |
| Summary statistics sheet (XLSX) | Quick overview: total papers, qualified/not-qualified counts, per-question yes/no/null distribution, average score | Medium | Computed from results array at export time | Matches extraction export Summary sheet pattern. Adds screening-specific stats: qualification rate, score distribution |
| Scoring configuration sheet (XLSX) | Researchers documenting systematic review methods need to report exact scoring criteria used; self-documenting export | Low | `scoringConfig` already stored on `screeningJobs`: rules (points per answer), thresholds (score-to-star mapping), minimum score | Dedicated worksheet showing: per-question point values, star threshold ranges, minimum qualification score |
| Job metadata envelope (JSON) | JSON export includes job creation date, questions, scoring config, total/qualified/failed counts -- self-documenting output file | Low | Pull from `screeningJobs` record alongside results | Makes JSON export reproducible and auditable without needing access to the app |
| Result status column | Shows which papers completed, failed, or were skipped -- important for audit trail and PRISMA flow documentation | Low | `status` field on each `screeningResults` record | Rendered as "Completed"/"Failed"/"Skipped". Failed papers have no answers but are still listed |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Server-side file generation via Convex action | Convex actions have 10MB response limit and would require Convex file storage setup; client-side generation is simpler and matches existing patterns | Generate files client-side using the same `downloadFile` utility and dynamic ExcelJS import already used by extraction and library exports |
| Bulk multi-job export (export all jobs at once) | Each job has different questions and scoring configs; merging them into one file is semantically incorrect and produces confusing spreadsheets | Export one job at a time. Users can combine exports manually in their own spreadsheets if needed |
| PDF export | Entirely different rendering pipeline (needs headless browser or PDF library); no existing pattern in codebase; researchers prefer editable formats for analysis | Stick with CSV/JSON/XLSX -- covers all real academic workflows (spreadsheet analysis, programmatic processing, data archival) |
| Custom column picker UI | Over-engineering for ~12 columns; the extraction export uses simple checkboxes for optional sections and it works well | Reuse checkbox toggle pattern: required columns always included, optional toggles for AI metadata (reasoning + confidence) |
| Re-export with different scoring rules | Would require client-side scoring engine recomputation and creates confusion about which scores are "official" | Export shows scores as computed at screening time. Users wanting different rules should run a new screening job |
| Abstract text in CSV export | Abstracts can be 300+ words, breaking CSV readability and making spreadsheets unwieldy. Most screening exports are for decision summaries, not full-text review | Include abstract in JSON export (it is structured data). Omit from CSV entirely. Optional column in XLSX |
| Export during processing | Job data is incomplete and actively changing; creates confusing partial files that may differ from final results | Only enable export button when job status is `completed`, `cancelled`, or `creditsExhausted` |
| BibTeX/RIS citation format export | Entire separate product category (reference management); users have Zotero for citation formatting; already out of scope per PROJECT.md | Papers include DOI and OpenAlex ID which users can use to import into any reference manager |

## Feature Dependencies

```
EXISTING infrastructure (no changes needed):
  - screeningResults table: answers, score, stars, qualified, aiMetadata, status
  - screeningJobs table: questions, scoringConfig, status, totalPapers, qualifiedPapers
  - getScreeningJob query: auth-gated, returns full job record
  - ExcelJS dynamic import pattern: lib/extraction/export.ts
  - downloadFile utility: lib/extraction/export.ts
  - ExportDialog component pattern: components/extraction/export-dialog.tsx
  - formatAnswerForCSV/formatAnswerForExcel helpers: lib/extraction/export.ts
  - ScreeningJobHistory component: components/screening/screening-job-history.tsx
  - by_job index on screeningResults: efficient job-scoped queries

NEW components to build:
  getJobResultsForExport query ──> screening export functions ──> ScreeningExportDialog ──> Export button
  (Convex backend)                (lib/screening/export.ts)     (React component)         (in job history)

Build order (serial dependency chain):
  1. getJobResultsForExport Convex query (loads all completed results for a job, auth-gated)
  2. Export utility functions (CSV/JSON/XLSX formatters using existing helpers)
  3. ScreeningExportDialog component (format picker + optional toggles)
  4. Export button integration in ScreeningJobHistory cards
```

## Existing Infrastructure to Reuse

| Existing Component | Reuse Strategy |
|--------------------|----------------|
| `exportToCSV` / `exportToJSON` / `exportToExcel` in `lib/extraction/export.ts` | Adapt column structure; do NOT import directly (different data shape), but copy the patterns: header generation, row mapping, downloadFile call, ExcelJS dynamic import |
| `ExportDialog` in `components/extraction/export-dialog.tsx` | Clone and simplify: same RadioGroup for format, fewer Checkbox options (just "Include AI metadata"), same DialogFooter pattern |
| `formatAnswerForCSV` / `formatAnswerForExcel` helpers | Directly importable for formatting boolean answers as "Yes"/"No" |
| `downloadFile` utility in `lib/extraction/export.ts` | Import directly -- format-agnostic file download trigger |
| `by_job` index on `screeningResults` | Efficient query for all results of a job; already exists in schema |
| `MAX_SCREENING_PAPERS_PER_JOB` from `queryBounds.ts` | Bound the results query to prevent unbounded `.collect()` |
| `getCurrentUser` auth helper | Standard auth gate for the new query |

## MVP Recommendation

Prioritize (in build order):
1. **Convex query `getJobResultsForExport`** -- Auth-gated query returning all completed/failed/skipped results for a screening job, bounded by `MAX_SCREENING_PAPERS_PER_JOB`. Returns paper metadata + answers + score/stars/qualified + aiMetadata. This is the only backend addition needed.
2. **Export functions in `lib/screening/export.ts`** -- Three functions: `exportScreeningToCSV`, `exportScreeningToJSON`, `exportScreeningToExcel`. Adapt extraction export column patterns for screening fields. Default columns: title, authors, year, DOI, OpenAlex ID, per-question answers, score, stars, qualified, status. Optional: AI reasoning, AI confidence.
3. **`ScreeningExportDialog` component** -- Simplified clone of extraction ExportDialog. Format radio (CSV/JSON/XLSX) + single checkbox toggle for "Include AI metadata". Shows paper count for context.
4. **Export button on job cards** -- Download icon button on completed/cancelled/creditsExhausted cards in `ScreeningJobHistory`. Opens `ScreeningExportDialog` with the selected job ID.

Defer (low effort, add after core works):
- XLSX Summary statistics sheet (per-question distributions, average score, qualification rate)
- XLSX Scoring configuration sheet (rules + thresholds as reference)
- Abstract column toggle for XLSX
- i18n for export dialog labels (can use existing extraction i18n keys as starting point)

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| CSV/JSON export | HIGH | Directly mirrors existing extraction + library export patterns; data shape is simpler (boolean answers vs mixed types) |
| XLSX export | HIGH | ExcelJS dynamic import pattern proven in codebase; same multi-sheet approach as extraction |
| Export dialog UX | HIGH | Direct simplification of existing ExportDialog; fewer options, same interaction pattern |
| Backend query | HIGH | `by_job` index exists; auth pattern identical to `getScreeningJob`; bounded by existing MAX constant |
| Data completeness | HIGH | All export-relevant fields (answers, score, stars, qualified, aiMetadata) already computed and stored at screening time; no recomputation needed |
| Integration with job history UI | HIGH | Component structure is clear; adding a button with stopPropagation follows existing accordion pattern in the component |

## Sources

- Existing extraction export: `lib/extraction/export.ts` (CSV/JSON/XLSX patterns, downloadFile utility, ExcelJS dynamic import)
- Existing library export: `lib/library/export.ts` (simpler CSV/JSON pattern, formatForExport helper)
- Existing export dialog: `components/extraction/export-dialog.tsx` (format selector, checkbox toggles, dialog structure)
- Screening schema: `convex/schema.ts` lines 684-770 (screeningJobs + screeningResults table definitions with all field types)
- Screening queries: `convex/screening/queries.ts` (auth patterns, user isolation, bounded queries, validator shapes)
- Scoring engine: `convex/screening/scoring.ts` (score/stars/qualified already computed at screening time -- no export-time recomputation)
- Job history UI: `components/screening/screening-job-history.tsx` (where export button integrates; status-aware rendering)
- Query bounds: `convex/lib/queryBounds.ts` (MAX_SCREENING_PAPERS_PER_JOB constant for bounded .collect())
- Search actions screening export test: `tests/search-actions-screening-export.test.ts` (contract tests for existing search-level screening export)
