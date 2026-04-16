# Phase 105 Deferred Items

Out-of-scope issues discovered during execution; logged per executor deviation-rule scope boundary. Do NOT fix in Phase 105 — track for a dedicated cleanup.

## Pre-existing TypeScript Errors

### DEF-105-01 — `tests/crash-prevention/prompt-delimiters.test.ts` regex-flag compile error

- **Discovered:** 2026-04-16 during Plan 105-02 `tsc --noEmit` run.
- **Origin:** Commit `9955fce feat(94-02): UUID prompt injection fence for extraction and critic prompts` (Phase 94 — unrelated to Phase 105).
- **Error:** `tests/crash-prevention/prompt-delimiters.test.ts(20,65): error TS1501: This regular expression flag is only available when targeting 'es2018' or later.`
- **Impact:** Single test file; does not block production build; not triggered by any Phase 105 change.
- **Disposition:** Defer to a dedicated cleanup (likely bump `target`/`lib` in `tsconfig.json` scoped for the test tree, or replace the regex flag). Not fixed in Phase 105 per executor scope-boundary rule (directly causes & blocks no Phase 105 task).

### DEF-105-02 — `tests/extraction-results-view-store.test.ts` `pageSize: 25` drift in migrateViewState

- **Discovered:** 2026-04-16 during Plan 105-02 test-regression sweep.
- **Origin:** Commit `db436b0 feat(103-01): i18n keys, Zustand store v2, GAP-02 useProtectedQuery fixes` (Phase 103 — unrelated to Phase 105).
- **Failures:**
  - `migrateViewState > version 0 returns default state regardless of input` — test expects `{ columnVisibility, activeView }` but migration now returns `{ columnVisibility, activeView, pageSize: 25 }`.
  - `migrateViewState > version 1 passes through state unchanged` — test expects input-identity but migration now shapes a new object with added `pageSize`.
- **Impact:** Two tests in one file; the v2 store behavior itself is correct (matches Phase 103 design); the test assertions drifted.
- **Disposition:** Defer to a cleanup that updates the test expectations to accept the new `pageSize` default. NOT fixed in Phase 105 per executor scope-boundary rule (Plan 105-02 touches zero lines of `lib/store/extraction-results-view.ts` or this test).
