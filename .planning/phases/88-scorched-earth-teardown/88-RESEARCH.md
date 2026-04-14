# Phase 88: Scorched-Earth Teardown - Research

**Researched:** 2026-04-14
**Domain:** Legacy code deletion, Convex schema removal, dependency uninstall, TypeScript compilation cleanup
**Confidence:** HIGH

## Summary

Phase 88 is a purely destructive teardown of the legacy extraction pipeline. The codebase currently contains approximately 9,610 lines of backend code in `convex/extraction/` (32 files), 15 UI helper files in `lib/extraction/`, 39 UI components in `components/extraction/`, 7 route files in `app/extraction/`, a dedicated Zustand store in `lib/store/extraction.ts`, extraction types in `lib/types/extraction.types.ts`, and 23+ extraction-specific test files. All of this code must be deleted, along with 11 legacy schema tables, the `@convex-dev/rag` component, the `pdfProcessingPool` workpool, and extraction i18n keys across 6 locale files.

The critical complexity is not the deletion itself but the surgical editing of shared files that mix extraction and non-extraction concerns. Six shared files require careful editing: `convex/schema.ts` (which imports `searchFiltersValidator` from the extraction module being deleted), `convex/convex.config.ts`, `convex/workpool.ts`, `lib/store.ts`, `lib/types/index.ts`, and `components/app-sidebar.tsx`. Additionally, several shared Convex modules (`convex/maintenance/mutations.ts`, `convex/ai/actions.ts`, `convex/lib/rateLimit.ts`, `convex/featureFlags/internal.ts`, `convex/lib/queryBounds.ts`, `convex/lib/constants.ts`) contain extraction-specific code that must be surgically removed.

**Primary recommendation:** Follow the schema-last deletion order (D-01) strictly. The most dangerous operation is the `searchFiltersValidator` import in `convex/schema.ts` -- this validator is defined in `convex/extraction/validators.ts` which is being deleted. The validator must either be relocated to a shared location or inlined into schema.ts before the extraction directory is removed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Schema-last approach -- remove consumers before providers to avoid intermediate tsc breaks. Order: UI routes/pages -> components -> lib helpers -> convex functions -> schema tables -> convex.config.ts component removal -> package.json uninstalls.
- **D-02:** Each deletion layer should compile cleanly before moving to the next. Plan should be structured as sequential layers, not one monolithic delete.
- **D-03:** Remove ONLY `pdfProcessingPool` from `convex/workpool.ts`. Keep `screeningPool` intact -- it powers the working v4.0 bulk screening feature and is NOT part of the legacy extraction pipeline.
- **D-04:** TEAR-05's "remove pdfProcessingPool and screeningPool workpool registrations" should be interpreted as: `pdfProcessingPool` is the legacy extraction pool being replaced. `screeningPool` serves screening (v4.0), not extraction -- preserve it.
- **D-05:** All `convex/screening/` code stays untouched. Only `convex/extraction/` is deleted.
- **D-06:** Surgical removal of extraction-only content from shared files. Delete extraction-only files wholesale. Strip extraction imports/exports from shared files. Leave non-extraction functionality intact.
- **D-07:** `lib/store.ts` -- remove the extraction store slice and any extraction-related types/actions. Keep all other slices.
- **D-08:** `lib/types/extraction.types.ts` -- delete entirely.
- **D-09:** `lib/types/index.ts` -- remove extraction re-exports, keep all others.
- **D-10:** `lib/pdf/download.ts` -- evaluate at deletion time. If it serves ONLY extraction, delete. If shared, strip extraction-only helpers and keep.
- **D-11:** `convex/crons.ts` -- remove any extraction-related scheduled jobs. Keep the rest.
- **D-12:** `convex/http.ts` -- remove any extraction-related HTTP routes. Keep the rest.
- **D-13:** Delete `tests/extraction/` directory entirely.
- **D-14:** Delete extraction-specific test files at any location.
- **D-15:** Preserve ALL screening tests.
- **D-16:** Preserve ALL non-extraction tests. Test count may drop -- acceptable for teardown.
- **D-17:** After deletion, run `pnpm test` to verify no remaining tests reference deleted extraction modules.

