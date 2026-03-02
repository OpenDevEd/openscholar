# Project Research Summary

**Project:** openalex-count — v2.3 Codebase Hardening
**Domain:** Convex + Next.js backend hardening (type safety, security, performance, data integrity)
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

v2.3 is a pure internal quality milestone with no user-facing features. The codebase has a set of well-understood, actively harmful gaps: plaintext Zotero API keys in the database, a deletion cascade that orphans child records on every delete, a rate limiter that exists only as a configuration stub with zero enforcement, and 30+ `ctx: any` and `internal as any` casts that defeat the type system. Every one of these problems can be fixed using packages already installed (`convex@1.32.0`, `convex-helpers@0.1.112`) and built-in Node.js `crypto` — zero new dependencies are required. The gap is entirely in how existing capabilities are used.

The recommended approach is to proceed in strict dependency order: clean up debug cruft first (lowest risk, builds confidence), then do the type safety sweep (establishes the foundation), then address data integrity (cascade fix + encryption), then performance (N+1 resolution, pagination), and finally enforcement (rate limiting). This order is mandated by the pitfall research — the type sweep and cascade fix touch the same 2000-line file (`extraction/mutations.ts`); doing them in parallel or the wrong order risks introducing regressions while refactoring already-sensitive deletion logic.

The critical risk is that well-intentioned fixes introduce regressions. The pitfall research is explicit: replacing `ctx: any` must be a pure type annotation change with no runtime logic changes, and removing the Stripe `"dummy"` key fallback must use lazy initialization (not module-scope throws) or it will break the entire billing module. Every phase must be verified with `npx convex dev` and the full test suite before the next phase begins. Schema changes must deploy all new fields as `v.optional()` first, following Convex's dual-write migration pattern.

## Key Findings

### Recommended Stack

No new dependencies. Every hardening fix uses existing installed packages or Node.js built-ins. The significant finding is that `convex-helpers@0.1.112` already ships a complete token-bucket rate limiter (`convex-helpers/server/rateLimit`) that just needs a schema table added and enforcement calls inserted — the current `convex/lib/rateLimit.ts` is a dead stub. The generated types in `convex/_generated/server.d.ts` and `convex/_generated/api.d.ts` already export fully-typed `QueryCtx`, `MutationCtx`, `internal`, and `components` — the `as any` casts throughout the codebase are unnecessary.

**Core technologies (already installed — no changes):**
- `convex@1.32.0`: Backend runtime — activate its type system; stop casting generated types to `any`
- `convex-helpers@0.1.112`: Rate limiting — replace the stub in `convex/lib/rateLimit.ts` with `defineRateLimits` from `convex-helpers/server/rateLimit`
- `Node.js crypto` (built-in): AES-256-GCM — reuse the existing `encrypt`/`decrypt` pattern from `convex/apiKeys/actions.ts` for Zotero keys

**Note on FEATURES.md vs STACK.md discrepancy:** FEATURES.md recommends `@convex-dev/rate-limiter` (official Convex component requiring install). STACK.md recommends `convex-helpers/server/rateLimit` (already installed, no component registration). The STACK.md finding is authoritative — using convex-helpers avoids adding a new component dependency and the algorithm is equivalent. Adopt `convex-helpers` for rate limiting.

### Expected Features (Hardening Items)

This milestone has no user-facing features. Every item is an internal fix categorized by urgency.

**Must fix (P1 — active security, data loss, or runtime risk):**
- Zotero API key encryption — only plaintext user secret in the database
- Deletion cascade: add evidence units — orphans `extractionEvidenceUnits` rows on every delete
- Deletion cascade: add storage cleanup — leaks Convex storage costs on every delete
- Orphaned PDF cleanup for failed papers — `download_failed`/`failed` papers with `storageId` never cleaned
- Stripe `"dummy"` key removal — silent auth failures in misconfigured prod (use lazy init pattern)
- Env var validation for `NEXT_PUBLIC_APP_URL` — risk of Stripe/Zotero OAuth redirect to localhost
- Remove production `console.log` — active log pollution in `openalex.ts` and billing page
- Fix `@ts-ignore` in `debug_papers.ts` — accessing non-existent field `p.pdfUsed` (renamed to `pdfContentUsed`)

