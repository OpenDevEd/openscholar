# Phase 88: Scorched-Earth Teardown - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete all legacy extraction code, schema tables, UI surfaces, i18n keys, and the RAG component so the repo compiles cleanly against an empty extraction namespace. This is purely destructive — no new code is written, no migration logic, no backward compat. The only "new" work is fixing dangling imports and dead exports that surface after deletion.

</domain>

<decisions>
## Implementation Decisions

### Deletion Order
- **D-01:** Schema-last approach — remove consumers before providers to avoid intermediate tsc breaks. Order: UI routes/pages → components → lib helpers → convex functions → schema tables → convex.config.ts component removal → package.json uninstalls.
- **D-02:** Each deletion layer should compile cleanly before moving to the next. Plan should be structured as sequential layers, not one monolithic delete.

### Screening Pipeline Boundaries
- **D-03:** Remove ONLY `pdfProcessingPool` from `convex/workpool.ts`. Keep `screeningPool` intact — it powers the working v4.0 bulk screening feature and is NOT part of the legacy extraction pipeline.
- **D-04:** TEAR-05's "remove pdfProcessingPool and screeningPool workpool registrations in favor of new slim workpool setup" should be interpreted as: `pdfProcessingPool` is the legacy extraction pool being replaced by the new `extractionPool` (Phase 89). `screeningPool` serves screening (v4.0), not extraction — preserve it. If TEAR-05 truly intends to remove screeningPool, that should be deferred to Phase 89 when the new extractionPool is registered as a replacement.
- **D-05:** All `convex/screening/` code stays untouched. Only `convex/extraction/` is deleted.

### Shared Dependencies
- **D-06:** Surgical removal of extraction-only content from shared files. Delete extraction-only files wholesale. Strip extraction imports/exports from shared files. Leave non-extraction functionality intact.
- **D-07:** `lib/store.ts` — remove the extraction store slice and any extraction-related types/actions. Keep all other slices (search, history, UI, focus, keywords, AI config, sidebar).
- **D-08:** `lib/types/extraction.types.ts` — delete entirely (extraction types are gone).
- **D-09:** `lib/types/index.ts` — remove extraction re-exports, keep all others.
- **D-10:** `lib/pdf/download.ts` — evaluate at deletion time. If it serves ONLY extraction, delete. If shared with screening or other features, strip extraction-only helpers and keep the rest.
- **D-11:** `convex/crons.ts` — remove any extraction-related scheduled jobs. Keep screening, maintenance, billing, and env validation crons.
- **D-12:** `convex/http.ts` — remove any extraction-related HTTP routes. Keep webhook, wallet, and other routes.

### Test Cleanup Scope
- **D-13:** Delete `tests/extraction/` directory entirely.
- **D-14:** Delete extraction-specific test files at any location: cascade-delete tests for extraction, job-stats tests, extraction insight component tests, extraction i18n coverage tests.
- **D-15:** Preserve ALL screening tests (`tests/screening/` or screening-related test files).
- **D-16:** Preserve ALL non-extraction tests. Test count may drop — acceptable for teardown.
- **D-17:** After deletion, run `pnpm test` to verify no remaining tests reference deleted extraction modules.

### Claude's Discretion
- Order of file deletion within each layer is Claude's choice — optimize for minimal intermediate breakage.
- Whether to use a single git commit per layer or per directory is Claude's choice — optimize for clean, reviewable history.
- Whether `lib/pdf/download.ts` is deleted or surgically edited depends on what the file contains at execution time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` — Contains all legacy extraction tables to remove (extractionJobs, extractionPapers, extractionQuestions, extractionEvidenceUnits, extractionResults, extractionResultReviews, extractionSavedViews, extractionWorkflowTemplates, extractionReportSnapshots, extractionJobStats, extractionRunDiffs)

### Component Configuration
- `convex/convex.config.ts` — Contains `@convex-dev/rag` component registration to remove, plus workpool registrations to evaluate
- `convex/workpool.ts` — Contains `pdfProcessingPool` (remove) and `screeningPool` (keep)

### Extraction Code (all to be deleted)
- `convex/extraction/` — ~9.6K LoC, 30+ files (mutations, queries, actions, workflow, workpoolActions, prompts, evidence_units, chunking, guard, pdfjs_extract, validators, debug_*.ts, test_*.ts)
- `lib/extraction/` — UI helpers (answer-grouping, card-thresholds, citation-panel, citations, confidence-messages, export, feature-flags, filtering, insights, pdf-highlight, pdfjs-text, question-status, reviews, status-filter-options, types)
- `app/extraction/` — Extraction UI routes and pages
- `components/extraction/` — Extraction feature components

### Shared Files (surgical editing needed)
- `lib/store.ts` — Zustand root store, extraction slice must be removed
- `lib/types/index.ts` — Re-exports extraction types
- `lib/pdf/download.ts` — May serve extraction only or be shared
- `convex/crons.ts` — May contain extraction-related cron jobs
- `convex/http.ts` — May contain extraction-related HTTP routes
- `messages/{en-US,en-GB,zh,fr,hi,ja}.json` — Contain `extraction.*` i18n keys to remove

### Requirements
- `.planning/REQUIREMENTS.md` — TEAR-01 through TEAR-10 define exact teardown scope

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None for this phase — this is purely destructive.

### Established Patterns
- `convex/schema.ts` is the single source of truth for all tables — removal there is definitive.
- `convex/convex.config.ts` manages all component registrations — removal there unregisters the component.
- `lib/types/index.ts` is the central type re-export file — removal of extraction exports there breaks the import chain.
- Locale files are at `messages/{en-US,en-GB,zh,fr,hi,ja}.json` (6 files per STRUCTURE.md, though REQUIREMENTS says en/fr/es/de/ar/zh — the actual file list at execution time determines which 6 to edit).

### Integration Points
- `convex/workflow.ts` — WorkflowManager config may reference extraction workflow
- `app/layout.tsx` — Root layout providers; unlikely to reference extraction directly
- `components/app-sidebar.tsx` — 32KB nav component likely has extraction nav entries to remove
- `package.json` — `@convex-dev/rag` dependency to uninstall, possibly `pdfjs-dist` evaluation

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md TEAR-01 through TEAR-10 are exhaustive. Follow them literally.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 88-scorched-earth-teardown*
*Context gathered: 2026-04-14*