### Claude's Discretion
- Order of file deletion within each layer is Claude's choice -- optimize for minimal intermediate breakage.
- Whether to use a single git commit per layer or per directory is Claude's choice.
- Whether `lib/pdf/download.ts` is deleted or surgically edited depends on what the file contains at execution time.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEAR-01 | Delete all legacy extraction tables from `convex/schema.ts` | 11 tables identified at lines 319-781 of schema.ts. `searchFiltersValidator` import from `convex/extraction/validators` must be relocated first. |
| TEAR-02 | Delete `convex/extraction/` directory entirely | 32 files, 9,610 LoC confirmed. Public API surface in `index.ts` exports to `_generated/api.d.ts`. |
| TEAR-03 | Delete `lib/extraction/` directory entirely | 15 files confirmed (answer-grouping through types). `lib/store/extraction.ts` is a separate store file also to delete. |
| TEAR-04 | Remove `@convex-dev/rag` from `convex.config.ts` and `package.json` | Only two import sites: `convex.config.ts:3` and `convex/extraction/workpoolActions.ts:7`. Package at line 33 of package.json. |
| TEAR-05 | Remove `pdfProcessingPool` workpool registration | Per D-03/D-04, remove ONLY `pdfProcessingPool`. Keep `screeningPool` and its `screeningWorkpool` component. Remove default `workpool` component from config. |
| TEAR-06 | Remove extraction entries from `lib/pdf/download.ts` | File is ONLY consumed by `convex/extraction/workpoolActions.ts` -- zero non-extraction consumers. Delete entirely per D-10. |
| TEAR-07 | Remove extraction UI routes, pages, components | `app/extraction/` (7 files), `components/extraction/` (39 files + 5 in results-views subdirectory). |
| TEAR-08 | Remove extraction i18n keys from all 6 locale files | 6 locale files: `en-US.json`, `en-GB.json`, `zh.json`, `fr.json`, `hi.json`, `ja.json`. Two top-level sections (`extraction`, `extractionView`) plus scattered keys in `common`, `toast`, `errorPages`, `jobStatus`. |
| TEAR-09 | Remove `uploadedPdfs` Convex file storage entries | Storage IDs (`_storage` references) exist only in extraction code. No migration needed -- just code deletion removes all references. |
| TEAR-10 | TypeScript compiles with zero errors | After deletion, `tsc --noEmit` must pass. Shared file surgery is the critical path (schema.ts, store.ts, types/index.ts, sidebar, ai/actions.ts, maintenance/mutations.ts, featureFlags/internal.ts, lib/rateLimit.ts, lib/queryBounds.ts, lib/constants.ts, search.types.ts). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema table deletion | Database / Storage | -- | Tables are defined in `convex/schema.ts`, deployed to Convex backend |
| Backend function deletion | API / Backend | -- | Mutations, queries, actions in `convex/extraction/` |
| UI route deletion | Browser / Client | Frontend Server (SSR) | Next.js pages in `app/extraction/`, SSR layout files |
| Component deletion | Browser / Client | -- | React components in `components/extraction/` |
| Lib helper deletion | Browser / Client | API / Backend | `lib/extraction/` used by both client and convex imports |
| i18n key removal | Browser / Client | -- | Locale JSON files consumed by `next-intl` |
| Dependency uninstall | Build artifacts | -- | `package.json` changes, `node_modules` cleanup |
| Shared file surgery | All tiers | -- | Affects schema, store, types, sidebar, AI actions, maintenance |

## Verified Deletion Inventory

### Wholesale Directory Deletions