**Should fix (P2 — prevents future incidents):**
- Rate limiting enforcement — config-only stub is completely unenforced; all endpoints open to abuse
- N+1 query fix in `loadJobDataForReporting` and `loadJobPapersAndResults` — 200+ sequential reads for 100-paper jobs; hits Convex transaction limits
- Deletion cascade: fix recursion to scheduler pattern — current O(n^2) re-scanning with recursion risk
- Debug/test function isolation — 14 debug/test files in production; gate behind `requirePublicDebugEnabled()`
- Unbounded `.collect()` audit — backfill full table scan and active subscription scan are the priority

**Defer (P3 — maintainability improvements):**
- Type safety sweep: `ctx: any` to `MutationCtx`/`QueryCtx` (~15 occurrences)
- Type safety: `internal as any` and `components as any` removal (~7 files)
- Type safety: `patchData: any` to typed partial
- Test coverage: extraction cascade delete
- Test coverage: Zustand store migrations

### Architecture Approach

The hardening work is concentrated in a small number of hot files. The most-touched file is `convex/extraction/mutations.ts` (2000+ lines) which contains the cascade delete, N+1 queries, type casts, and unbounded `.collect()` calls simultaneously — this is why phase ordering is critical. The schema requires two targeted additions: `rateLimitTables` (spreads into schema from convex-helpers) and the `zoteroConnections` table modification (`apiKey` field split into `encryptedApiKey` + `keyPrefix`). Both schema changes must deploy with `v.optional()` first.

**Major components and their hardening responsibilities:**
1. `convex/extraction/mutations.ts` — Cascade delete rewrite, N+1 fix, type sweep, `patchData` typing (highest-risk file; must not be touched by two phases simultaneously)
2. `convex/extraction/queries.ts` — N+1 fix for `loadJobPapersAndResults`, type sweep (QueryCtx)
3. `convex/lib/rateLimit.ts` — Full replacement: config stub to `defineRateLimits` from convex-helpers
4. `convex/schema.ts` — Add `rateLimitTables`, modify `zoteroConnections` (all new fields as `v.optional()` first)
5. `convex/lib/crypto.ts` (new file) — Extract shared `encrypt`/`decrypt` from `apiKeys/actions.ts`
6. `convex/zotero/actions.ts` — Encrypt on write, decrypt on read using shared crypto module
7. `convex/http.ts`, `convex/crons.ts`, billing modules — Remove `internal as any` / `components as any` casts
8. `app/actions/openalex.ts`, `app/settings/billing/page.tsx` — Remove production `console.log`

**Key architectural pattern — Convex action/mutation boundary for crypto:** AES-256-GCM requires Node.js `crypto`, which only runs in Convex actions (`"use node"`). Mutations and queries cannot encrypt/decrypt. The existing `apiKeys` pattern (encrypt in action, store encrypted value via mutation call, decrypt in action before use) must be extended to Zotero.

### Critical Pitfalls

1. **Type sweep breaks runtime behavior** — When `(q: any)` is replaced with a typed callback, the compiler may flag a wrong index name. The temptation is to "fix" the name, but the runtime was already working with string-based resolution. Rule: if a type change requires modifying a query body, stop and verify runtime behavior first. Run `npx convex dev` to regenerate types BEFORE making any type changes. (Confidence: HIGH)

2. **Stripe dummy key removal breaks development and CI** — Removing `|| "dummy"` and throwing at module scope makes the entire billing module uncallable (including non-Stripe functions) whenever `STRIPE_SECRET_KEY` is unset. Use a lazy initialization function (`getStripe()`) that throws only when actually called, not at module load time. (Confidence: HIGH)

3. **Deletion cascade ordering errors cause permanent orphans** — Evidence units must be deleted before papers (they reference `paperId`). Papers deleted before their evidence units leaves orphaned rows with no way to find them. Required order: evidence units -> reviews -> results -> papers (with storage cleanup) -> questions -> job. Use `ctx.scheduler.runAfter(0, ...)` not recursive `ctx.runMutation(internal...)` — the recursive pattern re-scans from the beginning each time (O(n^2)). (Confidence: HIGH)

4. **Zotero key migration corrupts existing connections** — Changing the `zoteroConnections` schema requires a multi-step migration. Do NOT rename `apiKey` to `encryptedApiKey` in one deployment. Add `encryptedApiKey: v.optional(v.string())` first, run a migration action that encrypts and writes the new field while keeping the old one, then make `encryptedApiKey` required and remove `apiKey` in a follow-up deployment. Migration action must be idempotent (skip rows where `encryptedApiKey` is already set). (Confidence: HIGH)

