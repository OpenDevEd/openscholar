# Architecture Patterns: Screening Export (v4.1)

**Domain:** Screening result export (CSV/JSON/XLSX download from screening job history)
**Researched:** 2026-03-09
**Confidence:** HIGH (direct codebase analysis, follows established export patterns)

## Recommended Architecture

Screening export follows a **client-side data assembly + client-side file generation** pattern, consistent with existing extraction export (`lib/extraction/export.ts`) and library export (`lib/library/export.ts`). No new backend endpoints or tables needed -- the data already exists in `screeningResults` and `screeningJobs` tables and can be fetched via a new query.

### Data Flow

```
User clicks "Export" on completed job card in ScreeningJobHistory
  -> DropdownMenu shows CSV / JSON / XLSX options
  -> User selects format
  -> Component calls Convex query: getScreeningResultsForExport(jobId)
  -> Query returns job metadata + all completed results (bounded by MAX_SCREENING_PAPERS_PER_JOB = 200)
  -> Client-side export function transforms data into selected format
  -> Browser triggers download via Blob + URL.createObjectURL (existing downloadFile pattern)
```

### Component Boundaries

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| `convex/screening/queries.ts` | New `getScreeningResultsForExport` query | Convex DB | **NEW query in existing file** |
| `lib/screening/export.ts` | Format screening data into CSV/JSON/XLSX | downloadFile helper, ExcelJS | **NEW file** |
| `lib/screening/__tests__/export.test.ts` | Unit tests for export functions | export module | **NEW file** |
| `components/screening/screening-job-history.tsx` | Add export dropdown button per completed job | export functions, query | **MODIFY existing** |
| i18n message files (6 locales) | Export button labels and format names | -- | **MODIFY existing** |

### No Changes Needed

| File | Why Not |
|------|---------|
| `convex/schema.ts` | No new tables or indexes -- `by_job` index on screeningResults already exists |
| `convex/screening/validators.ts` | Existing validators cover all export data shapes |
| `convex/lib/queryBounds.ts` | `MAX_SCREENING_PAPERS_PER_JOB` already exists (200) |
| `lib/extraction/export.ts` | Screening export is independent -- different data shapes |
| `lib/library/export.ts` | No shared code needed |

## New Components Detail

### 1. Backend Query: `getScreeningResultsForExport`

**File:** `convex/screening/queries.ts` (add to existing file)

**Why a new query instead of reusing existing queries:**
- `getPendingResults` is internalQuery (no auth) and only returns pending results
- `getResultInternal` returns single results
- Export needs ALL completed results for a job with full answer/score/metadata data

**Return shape:**
```typescript
export const getScreeningResultsForExport = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        status: screeningJobStatusValidator,
        questions: v.array(screeningQuestionValidator),
        scoringConfig: screeningScoringConfigValidator,
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
        totalPapers: v.number(),
        qualifiedPapers: v.number(),
      }),
      results: v.array(v.object({
        openalexId: v.string(),
        title: v.string(),
        authors: v.optional(v.array(v.string())),
        publicationYear: v.optional(v.number()),
        doi: v.optional(v.string()),
        status: screeningResultStatusValidator,
        answers: v.optional(
          v.record(v.string(), v.union(v.boolean(), v.null()))
        ),
        score: v.optional(v.number()),
        stars: v.optional(v.number()),
        qualified: v.optional(v.boolean()),
        aiMetadata: v.optional(v.object({
          reasoning: v.optional(v.string()),
          confidence: v.optional(v.number()),
          model: v.optional(v.string()),
        })),
      })),
    })
  ),
  handler: async (ctx, args) => {
    // 1. getCurrentUser() -- auth check
    // 2. ctx.db.get(args.jobId) -- verify job exists and belongs to user
    // 3. ctx.db.query("screeningResults")
    //      .withIndex("by_job", q => q.eq("jobId", args.jobId))
    //      .take(MAX_SCREENING_PAPERS_PER_JOB)
    // 4. Return { job: { ...metadata }, results: [...] }
  },
});
```

**Key decisions:**
- Returns job metadata alongside results (questions needed to label answer columns, scoring config provides context)
- Uses existing `by_job` index on screeningResults
- Bounded by `MAX_SCREENING_PAPERS_PER_JOB` (200) -- naturally safe since jobs cap at 200 papers
- Auth-gated via `getCurrentUser` + `job.userId === user._id` (same pattern as `getScreeningJob`)
- Returns null for non-existent/unauthorized jobs (no information leak)

### 2. Client Export Module: `lib/screening/export.ts`

**NEW file** following the pattern from `lib/extraction/export.ts`.

Three export functions with a common data interface:

