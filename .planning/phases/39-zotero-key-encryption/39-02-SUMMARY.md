---
phase: 39-zotero-key-encryption
plan: 02
subsystem: auth
tags: [aes-256-gcm, encryption, zotero, migration, security]

# Dependency graph
requires:
  - phase: 39-zotero-key-encryption
    plan: 01
    provides: "Shared crypto module, encrypt-on-write, dual-read fallback, migration helpers"
provides:
  - "Idempotent migrateToEncryptedKeys internalAction for bulk encryption of existing plaintext keys"
  - "Schema evolution: apiKey is now optional in zoteroConnections"
  - "encryptedApiKey is the single source of truth for new connections (no sentinel)"
  - "Dual-read fallback still works defensively for any un-migrated rows"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Idempotent migration action pattern with skip-if-already-encrypted guard"]

key-files:
  created: []
  modified: [convex/zotero/actions.ts, convex/schema.ts, convex/zotero/mutations.ts, convex/zotero/internal.ts]

key-decisions:
  - "Removed sentinel apiKey write entirely now that schema field is optional"
  - "Migration skips rows with no apiKey (defensive for connections created after schema change)"
  - "Explicit return type annotations on migrateToEncryptedKeys to avoid Convex circular inference issue"

patterns-established:
  - "Idempotent migration: check if target field is populated before processing, skip gracefully"

requirements-completed: [SEC-01]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 39 Plan 02: Zotero Key Migration Summary

**Idempotent migration action for encrypting existing plaintext Zotero keys, schema evolution to optional apiKey, sentinel removal**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T08:41:34Z
- **Completed:** 2026-03-02T08:43:54Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Added migrateToEncryptedKeys internalAction that encrypts all existing plaintext Zotero API keys in bulk
- Made apiKey field optional in zoteroConnections schema (v.optional(v.string()))
- Removed sentinel value "ENCRYPTED_SEE_encryptedApiKey" from saveConnection -- new connections no longer write apiKey at all
- Updated all return types (getConnection, listAllConnections, ZoteroConnection type) for optional apiKey
- Updated resolveZoteroApiKey to throw clear error when neither encrypted nor plaintext key is available

## Task Commits

Each task was committed atomically:

1. **Task 1: Add migration action and update schema** - `6fe97a9` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `convex/zotero/actions.ts` - Added migrateToEncryptedKeys internalAction, updated ZoteroConnection type and resolveZoteroApiKey
- `convex/schema.ts` - Changed apiKey from v.string() to v.optional(v.string()) in zoteroConnections
- `convex/zotero/mutations.ts` - Removed apiKey sentinel write from saveConnection insert
- `convex/zotero/internal.ts` - Updated getConnection and listAllConnections return validators for optional apiKey

## Decisions Made
- Removed sentinel apiKey write entirely since the schema field is now optional -- cleaner than keeping a meaningless string
- Migration skips rows with no apiKey (defensive for connections created post-schema-change that only have encryptedApiKey)
- Added explicit return type annotations on migrateToEncryptedKeys handler to avoid TypeScript circular inference with Convex internalAction

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added explicit type annotations for Convex circular inference**
- **Found during:** Task 1 (TypeScript verification)
- **Issue:** migrateToEncryptedKeys handler and connections variable had implicit 'any' type due to circular reference in Convex internalAction pattern
- **Fix:** Added explicit return type `Promise<{ total: number; migrated: number; skipped: number }>` and explicit array type for connections variable
- **Files modified:** convex/zotero/actions.ts
- **Verification:** `npx tsc --noEmit` passes with zero new errors
- **Committed in:** 6fe97a9 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added null guard for missing apiKey in migration**
- **Found during:** Task 1 (implementing migration)
- **Issue:** Plan assumed apiKey always exists, but after schema change it may be undefined for connections created without it
- **Fix:** Added `if (!conn.apiKey) { skipped++; continue; }` guard in migration loop
- **Files modified:** convex/zotero/actions.ts
- **Verification:** Migration safely skips rows with no plaintext key
- **Committed in:** 6fe97a9 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - ENCRYPTION_KEY environment variable is already configured from Phase 37. Migration action can be run from the Convex dashboard.

## Next Phase Readiness
- SEC-01 fully satisfied: Zotero API keys encrypted at rest with AES-256-GCM
- Phase 39 complete -- all plans executed
- No blockers for subsequent phases

## Self-Check: PASSED

All 4 modified files verified present. Task commit (6fe97a9) confirmed in git log.

---
*Phase: 39-zotero-key-encryption*
*Completed: 2026-03-02*
