# Project Research Summary

**Project:** OpenAlex Count — v4.1 Screening Export
**Domain:** Academic screening result export (CSV/JSON/XLSX)
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

The v4.1 screening export feature is a straightforward data-shape adaptation with zero new dependencies. The codebase already contains every library and utility needed: ExcelJS with dynamic import for XLSX, CSV helpers, download utilities, and a well-indexed screening data model. The existing extraction export (`lib/extraction/export.ts`) and library export (`lib/library/export.ts`) provide battle-tested patterns to follow. This is not a capability gap -- it is a matter of wiring existing infrastructure to a new data shape (screening results with boolean answers, scores, and qualification status).

The recommended approach is a three-step serial build: (1) a new auth-gated Convex query to fetch all results for a completed screening job, (2) three pure export functions (CSV/JSON/XLSX) in a new `lib/screening/export.ts` module, and (3) an export dropdown button integrated into the existing job history component. Each step has a clear dependency on the previous one, and all follow established patterns in the codebase. The total scope is one new query, one new module with three functions, and modifications to one UI component plus i18n files.

The key risks are data integrity issues from dynamic question columns (user-authored questions become CSV/XLSX headers that need escaping) and silent partial exports from incomplete jobs. Both are preventable with explicit null-fallback answer mapping and status-aware UI gating. The bounded dataset (max 200 papers per job) eliminates all scalability concerns for client-side file generation.

## Key Findings

### Recommended Stack

No new packages. Zero changes to `package.json`. Every required capability already exists in the codebase.

**Core technologies (all existing):**
- **ExcelJS (dynamic import):** XLSX generation with multi-sheet workbooks -- production-proven pattern in `lib/extraction/export.ts`
- **`jsonToCSV` / `downloadAsFile`:** CSV generation and browser download -- existing utilities in `lib/utils.ts`
- **Convex `by_job` index:** Efficient query for all screening results by job ID -- already defined in schema
- **shadcn/ui DropdownMenu:** Format selection UI -- consistent with existing component library

### Expected Features

**Must have (table stakes):**
- CSV export with paper metadata + per-question answer columns + score/stars/qualified
- JSON export with structured data and job metadata envelope
- XLSX export with Results sheet and Summary/Config sheets
- Export button on completed job cards in screening job history
- Per-question dynamic columns derived from `job.questions` array
- Score, star rating, and qualified status columns

**Should have (differentiators):**
- AI reasoning and confidence columns (optional toggle)
- Export dialog with format selection and AI metadata checkbox
- Export from partial/cancelled jobs with visible warning and paper count
- Scoring configuration sheet in XLSX for methodology documentation
- Descriptive filenames including date and paper count

**Defer (v2+):**
- XLSX abstract column toggle
- Bulk multi-job export
- PDF export
- Custom column picker UI
- Re-export with different scoring rules

### Architecture Approach

Client-side data assembly and file generation, matching both existing export systems. A single new Convex query fetches job metadata and results in one call. Pure export functions transform the data into the selected format. The browser triggers the download via Blob URL. No server-side file generation, no temporary storage, no cleanup.

**Major components:**
1. **`getScreeningResultsForExport` query** (Convex) -- auth-gated query returning job metadata + all results via `by_job` index, bounded by `MAX_SCREENING_PAPERS_PER_JOB`
2. **`lib/screening/export.ts`** (client) -- three pure functions (`exportScreeningToCSV`, `exportScreeningToJSON`, `exportScreeningToExcel`) with a common `ScreeningExportData` interface
3. **Export dropdown in `screening-job-history.tsx`** (UI) -- format picker on completed job cards using `convex.query()` for one-shot fetch (not reactive subscription)

### Critical Pitfalls

1. **Dynamic question column misalignment** -- Always iterate `job.questions` for column headers, use `result.answers?.[q.key] ?? null` with explicit null fallback. Never iterate over `result.answers` keys directly.
2. **No existing query for batch results** -- Must create `getScreeningResultsForExport` before any export logic. Existing queries are either internal-only, single-result, or pending-filtered.
3. **Silent partial exports** -- Only enable export on completed jobs. For cancelled/creditsExhausted jobs, show warning with paper count. Filter to `status === "completed"` results only.
4. **CSV header corruption from user-authored questions** -- Apply CSV escaping (quote-wrapping, internal quote doubling) to header cells, not just data cells. Truncate long question text for XLSX headers.
5. **Boolean "true"/"false" instead of "Yes"/"No"** -- Create dedicated `formatScreeningAnswer()` returning "Yes"/"No"/"N/A". Do not rely on `String(answer)`.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Data Layer (Backend Query)
**Rationale:** Everything depends on being able to fetch screening results. No export function or UI can be built or tested without this query.
**Delivers:** Auth-gated `getScreeningResultsForExport` Convex query returning job metadata + all results.
**Addresses:** Table stakes data access; returns questions array for dynamic columns, scoring config for XLSX config sheet, all result fields for export.
**Avoids:** Pitfall 2 (no query exists), Pitfall 1 (column misalignment -- query returns structured data with questions for column derivation), auth/ownership security issues.
**Verification:** Deploy and test with `npx convex run`; write convex-test cases for auth, ownership, bounded results, and partial job handling.

