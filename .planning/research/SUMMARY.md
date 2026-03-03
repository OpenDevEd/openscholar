# Project Research Summary

**Project:** OpenAlex Count — v3.0 Zero-Any Overhaul
**Domain:** Codebase hardening — eliminating `as any` casts, XSS vectors, unbounded queries, and ephemeral audit logging from an existing Convex + Next.js academic extraction platform
**Researched:** 2026-03-03
**Confidence:** HIGH

## Executive Summary

This is a codebase hardening milestone, not a greenfield feature build. The v3.0 overhaul resolves 12 documented concerns across four categories: type safety (`as any` casts), security (XSS, audit persistence, env validation), performance (unbounded queries, synchronous bundle weight), and correctness (rate limiter exhaustiveness, credit TOCTOU, typed workflow IDs). Every concern has a known fix pattern that uses existing dependencies — **no new npm packages are required beyond a single conditional install** (`exceljs` if the XLSX migration proceeds). The stack is already configured for every capability needed.

The recommended approach is to resolve concerns in dependency order, moving from cheap isolated type fixes to medium-cost security changes to high-cost architectural changes. The lowest-risk items (Stripe cast fix, rate limiter typing, export/filtering type derivation) can ship independently and immediately. The highest-risk items (library pagination count fix, incremental aggregation) require careful testing against existing Convex behaviors and must not change cursor formats that are persisted in user URLs via nuqs.

The most significant risk in this milestone is not implementation complexity but subtle behavioral breakage: removing `as any` casts can silently produce `undefined` where values were previously returned (Stripe customer union), changing pagination cursor formats can break bookmarked library URLs, and audit table writes added to hot paths can slow extraction mutations by introducing OCC contention. Every fix requires a test written before the change, covering both the happy path and the previously-hidden failure path that the `as any` was masking.

---

## Key Findings

### Recommended Stack

The existing stack (Next.js, Convex `^1.31.7`, `@convex-dev/workflow ^0.3.4`, Stripe SDK v20, Zod `^4.3.6`, `convex-test ^0.0.41`) already contains every capability needed to resolve all 12 concerns. The only conditional addition is `exceljs@4.4.0` to replace the unmaintained `xlsx@0.18.5` package. The XSS fix requires zero new dependencies (React-native text splitting instead of DOMPurify).

**Core technologies for v3.0 fixes:**
- `exceljs@4.4.0` (conditional install): Actively maintained XLSX library; replaces `xlsx` which has known prototype pollution CVEs and is stagnant. Uses dynamic import to avoid the ~500KB static bundle weight.
- `paginationOptsValidator` from `convex ^1.31.7` (already installed): Apply to `getLibraryCount` unbounded `.collect()` — the main browse/search pagination was already migrated in a prior phase; only the count query and sparse-page UI handling remain.
- `vWorkflowId` from `@convex-dev/workflow ^0.3.4` (already installed): Replaces `workflowId as any` cast in extraction cancel path; requires verifying the component's exported type before changing schema.
- Zod `^4.3.6` (already installed): Env var validation schema for Convex-side startup validation; use `.issues` not `.errors` for error access in v4 API.
- `convex-test ^0.0.41` (already installed): Sequential concurrency invariant tests; true OCC simulation is not possible in the test mock — document this and test the invariant instead.

### Expected Features (Fix Scope)

**Must fix — active risk or broken at scale (P1):**
- XSS-safe text highlighting — `dangerouslySetInnerHTML` with unsanitized paper titles and AI answers is an active XSS vector; replace with React-native `HighlightedText` component
- Startup env var validation — silent misconfiguration on deployment; add cron-based validation calling existing `assertPlanPriceConfig()` plus a new encryption key check
- Rate limiter exhaustiveness — `name as any` in `consume` mutation allows any string, bypassing rate limit enforcement; replace with runtime validation against `Object.keys(rateLimitConfig)`
- Real library pagination (count fix) — `getLibraryCount` uses unbounded `.collect()`; the browse/search queries were already paginated in a prior phase

