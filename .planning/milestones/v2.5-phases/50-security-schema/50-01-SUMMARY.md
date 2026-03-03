---
phase: 50-security-schema
plan: 01
subsystem: auth
tags: [encryption, audit-logging, schema-migration, crypto, zotero]

# Dependency graph
requires:
  - phase: 43-api-key-encryption
    provides: "Encrypted API key migration (all rows populated with encryptedApiKey)"
provides:
  - "Required (non-optional) encryptedApiKey and keyPrefix in zoteroConnections schema"
  - "Centralized decryptApiKey() utility with structured audit logging"
  - "All 3 decrypt call sites migrated to audited decryptApiKey"
affects: [50-02-PLAN, zotero-integration, extraction-pipeline, api-keys]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralized-decrypt-with-audit, structured-audit-logging]

key-files:
  created: []
  modified:
    - convex/lib/crypto.ts
    - convex/schema.ts
    - convex/zotero/internal.ts
    - convex/zotero/actions.ts
    - convex/extraction/workpoolActions.ts
    - convex/apiKeys/actions.ts

key-decisions:
  - "Used console.log JSON audit format matching existing AUDIT pattern (e.g. AUDIT:DEBUG_ACCESS)"
  - "Used String(job.userId) fallback to 'system' for extraction workpool decrypt (internal action without direct user context)"

patterns-established:
  - "Centralized audit-logged decrypt: all API key decryption goes through decryptApiKey() with userId + purpose"
  - "Schema field finalization: make optional fields required after data migration is complete"

requirements-completed: [TYPE-05, SEC-01]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 50 Plan 01: Security & Schema Hardening Summary

**Required encryptedApiKey schema field and centralized decryptApiKey utility with structured audit logging across all 3 decrypt call sites**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T09:09:11Z
- **Completed:** 2026-03-03T09:12:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created `decryptApiKey()` centralized utility in crypto.ts with structured JSON audit logging (userId, purpose, timestamp)
- Migrated all 3 decrypt call sites (zotero/actions, apiKeys/actions, extraction/workpoolActions) to use audited decryptApiKey
- Made `encryptedApiKey` and `keyPrefix` required (non-optional) in zoteroConnections schema
- Updated return validators in zotero/internal.ts to reflect required fields
- Zero direct decrypt() calls remain outside crypto.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create centralized decryptApiKey utility with audit logging** - `b4b65bd` (feat)
2. **Task 2: Migrate all decrypt call sites to decryptApiKey and make encryptedApiKey required** - `9fcd51c` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `convex/lib/crypto.ts` - Added decryptApiKey() wrapper with structured audit logging
- `convex/schema.ts` - Made encryptedApiKey and keyPrefix required in zoteroConnections
- `convex/zotero/internal.ts` - Updated getConnection and listAllConnections return validators
- `convex/zotero/actions.ts` - Migrated resolveZoteroApiKey to use decryptApiKey with userId audit context
- `convex/extraction/workpoolActions.ts` - Migrated PDF download decrypt to decryptApiKey with system audit context
- `convex/apiKeys/actions.ts` - Migrated getDecrypted handler to decryptApiKey with user and provider audit context

## Decisions Made
- Used console.log JSON audit format matching existing AUDIT pattern (e.g. `[AUDIT:KEY_DECRYPT]`) for consistency
- For extraction workpool (internal action), used `String(job.userId)` with "system" fallback since it's an internal action without direct user context
- Removed the null guard for `connection.encryptedApiKey` in resolveZoteroApiKey since the schema now guarantees it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- TYPE-05 (required encryptedApiKey) and SEC-01 (audited decrypt) are complete
- Ready for 50-02 plan execution (remaining security/schema tasks)
- Deploy will enforce the required field constraint (all existing rows already have encryptedApiKey populated from Phase 43 migration)

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 50-security-schema*
*Completed: 2026-03-03*
