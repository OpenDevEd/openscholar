# Pitfalls Research

**Domain:** Screening result export (CSV/JSON/XLSX) for academic screening tool
**Researched:** 2026-03-09
**Confidence:** HIGH (based on direct codebase analysis of existing export patterns and screening schema)

## Critical Pitfalls

### Pitfall 1: Dynamic Question Columns Misaligned Between Job and Results

**What goes wrong:**
Screening jobs have user-defined questions (`questions: [{key, question}]`) stored on the job document. Each `screeningResult` stores `answers: Record<string, boolean | null>` keyed by question key. If the export builds columns from job.questions but a result has missing keys (e.g., the paper failed or was skipped mid-processing), the CSV/XLSX columns silently shift, corrupting the entire row alignment.

**Why it happens:**
The extraction export (`lib/extraction/export.ts`) iterates `questions.forEach(q => { result = paper.results.find(r => r.questionKey === q.key) })` -- safe because extraction results are stored per-question as separate array elements. But screening results store all answers in a single `Record<string, boolean | null>`, so a missing key is a missing property, not a missing array element. Developers copy the extraction pattern without adapting for the flat record structure.

**How to avoid:**
Always iterate over `job.questions` as the column source, and use `result.answers?.[q.key] ?? null` with explicit null fallback for each cell. Never iterate over `result.answers` keys directly (order is not guaranteed and may include stale keys from schema changes).

**Warning signs:**
- CSV has fewer columns than expected for some rows
- XLSX rows appear shifted when opened in Excel
- Tests pass with complete results but fail with partial/skipped results

**Phase to address:**
Phase 1 (data layer) -- the `formatScreeningResultRow()` function must handle missing answers from the start.

---

### Pitfall 2: No Query to Fetch All Results for a Job

**What goes wrong:**
The existing screening queries (`convex/screening/queries.ts`) have no public query that returns all `screeningResults` for a given job. There is `getPendingResults` (internal, pending-only) and `getResultInternal` (single result by ID). Developers try to build the export purely client-side without a backend query, or misuse the internal queries, or forget auth guards.

**Why it happens:**
The screening feature was built for real-time progress tracking (polling job status), not batch data retrieval. The export use case was not anticipated in v4.0, so no "get all results for job" query exists.

**How to avoid:**
Create a new `getScreeningJobResults` public query in `convex/screening/queries.ts` that:
1. Authenticates the user and verifies job ownership (same pattern as `getScreeningJob`)
2. Uses the `by_job` index on `screeningResults`
3. Applies `.take(MAX_SCREENING_PAPERS_PER_JOB)` bound (200 -- already defined in queryBounds.ts)
4. Returns all fields needed for export: answers, score, stars, qualified, paper metadata, aiMetadata

**Warning signs:**
- Export feature tries to call internal queries from client code
- Export loads results one-by-one in a loop (N+1 pattern)
- No auth check on the results query

**Phase to address:**
Phase 1 (data layer) -- this query must exist before any export logic can be written or tested.

---

### Pitfall 3: Exporting In-Progress or Failed Jobs Without Warning

**What goes wrong:**
Users click export on a job with status `processing`, `cancelled`, `creditsExhausted`, or `failed`. The export silently produces a partial dataset with missing/incomplete results. The user imports this into their systematic review workflow (e.g., PRISMA) and draws conclusions from incomplete data.

**Why it happens:**
The extraction export dialog receives pre-filtered, complete data. The screening export will receive raw job data that may include results with status `pending`, `processing`, `failed`, or `skipped`. Developers don't filter by result status before export.

**How to avoid:**
1. Only show the export button on completed jobs (`status === "completed"`)
2. For `creditsExhausted` or `cancelled` jobs, show export with a visible warning banner: "X of Y papers were screened. Export contains partial results."
3. Filter out results with `status !== "completed"` from the export dataset
4. Include a metadata row or sheet indicating total papers, screened papers, and skipped/failed counts

**Warning signs:**
- Export button visible on in-progress jobs
- Export file contains empty answer columns for some papers with no explanation
- No count of included vs. excluded papers in the export

**Phase to address:**
Phase 2 (export functions) -- status filtering and warning logic built into the export utilities.

---

### Pitfall 4: CSV Special Character Corruption in Question Text Used as Headers

**What goes wrong:**
Screening questions are user-authored free text (e.g., `"Does the study use RCT, quasi-experimental, or case-control design?"`). These become CSV column headers. Commas, quotes, and newlines in question text corrupt CSV structure. The existing extraction export escapes cell values (`cell.replace(/"/g, '""')`) but the same escaping must also apply to headers.