**Should fix — accumulating debt or reliability risk (P2):**
- Persistent audit table — `console.log` audit events are ephemeral and non-queryable; add `auditLogs` table with `writeAuditLog` internalMutation; audit only security-sensitive callers, not extraction hot paths
- Dynamic XLSX import + exceljs migration — remove ~500KB from initial bundle and replace CVE-exposed `xlsx` with actively maintained `exceljs`
- Subscription cron batching — 1,000 subscriptions processed per cron without circuit-breaking risks Stripe rate limit exhaustion; adopt self-scheduling batch pattern already used by `cleanupDeletedUsers`
- Typed `as any` casts in export/filtering — derive `ExtractionResultWithReview` type from existing validator; zero runtime change, pure compile-time safety
- Stripe customer type cast fix — direct pattern transplant from `convex/http.ts` to `maintenance/internal.ts`; requires test for expanded customer object path

**Defer or conditional (P3):**
- Incremental extraction report aggregation — high complexity architectural change; add `extractionJobStats` table and incremental upsert in workpool; prerequisite for lifting the 500-paper cap but optional for v3.0 completion
- Typed workflow cancel IDs — requires verifying `@convex-dev/workflow` exported type before changing schema; treat as a research item first
- Credit TOCTOU mitigation — precautionary; Convex OCC already prevents negative balances; add concurrency invariant test, implement workpool serialization only if negative balance is observed in production

**Anti-features (avoid):**
- DOMPurify for XSS highlighting — adds bundle weight and DOM requirement; React text splitting is strictly simpler and correct for this use case
- `assertPlanPriceConfig()` at module scope — blocks ALL functions in the module if env var missing; always call inside handlers, never at module load time
- Per-user workpool for all credit operations — introduces deadlock potential and serializes hot extraction paths unnecessarily
- Offset-based pagination — Convex does not natively support it; cursor-based pagination is already implemented for browse/search

### Architecture Approach

The v3.0 overhaul makes surgical modifications to five architectural domains without restructuring the existing Next.js + Convex layering. New schema components are limited to: an `auditLogs` table, a `logAuditEvent` internalMutation, and optionally an `extractionJobStats` table (for incremental aggregation). All other changes are in-place replacements within existing files. The client-facing library UI requires one targeted change: auto-calling `loadMore()` when a sparse page is returned from the collection-filtered query, which is a known behavior of the `convex-helpers` `filter()` + `.paginate()` pattern.

**Major components modified:**
1. `convex/lib/crypto.ts` + `convex/lib/debug_gate.ts` — add optional `auditWriter` callback for persistent audit logging; keep `console.log` as fallback for hot-path callers
2. `convex/library/queries.ts` — fix `getLibraryCount` unbounded `.collect()` to `.take(10_000)` bound; sparse-page UI side effect handled client-side
3. `convex/extraction/workpoolActions.ts` + `mutations.ts` — add incremental stats upsert on paper completion (if Domain 3 is in scope)
4. `lib/extraction/export.ts` + `export-dialog.tsx` — swap static `xlsx` import for dynamic `exceljs` import inside handler
5. `convex/schema.ts` — add `auditLogs` table; optionally add `extractionJobStats` table
6. `components/extraction/results-views/table-view.tsx` — replace all three `dangerouslySetInnerHTML` call sites with `<HighlightedText>` React component

### Critical Pitfalls

1. **`as any` removal silently produces `undefined` for Stripe customer union** — `fresh.customer` is a string by default (not an expanded object); any narrowing that throws for the string case will crash the maintenance cron for ALL subscriptions. Fix: `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id`. Write a test for BOTH branches before deploying.

2. **Library cursor format invalidation breaks bookmarked URLs** — the main browse/search queries already use `.paginate()`; only `getLibraryCount` still uses `.collect()`. DO NOT change the cursor format of existing paginated queries. Changing from `convex-helpers filter()` cursors to index-based cursors invalidates user-bookmarked URLs and requires a cursor migration handler (catch parse error, reset to page 1 via nuqs).

