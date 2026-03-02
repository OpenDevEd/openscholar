---
phase: 39-zotero-key-encryption
verified: 2026-03-02T10:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 39: Zotero Key Encryption Verification Report

**Phase Goal:** Zotero API keys are encrypted at rest using the same AES-256-GCM pattern as provider API keys
**Verified:** 2026-03-02T10:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `encrypt`, `decrypt`, `getKeyPrefix` in `convex/lib/crypto.ts` produce the same `iv:authTag:ciphertext` format as the original `convex/apiKeys/actions.ts` implementation | VERIFIED | `convex/lib/crypto.ts` lines 11-64 contain AES-256-GCM with identical format (`${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`); `apiKeys/actions.ts` no longer contains local definitions |
| 2  | `apiKeys/actions.ts` imports `encrypt`, `decrypt`, `getKeyPrefix` from `lib/crypto` instead of defining them locally | VERIFIED | Line 6: `import { encrypt, decrypt, getKeyPrefix } from "../lib/crypto";` — no local `ALGORITHM`, `IV_LENGTH`, `encrypt`, `decrypt`, or `getKeyPrefix` definitions found |
| 3  | `completeOAuth` in `zotero/actions.ts` encrypts the access token before calling `saveConnection` | VERIFIED | Lines 609-623 of `zotero/actions.ts`: ENCRYPTION_KEY check, `encrypt(accessToken, encryptionKey)`, `getKeyPrefix(accessToken)`, then `saveConnection` called with `encryptedApiKey + keyPrefix` |
| 4  | Every Zotero action that calls `getConnection` decrypts the key before using it (fetchCollections, fetchGroups, fetchItems, getAttachments, downloadFile) | VERIFIED | All 5 handlers use `const apiKey = resolveZoteroApiKey(connection)` (lines 656, 709, 784, 998, 1065) — no direct `connection.apiKey` reads in any handler |
| 5  | `workpoolActions.ts` decrypts the Zotero API key before passing it to `downloadPdf` | VERIFIED | Lines 752-761: decrypt via `decrypt(zoteroConnection.encryptedApiKey, encryptionKey)` before constructing `zoteroApiKey`, then passed as `{ apiKey: zoteroApiKey, ... }` to `downloadPdf` |
| 6  | Connections with only a plaintext `apiKey` (pre-migration) still work via dual-read fallback | VERIFIED | `resolveZoteroApiKey` checks `connection.encryptedApiKey` first; if absent, falls back to `connection.apiKey` (line 43-44); `workpoolActions.ts` has same fallback pattern (line 759-760) |
| 7  | `migrateToEncryptedKeys` internalAction encrypts all existing plaintext Zotero API keys and is idempotent | VERIFIED | Lines 1097-1141 of `zotero/actions.ts`: iterates all connections via `listAllConnections`, skips rows where `encryptedApiKey` is already set OR where `apiKey` is missing, encrypts remaining rows via `patchEncryptedKey` |
| 8  | Migration is idempotent — re-running skips rows where `encryptedApiKey` is already populated | VERIFIED | Lines 1119-1127: `if (conn.encryptedApiKey) { skipped++; continue; }` and `if (!conn.apiKey) { skipped++; continue; }` |
| 9  | After migration, the plaintext `apiKey` field is optional in the schema and no new code path writes to it | VERIFIED | `convex/schema.ts` line 175: `apiKey: v.optional(v.string())` — `saveConnection` mutation does not write `apiKey` field; sentinel value `"ENCRYPTED_SEE_encryptedApiKey"` is absent from codebase |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/lib/crypto.ts` | Shared AES-256-GCM encrypt/decrypt/getKeyPrefix | VERIFIED | 64 lines; exports `encrypt`, `decrypt`, `getKeyPrefix`; uses `aes-256-gcm`, `iv:authTag:ciphertext` format; no "use node" directive |
| `convex/zotero/internal.ts` | `getConnection` returns both `encryptedApiKey` and `apiKey` for dual-read; `listAllConnections` for migration | VERIFIED | `getConnection` returns `v.optional(v.string())` for both fields; `listAllConnections` returns array with both optional fields |
| `convex/zotero/mutations.ts` | `saveConnection` accepts `encryptedApiKey + keyPrefix`; `patchEncryptedKey` mutation for migration | VERIFIED | `saveConnection` args are `encryptedApiKey: v.string(), keyPrefix: v.string()` — no `apiKey` field written; `patchEncryptedKey` exists at lines 113-124 |
| `convex/zotero/actions.ts` | `migrateToEncryptedKeys` internalAction; `resolveZoteroApiKey` helper; `encrypt` in `completeOAuth` | VERIFIED | All three present; migration action at line 1097; `resolveZoteroApiKey` at line 34; encrypt in `completeOAuth` at line 613 |
| `convex/schema.ts` | `apiKey` changed from `v.string()` to `v.optional(v.string())` in `zoteroConnections` | VERIFIED | Line 175: `apiKey: v.optional(v.string()),  // Deprecated: use encryptedApiKey. Optional after migration.` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/lib/crypto.ts` | `convex/apiKeys/actions.ts` | `import { encrypt, decrypt, getKeyPrefix }` | WIRED | Line 6 of `apiKeys/actions.ts`: `import { encrypt, decrypt, getKeyPrefix } from "../lib/crypto"` confirmed; no local definitions remain |
| `convex/lib/crypto.ts` | `convex/zotero/actions.ts` | `import { encrypt, decrypt, getKeyPrefix }` | WIRED | Line 15 of `zotero/actions.ts`: `import { encrypt, decrypt, getKeyPrefix } from "../lib/crypto"` confirmed |
| `convex/zotero/actions.ts` | `convex/zotero/mutations.ts` | `saveConnection` with `encryptedApiKey + keyPrefix` args | WIRED | Line 617: `ctx.runMutation(internal.zotero.mutations.saveConnection, { ..., encryptedApiKey, keyPrefix, ... })` confirmed |
| `convex/extraction/workpoolActions.ts` | `convex/lib/crypto.ts` | `import { decrypt }` | WIRED | Line 18: `import { decrypt } from "../lib/crypto"` confirmed; used at line 758 |
| `convex/zotero/actions.ts` (migrateToEncryptedKeys) | `convex/zotero/internal.ts` (listAllConnections) | `ctx.runQuery(internal.zotero.internal.listAllConnections)` | WIRED | Line 1114 confirmed; `listAllConnections` is exported from `internal.ts` |
| `convex/zotero/actions.ts` (migrateToEncryptedKeys) | `convex/zotero/mutations.ts` (patchEncryptedKey) | `ctx.runMutation(internal.zotero.mutations.patchEncryptedKey)` | WIRED | Line 1131 confirmed; `patchEncryptedKey` is exported from `mutations.ts` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEC-01 | 39-01, 39-02 | Zotero API key encrypted with AES-256-GCM (matching apiKeys pattern) | SATISFIED | Shared crypto module extracts AES-256-GCM from apiKeys; Zotero write path encrypts via `completeOAuth`; all read paths decrypt via `resolveZoteroApiKey`; schema makes plaintext field optional; migration action available to encrypt existing rows |