| Directory | Files | LoC | Action |
|-----------|-------|-----|--------|
| `convex/extraction/` | 32 | 9,610 | `rm -rf` [VERIFIED: ls + wc -l] |
| `lib/extraction/` | 15 | ~2,100 | `rm -rf` [VERIFIED: ls] |
| `components/extraction/` | 44 (incl. subdirectory) | ~8,500 | `rm -rf` [VERIFIED: ls -laR] |
| `app/extraction/` | 7 (incl. subdirectories) | ~1,800 | `rm -rf` [VERIFIED: ls -laR] |
| `tests/extraction/` | 2 | ~128 | `rm -rf` [VERIFIED: ls] |

### Wholesale File Deletions

| File | Reason | Action |
|------|--------|--------|
| `lib/types/extraction.types.ts` | Extraction types -- zero non-extraction consumers | Delete [VERIFIED: grep] |
| `lib/store/extraction.ts` | Extraction Zustand store -- zero non-extraction consumers | Delete [VERIFIED: grep] |
| `lib/pdf/download.ts` | Only consumer is `convex/extraction/workpoolActions.ts` | Delete per D-10 [VERIFIED: grep] |
| `convex/debug.ts` | Queries `extractionPapers` table | Delete [VERIFIED: read] |
| `convex/debug_papers.ts` | Queries `extractionPapers` table | Delete [VERIFIED: read] |

### Extraction Test Files to Delete

| File | Imports From |
|------|-------------|
| `tests/answer-grouping.test.ts` | `lib/extraction/answer-grouping` |
| `tests/card-thresholds.test.ts` | `lib/extraction/card-thresholds` |
| `tests/confidence-badge.test.tsx` | `components/extraction/confidence-badge` |
| `tests/confidence-messages.test.ts` | `lib/extraction/confidence-messages` |
| `tests/export-answer-formatters.test.ts` | `lib/extraction/export` |
| `tests/export-citations.test.ts` | `lib/extraction/citations` |
| `tests/export-extraction-options.test.ts` | `lib/extraction/filtering`, `lib/extraction/export` |
| `tests/extraction-citation-panel.test.ts` | `lib/extraction/citation-panel` |
| `tests/extraction-feature-flags.test.ts` | `convex/extraction/content` |
| `tests/extraction-filtering.test.ts` | `lib/extraction/filtering` |
| `tests/extraction-i18n-coverage.test.ts` | Extraction i18n keys |
| `tests/extraction-insights-overview.test.tsx` | `components/extraction/insights-overview` |
| `tests/extraction-insights-question-panel.test.tsx` | `components/extraction/insights-question-panel` |
| `tests/extraction-insights.test.ts` | `lib/extraction/insights` |
| `tests/extraction-v3-evidence.test.ts` | `convex/extraction/evidence_units` |
| `tests/extraction-v3-integration.test.ts` | `convex/extraction/workpoolActions` |
| `tests/extraction-v3-prompts.test.ts` | `convex/extraction/prompts` |
| `tests/highlight-text.test.ts` | `components/extraction/results-views/highlighted-text` |
| `tests/question-list-item.test.tsx` | `components/extraction/question-list-item` |
| `tests/question-status.test.ts` | `lib/extraction/question-status` |
| `tests/stacked-answer-bars.test.tsx` | `components/extraction/stacked-answer-bars` |
| `tests/summary-cards.test.tsx` | `components/extraction/summary-cards` |
| `tests/components/grouped-answer-row.test.tsx` | `components/extraction/grouped-answer-row` |

**Total: 23 test files + 2 in `tests/extraction/` directory = 25 extraction test files** [VERIFIED: find + grep]

### Shared Files Requiring Surgical Editing