```typescript
interface ScreeningExportData {
  job: { questions, scoringConfig, createdAt, completedAt, totalPapers, qualifiedPapers };
  results: Array<{ title, doi, authors, publicationYear, status, answers, score, stars, qualified, aiMetadata }>;
}

export function exportScreeningToCSV(data: ScreeningExportData): void;
export function exportScreeningToJSON(data: ScreeningExportData): void;
export async function exportScreeningToExcel(data: ScreeningExportData): Promise<void>;
```

**CSV/XLSX column structure:**

| Column | Source |
|--------|--------|
| Title | `result.title` |
| DOI | `result.doi` |
| Year | `result.publicationYear` |
| Authors | `result.authors?.join("; ")` |
| Status | `result.status` |
| Q1: [question text] | `result.answers?.[q.key]` -> Yes / No / N/A |
| Q2: [question text] | (dynamic columns per question) |
| Score | `result.score` |
| Stars | `result.stars` |
| Qualified | `result.qualified` -> Yes / No |
| AI Confidence | `result.aiMetadata?.confidence` |
| AI Reasoning | `result.aiMetadata?.reasoning` (JSON only, or XLSX optional column) |

**XLSX multi-sheet structure (matching extraction export pattern):**
- Sheet 1: "Results" -- all paper results with dynamic question answer columns
- Sheet 2: "Questions" -- question key, question text
- Sheet 3: "Summary" -- job-level stats (total papers, qualified, scoring config, date range)

**Key implementation details:**
- `downloadFile` helper: Duplicate the 6-line function from `lib/extraction/export.ts` rather than extracting to shared module. Both are leaf modules with no shared callers -- coupling them creates false dependencies.
- ExcelJS dynamic import: Copy exact CJS/ESM interop guard from extraction export (`'default' in mod` pattern).
- Answer formatting: Screening answers are simpler than extraction answers (boolean | null vs arrays/numbers). Write screening-specific formatters: `true` -> "Yes", `false` -> "No", `null/undefined` -> "N/A".

### 3. UI Changes: Export Button in Job History

**File:** `components/screening/screening-job-history.tsx` (modify existing)

**Where:** Add an export dropdown button to each completed job card, in the header row next to the date. Only render for jobs with `status === "completed"`.

**Implementation approach:**
- Use `DropdownMenu` (existing shadcn component) with three items: CSV, JSON, XLSX
- `onClick` on dropdown item fetches data and triggers download
- Add loading state while fetching (replace dropdown trigger icon with Loader2 spinner)
- Use `e.stopPropagation()` on the dropdown trigger to prevent card click (job selection) -- already patterned in the accordion section of this component