3. **ExcelJS API differences produce silently corrupt XLSX files** — ExcelJS uses a builder pattern incompatible with `xlsx`'s array-of-arrays API. A successful compile does not mean a valid Excel file. Write a round-trip test (generate, parse back, assert header and row counts) before shipping. Start with dynamic import of `xlsx` first; migrate to `exceljs` API in a second step.

4. **Audit table writes in extraction hot paths cause OCC contention** — if `decryptApiKey` is called inside extraction loops and each call inserts an audit record, a 500-paper job creates 500 DB writes in one mutation context. Keep `console.log` for hot-path callers; persist to DB only for user-facing security-sensitive operations (API key save, debug gate access).

5. **Env var validation at module scope blocks non-billing functions** — calling `assertPlanPriceConfig()` at the top level of `convex/lib/constants.ts` will block ALL functions that import that module when Stripe env vars are missing (including subscription status queries). Always call validation inside the specific handler that uses the env var, never at module load time.

---

## Implications for Roadmap

Based on dependencies, risk level, and test requirements, the recommended phase structure is:

### Phase 1: Type Safety Sweep

**Rationale:** These are the cheapest changes with the highest compile-time safety payoff and zero runtime risk if approached with test-first discipline. They are independent of each other and of all other phases — ideal to ship first to build confidence.

**Delivers:** Elimination of `as any` casts from non-architectural paths; TypeScript catches field renames and schema changes from this point forward.

**Addresses:**
- Typed `as any` casts in `lib/extraction/export.ts` and `filtering.ts` (derive `ExtractionResultWithReview` from existing `extractionResultWithReviewValidator`)
- Stripe customer type cast fix in `convex/maintenance/internal.ts` (pattern transplant from `convex/http.ts`)
- Rate limiter exhaustiveness in `consume` mutation (runtime validation against `Object.keys(rateLimitConfig)`)
- Typed workflow cancel IDs (research `@convex-dev/workflow` type first, then schema fix or intermediate guard)

**Avoids:** Write tests for both union branches of the Stripe customer fix before deploying. Research `@convex-dev/workflow` exported types before touching schema — do not cast to `Id<"_scheduled_functions">` without verification.

**Research flag:** Standard type guard narrowing patterns — skip research-phase. Workflow ID type requires one focused lookup of `@convex-dev/workflow` type definitions before writing any code.

---

### Phase 2: Security and Audit

**Rationale:** These require new infrastructure (audit table schema change) or cross-cutting call site updates (XSS fix touches three render sites, env validation requires a new cron). Grouped together because they share a schema deploy and have a related security scope.

**Delivers:** XSS-safe highlighting, startup misconfiguration detection, queryable audit history for security-sensitive operations.

**Addresses:**
- XSS-safe `HighlightedText` React component (replace all three `dangerouslySetInnerHTML` sites in `table-view.tsx`)
- Startup env var validation (cron calls `assertPlanPriceConfig()` plus encryption key check — never at module scope)
- Persistent audit table (`auditLogs` schema, `writeAuditLog` internalMutation, optional writer pattern in `crypto.ts` via callback, not signature change)

**Avoids:** XSS test must verify HTML characters in both `text` and `query` parameters; highlighting must remain case-insensitive with regex-escaped query. Env validation must call inside handlers. Audit writes must NOT enter extraction loops — define audit scope (user-facing security operations only) before writing code.

**Research flag:** Standard well-documented patterns — skip research-phase for XSS React component and audit table. Env validation placement has a Convex-specific pitfall (module-scope blocking) that is documented in PITFALLS.md — consult before implementation.

---

### Phase 3: Performance Fixes

**Rationale:** The remaining `.collect()` in `getLibraryCount` is a correctness-at-scale issue. Subscription cron batching and dynamic XLSX import are reliability and bundle improvements. Grouped together as infrastructure-touching changes that are each independent of one another.

**Delivers:** Bounded library item count query, XLSX bundle removed from initial page load (~500KB reduction), Stripe rate limit risk eliminated from subscription cron.