| File | What to Remove | What to Keep |
|------|---------------|--------------|
| `convex/schema.ts` | Import of `searchFiltersValidator` from `./extraction/validators` (line 4). All 11 extraction tables (lines 319-781): `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionJobStats`, `extractionRunDiffs`. | All other tables (models, featureFlags, users, credits, creditTransactions, subscriptions, billingCustomers, stripeEventLogs, auditLogs, walletAllowedOrigins, walletKeys, apiKeys, zoteroConnections, zoteroOAuthTokens, screeningJobs, etc.) |
| `convex/convex.config.ts` | `import rag from "@convex-dev/rag/convex.config.js"` (line 3), `import workpool from "@convex-dev/workpool/convex.config.js"` (line 5), `app.use(rag)` (line 10), `app.use(workpool)` (line 12) | `stripe`, `workflow`, `screeningWorkpool` components |
| `convex/workpool.ts` | `pdfProcessingPool` const (lines 5-14), `import { components }` may need adjustment | `screeningPool` const (lines 17-25), `components` import |
| `lib/store.ts` | `ExtractionSortBy` import (line 15), `extractionViewMode` state field (line 86), `extractionSortBy` state field (line 87), `setExtractionViewMode` action (line 99), `setExtractionSortBy` action (line 100), implementation lines 595-596 and 614-615, persist whitelist entries 654-655 | All non-extraction slices (search, history, UI, focus, keywords, AI config, sidebar, screening) |
| `lib/types/index.ts` | Lines 40-60: entire extraction type re-export block | AI types, screening types, search types |
| `lib/types/search.types.ts` | `ExtractionSortBy` type definition (line 205) | All other types |
| `components/app-sidebar.tsx` | Lines 374, 376, 438-439, 523-528: extraction feature flag check, extraction plan check, extraction nav entry | All other nav entries (search, history, bookmarks, screening, etc.) |
| `convex/maintenance/mutations.ts` | Lines 38-52: extraction job cascade delete logic referencing `internal.extraction.mutations.deleteExtractionInternal` | All other user cleanup logic |
| `convex/ai/actions.ts` | Lines 5-78: `getExtractionQuestionsConfig` import and `generateExtractionQuestions` action | All other AI actions (translateQuery, translatePaperContent, screening, etc.) |
| `convex/lib/rateLimit.ts` | Line 18: `"start-extraction"` rate limit key, and its corresponding validator literal (line 58) | All other rate limit keys |
| `convex/featureFlags/internal.ts` | Lines 47-53: all `extraction.*` feature flag seeds | All other feature flag seeds |
| `convex/lib/constants.ts` | Extraction-related constants and comments (lines 3, 9-14, 30) | Non-extraction constants |
| `convex/lib/queryBounds.ts` | Extraction-related query bound constants (lines 9, 14, 30) | Non-extraction bounds |
| `lib/ai/core/configs.ts` | `getExtractionQuestionsConfig` function (lines 94-118) and its related imports/schema | All other config functions |
| `lib/ai/client/executor.ts` | Lines 11 and 134: `getExtractionQuestionsConfig` import and usage | All other executor logic |

## Critical Pattern: searchFiltersValidator Relocation

**The most dangerous operation in this phase.**

`convex/schema.ts` line 4 imports `searchFiltersValidator` from `./extraction/validators`. This validator is used by three extraction tables in schema.ts (`extractionJobs` at lines 335/374, `extractionWorkflowTemplates` at line 626). Since all three tables are being deleted, the import AND all usages disappear together.

**Verification:** `searchFiltersValidator` is NOT used by any non-extraction table. [VERIFIED: grep of `convex/screening/` returned zero matches] The import can be deleted along with the tables.

**Risk level:** LOW -- clean removal since all consumers of the validator are also being removed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tracking deleted files | Custom deletion manifest | `git diff --stat` after each layer | Git already tracks what was deleted |
| Validating clean compile | Custom lint script | `tsc --noEmit` | TypeScript compiler is the authoritative check |
| Finding dangling imports | Manual file reading | `tsc --noEmit` error output | Compiler finds ALL dangling imports, not just obvious ones |
| Verifying test suite | Manual test enumeration | `pnpm test` (vitest run) | Test runner validates all imports at collection time |

## Common Pitfalls