5. **Schema changes for multiple fixes require coordinated deployment** — Multiple phases touch the schema: rate limiting adds `rateLimitTables`, Zotero encryption modifies `zoteroConnections`. All new fields must start as `v.optional()`. Group all schema additions into one deployment before any data migration code ships. (Confidence: HIGH)

## Implications for Roadmap

Based on research, the pitfall guidance gives an explicit phase ordering. The roadmapper should adopt this order directly — it is driven by file-level conflicts and dependency chains, not preference.

### Phase 1: Quick Wins and Debug Cleanup
**Rationale:** Lowest risk, zero schema changes, zero behavioral changes. Each fix is a one-to-five line deletion or rename. Starting here builds confidence and establishes a clean baseline before touching the high-risk files.
**Delivers:** Production logs cleaned, ts-ignore fixed, debug function surface area reduced, billing module correctly fails on misconfiguration.
**Addresses (P1 items):** Remove production `console.log`, fix `@ts-ignore` in `debug_papers.ts`, remove Stripe `"dummy"` key (lazy init), add env var validation for `NEXT_PUBLIC_APP_URL`.
**Also addresses:** Debug/test function isolation (gate behind `requirePublicDebugEnabled()`), remove test exports from `convex/extraction/index.ts`.
**Avoids:** Pitfall 5 (lazy Stripe init, not module-scope throw), Pitfall 13 (manual log removal, not blanket compiler config), Pitfall 10 (grep all references before removing any debug function).
**Research flag:** Standard patterns — no research phase needed.

### Phase 2: Type Safety Sweep
**Rationale:** Must happen before the cascade fix and N+1 fix because those fixes touch the same files. Doing the type sweep first means the cascade rewrite happens in a codebase where `ctx` is already properly typed, making the rewrite safer and the diff cleaner.
**Delivers:** Compile-time type safety in extraction module, billing module, crons, http webhooks. Removes all `ctx: any`, `internal as any`, `components as any`, and `patchData: any`.
**Addresses (P3 items):** Full type safety sweep across 10+ files.
**Avoids:** Pitfall 1 (run `npx convex dev` first, regenerate types, never change logic to satisfy type checker), Pitfall 2 (stale codegen causes spurious errors — regenerate before editing), Pitfall 17 (never combine type sweep with cascade logic changes in the same PR).
**Key constraint:** Treat this as a pure annotation change. The test suite must pass with zero behavior changes. Run `npx convex dev` before starting.
**Research flag:** Standard patterns — no research phase needed.

### Phase 3: Schema Additions (Coordinated)
**Rationale:** Multiple later phases (rate limiting, Zotero encryption) require schema changes. Deploying all schema additions together in one phase, as `v.optional()` fields, avoids the Pitfall 19 coordination failure. This phase has no logic changes — just schema + codegen.
**Delivers:** `rateLimits` table (from `rateLimitTables`), `zoteroConnections.encryptedApiKey: v.optional(v.string())`, `zoteroConnections.keyPrefix: v.optional(v.string())`.
**Avoids:** Pitfall 19 (all fields `v.optional()` first; one coordinated deployment; test with `npx convex deploy --preview`).
**Research flag:** Standard patterns — no research phase needed.

### Phase 4: Data Integrity — Cascade Delete and Storage Cleanup
**Rationale:** Highest-value data integrity fix. Every job deletion since launch has orphaned `extractionEvidenceUnits` rows and leaked Convex storage. Fixing this stops the accumulating technical debt. Depends on type sweep (Phase 2) being complete — the cascade code is in the same file and must be refactored with proper types.
**Delivers:** Correct deletion cascade (evidence units -> reviews -> results -> papers + storage -> questions -> job), scheduler-based batching replacing O(n^2) recursion, orphaned PDF cleanup extended to failed/download_failed papers.
**Addresses (P1 + P2 items):** Deletion cascade evidence units, deletion cascade storage cleanup, orphaned PDF cleanup, cascade recursion pattern fix.
**Avoids:** Pitfall 3 (strict deletion order, phase tracking with cursor), Pitfall 17 (cascade done after type sweep ships), Pitfall 20 (storage deletes batched, not inline for large jobs).
**Research flag:** Well-documented Convex scheduler pattern — no research phase needed, but write comprehensive test after implementing.