**REQUIREMENTS.md traceability:** SEC-01 is mapped to Phase 39 with status "Complete" (line 99). The requirement is marked `[x]` (line 27). Both plans (39-01 and 39-02) claim `requirements: [SEC-01]`. No orphaned requirements found — the only requirement ID mapped to Phase 39 is SEC-01.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned: `convex/lib/crypto.ts`, `convex/apiKeys/actions.ts`, `convex/zotero/actions.ts`, `convex/zotero/mutations.ts`, `convex/zotero/internal.ts`, `convex/extraction/workpoolActions.ts`, `convex/schema.ts`

- No TODO/FIXME/HACK/PLACEHOLDER comments in phase files
- No sentinel value `"ENCRYPTED_SEE_encryptedApiKey"` remaining in codebase (correctly removed in Plan 02)
- No `return null` / empty implementations
- No direct `connection.apiKey` reads in any Zotero action handler — all go through `resolveZoteroApiKey`

**TypeScript compilation:** `npx tsc --noEmit` produces 3 errors, all in `tests/` files (`credit_grant_missing_credits_row.test.ts` and `live-billing/*.test.ts`). These are pre-existing test type issues unrelated to Phase 39. All Convex production files compile cleanly.

---

### Human Verification Required

None. All observable behaviors are verifiable from the codebase:

- Encryption format is structurally verifiable (iv:authTag:ciphertext in AES-256-GCM)
- All write paths are statically traceable to `encrypt` call
- All read paths are statically traceable to `resolveZoteroApiKey` or inline `decrypt`
- Schema change is directly readable
- Migration action logic is deterministic and readable

The only aspect requiring runtime confirmation would be testing the actual encryption/decryption round-trip in a live environment, which is a deployment concern rather than a code verification concern.

---

### Commit Verification

All three task commits confirmed present in git history:

- `155f5f6` — feat(39-01): extract shared crypto module and update apiKeys imports
- `c07c15a` — feat(39-01): encrypt Zotero keys on write, decrypt on read, dual-read fallback
- `6fe97a9` — feat(39-02): add migration action, make apiKey optional, remove sentinel

---

### Summary

Phase 39 fully achieves its goal. Zotero API keys are encrypted at rest using AES-256-GCM, the same algorithm and format used by provider API keys:

1. **Shared crypto module** (`convex/lib/crypto.ts`) is the single source of AES-256-GCM logic, used by both `apiKeys/actions.ts` and `zotero/actions.ts`.
2. **Encrypt on write** — `completeOAuth` in `zotero/actions.ts` encrypts the access token before calling `saveConnection`. New connections never store plaintext.
3. **Decrypt on read** — all 5 Zotero action handlers and `workpoolActions.ts` route through `resolveZoteroApiKey` or inline decrypt before using the key.
4. **Dual-read fallback** — pre-migration plaintext rows still work; the fallback is defensive and correct.
5. **Schema evolved** — `apiKey` is now `v.optional(v.string())`. No new code path writes to it.
6. **Migration action** — `migrateToEncryptedKeys` is idempotent and ready to run from the Convex dashboard to encrypt existing rows.

SEC-01 is satisfied. No gaps. No blocker anti-patterns.

---

_Verified: 2026-03-02T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