### Pitfall 1: Convex Generated API Cache
**What goes wrong:** After deleting `convex/extraction/`, the `convex/_generated/api.d.ts` file still references extraction types and functions, causing type errors.
**Why it happens:** The generated API file is auto-generated by Convex dev/deploy. If not regenerated, stale types persist.
**How to avoid:** Run `npx convex dev` or `npx convex codegen` after deleting extraction code to regenerate the API type file. [ASSUMED]
**Warning signs:** Type errors referencing `api.extraction.*` paths.

### Pitfall 2: searchFiltersValidator Import Ordering
**What goes wrong:** Deleting `convex/extraction/validators.ts` before removing the import from `convex/schema.ts` breaks the schema, which breaks ALL Convex operations.
**Why it happens:** Schema is the foundational file -- a broken schema means zero Convex functions work.
**How to avoid:** Remove the `searchFiltersValidator` import and all extraction table definitions from schema.ts BEFORE deleting the extraction directory, not after.
**Warning signs:** `tsc --noEmit` errors in `convex/schema.ts` referencing missing module.

### Pitfall 3: Locale File JSON Syntax Errors
**What goes wrong:** Removing keys from the middle of a JSON object leaves trailing commas or breaks JSON structure.
**Why it happens:** JSON does not allow trailing commas. When removing a key that precedes a closing brace, the preceding entry's trailing comma must also be removed.
**How to avoid:** After editing locale files, validate JSON syntax: `node -e "JSON.parse(require('fs').readFileSync('messages/en-US.json', 'utf8'))"`. Or use programmatic removal instead of manual editing.
**Warning signs:** Runtime parse errors, locale loading failures.

### Pitfall 4: Workpool Component Left Orphaned in Config
**What goes wrong:** The default `workpool` component in `convex.config.ts` (line 5, 12) is the one backing `pdfProcessingPool`. If only `pdfProcessingPool` is removed from `workpool.ts` but the component registration stays in `convex.config.ts`, the component deploys to Convex but has no consumer.
**Why it happens:** `components.workpool` is referenced by `pdfProcessingPool` while `components.screeningWorkpool` is referenced by `screeningPool`. When `pdfProcessingPool` is deleted, the default `workpool` component import and `app.use(workpool)` become dead code.
**How to avoid:** Remove both the import and `app.use(workpool)` from `convex.config.ts` when removing `pdfProcessingPool`. Keep `screeningWorkpool` import and registration.
**Warning signs:** Convex dashboard showing an unused `workpool` component.

### Pitfall 5: Extraction Store Slice in Zustand Persist Migration
**What goes wrong:** `lib/store.ts` has a `persist` configuration that whitelists specific fields (lines 654-655 include `extractionViewMode` and `extractionSortBy`). If these fields are removed from the state shape but left in the persist whitelist (or vice versa), the store throws at hydration.
**Why it happens:** Zustand persist stores serialized state in localStorage. Stale persisted state may include extraction fields that no longer exist in the type.
**How to avoid:** Remove extraction fields from both the state interface AND the persist whitelist. Bump the persist version number to force a clean migration.
**Warning signs:** Console errors about unknown state fields, sidebar tree crashes (CRASH-07).

### Pitfall 6: Maintenance Mutations Scheduler Reference
**What goes wrong:** `convex/maintenance/mutations.ts` calls `internal.extraction.mutations.deleteExtractionInternal`. After deletion, this reference breaks at compile time.
**Why it happens:** The maintenance module cascades user deletion through extraction job cleanup.
**How to avoid:** Remove the entire extraction job cleanup block (lines 38-52 of maintenance/mutations.ts). Since extraction tables no longer exist, there is nothing to cascade-delete.
**Warning signs:** `tsc --noEmit` error in `convex/maintenance/mutations.ts`.