**Addresses:**
- `getLibraryCount` unbounded `.collect()` fix (`.take(10_000)` bound)
- Dynamic XLSX import + `exceljs` migration (remove `xlsx`, install `exceljs`, rewrite export API with dynamic import inside handler)
- Subscription cron batching with circuit-breaker (cursor-based self-scheduling, 45s time budget, parallel Stripe calls within each batch)

**Avoids:** ExcelJS migration requires a round-trip XLSX test before shipping. Ship the dynamic import of `xlsx` first as a separate step to confirm bundle size reduction before committing to full API rewrite. The subscription batch pattern has a direct codebase analog (`cleanupDeletedUsers`) — read that pattern first.

**Research flag:** ExcelJS API differences from `xlsx` are non-trivial — dedicate time to reading ExcelJS docs for workbook/worksheet/row construction before writing code. This phase benefits from a brief research-phase for the ExcelJS migration step.

---

### Phase 4: Incremental Extraction Aggregation (Conditional)

**Rationale:** The highest-complexity change in the overhaul. Requires a new table, a modified write path in workpool workers on every paper completion, and a modified read path in reporting. It is the prerequisite for lifting the 500-paper cap in a future milestone. Deferred to its own phase because it can be implemented independently and carries the highest regression risk to the extraction pipeline.

**Delivers:** Extraction report generation decoupled from loading all result records; O(questions) instead of O(papers × questions) at report time; `MAX_PAPERS_PER_JOB` cap can be lifted in a subsequent milestone once the incremental path is validated end-to-end.

**Addresses:**
- Incremental extraction report aggregation (`extractionJobStats` table, upsert in `workpoolActions.ts`, backfill fallback for existing jobs, cascade delete inclusion)

**Avoids:** Upsert must be atomic (Convex OCC handles this). Cascade delete must include `extractionJobStats` records. Existing jobs need a backfill path (first report request fans out, then persists stats). Do NOT remove the 500-paper cap until the incremental path is tested in production with real jobs.

**Research flag:** This phase warrants `/gsd:research-phase` during planning to validate the upsert pattern, confirm OCC handles concurrent paper completions correctly, and design the backfill strategy for existing completed jobs.

---

### Phase 5: Credit Concurrency Validation (Conditional)

**Rationale:** The credit TOCTOU concern is documented but no negative-balance incident has been observed. Convex OCC already prevents negative balances. This phase adds the missing concurrency invariant test and closes the concern based on test evidence rather than assumption.

**Delivers:** Confirmed OCC protection for credit deduction; per-user workpool mitigation implemented only if test reveals an actual gap (negative balance produced).

**Addresses:**
- Credit TOCTOU mitigation (concurrency invariant test first; workpool implementation only if negative balance is observed in test output)

**Avoids:** Do NOT implement per-user workpool unless the test confirms OCC is insufficient — it introduces deadlock potential for nested workpool calls and serializes hot extraction paths. The test must assert no negative balance, not merely that two concurrent requests are processed.

**Research flag:** Standard concurrency testing pattern in `convex-test` — skip research-phase. This phase can run in parallel with any other phase since it is test-only until a gap is confirmed.

---

### Phase Ordering Rationale

- Phase 1 is first because type fixes are isolated, low-risk, and immediately verifiable — they build implementation confidence before touching infrastructure.
- Phase 2 follows because the security fixes require a schema deploy (audit table) and cross-cutting call site changes that are easier to reason about after the type fixes are clean.
- Phase 3 groups the remaining performance fixes that have external dependency changes (`exceljs`) and cron restructuring — isolated from core extraction path changes.
- Phase 4 is last among code changes because it modifies the write path of every active extraction job — highest regression risk, requires the most careful testing.
- Phase 5 is conditional and can run in parallel with any other phase since it is test-only until a gap is confirmed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All fixes use already-installed dependencies. Only ExcelJS is a conditional new install. ESM compatibility verified for Next.js route handler context. ExcelJS ESM issue is a bundler artifact — not applicable to Next.js Node.js API routes. |
| Features | HIGH | 12 concerns fully enumerated in CONCERNS.md with exact file/line citations. Fix scope is tightly bounded with no ambiguity about scope. BILL-02 explicitly out of scope. |
| Architecture | HIGH | All integration points verified against actual codebase files. Critical discovery: browse/search library pagination was already migrated in a prior phase — only `getLibraryCount` still uses `.collect()`. |
| Pitfalls | HIGH | Critical pitfalls derived from direct codebase inspection plus prior research (PITFALLS.md v2.3 and v2.4 are referenced — Pitfalls 5 and 6 from v2.3 remain directly applicable to env validation in v3.0). |