### Phase 2: Export Functions + Tests
**Rationale:** Pure functions with no UI dependency. Can be fully unit-tested with mock data. Must be correct before UI wiring.
**Delivers:** `lib/screening/export.ts` with CSV, JSON, and XLSX export functions; `lib/screening/__tests__/export.test.ts` with comprehensive tests.
**Uses:** ExcelJS dynamic import pattern, `downloadAsFile` from `lib/utils.ts`, `jsonToCSV` from `lib/utils.ts`.
**Implements:** All three format generators with dynamic question columns, answer formatting, status filtering, scoring config inclusion.
**Avoids:** Pitfall 4 (CSV header escaping), Pitfall 5 (missing scoring config), Pitfall 6 (boolean formatting), Pitfall 7 (static ExcelJS import), Pitfall 8 (duplicate download utility -- use existing `downloadAsFile`).

### Phase 3: UI Integration
**Rationale:** Depends on both query (Phase 1) and export functions (Phase 2). Final wiring layer.
**Delivers:** Export dropdown button on completed job cards in `screening-job-history.tsx`, i18n strings for 6 locales, loading states, descriptive filenames.
**Avoids:** Pitfall 3 (export on in-progress jobs -- button hidden/disabled), Pitfall 9 (missing i18n), Pitfall 10 (unclear filenames), UX pitfalls (no loading state, no paper count).
**Key pattern:** Use `useConvex()` + `convex.query()` for one-shot fetch, NOT `useQuery` reactive subscription.

### Phase Ordering Rationale

- **Serial dependency chain:** Query -> Export functions -> UI. Each phase produces the input for the next. No parallelism possible.
- **Testability gradient:** Phase 1 testable via `npx convex run` and convex-test. Phase 2 testable with pure unit tests (no browser, no Convex). Phase 3 requires manual testing with real data.
- **Risk front-loading:** The only genuinely new code (the Convex query) ships first and can be validated independently. Phases 2 and 3 follow established patterns with high confidence.

### Research Flags

Phases with standard patterns (skip phase research):
- **Phase 1:** Query follows exact same pattern as `getScreeningJob` -- auth, ownership, index query, bounded take. No research needed.
- **Phase 2:** Export functions follow extraction export patterns. ExcelJS dynamic import is copy-paste. CSV/JSON generation uses existing utilities. No research needed.
- **Phase 3:** UI follows existing dropdown and dialog patterns in the codebase. No research needed.

No phases need deeper research. This is a well-understood feature with complete codebase precedent.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies; every utility verified in codebase with exact file locations and line numbers |
| Features | HIGH | Feature set derived from existing export patterns and screening data model; clear table stakes vs differentiators |
| Architecture | HIGH | Direct adaptation of proven extraction export architecture; same data flow, simpler data shape |
| Pitfalls | HIGH | All pitfalls identified from direct codebase analysis of existing export code and screening schema |

**Overall confidence:** HIGH

### Gaps to Address

- **`downloadFile` vs `downloadAsFile` decision:** Architecture suggests duplicating `downloadFile`, Pitfalls recommends reusing `downloadAsFile` from `lib/utils.ts`. Recommendation: use `downloadAsFile` from `lib/utils.ts` to avoid a third copy. Validate during Phase 2 that it handles Blob inputs for XLSX.
- **MAX_SCREENING_PAPERS_PER_JOB value discrepancy:** STACK.md references 500, ARCHITECTURE.md and PITFALLS.md reference 200. Verify actual value in `convex/lib/queryBounds.ts` during Phase 1. Either value is trivially small for client-side export.
- **AI metadata opt-in UX:** Features research suggests a dialog with checkboxes; Architecture suggests a simpler dropdown without dialog. Recommendation: start with dropdown-only (CSV/JSON/XLSX) for MVP, add dialog with AI metadata toggle as a fast follow if user feedback demands it.

## Sources

### Primary (HIGH confidence -- direct codebase analysis)
- `lib/extraction/export.ts` -- CSV/JSON/XLSX export patterns, ExcelJS dynamic import, downloadFile utility
- `lib/library/export.ts` -- CSV/JSON export via downloadAsFile
- `lib/utils.ts` -- jsonToCSV, downloadAsFile utilities
- `convex/schema.ts` L684-770 -- screeningJobs and screeningResults table definitions
- `convex/screening/queries.ts` -- existing query patterns, auth guards, user isolation
- `convex/lib/queryBounds.ts` -- MAX_SCREENING_PAPERS_PER_JOB bound
- `components/screening/screening-job-history.tsx` -- UI integration point
- `components/extraction/export-dialog.tsx` -- export dialog pattern reference

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