### Pitfall 7: pdfjs-dist Left in Package.json
**What goes wrong:** `pdfjs-dist` is at line 57 of `package.json`. It is ONLY imported by `convex/extraction/pdfjs_extract.ts` and `components/extraction/pdf-viewer.tsx` -- both being deleted.
**Why it happens:** Easy to forget transitive dependencies when the direct consumer directories are wholesale-deleted.
**How to avoid:** After deletion, check whether `pdfjs-dist` has any remaining importers. If none, uninstall it alongside `@convex-dev/rag`. [VERIFIED: only 2 import sites, both in extraction code]
**Warning signs:** Unused dependency in `package.json`, wasted bundle size.

## Architecture Patterns

### Deletion Layer Order (from D-01)

```
Layer 1: UI Routes & Pages
   app/extraction/          [7 files]
   
Layer 2: UI Components
   components/extraction/   [44 files]

Layer 3: Lib Helpers
   lib/extraction/          [15 files]
   lib/store/extraction.ts  [1 file]
   lib/types/extraction.types.ts [1 file]
   lib/pdf/download.ts      [1 file, per D-10 evaluation]

Layer 4: Shared File Surgery
   lib/store.ts             [remove extraction slice]
   lib/types/index.ts       [remove extraction re-exports]
   lib/types/search.types.ts [remove ExtractionSortBy]
   components/app-sidebar.tsx [remove extraction nav]
   lib/ai/core/configs.ts   [remove extraction config]
   lib/ai/client/executor.ts [remove extraction import]

Layer 5: Convex Functions + Shared Convex Surgery
   convex/extraction/       [32 files]
   convex/debug.ts          [delete]
   convex/debug_papers.ts   [delete]
   convex/maintenance/mutations.ts [surgery]
   convex/ai/actions.ts     [surgery]
   convex/lib/rateLimit.ts  [surgery]
   convex/featureFlags/internal.ts [surgery]
   convex/lib/constants.ts  [surgery]
   convex/lib/queryBounds.ts [surgery]

Layer 6: Schema Tables
   convex/schema.ts         [remove import + 11 tables]

Layer 7: Component Config & Package Cleanup
   convex/convex.config.ts  [remove rag + default workpool]
   convex/workpool.ts       [remove pdfProcessingPool]
   package.json             [uninstall @convex-dev/rag, pdfjs-dist]

Layer 8: i18n Cleanup
   messages/en-US.json      [remove extraction/extractionView sections + scattered keys]
   messages/en-GB.json      [same]
   messages/zh.json          [same]
   messages/fr.json          [same]
   messages/hi.json          [same]
   messages/ja.json          [same]

Layer 9: Test Cleanup
   tests/extraction/         [2 files]
   tests/extraction-*.test.* [12 files]
   tests/answer-grouping.test.ts, etc. [11 additional files]
```

### Anti-Patterns to Avoid
- **Monolithic delete:** Do NOT delete everything in one shot. The resulting error count will be overwhelming and hide real issues behind cascading import failures.
- **Schema-first deletion:** Do NOT remove schema tables before removing the functions and types that reference them. Schema is the provider; everything else is the consumer.
- **Partial workpool removal:** Do NOT remove the `screeningPool` or the `screeningWorkpool` component registration. These are live production infrastructure for v4.0 screening.

## i18n Key Structure

Each of the 6 locale files has the same structure. Keys to remove:

| Location | Type | Example Keys |
|----------|------|-------------|
| Top-level `"extraction"` section | Object (~140 keys) | `extraction.searchJobs`, `extraction.startExtraction`, `extraction.exportResults`, etc. |
| Top-level `"extractionView"` section | Object (~14 keys) | `extractionView.extractionResults`, `extractionView.insights`, etc. |
| `common.extraction` | String | Nav label "Extraction" |
| `common.extractionError` | String | Error label |
| `toast.extractionPlanRequired` | String | Plan gate toast |
| `errorPages.extractionUnavailable` | String | Error page title |
| `errorPages.extractionErrorDescription` | String | Error page description |
| `jobStatus.extractionProgress` | String | Progress label |
| `jobStatus.loadingExtractionResults` | String | Loading state |
| `pricing.proDescription` | String (contains "extraction" text) | Evaluate -- may keep if text is about the product tier, not the feature |
| `pricing.proFeature2` | String | "Data extraction (Pro-only)" |