**Overall confidence:** HIGH

### Gaps to Address

- **`@convex-dev/workflow` ID type for `workflow.cancel()`:** The exact TypeScript type returned by `workflow.start()` must be read from the component's type definitions before changing the `extractionJobs` schema or removing the cast. If the type is a plain `string`, the fix is simpler than a schema migration. Treat Phase 1's workflow ID item as a research-first task.

- **Sparse-page UI behavior for collection-filtered library:** The `convex-helpers` `filter()` + `.paginate()` pattern produces sparse pages when the filter is selective. The library UI must handle `page.length < numItems && !isDone` by calling `loadMore()` automatically. The current behavior should be observed in the running app before assuming code changes are needed.

- **ExcelJS API parity for extraction data shapes:** The `formatAnswerForExcel()` function returns `any` and the export handles booleans, nulls, arrays, and strings. ExcelJS `CellValue` types must be verified compatible with each answer shape before migration is complete. A round-trip test is mandatory.

- **BILL-02 (upgrade metadata Stripe to Convex):** Listed in CONCERNS.md as tech debt but explicitly out of scope for v3.0. Do not add to any phase — verify migration completeness separately before implementing in a future milestone.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `convex/lib/rateLimit.ts:52`, `convex/maintenance/internal.ts:103`, `convex/library/queries.ts:243-254`, `convex/extraction/mutations.ts:263`, `convex/lib/crypto.ts:81-86`, `components/extraction/results-views/table-view.tsx:162-165/378-388/450-451`, `lib/extraction/export.ts:2`, `lib/extraction/filtering.ts:48/51`
- [Convex Pagination Docs](https://docs.convex.dev/database/pagination) — `paginationOptsValidator`, `.paginate()`, Cursor type
- [Convex OCC Docs](https://docs.convex.dev/database/advanced/occ) — serializability guarantees, automatic retry
- [Convex Transaction Limits](https://docs.convex.dev/production/state/limits) — 16,000 writes per transaction limit
- [ExcelJS GitHub Releases](https://github.com/exceljs/exceljs/releases) — v4.4.0 (October 2024), CJS-only internals
- [ExcelJS ESM Discussion #2853](https://github.com/exceljs/exceljs/discussions/2853) — CJS dynamic require issue in bundled ESM; not applicable to Next.js Node.js route handler context
- [Stripe SDK issue #1556](https://github.com/stripe/stripe-node/issues/1556) — `typeof x === 'string'` is the official workaround for the customer union type; conditional generics explicitly declined by maintainers
- [@convex-dev/workflow npm](https://www.npmjs.com/package/@convex-dev/workflow) — v0.3.4, `vWorkflowId` exported; v0.2.7 added `WorkflowId` type
- [Zod v4 Changelog](https://zod.dev/v4/changelog) — `.issues` not `.errors`; `.parse()` and `.safeParse()` unchanged

### Secondary (MEDIUM confidence)
- [Convex Stack: Take Control of Pagination](https://stack.convex.dev/pagination) — `getPage` helper; `convex-helpers` sparse page behavior
- Prior research: `.planning/research/FEATURES_v2.3_HARDENING.md`, `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md` — scheduler batching patterns and env validation pitfalls remain directly applicable
- [@t3-oss/env-nextjs docs](https://env.t3.gg/docs/introduction) — evaluated and rejected; does not cover Convex runtime env vars

### Tertiary (LOW confidence)
- `convex-helpers` GitHub issue #864 — sparse page behavior with `filter().paginate()`; workaround is UI-side `loadMore()` on short pages

---

*Research completed: 2026-03-03*
*Ready for roadmap: yes*