### Phase 5: Security Hardening — Zotero Encryption
**Rationale:** Depends on Phase 3 (schema has `encryptedApiKey` field). The Zotero key is the only unencrypted user secret in the database. The migration must follow the dual-write pattern to avoid corrupting existing connections.
**Delivers:** Zotero API keys encrypted at rest with AES-256-GCM (same as provider API keys), shared `convex/lib/crypto.ts` utility, idempotent migration from plaintext to encrypted.
**Addresses (P1 items):** Zotero API key encryption.
**Avoids:** Pitfall 4 (multi-step migration: add optional field first, migrate data, make required, remove old field; action must be idempotent; validate `ENCRYPTION_KEY` before starting), Pitfall 11 (add `keyVersion` field for future key rotation).
**Research flag:** Well-documented pattern (reuse of existing `apiKeys/actions.ts`) — no research phase needed.

### Phase 6: Performance — N+1 Resolution and Bounded Queries
**Rationale:** Depends on type sweep (Phase 2) being complete for safe refactoring. N+1 queries in `loadJobDataForReporting` and `loadJobPapersAndResults` will hit Convex transaction limits as job sizes grow. The `Promise.all` parallelization fix is the correct first step (safer than batch-by-jobId which requires schema changes).
**Delivers:** Parallelized per-paper queries using `Promise.all` in both reporting functions, bounded `.collect()` calls for the top unbounded queries (backfill full table scan, active subscription scan).
**Addresses (P2 items):** N+1 fix for both functions, top-3 unbounded `.collect()` audit.
**Avoids:** Pitfall 7 (keep return type identical before and after; `Promise.all` is the safe intermediate step), Pitfall 8 (audit each `.collect()` individually — bounded per-user/per-job calls are fine), Pitfall 12 (do not add `.take()` to reactive UI queries — only safe for one-shot action queries).
**Research flag:** Standard Convex patterns — no research phase needed.

### Phase 7: Rate Limiting Enforcement
**Rationale:** Last because it is additive behavior (new enforcement logic) rather than a fix for existing broken behavior. Deploying separately from performance fixes avoids the OCC interaction (Pitfall 18). Depends on schema additions (Phase 3) for the `rateLimits` table.
**Delivers:** Enforced token-bucket rate limits on `start-extraction`, `api-key-save`, `checkout-session`, and `ensure-user` endpoints using `convex-helpers/server/rateLimit`.
**Addresses (P2 items):** Rate limiting enforcement.
**Avoids:** Pitfall 9 (use convex-helpers implementation which handles OCC correctly for low-volume endpoints; do not roll a custom counter), Pitfall 18 (deploy separately from N+1 fixes).
**Key decision:** Use `convex-helpers/server/rateLimit` (already installed) NOT `@convex-dev/rate-limiter` component (requires install + component registration). Same algorithm, zero new dependency.
**Research flag:** Standard patterns — no research phase needed.

### Phase 8: Test Coverage
**Rationale:** Tests for the deletion cascade should be written against the corrected implementation (Phase 4), not the broken original. Zustand migration tests are independent and can be done in any order.
**Delivers:** Test coverage for extraction cascade delete (verify all child entities deleted), Zustand store migration chain tests (5-version chain verified).
**Addresses (P3 items):** Test coverage for two previously untested subsystems.
**Research flag:** Standard Convex test patterns using `convex-test@0.0.41` — no research phase needed.

### Phase Ordering Rationale

- **Phase 1 before all others:** No risk. Establishes clean baseline. Debug cleanup requires knowing which functions are referenced elsewhere (Pitfall 10 — grep before removing).
- **Phase 2 (type sweep) before Phases 4 and 6:** The cascade fix and N+1 fix both touch `extraction/mutations.ts`. Doing the type sweep first means those rewrites happen in a properly-typed file. Never combine type annotation changes with logic changes in the same PR.
- **Phase 3 (schema) before Phases 5 and 7:** Rate limiting and Zotero encryption both need schema fields. One coordinated schema deployment avoids repeated deploy cycles and the risk of required-field schema push failures.
- **Phase 4 (cascade) before Phase 8 (tests):** Tests should validate the corrected behavior, not the broken original.
- **Phase 7 (rate limiting) last:** It is additive, not corrective. Any latency from Convex OCC on the rate limit table should not interact with the query performance changes from Phase 6.

### Research Flags