[VERIFIED: python3 JSON parsing of en-US.json]

**Actual locale files (differ from REQUIREMENTS.md):**
- REQUIREMENTS says: `en.json, fr.json, es.json, de.json, ar.json, zh.json`
- CONTEXT says: `en-US, en-GB, zh, fr, hi, ja`
- **On disk:** `en-US.json, en-GB.json, zh.json, fr.json, hi.json, ja.json` [VERIFIED: ls messages/]

The planner should use the on-disk file list, not the REQUIREMENTS.md list.

## Verified Shared File Reference Counts

Comprehensive extraction reference map for files OUTSIDE the extraction directories:

| File | References | Type |
|------|-----------|------|
| `convex/schema.ts` | 1 import + 11 table definitions | Import + schema |
| `convex/convex.config.ts` | 2 imports + 2 `app.use()` calls | Config |
| `convex/workpool.ts` | 1 const definition (pdfProcessingPool) | Export |
| `convex/maintenance/mutations.ts` | 1 scheduler call + surrounding logic | Runtime reference |
| `convex/ai/actions.ts` | 1 import + 1 action definition | Import + export |
| `convex/lib/rateLimit.ts` | 1 key definition + 1 validator literal | Config |
| `convex/featureFlags/internal.ts` | 7 feature flag seed entries | Data |
| `convex/lib/constants.ts` | 3 comments referencing extraction | Comments only |
| `convex/lib/queryBounds.ts` | 3 constants referencing extraction | Constants |
| `convex/debug.ts` | Entire file queries extractionPapers | Delete wholesale |
| `convex/debug_papers.ts` | Entire file queries extractionPapers | Delete wholesale |
| `lib/store.ts` | 2 state fields + 2 actions + 1 import + persist entries | State + import |
| `lib/types/index.ts` | 20-line extraction re-export block | Re-exports |
| `lib/types/search.types.ts` | 1 type definition (ExtractionSortBy) | Type |
| `lib/ai/core/configs.ts` | 1 function definition (getExtractionQuestionsConfig) | Export |
| `lib/ai/client/executor.ts` | 1 import + 1 usage | Import |
| `components/app-sidebar.tsx` | 2 hooks + 2 conditionals + 1 nav entry | UI logic |
| `convex/_generated/api.d.ts` | Auto-generated -- will regenerate after deletion | Generated |

[VERIFIED: grep across entire codebase]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| TypeScript (`tsc`) | TEAR-10 compilation check | Checked via `pnpm test` | Via project | -- |
| Vitest | Test verification (D-17) | Yes | Via project | -- |
| Node.js | All tooling | Yes | System | -- |
| pnpm | Package management | Yes | Via project | npm |

Step 2.6: No new external dependencies needed. This phase is code/config deletion only.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via project config) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEAR-01 | Schema has zero extraction tables | smoke | `grep -c "extractionJobs\|extractionPapers\|extractionQuestions\|extractionEvidenceUnits\|extractionResults\|extractionResultReviews\|extractionSavedViews\|extractionWorkflowTemplates\|extractionReportSnapshots\|extractionJobStats\|extractionRunDiffs" convex/schema.ts` should return 0 | N/A (shell check) |
| TEAR-02 | `convex/extraction/` does not exist | smoke | `test ! -d convex/extraction && echo PASS` | N/A (shell check) |
| TEAR-03 | `lib/extraction/` does not exist | smoke | `test ! -d lib/extraction && echo PASS` | N/A (shell check) |
| TEAR-04 | `@convex-dev/rag` absent from config and package.json | smoke | `grep -c "@convex-dev/rag" convex/convex.config.ts package.json` should return 0 | N/A (shell check) |
| TEAR-05 | `pdfProcessingPool` absent, `screeningPool` present | smoke | `grep -c "pdfProcessingPool" convex/workpool.ts` = 0 AND `grep -c "screeningPool" convex/workpool.ts` > 0 | N/A (shell check) |
| TEAR-06 | `lib/pdf/download.ts` deleted or extraction-free | smoke | `test ! -f lib/pdf/download.ts && echo PASS` | N/A (shell check) |
| TEAR-07 | `app/extraction/` and `components/extraction/` do not exist | smoke | `test ! -d app/extraction -a ! -d components/extraction && echo PASS` | N/A (shell check) |
| TEAR-08 | Zero extraction i18n keys in locale files | smoke | `grep -rl '"extraction"' messages/` should return 0 lines | N/A (shell check) |
| TEAR-09 | No file storage references to extraction uploads | smoke | Covered by TEAR-02 (extraction code is the only consumer) | N/A |
| TEAR-10 | `tsc --noEmit` returns zero errors | integration | `npx tsc --noEmit` | N/A (compiler check) |

