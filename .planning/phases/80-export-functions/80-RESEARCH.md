# Phase 80: Export Functions - Research

**Researched:** 2026-03-09
**Domain:** Client-side screening export (CSV, JSON, XLSX) — pure formatting functions
**Confidence:** HIGH

## Summary

Phase 80 builds pure formatting functions that convert the data returned by `getScreeningResultsForExport` (Phase 79) into downloadable CSV, JSON, and XLSX files. The codebase already has two complete export systems to follow: `lib/extraction/export.ts` (extraction results with ExcelJS) and `lib/library/export.ts` (library items with `jsonToCSV`/`downloadAsFile`). ExcelJS v4.4.0 is already installed. All utility functions (`downloadAsFile`, `jsonToCSV`, `escapeCSVValue`, `formatAnswerForCSV`, `formatAnswerForExcel`) are already implemented and tested.

The screening export differs from the extraction export in data shape: screening answers are `Record<string, boolean | null>` (one boolean per question key) vs extraction answers which are `string | number | boolean | string[]` per question. Screening also has score, stars, and qualified columns that extraction does not. The XLSX export needs a Summary sheet with job config (questions, scoring rules, star thresholds) and aggregate statistics (total papers, qualified count, score distribution) — different from the extraction export which summarizes per-question confidence.

**Primary recommendation:** Create `lib/screening/export.ts` with three pure functions (`generateScreeningCSV`, `generateScreeningJSON`, `generateScreeningXLSX`) that take the query return type as input and produce downloadable files. Follow the existing extraction export patterns exactly. Write unit tests in `tests/export-screening.test.ts` using the same vitest patterns as `tests/export-csv-json.test.ts` and `tests/export-exceljs-roundtrip.test.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXP-02 | CSV export with paper metadata, question answer columns, score, stars, qualified | `jsonToCSV` and `downloadAsFile` utilities exist; screening answers are `Record<string, boolean \| null>` mapping to Yes/No/N/A columns; `formatAnswerForCSV` handles boolean->Yes/No |
| EXP-03 | JSON export with structured paper data, answers, scoring, job metadata envelope | Follow `exportToJSON` pattern from extraction export; job metadata available from query return shape |
| EXP-04 | XLSX export with Results + Summary sheets | ExcelJS v4.4.0 installed; dynamic import pattern and round-trip test patterns exist in `lib/extraction/export.ts` and `tests/export-exceljs-roundtrip.test.ts` |
| EXP-05 | Failed/skipped papers with null/N/A fallbacks | Query returns ALL result statuses (Phase 79 decision); format functions must handle `answers: undefined`, `score: undefined`, `stars: undefined`, `qualified: undefined` gracefully |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| exceljs | ^4.4.0 | XLSX workbook generation | Already installed, used by extraction export |
| vitest | (project version) | Unit testing | Project standard test runner |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/utils.ts (jsonToCSV) | local | CSV generation from flat objects | CSV export — handles escaping, headers |
| lib/utils.ts (downloadAsFile) | local | Browser file download trigger | All format downloads |
| lib/utils.ts (escapeCSVValue) | local | CSV field escaping | Used internally by jsonToCSV |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jsonToCSV from utils | Manual CSV building (as in extraction export) | jsonToCSV is simpler for flat row objects; extraction export builds CSV manually because it has dynamic columns. For screening, we need dynamic question columns too, so manual CSV building (like extraction) is better |

**Installation:**
```bash
# No new dependencies needed — exceljs already installed
```

## Architecture Patterns

### Recommended Project Structure
```
lib/screening/
  export.ts              # NEW: generateScreeningCSV, generateScreeningJSON, generateScreeningXLSX
tests/
  export-screening.test.ts  # NEW: Unit tests for all three format functions