**Data fetching strategy -- on-demand fetch, not reactive subscription:**
- Do NOT pre-fetch export data for all visible jobs (wasteful -- most jobs won't be exported)
- Do NOT use `useQuery` (creates persistent subscription for a one-shot download)
- Use `fetchQuery` from `convex/react` for one-shot data fetch on click
- When data arrives, call the appropriate export function, then clear loading state

```typescript
// Simplified flow in the component:
const convex = useConvex();

async function handleExport(jobId: Id<"screeningJobs">, format: "csv" | "json" | "xlsx") {
  setExportingJobId(jobId);
  try {
    const data = await convex.query(api.screening.queries.getScreeningResultsForExport, { jobId });
    if (!data) return; // job not found or unauthorized
    if (format === "csv") exportScreeningToCSV(data);
    else if (format === "json") exportScreeningToJSON(data);
    else await exportScreeningToExcel(data);
  } finally {
    setExportingJobId(null);
  }
}
```

## Patterns to Follow

### Pattern 1: Client-Side File Generation
**What:** Generate files entirely in the browser using data fetched from Convex queries.
**When:** Export data fits comfortably in memory. Screening jobs cap at 200 papers -- well under any limit.
**Why:** No server-side file generation needed. No temporary file storage. No cleanup. Instant download. Proven pattern in this codebase (extraction export, library export).

### Pattern 2: Dynamic ExcelJS Import
**What:** `await import('exceljs')` at call time, not at module load.
**When:** XLSX export specifically.
**Why:** Keeps ~500KB out of initial bundle. Already proven in `lib/extraction/export.ts`.
```typescript
const mod = await import('exceljs');
const ExcelJSModule = 'default' in mod ? (mod as unknown as { default: typeof mod }).default : mod;
const workbook = new ExcelJSModule.Workbook();
```

### Pattern 3: Auth-Gated Query with User Isolation
**What:** Every query checks `getCurrentUser()` and verifies `job.userId === user._id` before returning data.
**When:** Any user-facing query returning job-specific data.
**Why:** Prevents data leaks between users. Returns null (not error) for unauthorized access -- same pattern as all existing screening queries.

### Pattern 4: Bounded Results with Shared Constants
**What:** Use `.take(MAX_SCREENING_PAPERS_PER_JOB)` on result queries.
**When:** Loading all results for a job.
**Why:** Defense-in-depth even though jobs are capped at creation time. Matches codebase convention from `queryBounds.ts`.

### Pattern 5: Pure Export Functions (No Side Effects Beyond Download)
**What:** Export functions take data in, trigger browser download, return void.
**When:** All export implementations.
**Why:** Fully testable without Convex, browser APIs, or network. Tests can verify CSV string output, JSON structure, and XLSX workbook contents.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared Export Utilities Across Domains
**What:** Extracting `downloadFile` or formatters into a shared `lib/export/` module.
**Why bad:** Creates coupling between extraction and screening -- they evolve independently. Extraction answers are complex (arrays, numbers, confidence per question). Screening answers are simple booleans. A shared abstraction would be lowest-common-denominator.
**Instead:** Each domain owns its export module. Duplicating the 6-line `downloadFile` helper is acceptable.

### Anti-Pattern 2: Server-Side File Generation via Convex Action
**What:** Generating CSV/XLSX on the Convex action layer and returning as base64 or storing in file storage.
**Why bad:** Unnecessary complexity for 200-row exports. Convex actions have timeout limits. File storage adds cleanup concerns. All existing exports are client-side.
**Instead:** Client-side generation. Only consider server-side if exports grow to thousands of rows (not the case here).

### Anti-Pattern 3: Pre-fetching Export Data for All Jobs
**What:** Loading all screening results for every visible job in the history list.
**Why bad:** Most jobs won't be exported. Loading 200 results x 10 jobs = 2,000 documents for no reason.
**Instead:** Fetch on-demand when user clicks export.

### Anti-Pattern 4: Reactive Subscription for One-Shot Export
**What:** Using `useQuery` that stays subscribed after download completes.
**Why bad:** Wastes bandwidth on result updates after download is done. Export is a one-shot action.
**Instead:** Use `convex.query()` (via `useConvex()` hook) for one-shot fetch.

## Build Order (Dependency-Aware)

Build in this order to respect dependencies:

### Step 1: Backend Query
**File:** `convex/screening/queries.ts` -- add `getScreeningResultsForExport`
- Zero dependencies on new client code
- Can be verified via `npx convex run` after deploy
- Deploy independently before client code

### Step 2: Export Functions + Tests
**Files:** `lib/screening/export.ts` + `lib/screening/__tests__/export.test.ts`
- Depends on the TypeScript return type shape from step 1 (compile-time only, not runtime)
- Pure functions -- fully unit-testable without Convex or browser
- TDD: write tests first, then implement
- Test CSV string output, JSON structure, ExcelJS workbook contents

### Step 3: UI Integration
**Files:** `components/screening/screening-job-history.tsx` + i18n message files (6 locales)
- Depends on both the query (step 1) and export functions (step 2)
- Add export dropdown with format picker
- Add i18n strings: export button label, format names (CSV, JSON, Excel), loading state
- Manual testing with real completed screening job data

## Scalability Considerations

| Concern | At 200 papers (current max) | At 1,000 papers (future) | At 10,000 papers |
|---------|---------------------------|-------------------------|------------------|
| Query performance | Instant via by_job index | Fast, still in-memory | Consider pagination |
| Client memory | ~50KB JSON | ~250KB JSON | Consider chunked/streaming |
| XLSX generation | <1s | ~2-3s | Consider Web Worker |
| Download size | ~20KB CSV | ~100KB CSV | Still fine for browser |

Current `MAX_SCREENING_PAPERS_PER_JOB = 200` means all scalability concerns are non-issues for v4.1.

## Sources

- `lib/extraction/export.ts` -- extraction export pattern (CSV/JSON/XLSX with ExcelJS dynamic import)
- `lib/library/export.ts` -- library export pattern (CSV/JSON via downloadAsFile)
- `convex/screening/queries.ts` -- existing screening query patterns and auth gates
- `convex/schema.ts` lines 732-770 -- screeningResults table schema with by_job index
- `convex/schema.ts` lines 684-727 -- screeningJobs table schema
- `convex/screening/validators.ts` -- all screening validators
- `convex/lib/queryBounds.ts` -- MAX_SCREENING_PAPERS_PER_JOB = 200
- `components/screening/screening-job-history.tsx` -- existing job history UI component
- `components/screening/screening-jobs-dialog.tsx` -- dialog wrapper for job history