### Sampling Rate
- **Per task commit:** `pnpm test` (4.76s currently, will be faster after deletion)
- **Per wave merge:** `pnpm test && npx tsc --noEmit`
- **Phase gate:** Full suite green + tsc --noEmit zero errors

### Wave 0 Gaps
None -- existing test infrastructure (`vitest.config.ts`, `pnpm test`) covers all validation needs. All verification for this phase is shell-based smoke checks and compiler validation, not new test files.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Running `npx convex dev` or `npx convex codegen` regenerates `_generated/api.d.ts` after extraction deletion | Pitfall 1 | Medium -- stale generated types would cause false tsc errors. Fixable by checking Convex docs for exact regeneration command. |
| A2 | `pdfjs-dist` has zero non-extraction importers and can be safely uninstalled | Pitfall 7 | Low -- verified via grep that only 2 import sites exist, both in extraction code. |

## Open Questions

1. **`pdfjs-dist` removal vs. Phase 90 reuse**
   - What we know: `pdfjs-dist` is currently only imported by extraction code. Phase 90 introduces `unpdf` (serverless-bundled PDF.js v5) as the replacement.
   - What's unclear: Whether `unpdf` completely replaces `pdfjs-dist` or whether some of the download utility logic in `lib/pdf/download.ts` would be useful to Phase 90.
   - Recommendation: Delete both `pdfjs-dist` and `lib/pdf/download.ts` in this phase. Phase 90 will build fresh with `unpdf` per requirements. The download utility is tightly coupled to the old extraction flow.

2. **`lib/ai/core/configs.ts` -- extraction question generation**
   - What we know: The `getExtractionQuestionsConfig` function and its prompts are extraction-specific. The `convex/ai/actions.ts` `generateExtractionQuestions` action uses it.
   - What's unclear: Whether the new extraction pipeline (Phase 91+) will reuse this AI config or build new prompts.
   - Recommendation: Delete it. The v6.0 extraction pipeline uses a completely different approach (Gemini 3 Flash via OpenRouter, flat 7-field Zod schema). Old prompt engineering is not reusable.

## Sources

### Primary (HIGH confidence)
- Codebase grep and file reads across all referenced files
- Direct verification of all import chains and reference counts
- `vitest run` confirming 108 test files, 1435 tests passing
- `ls`, `wc -l`, JSON parsing of locale files

### Secondary (MEDIUM confidence)
- None -- all findings verified via codebase inspection

### Tertiary (LOW confidence)
- A1: Convex codegen behavior (assumed from training knowledge, not verified against Convex docs)

## Metadata

**Confidence breakdown:**
- Deletion inventory: HIGH -- every file and reference verified via grep/read
- Shared file surgery: HIGH -- all extraction references enumerated with line numbers
- Pitfalls: HIGH -- based on verified structural analysis of the codebase
- i18n cleanup: HIGH -- JSON structure parsed programmatically

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- codebase structure unlikely to change before this phase executes)