**Why it happens:**
The existing extraction export builds headers from `q.question` directly (line 89 of `lib/extraction/export.ts`), but extraction questions have system-controlled text. Screening questions are user-authored and can contain any characters including commas, double quotes, and newlines.

**How to avoid:**
Apply the same CSV escaping to header cells as to data cells: wrap each header in double quotes and escape internal quotes. Also truncate question text for XLSX column headers (Excel has practical limits on header length that cause display issues).

**Warning signs:**
- CSV opens incorrectly in Excel with column misalignment
- Tests only use simple question text like "Is this relevant?"
- XLSX headers appear truncated or wrapped unexpectedly

**Phase to address:**
Phase 2 (export functions) -- CSV/XLSX header generation must escape and truncate.

---

### Pitfall 5: Scoring Config Not Included in Export

**What goes wrong:**
The export contains answers (yes/no/null), scores, and stars, but not the scoring rules that produced them. A researcher reviewing the export cannot verify how scores were calculated, making the export non-reproducible for systematic review methodology.

**Why it happens:**
Developers treat the export as a data dump rather than a reproducible research artifact. The scoring config (`rules`, `starThresholds`, `minimumScore`) lives on the job document and is easy to omit from a results-focused export.

**How to avoid:**
- JSON export: include the full `scoringConfig` object in the metadata section
- XLSX export: add a "Configuration" sheet with scoring rules and star thresholds (follows the existing "Questions" and "Summary" sheet pattern in the extraction XLSX export)
- CSV export: accept that CSV is inherently flat and cannot include config metadata; document this limitation

**Warning signs:**
- JSON export has no `scoringConfig` field
- XLSX has results sheet but no configuration sheet
- Reviewers ask "how was the score calculated?" after receiving the export

**Phase to address:**
Phase 2 (export functions) -- built into the export data structure from the start.

## Moderate Pitfalls

### Pitfall 6: Boolean Answers Displayed as "true"/"false" Instead of "Yes"/"No"

**What goes wrong:**
Screening answers are typed `boolean | null` in the schema (`v.union(v.boolean(), v.null())`). Directly stringifying `true`/`false`/`null` produces programmer-readable values ("true", "false", "null") instead of researcher-readable values ("Yes", "No", "N/A").

**Why it happens:**
The extraction export has `formatAnswerForCSV` and `formatAnswerForExcel` that handle multiple answer types. Screening only has boolean answers, so developers might skip the formatter and call `String(answer)` directly.

**How to avoid:**
Create a dedicated `formatScreeningAnswer(answer: boolean | null): string` that returns "Yes" / "No" / "N/A". Reuse for all three export formats.

**Warning signs:**
- Export file contains literal "true", "false", or "null" strings

**Phase to address:**
Phase 2 (export functions).

---

### Pitfall 7: ExcelJS Imported Statically Instead of Dynamically

**What goes wrong:**
ExcelJS is ~500KB. The extraction export already uses dynamic `import('exceljs')` with a CJS/ESM interop guard (lines 201-203 of `lib/extraction/export.ts`). If the screening export imports ExcelJS statically, it adds ~500KB to the initial JS bundle for a feature that is used occasionally.

**Why it happens:**
Static imports are simpler and the developer forgets this is a browser-side module where bundle size matters.

**How to avoid:**
Copy the exact dynamic import pattern from extraction export:
```typescript
const mod = await import('exceljs');
const ExcelJSModule = 'default' in mod ? (mod as unknown as { default: typeof mod }).default : mod;
```

**Warning signs:**
- `next build` shows increased bundle size
- Static `import ExcelJS from 'exceljs'` at top of file

**Phase to address:**
Phase 2 (export functions).

---

### Pitfall 8: Duplicating downloadFile/CSV-Escaping Instead of Extracting Shared Utilities

**What goes wrong:**
The codebase already has two separate download mechanisms: `downloadFile()` in `lib/extraction/export.ts` and `downloadAsFile()` in `lib/utils.ts` (used by library export). A third copy in screening export creates three divergent implementations of the same logic.

**Why it happens:**
Each export module was built independently. The extraction export has its own `downloadFile`, the library export uses a utility from `lib/utils.ts`, and a screening export will be tempted to copy one of them.

**How to avoid:**
Use the existing `downloadAsFile` from `lib/utils.ts` (already imported by library export). For the CSV escaping utility, extract the `row.map(cell => ...)` pattern from `lib/extraction/export.ts` into a shared helper, or build the screening CSV export using the same `jsonToCSV` utility the library export uses.

**Warning signs:**
- A new `downloadFile` function in the screening export module
- CSV escaping logic copy-pasted rather than shared

