---
phase: 39-zotero-key-encryption
plan: 01
subsystem: auth
tags: [aes-256-gcm, encryption, zotero, crypto, security]

# Dependency graph
requires:
  - phase: 37-rate-limit-schema-hardening
    provides: "encryptedApiKey and keyPrefix optional fields on zoteroConnections schema"
provides:
  - "Shared AES-256-GCM crypto module at convex/lib/crypto.ts"
  - "Zotero encrypt-on-write in completeOAuth"
  - "Zotero decrypt-on-read via resolveZoteroApiKey in all 5 action handlers + workpoolActions"
  - "Dual-read fallback for pre-migration plaintext keys"
  - "Migration helpers: listAllConnections query and patchEncryptedKey mutation"
affects: [39-02-migration, extraction-workpool]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Shared crypto module for AES-256-GCM encrypt/decrypt", "resolveZoteroApiKey dual-read fallback pattern"]

key-files:
  created: [convex/lib/crypto.ts]
  modified: [convex/apiKeys/actions.ts, convex/zotero/actions.ts, convex/zotero/mutations.ts, convex/zotero/internal.ts, convex/extraction/workpoolActions.ts]

key-decisions:
  - "Sentinel value 'ENCRYPTED_SEE_encryptedApiKey' in apiKey field for new connections (required field during transition)"
  - "resolveZoteroApiKey checks encryptedApiKey first, falls back to plaintext apiKey for pre-migration rows"

patterns-established:
  - "Shared crypto: import { encrypt, decrypt, getKeyPrefix } from lib/crypto for any module needing AES-256-GCM"
  - "Dual-read fallback: check encryptedApiKey presence before decrypting, fall back to plaintext for migration compatibility"

requirements-completed: [SEC-01]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 39 Plan 01: Zotero Key Encryption Summary

**Shared AES-256-GCM crypto module extracted from apiKeys, Zotero encrypt-on-write and decrypt-on-read across all action handlers with dual-read fallback**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T08:35:46Z
- **Completed:** 2026-03-02T08:39:18Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Extracted encrypt, decrypt, getKeyPrefix into shared convex/lib/crypto.ts module used by both apiKeys and zotero
- All new Zotero OAuth connections encrypt the API key with AES-256-GCM before storing
- All 5 Zotero action handlers (fetchCollections, fetchGroups, fetchItems, getAttachments, downloadFile) plus workpoolActions decrypt on read
- Dual-read fallback ensures pre-migration plaintext keys continue to work
- Migration helpers (listAllConnections, patchEncryptedKey) ready for Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract shared crypto module and update apiKeys imports** - `155f5f6` (feat)
2. **Task 2: Encrypt Zotero keys on write, decrypt on read, dual-read fallback** - `c07c15a` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `convex/lib/crypto.ts` - Shared AES-256-GCM encrypt/decrypt/getKeyPrefix module
- `convex/apiKeys/actions.ts` - Replaced local crypto functions with import from lib/crypto
- `convex/zotero/actions.ts` - Added resolveZoteroApiKey, encrypt in completeOAuth, decrypt in all 5 handlers
- `convex/zotero/mutations.ts` - saveConnection accepts encryptedApiKey + keyPrefix, added patchEncryptedKey
- `convex/zotero/internal.ts` - getConnection returns encryptedApiKey + apiKey, added listAllConnections
- `convex/extraction/workpoolActions.ts` - Decrypt Zotero key before passing to downloadPdf

## Decisions Made
- Used sentinel value "ENCRYPTED_SEE_encryptedApiKey" in the required `apiKey` schema field for new connections to maintain schema compatibility during transition period
- resolveZoteroApiKey checks encryptedApiKey first, falls back to plaintext apiKey for pre-migration rows

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. ENCRYPTION_KEY environment variable is already configured from Phase 37.

## Next Phase Readiness
- Plan 02 migration can use listAllConnections + patchEncryptedKey to encrypt all existing plaintext keys
- All read paths already handle dual-read, so migration is non-breaking
- No blockers

## Self-Check: PASSED

All 6 files verified present. Both task commits (155f5f6, c07c15a) confirmed in git log.

---
*Phase: 39-zotero-key-encryption*
*Completed: 2026-03-02*