Phases with standard patterns (skip research-phase):
- **All 8 phases:** Every fix uses verified Convex patterns from official documentation. No third-party integrations, no novel algorithms, no ambiguous API surfaces. The STACK, FEATURES, ARCHITECTURE, and PITFALLS research is at HIGH confidence throughout and directly cites the relevant generated type files and installed package versions. The roadmapper should NOT trigger `gsd:research-phase` for any phase — proceed directly to implementation planning.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against installed package versions and generated type declarations in `_generated/server.d.ts` and `_generated/api.d.ts`. Zero new dependencies. |
| Features | HIGH | All hardening items verified against actual source files with line numbers. Priority tiers are based on active risk assessment, not speculation. |
| Architecture | HIGH | Integration points catalogued per-file with exact line numbers. Verified encryption pattern against existing `convex/apiKeys/actions.ts`. Convex action/mutation runtime boundary constraint confirmed. |
| Pitfalls | HIGH | 20 pitfalls documented with direct codebase evidence. All critical pitfalls have HIGH confidence sourced from official Convex documentation and verified against actual production file locations. |

**Overall confidence:** HIGH

### Gaps to Address

- **Rate limiter choice:** FEATURES.md and STACK.md disagree on whether to use `@convex-dev/rate-limiter` (component) or `convex-helpers/server/rateLimit` (already installed). The roadmap adopts convex-helpers to avoid a new dependency. If the team prefers the official component for future flexibility, Phase 7 can switch — the interface is nearly identical.

- **`internal as any` root cause:** Some `as any` casts may be for component API functions (e.g., `@convex-dev/stripe`) that have incomplete type generation. After removing casts, `npx convex dev` may reveal genuine type gaps. If component types are incomplete, narrow casts (specific interface, not `any`) are acceptable. Assess after Phase 2.

- **Key versioning for encryption:** PITFALLS.md recommends adding `keyVersion` to both `apiKeys` and `zoteroConnections` for future key rotation. This is potentially deferred from Phase 5 scope but should be flagged as tech debt if not implemented. The risk is low for v2.3 since key rotation has not been needed, but it becomes harder to add retroactively.

- **Cascade test coverage scope:** Phase 8 test coverage for the cascade delete requires creating a full job graph (job + questions + papers + results + reviews + evidence units + storage IDs) in `convex-test`. The test scaffolding may be time-consuming. If the cascade is well-reviewed in Phase 4 with manual verification, Phase 8 tests can be scoped to the most critical invariants (zero orphaned rows after deletion).

## Sources

### Primary (HIGH confidence)
- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) — QueryCtx/MutationCtx typing patterns, `as any` elimination
- [Convex Paginated Queries](https://docs.convex.dev/database/pagination) — `.paginate()` API, `PaginationResult` shape
- [Convex Rate Limiting](https://stack.convex.dev/rate-limiting) — token bucket implementation, OCC pitfalls
- [convex-helpers rateLimit source](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/rateLimit.ts) — `defineRateLimits` API, `rateLimitTables` schema
- [Convex Intro to Migrations](https://stack.convex.dev/intro-to-migrations) — dual-write migration pattern for schema changes
- [Convex Queries That Scale](https://stack.convex.dev/queries-that-scale) — index optimization, `.collect()` limits (1024 docs, 32K scan)
- [Convex Transaction Limits](https://docs.convex.dev/production/state/limits) — 16,000 writes/transaction, 1s execution limit
- [Convex Query Functions](https://docs.convex.dev/functions/query-functions) — reactive query semantics and subscription model
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) — Promise.all for parallel reads, scheduler for batch continuation
- Generated type declarations verified: `convex/_generated/server.d.ts` (lines 107-143), `convex/_generated/api.d.ts` (lines 212-568)
- Installed package versions verified: `convex@1.32.0`, `convex-helpers@0.1.112`

### Secondary (MEDIUM confidence)
- [AES-256 Encryption Modes and Pitfalls](https://terrazone.io/aes-256-encryption-types/) — IV reuse risk, nonce exhaustion threshold
- [Stateful Online Migrations](https://stack.convex.dev/migrating-data-with-mutations) — cursor-based batch processing pattern
- [Convex Functional Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) — batched relationship fetching patterns

### Tertiary (codebase evidence)
- `convex/apiKeys/actions.ts` — existing AES-256-GCM encrypt/decrypt pattern (direct model for Zotero encryption)
- `convex/extraction/mutations.ts:968-1009` — current cascade delete implementation (confirmed missing evidence units, reviews, storage)
- `convex/lib/rateLimit.ts` — confirmed config-only stub with zero enforcement
- `convex/schema.ts:167-175` — confirmed `zoteroConnections` has plaintext `apiKey: v.string()`
- `convex/extraction/index.ts:94-121` — confirmed debug/test function exports in production deployment

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