```

### Pattern 1: Pure Format Functions (No Download Side Effects)
**What:** Export functions that generate content (string/Blob) and trigger download, separated from data fetching
**When to use:** All client-side exports
**Example (from existing extraction export):**
```typescript
// The function receives already-fetched data, formats it, and downloads
export function exportScreeningToCSV(data: ScreeningExportData): void {
  // 1. Build headers from questions
  // 2. Build rows from results
  // 3. Generate CSV string
  // 4. Trigger download
}
```

### Pattern 2: Dynamic Import for ExcelJS
**What:** Lazy-load ExcelJS (~500KB) only when XLSX export is requested
**When to use:** XLSX export only
**Example (from existing `exportToExcel`):**
```typescript
export async function exportScreeningToExcel(data: ScreeningExportData): Promise<void> {
  const mod = await import('exceljs');
  const ExcelJSModule = 'default' in mod ? (mod as unknown as { default: typeof mod }).default : mod;
  const workbook = new ExcelJSModule.Workbook();
  // ...
}
```

### Pattern 3: Screening Answer Formatting
**What:** Convert `boolean | null | undefined` screening answers to display values
**When to use:** CSV and XLSX answer columns
**Rules:**
- `true` -> "Yes"
- `false` -> "No"
- `null` -> "N/A" (AI explicitly returned null/inconclusive)
- `undefined` (missing answers on failed/skipped) -> "N/A"

**Key difference from extraction:** Screening answers are ONLY boolean. No need for array/number/string formatting. The existing `formatAnswerForCSV`/`formatAnswerForExcel` are designed for extraction's multi-type answers. For screening, a simpler formatter is appropriate.

### Pattern 4: Download with Descriptive Filenames
**What:** Files named with job date and status for easy identification
**When to use:** All exports
**Example:**
```typescript
// Pattern: screening-export-{YYYY-MM-DD}-{status}.{ext}
const date = new Date(data.job.createdAt).toISOString().slice(0, 10);
const filename = `screening-export-${date}-${data.job.status}.csv`;
```

### Anti-Patterns to Avoid
- **Fetching data inside export functions:** Export functions receive data as input; the query call happens in the UI layer (Phase 81)
- **Using jsonToCSV for screening CSV:** The screening CSV needs dynamic question columns in a specific order (paper metadata, then question columns, then scoring columns). Manual CSV building (like extraction export) gives better column control
- **Forgetting BOM for CSV:** `downloadAsFile` already adds BOM for Excel compatibility, but if using the extraction pattern's `downloadFile`, add BOM manually
- **Treating null and undefined answers the same in JSON:** In JSON export, preserve the distinction: `null` means "AI answered inconclusive", `undefined`/missing means "not processed"

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV escaping | Custom escape function | `escapeCSVValue` from `lib/utils.ts` | Handles quotes, commas, newlines correctly |
| File download trigger | Custom download logic | `downloadFile` from `lib/extraction/export.ts` or `downloadAsFile` from `lib/utils.ts` | Both handle Blob creation, link click, cleanup |
| XLSX generation | Custom binary format | ExcelJS (already installed) | XLSX is a complex ZIP-based format |
| CSV BOM handling | Manual BOM insertion | `downloadAsFile` handles it automatically | Excel requires BOM for UTF-8 CSV |

## Common Pitfalls

### Pitfall 1: Crashing on Failed/Skipped Results with Missing Answers
**What goes wrong:** Accessing `result.answers[questionKey]` when `answers` is `undefined` throws TypeError
**Why it happens:** Failed/skipped results have no `answers` field (it is `v.optional`)
**How to avoid:** Always check `result.answers` existence before accessing keys: `result.answers?.[questionKey] ?? null`
**Warning signs:** No test case for results with `status: "failed"` and `answers: undefined`

### Pitfall 2: Question Column Order Mismatch
**What goes wrong:** CSV headers list questions in different order than data cells
**Why it happens:** Using `Object.keys(result.answers)` instead of `job.questions` array for column ordering
**How to avoid:** Always derive question columns from `job.questions` array (which has a stable order), not from individual result answer keys
**Warning signs:** Questions appearing in different order between header row and data rows

### Pitfall 3: Missing Scoring Columns for Incomplete Results
**What goes wrong:** Score/stars/qualified are `undefined` for failed/skipped results, causing empty cells or crashes
**Why it happens:** Only completed results have score/stars/qualified populated
**How to avoid:** Default to empty string (CSV/XLSX) or explicit null (JSON) for missing scoring fields
**Warning signs:** Export crashes when a job has any failed results

### Pitfall 4: ExcelJS Default Import Issue
**What goes wrong:** `new ExcelJS.Workbook()` fails because the module has a default export wrapper
**Why it happens:** ESM/CJS interop issue with ExcelJS
**How to avoid:** Use the exact pattern from the existing codebase: `const ExcelJSModule = 'default' in mod ? (mod as unknown as { default: typeof mod }).default : mod;`
**Warning signs:** "ExcelJS.Workbook is not a constructor" error

### Pitfall 5: XLSX Summary Sheet Missing Job Config Details
**What goes wrong:** Summary sheet only has aggregate counts but not the scoring rules and star thresholds the user configured
**Why it happens:** Developer forgets that the summary should include job configuration, not just statistics
**How to avoid:** Requirements say "Summary sheet with job config, scoring rules, and aggregate statistics" -- include all three sections
**Warning signs:** Summary sheet has statistics but no scoring rules or star thresholds

## Code Examples

### Screening Export Data Type
```typescript
// Source: Derived from getScreeningResultsForExport return type (convex/screening/queries.ts)
export interface ScreeningExportData {
  job: {
    _id: string;
    status: string;
    questions: Array<{ key: string; question: string }>;
    scoringConfig: {
      rules: Array<{
        questionKey: string;
        yesPoints: number;
        noPoints: number;
        nullPoints: number;
      }>;
      starThresholds: Array<{
        minScore: number;
        maxScore: number;
        stars: number;
      }>;
      minimumScore?: number;
    };
    totalPapers: number;
    qualifiedPapers: number;
    createdAt: number;
    completedAt?: number;
  };
  results: Array<{
    openalexId: string;
    title: string;
    authors?: string[];
    publicationYear?: number;
    doi?: string;
    status: string;
    answers?: Record<string, boolean | null>;
    score?: number;
    stars?: number;
    qualified?: boolean;
  }>;
}
```

### CSV Export Pattern
```typescript
// Source: Adapted from lib/extraction/export.ts exportToCSV pattern
export function exportScreeningToCSV(data: ScreeningExportData): void {
  const { job, results } = data;

  // Fixed columns
  const headers: string[] = ['Title', 'Authors', 'Year', 'DOI', 'OpenAlex ID'];

  // Dynamic question columns from job config (stable order)
  job.questions.forEach(q => {
    headers.push(q.question);
  });

  // Scoring columns
  headers.push('Score', 'Stars', 'Qualified', 'Status');

  // Build rows
  const rows = results.map(result => {
    const row: string[] = [
      result.title,
      result.authors?.join('; ') ?? '',
      result.publicationYear?.toString() ?? '',
      result.doi ?? '',
      result.openalexId,
    ];

    // Question answers
    job.questions.forEach(q => {
      const answer = result.answers?.[q.key];
      if (answer === true) row.push('Yes');
      else if (answer === false) row.push('No');
      else row.push('N/A');
    });

    // Scoring
    row.push(
      result.score !== undefined ? result.score.toString() : '',
      result.stars !== undefined ? result.stars.toString() : '',
      result.qualified !== undefined ? (result.qualified ? 'Yes' : 'No') : '',
      result.status
    );

    return row;
  });

  // Build CSV with proper escaping
  const csv = [headers, ...rows]
    .map(row => row.map(cell => {
      const str = String(cell);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str === '') {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','))
    .join('\n');

  const date = new Date(job.createdAt).toISOString().slice(0, 10);
  downloadFile(csv, `screening-export-${date}-${job.status}.csv`, 'text/csv');
}
```

### JSON Export Pattern
```typescript
// Source: Adapted from lib/extraction/export.ts exportToJSON pattern
export function exportScreeningToJSON(data: ScreeningExportData): void {
  const { job, results } = data;

  const envelope = {
    exportedAt: new Date().toISOString(),
    job: {
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
      totalPapers: job.totalPapers,
      qualifiedPapers: job.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
    },
    results: results.map(r => ({
      openalexId: r.openalexId,
      title: r.title,
      authors: r.authors ?? [],
      publicationYear: r.publicationYear ?? null,
      doi: r.doi ?? null,
      status: r.status,
      answers: r.answers ?? null,
      score: r.score ?? null,
      stars: r.stars ?? null,
      qualified: r.qualified ?? null,
    })),
  };

  const json = JSON.stringify(envelope, null, 2);
  const date = new Date(job.createdAt).toISOString().slice(0, 10);
  downloadFile(json, `screening-export-${date}-${job.status}.json`, 'application/json');
}
```

### XLSX Summary Sheet Content
```typescript
// Source: Requirement EXP-04 specifies: job config, scoring rules, aggregate statistics
// Summary sheet sections:
// 1. Job Info: status, date created, date completed, total papers, qualified papers
// 2. Questions: list of screening questions
// 3. Scoring Rules: per-question yes/no/null points
// 4. Star Thresholds: minScore/maxScore/stars for each tier
// 5. Statistics: qualified rate, average score, score distribution
```

## State of the Art

No changes needed. This phase uses only existing project patterns and ExcelJS v4.4.0.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | ExcelJS dynamic import for XLSX | Established in extraction export (v2.0) | Same pattern reused |
| N/A | Manual CSV with escaping | Established in extraction export (v2.0) | Same pattern reused |

## Open Questions

1. **Whether to use `downloadAsFile` (utils) or `downloadFile` (extraction export) for triggering download**
   - What we know: Both exist, slightly different APIs. `downloadAsFile` adds BOM for CSV. `downloadFile` from extraction takes content/Blob.
   - What's unclear: Which is the "canonical" one going forward
   - Recommendation: Use `downloadFile` from extraction export (handles both string and Blob), but add BOM for CSV manually. Or better: create the screening export's own inline download helper to avoid cross-module coupling.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/export-screening.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXP-02a | CSV has correct headers (metadata + question columns + scoring) | unit | `npx vitest run tests/export-screening.test.ts -t "CSV headers"` | Needs creation |
| EXP-02b | CSV rows have Yes/No/N/A for boolean answers | unit | `npx vitest run tests/export-screening.test.ts -t "CSV answers"` | Needs creation |
| EXP-02c | CSV includes score, stars, qualified columns | unit | `npx vitest run tests/export-screening.test.ts -t "CSV scoring"` | Needs creation |
| EXP-03a | JSON envelope has job metadata and results array | unit | `npx vitest run tests/export-screening.test.ts -t "JSON envelope"` | Needs creation |
| EXP-03b | JSON results have structured answers object | unit | `npx vitest run tests/export-screening.test.ts -t "JSON answers"` | Needs creation |
| EXP-04a | XLSX Results sheet has all data columns | unit | `npx vitest run tests/export-screening.test.ts -t "XLSX Results"` | Needs creation |
| EXP-04b | XLSX Summary sheet has job config and statistics | unit | `npx vitest run tests/export-screening.test.ts -t "XLSX Summary"` | Needs creation |
| EXP-05a | CSV handles failed/skipped results with N/A fallbacks | unit | `npx vitest run tests/export-screening.test.ts -t "failed results CSV"` | Needs creation |
| EXP-05b | JSON handles failed/skipped results with null fallbacks | unit | `npx vitest run tests/export-screening.test.ts -t "failed results JSON"` | Needs creation |
| EXP-05c | XLSX handles failed/skipped results without crashing | unit | `npx vitest run tests/export-screening.test.ts -t "failed results XLSX"` | Needs creation |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/export-screening.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `tests/export-screening.test.ts` -- new file covering EXP-02 through EXP-05
- [ ] `lib/screening/export.ts` -- new file with three export functions

No framework install needed -- vitest and exceljs already configured.

## Sources

### Primary (HIGH confidence)
- `lib/extraction/export.ts` -- existing CSV, JSON, XLSX export patterns with ExcelJS
- `lib/library/export.ts` -- existing library CSV/JSON export patterns
- `lib/utils.ts` -- `jsonToCSV`, `downloadAsFile`, `escapeCSVValue` utilities
- `tests/export-exceljs-roundtrip.test.ts` -- ExcelJS round-trip test pattern
- `tests/export-csv-json.test.ts` -- CSV utility test pattern
- `tests/export-answer-formatters.test.ts` -- answer formatting test pattern
- `convex/screening/queries.ts:190-250` -- `getScreeningResultsForExport` return shape
- `convex/screening/validators.ts` -- screening question and scoring config validators
- `convex/schema.ts:684-770` -- screeningJobs and screeningResults table schemas
- `package.json` -- exceljs ^4.4.0 already installed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed, no new dependencies
- Architecture: HIGH -- exact export patterns exist for extraction and library; screening adapts them
- Pitfalls: HIGH -- based on direct code reading and data shape analysis of the screening schema

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- only internal patterns, no external dependency changes)
