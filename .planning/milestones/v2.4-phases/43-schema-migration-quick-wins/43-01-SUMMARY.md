---
phase: 43-schema-migration-quick-wins
plan: 01
subsystem: database
tags: [encryption, schema-migration, convex, security, zotero]

# Dependency graph
requires:
  - phase: 39-zotero-key-encryption
    provides: encryptedApiKey field and encrypt/decrypt infrastructure
provides:
  - Complete removal of plaintext apiKey from schema and all code paths
  - Migration action that encrypts and clears plaintext keys
  - Encrypted-only Zotero API key resolution
affects: [zotero-integration, extraction-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-deploy migration pattern (migrate data first, then remove schema field)
    - Encrypted-only key resolution with single code path

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/zotero/actions.ts
    - convex/zotero/internal.ts
    - convex/zotero/mutations.ts
    - convex/extraction/workpoolActions.ts

key-decisions:
  - "Removed clearPlaintextApiKey mutation after schema cleanup since patching a non-schema field would fail"
  - "Simplified migrateToEncryptedKeys to skip-only logic post-migration (no encrypt path needed)"

patterns-established:
  - "Two-deploy migration: deploy migration code + run it, then deploy schema removal separately"

requirements-completed: [SEC-01, SEC-02]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 43 Plan 01: Schema Migration Summary

**Encrypt-and-clear migration for Zotero API keys with full schema and code removal of plaintext apiKey field**

## Performance

- **Duration:** 3 min (Task 3 continuation only; Tasks 1-2 completed in prior session)
- **Started:** 2026-03-02T21:46:39Z
- **Completed:** 2026-03-02T21:49:17Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Migration action extended to encrypt and clear all plaintext apiKey values from Zotero connection documents
- Plaintext apiKey field fully removed from Convex schema definition
- All fallback code paths (dual-read plaintext/encrypted) removed from actions, internal queries, and extraction pipeline
- Convex build passes cleanly with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend migration to clear plaintext apiKey** - `2c2eb10` (feat)
2. **Task 2: Run migration and verify zero plaintext rows** - checkpoint resolved (dashboard action)
3. **Task 3: Remove apiKey field from schema and all fallback code paths** - `00d9f65` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `convex/schema.ts` - Removed deprecated apiKey field from zoteroConnections table
- `convex/zotero/actions.ts` - Removed apiKey from ZoteroConnection type, simplified resolveZoteroApiKey to encrypted-only, cleaned migrateToEncryptedKeys
- `convex/zotero/internal.ts` - Removed apiKey from getConnection and listAllConnections return validators and objects
- `convex/zotero/mutations.ts` - Removed clearPlaintextApiKey mutation (no longer needed post-migration)
- `convex/extraction/workpoolActions.ts` - Removed plaintext fallback branch in PDF download Zotero key resolution
- `convex/_generated/api.d.ts` - Auto-generated type updates

## Decisions Made
- Removed `clearPlaintextApiKey` mutation entirely during schema cleanup (Rule 1 - Bug prevention): patching a field not in schema would cause runtime errors
- Simplified `migrateToEncryptedKeys` to skip-only logic since migration has already run and all plaintext keys are cleared

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed clearPlaintextApiKey mutation**
- **Found during:** Task 3 (schema cleanup)
- **Issue:** After removing apiKey from the schema, the clearPlaintextApiKey mutation would fail at runtime because `ctx.db.patch(id, { apiKey: undefined })` references a field not in the schema
- **Fix:** Removed the mutation entirely since all apiKey fields have been cleared by the migration
- **Files modified:** convex/zotero/mutations.ts
- **Verification:** Convex build passes, no references to clearPlaintextApiKey remain
- **Committed in:** 00d9f65 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug prevention)
**Impact on plan:** Necessary for correctness -- patching a non-schema field would cause runtime errors.

## Issues Encountered
None

## User Setup Required
None - migration was already run from Convex dashboard during Task 2 checkpoint.

## Next Phase Readiness
- Schema migration complete, plaintext apiKey fully eliminated
- Zotero API keys exist only in encrypted form
- Ready for Phase 44 and beyond

## Self-Check: PASSED

- All modified files exist on disk
- Commits 2c2eb10 (Task 1) and 00d9f65 (Task 3) verified in git log
- Zero stale `.apiKey` property references in zotero/extraction modules
- Convex build passes cleanly

---
*Phase: 43-schema-migration-quick-wins*
*Completed: 2026-03-02*
