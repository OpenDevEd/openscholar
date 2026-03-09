# Technology Stack: v4.1 Screening Export (CSV/JSON/XLSX)

**Project:** OpenAlex Count
**Researched:** 2026-03-09
**Confidence:** HIGH
**Scope:** Stack additions for exporting screening job results as CSV, JSON, and XLSX from job history. Existing stack (Next.js, Convex, ExcelJS dynamic import, CSV/JSON export utilities, next-intl, shadcn/ui) is validated -- NOT re-researched.

---

## Key Finding: Zero New Dependencies

The existing codebase contains every library and utility needed for screening export. No new packages, no version bumps, no new patterns required. This is a **data-shape adaptation**, not a capability gap.

Two battle-tested export systems already exist:
1. **Extraction export** (`lib/extraction/export.ts`) -- CSV/JSON/XLSX with ExcelJS dynamic import, multi-sheet workbooks, `downloadFile` helper
2. **Library export** (`lib/library/export.ts`) -- CSV/JSON using `jsonToCSV` and `downloadAsFile` from `lib/utils.ts`

The screening export follows the extraction export pattern (dynamic question columns, multi-sheet XLSX) but with a simpler data shape (boolean answers vs mixed types).

---

## Existing Stack to Reuse

### Export Infrastructure (already in codebase)

| Technology | Location | Purpose | Reuse Strategy |
|------------|----------|---------|----------------|
| ExcelJS (dynamic import) | `lib/extraction/export.ts` | XLSX generation with multi-sheet workbooks | Clone `exportToExcel` pattern; adapt columns for screening data shape |
| `downloadFile` helper | `lib/extraction/export.ts` | Browser-side Blob download trigger | Import directly -- generic, format-agnostic |
| `jsonToCSV` | `lib/utils.ts` | Flat object array to CSV string | Use for screening CSV (library export pattern) |
| `downloadAsFile` | `lib/utils.ts` | CSV/JSON download with MIME types | Use for CSV/JSON paths (library export pattern) |
| `formatAnswerForCSV` | `lib/extraction/export.ts` | Type-aware answer formatting | Screening answers are `boolean | null` -- simpler case, but helper handles it |
| `formatAnswerForExcel` | `lib/extraction/export.ts` | Type-aware answer formatting for Excel | Same as above |

### Data Access (already in codebase)

| Technology | Location | Purpose | Reuse Strategy |
|------------|----------|---------|----------------|
| `screeningResults` table | `convex/schema.ts` L732-770 | Per-paper outcomes with answers, score, stars, qualified | Query via `by_job` index, bounded with `MAX_SCREENING_PAPERS_PER_JOB` |
| `screeningJobs` table | `convex/schema.ts` | Job metadata: questions, scoring config | `getScreeningJob` already returns questions and scoringConfig for column headers |
| `by_job` index | `convex/schema.ts` L768 | Index on screeningResults.jobId | Fetch all results for a completed job |

### UI Components (already in codebase)

| Technology | Location | Purpose | Reuse Strategy |
|------------|----------|---------|----------------|
| `screening-job-history.tsx` | `components/screening/` | Job history list with per-job actions | Add export dropdown for completed jobs |
| shadcn/ui DropdownMenu | `components/ui/` | Dropdown for format selection | CSV/JSON/XLSX picker |
| lucide-react | Throughout | Icons | `Download` or `FileDown` icon for export button |
| next-intl | Throughout | i18n (6 locales) | Add screening export keys to translation files |
| sonner toasts | Throughout | User feedback | Toast on export start/completion |

---

## What NOT to Add

| Temptation | Why Not | What to Do Instead |
|------------|---------|-------------------|
| `file-saver` / `FileSaver.js` | `downloadFile` in `lib/extraction/export.ts` already handles Blob downloads | Import existing helper |
| `papaparse` for CSV | `jsonToCSV` in `lib/utils.ts` handles CSV; screening data is flat | Import existing helper |
| `xlsx` / `SheetJS` | ExcelJS already installed with dynamic import and CJS/ESM interop guard | Reuse existing ExcelJS pattern |
| Server-side export (Convex action) | Max 500 papers per job (`MAX_SCREENING_PAPERS_PER_JOB`); client-side generation handles this volume easily | Client-side export like extraction/library |
| Streaming/chunked export | 500 rows is trivially small for in-memory generation | Single-pass export |
| New export component library | Three format-specific functions + one dropdown is all that is needed | Plain functions + shadcn DropdownMenu |
| `react-hot-toast` | Project uses sonner toasts | Use existing toast pattern |

---

## New Code Needed (Not Dependencies)

### 1. Convex Query: `getScreeningResultsForExport`

**Location:** `convex/screening/queries.ts`

New auth-gated query fetching all results for a completed job via `by_job` index with `.take(MAX_SCREENING_PAPERS_PER_JOB)` bound. Returns paper metadata + answers + score + stars + qualified + aiMetadata.

**Why a new query:** `getPendingResults` filters by status=pending and returns subset fields. `getResultInternal` is per-result and internal-only. Export needs all completed results with full answer/scoring data in one auth-gated query.