**Phase to address:**
Phase 2 (export functions) -- decide on shared utility approach before writing formatters.

## Minor Pitfalls

### Pitfall 9: Missing i18n Strings for Export UI

**What goes wrong:**
The project uses next-intl with 6 locale files. Adding an export button, format selector, and option checkboxes to the screening job history requires new translation keys. Missing keys cause fallback to the key string (e.g., "screeningExport.downloadButton" shown to users).

**Why it happens:**
i18n updates are easy to forget, especially across 6 locales.

**How to avoid:**
Add all screening export i18n keys to all 6 locale files in the same PR as the UI component. Check the browser console for missing translation warnings.

**Warning signs:**
- Raw translation key strings visible in UI
- Console warnings from next-intl about missing keys

**Phase to address:**
Phase 3 (UI integration).

---

### Pitfall 10: Export Filename Not Descriptive Enough

**What goes wrong:**
Generic filenames like `screening-results-1741510800000.csv` (Unix timestamp) are impossible to identify later. The extraction export uses `extraction-results-${Date.now()}` and the library export uses `library-export-${ISO-date}`.

**Why it happens:**
Following the existing timestamp pattern without considering that screening jobs are discrete, identifiable units (unlike general library exports).

**How to avoid:**
Include the job date and result count in the filename: `screening-2026-03-09-142papers.csv`. This matches academic workflow expectations where researchers manage many export files.

**Warning signs:**
- Users re-downloading exports because they cannot identify previous files

**Phase to address:**
Phase 3 (UI integration).

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy extraction export verbatim for screening | Fast implementation | Two divergent export systems with different data shapes, hard to maintain | Never -- extract shared utilities (download, CSV escaping, ExcelJS dynamic import) and build screening-specific formatters |
| Skip ExcelJS dynamic import for screening | Simpler code | +500KB to initial bundle for an occasional feature | Never -- pattern already established |
| Hardcode column order instead of deriving from job.questions | Works for current test cases | Breaks when questions differ between jobs | Never -- column order must derive from job.questions |
| Export all results without status filter | Shows complete dataset | Includes garbage data (pending/failed) that misleads researchers | Only with explicit status column AND warning banner |
| Inline the results query in an action instead of a query | Avoids adding a new query function | Cannot use Convex reactivity, harder to test | Never -- query is needed anyway and follows established patterns |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Convex query for results | Using `.collect()` without bounds | Use `.take(MAX_SCREENING_PAPERS_PER_JOB)` (200) via `by_job` index |
| ExcelJS dynamic import | Static `import ExcelJS from 'exceljs'` | Dynamic `const mod = await import('exceljs')` with CJS/ESM interop guard |
| Screening job ownership | Fetching results without verifying job belongs to user | Query job first, check `job.userId === user._id`, then query results by jobId |
| Answer type coercion | Treating `boolean \| null` answers as strings directly | Use explicit formatter: `true` -> "Yes", `false` -> "No", `null` -> "N/A" |
| Existing download utility | Creating a third `downloadFile` function | Use `downloadAsFile` from `lib/utils.ts` (already used by library export) |
| Screening result status | Including `pending`/`failed`/`skipped` results in export | Filter to `status === "completed"` only, document excluded count |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading results without the by_job index | Full table scan on screeningResults | Use `.withIndex("by_job", q => q.eq("jobId", jobId))` | Even at 200 results per job, table scan hits all jobs' results |
| Re-rendering job history list on export button click | Dialog flickers or re-fetches data | Use stable query reference, memoize export data | Noticeable with 10+ jobs in history |
| Building XLSX synchronously blocking main thread | UI freezes for 1-2 seconds | ExcelJS `writeBuffer()` is async -- ensure proper `await` with loading state | At 200 papers with 5+ questions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Results query without auth + ownership check | Any user could export another user's screening results by guessing job ID | Follow `getScreeningJob` pattern: `getCurrentUser(ctx)` + `job.userId !== user._id` null return |
| Including AI provider/model details in default CSV export | Leaks internal infrastructure choices | Include AI metadata only in JSON format under explicit opt-in flag |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Export button with no loading state | User clicks multiple times, gets duplicate downloads | Disable button during export, show spinner, re-enable on completion |
| No indication of what is being exported | User unsure if getting all papers or just qualified | Show count in button text: "Export 142 results" |
| Export available on in-progress or empty jobs | User exports empty or partial file, confused | Hide export button when `processedPapers === 0`; show warning for partial jobs |
| No format description on selection | User picks wrong format, has to re-export | Brief description under each option (CSV: "spreadsheet compatible", XLSX: "Excel with multiple sheets", JSON: "structured data with full metadata") |

