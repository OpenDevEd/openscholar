---
phase: 104-zotero-revival
plan: 01
subsystem: zotero-backend-foundation
tags: [env-validation, purge-action, i18n, zotero, convex]
dependency_graph:
  requires: []
  provides: [env-validation-zotero, purge-action, i18n-zotero-keys]
  affects: [convex/lib/envValidation.ts, convex/zotero/actions.ts, convex/zotero/mutations.ts, messages/*]
tech_stack:
  added: []
  patterns: [internalAction-audit-logging, internalMutation-batch-delete, convex-test-seed-helpers]
key_files:
  created:
    - convex/zotero/purge.test.ts
  modified:
    - convex/lib/envValidation.ts
    - convex/zotero/actions.ts
    - convex/zotero/mutations.ts
    - tests/env-validation.test.ts
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json
decisions:
  - REQUIRED_ENV_VARS extended to 8 entries (added ZOTERO_CLIENT_KEY, ZOTERO_CLIENT_SECRET; ENCRYPTION_KEY already present at index 1)
  - purgeAllZoteroData as internalMutation (not internalAction) for direct ctx.db access; purgeStaleZoteroState as internalAction wrapping it with audit logging
  - i18n uses English placeholders for all non-English locales per project convention
metrics:
  duration: 5m 50s
  completed: 2026-04-16
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 11
---

# Phase 104 Plan 01: Foundation (Env Validation + Purge + i18n) Summary

Extended REQUIRED_ENV_VARS with ZOTERO_CLIENT_KEY and ZOTERO_CLIENT_SECRET, created purgeAllZoteroData internalMutation and purgeStaleZoteroState internalAction with pre/post audit logging, and seeded 34 i18n keys across 6 locales for the Zotero connection card and ZoteroTab.

## What Was Done

### Task 1: Env validation + purge action + purge test (aa5a185)

**Part A - Env Validation (ZOT-05):**
- Extended `REQUIRED_ENV_VARS` in `convex/lib/envValidation.ts` from 6 to 8 entries by appending `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET`
- Updated `tests/env-validation.test.ts`: synced mirror array (8 entries), added Zotero env vars to all "set all others" blocks in 4 existing tests, added 2 new test cases (`detects missing ZOTERO_CLIENT_KEY`, `detects missing ZOTERO_CLIENT_SECRET`)
- All 6 env-validation tests pass

**Part B - Purge Mutation (ZOT-06):**
- Added `purgeAllZoteroData` internalMutation to `convex/zotero/mutations.ts`: deletes all rows from `zoteroConnections` and `zoteroOAuthTokens`, returns `{ connectionsDeleted, tokensDeleted }`
- Added `purgeStaleZoteroState` internalAction to `convex/zotero/actions.ts`: logs `ZOTERO_PURGE_START` audit event, calls `purgeAllZoteroData` mutation, logs `ZOTERO_PURGE_COMPLETE` with row counts

**Part C - Purge Test:**
- Created `convex/zotero/purge.test.ts` following `wallet.test.ts` pattern with `seedUser`, `seedZoteroConnection`, `seedZoteroOAuthToken` helpers
- 2 test cases: purge with data (asserts counts + empty tables), purge on empty tables (asserts zero counts)
- Note: convex-test tests cannot run locally due to pre-existing `vitest-environment-edge-runtime` infrastructure issue (affects all convex-test tests project-wide including wallet.test.ts)

### Task 2: Seed i18n keys across all 6 locales (4823244)

- Added `connectionsPage.zotero` namespace (14 keys): title, description, connect/disconnect buttons, OAuth success/error toasts, connection status display, loading states
- Added `extraction.zoteroTab` namespace (20 keys): not connected state, collection picker labels, item list loading/empty states, DOI resolution states (resolving/resolved/failed/noDoi), pagination, error messages
- All 6 locales (en-US, en-GB, fr, ja, zh, hi) updated with identical English text per project convention
- Existing `extraction.selector.tabs.zotero` key preserved unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **ENCRYPTION_KEY not added to REQUIRED_ENV_VARS** -- already present at index 1 (per D-12 clarification in RESEARCH.md Pitfall 1)
2. **purgeAllZoteroData as separate internalMutation** -- required because internalActions cannot access ctx.db directly (Convex guidelines); the internalAction wraps it with audit logging
3. **convex-test infrastructure gap documented** -- pre-existing issue affecting all convex-test tests in the project; purge test code is structurally correct and follows the exact wallet.test.ts pattern

## Verification Results

- `npx vitest run tests/env-validation.test.ts`: 6/6 tests pass
- `convex/zotero/purge.test.ts`: structurally correct, cannot run due to pre-existing convex-test infrastructure issue (same as wallet.test.ts)
- All 6 locale files verified to contain both `connectionsPage.zotero` and `extraction.zoteroTab` namespaces with all required keys
- `convex/lib/envValidation.ts` REQUIRED_ENV_VARS has exactly 8 entries
- `convex/zotero/actions.ts` exports `purgeStaleZoteroState` as `internalAction`
- `convex/zotero/mutations.ts` exports `purgeAllZoteroData` as `internalMutation`

## Threat Surface Scan

No new threat surface introduced beyond what is documented in the plan's threat model. `purgeStaleZoteroState` is platform-enforced internal (T-104-01), audit logging covers repudiation (T-104-02), env var names are not sensitive (T-104-03).

## Self-Check: PASSED

- All 12 files verified present on disk
- Both commit hashes (aa5a185, 4823244) verified in git log