**Return shape:**
```typescript
v.array(v.object({
  title: v.string(),
  doi: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  publicationYear: v.optional(v.number()),
  openalexId: v.string(),
  status: screeningResultStatusValidator,
  answers: v.optional(v.record(v.string(), v.union(v.boolean(), v.null()))),
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  qualified: v.optional(v.boolean()),
  savedToLibrary: v.optional(v.boolean()),
}))
```

### 2. Export Module: `lib/screening/export.ts`

**Location:** New file following `lib/extraction/export.ts` pattern

Three functions:
- `exportScreeningToCSV(job, results)` -- flat rows with dynamic question columns
- `exportScreeningToJSON(job, results)` -- structured JSON with metadata envelope
- `exportScreeningToExcel(job, results)` -- multi-sheet XLSX (Results sheet + Summary sheet)

**Column structure for all formats:**

| Column Type | Columns |
|------------|---------|
| Paper metadata | Title, DOI, Year, Authors |
| Per-question answers | Dynamic from `job.questions` (Yes/No/N/A per question) |
| Scoring | Score, Stars, Qualified (Yes/No), Saved to Library (Yes/No) |
| Status | Result status (completed/failed/skipped) |

**XLSX-specific:** Two sheets:
1. **Results** -- all rows with all columns above
2. **Summary** -- total papers, qualified count, qualification rate, per-question yes/no/null breakdown

### 3. UI: Export Button in Job History

**Location:** `components/screening/screening-job-history.tsx`

DropdownMenu with 3 format options (CSV, JSON, XLSX), shown only for completed/creditsExhausted jobs. On click: fetch results via `useQuery`, call export function, show toast.

---

## Integration Points

| Integration | How It Connects |
|-------------|-----------------|
| `screening-job-history.tsx` -> export module | Button triggers query for results, then calls format-specific export function |
| Export module -> `lib/extraction/export.ts` | Import `downloadFile` for Blob download trigger |
| Export module -> ExcelJS | Dynamic import with exact same CJS/ESM interop pattern as extraction export |
| Convex query -> `queryBounds.ts` | Import `MAX_SCREENING_PAPERS_PER_JOB` for `.take()` bound |
| i18n -> translation files | Add keys: "Export", "Export as CSV", "Export as JSON", "Export as XLSX", "Exporting..." in 6 locales |

---

## Screening Data Shape (from schema, verified)

```typescript
// screeningResults fields available for export (convex/schema.ts L732-770):
{
  title: string;
  doi?: string;
  authors?: string[];
  publicationYear?: number;
  openalexId: string;
  status: "pending" | "processing" | "completed" | "failed" | "skipped";
  answers?: Record<string, boolean | null>;  // key = question key
  score?: number;
  stars?: number;
  qualified?: boolean;
  aiMetadata?: { reasoning?: string; confidence?: number; model?: string; provider?: string; };
  savedToLibrary?: boolean;
}

// screeningJobs.questions (for dynamic column headers):
Array<{ key: string; question: string; }>

// screeningJobs.scoringConfig (for summary context):
{ rules: ScoringRule[]; starThresholds: StarThreshold[]; minimumScore?: number; }
```

---

## Installation

```bash
# No new packages to install.
# Zero changes to package.json.
```

---

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|------------|-------|
| No new dependencies needed | HIGH | All export utilities verified in codebase: ExcelJS, CSV helpers, download helpers |
| Client-side export sufficient for 500 papers | HIGH | Extraction export handles similar volume client-side; MAX_SCREENING_PAPERS_PER_JOB = 500 |
| ExcelJS dynamic import pattern works | HIGH | Production-proven in `lib/extraction/export.ts` with CJS/ESM interop |
| `by_job` index exists on screeningResults | HIGH | Verified in `convex/schema.ts` line 768 |
| Screening answers are `Record<string, boolean \| null>` | HIGH | Verified in `convex/schema.ts` lines 747-749 |
| `downloadFile` helper is reusable | HIGH | Generic function accepting `string \| Blob` with any MIME type |

---

## Sources

- `lib/extraction/export.ts` -- extraction export (CSV/JSON/XLSX) with ExcelJS dynamic import, `downloadFile`, answer formatters
- `lib/library/export.ts` -- library export (CSV/JSON) using `jsonToCSV` and `downloadAsFile`
- `lib/utils.ts` -- `jsonToCSV` (L144), `downloadAsFile` (L169) utilities
- `convex/schema.ts` L732-770 -- screeningResults table definition with answers, score, stars, qualified fields
- `convex/screening/validators.ts` -- screening type validators (question, scoring config, status)
- `convex/screening/queries.ts` -- existing queries (getScreeningJob, getPendingResults, getResultInternal)
- `convex/lib/queryBounds.ts` -- MAX_SCREENING_PAPERS_PER_JOB bound constant
- `components/screening/screening-job-history.tsx` -- UI integration point for export button

---

*Stack research for: v4.1 Screening Export (CSV/JSON/XLSX)*
*Researched: 2026-03-09*