## "Looks Done But Isn't" Checklist

- [ ] **Results query:** Has auth guard AND job ownership check -- verify both paths return null for unauthorized access
- [ ] **CSV headers:** Question text is escaped (commas, quotes, newlines) -- verify with a question containing `"Is it a "good" study?"`
- [ ] **XLSX column types:** Score is number not string -- verify Excel shows numeric sorting, not lexicographic
- [ ] **Partial job export:** Warning shows when job is not `completed` -- verify with `creditsExhausted` status
- [ ] **Empty answers:** `null` answers render as "N/A" not empty string or literal "null" -- verify in all three formats
- [ ] **i18n:** Export dialog strings added to all 6 locale files -- verify no missing translation warnings
- [ ] **ExcelJS import:** Uses dynamic `import()` not static -- verify bundle size unchanged with `next build`
- [ ] **Scoring config:** JSON export includes `scoringConfig`, XLSX has configuration sheet -- verify both present
- [ ] **File download:** `URL.revokeObjectURL()` called after download -- verify no memory leak
- [ ] **Boolean display:** `true`/`false` shown as "Yes"/"No" not "true"/"false" -- verify in CSV and XLSX
- [ ] **Status filter:** Only `completed` results exported, failed/skipped excluded -- verify with mixed-status job
- [ ] **Shared utilities:** No duplicate downloadFile function -- verify reusing `downloadAsFile` from `lib/utils.ts`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Column misalignment from missing answers | LOW | Fix formatter to use `answers?.[key] ?? null`, re-export. No data loss -- results persist in Convex. |
| No results query exists | MEDIUM | Write query with auth guard, deploy, wire up UI. Blocks entire export feature until resolved. |
| Partial data exported without warning | LOW | Add warning banner and status filter, re-export. User may need to re-run analysis. |
| CSV corruption from special characters | LOW | Fix escaping in header generation, re-export. |
| Missing scoring config in export | LOW | Add to export format, re-export. No data migration needed. |
| Bundle size regression from static ExcelJS | MEDIUM | Switch to dynamic import, redeploy. No data changes. |
| Boolean "true"/"false" in export | LOW | Add formatter, re-export. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| No results query (P2) | Phase 1 (data layer) | `getScreeningJobResults` query exists with auth guard and ownership check, tested with convex-test |
| Dynamic column misalignment (P1) | Phase 1 (data layer) | Unit test with partial answers (some questions unanswered) produces correct column count |
| Auth on results query (P2) | Phase 1 (data layer) | convex-test verifying null return for non-owner and unauthenticated users |
| Exporting incomplete jobs (P3) | Phase 2 (export functions) | Status filter test: only `completed` results included; partial job triggers warning |
| CSV special characters (P4) | Phase 2 (export functions) | Unit test with question text containing commas, quotes, and newlines |
| Missing scoring config (P5) | Phase 2 (export functions) | JSON round-trip test includes scoringConfig; XLSX has configuration sheet |
| Boolean formatting (P6) | Phase 2 (export functions) | Formatter test: true->"Yes", false->"No", null->"N/A" |
| ExcelJS static import (P7) | Phase 2 (export functions) | Dynamic import pattern used; bundle size unchanged |
| Shared utilities (P8) | Phase 2 (export functions) | No duplicate downloadFile; uses `downloadAsFile` from lib/utils |
| Missing i18n (P9) | Phase 3 (UI integration) | All 6 locale files updated, no console warnings |
| Filename clarity (P10) | Phase 3 (UI integration) | Filename includes date and paper count |
| Loading state (UX) | Phase 3 (UI integration) | Button disabled during export, spinner shown |

## Sources

- Direct codebase analysis: `convex/schema.ts` (lines 684-770 -- screeningJobs and screeningResults table definitions)
- Existing screening queries: `convex/screening/queries.ts` (no public results-for-job query exists)
- Existing export patterns: `lib/extraction/export.ts` (CSV/JSON/XLSX with dynamic ExcelJS), `lib/library/export.ts` (CSV/JSON via downloadAsFile)
- Export dialog: `components/extraction/export-dialog.tsx` (format selection + options UI pattern)
- Query bounds: `convex/lib/queryBounds.ts` (MAX_SCREENING_PAPERS_PER_JOB = 200)
- Screening types: `lib/types/screening.types.ts` (ScreeningResult interface)
- Job history UI: `components/screening/screening-job-history.tsx` (where export button will be added)

---
*Pitfalls research for: Screening result export (CSV/JSON/XLSX)*
*Researched: 2026-03-09*
