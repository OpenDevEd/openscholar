# Feature Research: v3.0 Zero-Any Overhaul

**Domain:** Codebase health — resolving all CONCERNS.md items in an existing Convex + Next.js academic search/extraction platform
**Researched:** 2026-03-03
**Confidence:** HIGH (all items have exact file locations in CONCERNS.md; fix patterns derived directly from the existing codebase and prior research)

## Overview

This is not a greenfield feature milestone. Every item is a resolution of a documented concern: tech debt, a known bug, a security risk, a performance bottleneck, or a fragile pattern. The framing throughout is: what does "correctly resolved" look like, what is the expected behavior after the fix, and what complexity and dependencies does the fix carry?

The 12 concern items from the milestone context are grouped into four categories matching their concern origin:

1. **Type safety** — eliminate `as any` casts across the whole codebase
2. **Security and audit** — persistent audit table, XSS-safe highlighting, startup validation, production exclusion
3. **Performance** — real server-side library pagination, incremental extraction aggregation, dynamic XLSX import, subscription cron batching
4. **Correctness** — rate limiter exhaustiveness, credit TOCTOU mitigation, typed workflow cancel IDs

---

## Feature Landscape

### Table Stakes (Must Resolve — Active Risk, Broken Behavior, or Safety Gaps)

These represent currently-broken behavior, active security risks, or patterns that will fail silently in production. Resolving them is non-negotiable for a "hardened" codebase milestone.

| # | Fix | Why Table Stakes | Complexity | Existing Code Dependency |
|---|-----|------------------|------------|--------------------------|
| 1 | **XSS-safe text highlighting** | `highlightText()` injects unsanitized paper titles and AI-generated answers into the DOM via `dangerouslySetInnerHTML`. Paper titles from OpenAlex could contain `<script>` or `<img onerror>` payloads. | MEDIUM | `components/extraction/results-views/table-view.tsx` lines 159–165, 293–297, 378–388, 450–451. The fix is React-native: split text on regex match, return an array of `<span>` and `<mark>` elements. No third-party library needed. The function signature changes from `string -> string` to `string -> ReactNode`. All three call sites using `dangerouslySetInnerHTML` must be updated to render JSX instead. |
| 2 | **Startup env var validation** | `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `CLERK_JWT_ISSUER_DOMAIN` are accessed lazily at call time. `assertPlanPriceConfig()` exists but is never called proactively. A misconfigured deployment runs silently until a user action triggers a failure. | LOW | `convex/lib/constants.ts` has `assertPlanPriceConfig()` already. Add a dedicated cron action that calls it (and equivalent checks for encryption and Stripe keys) on startup/warmup. Alternatively, call the check in the first operation of each major flow entry point. |
| 3 | **Rate limiter exhaustiveness enforcement** | `name: args.name as any` in `convex/lib/rateLimit.ts` line 52 bypasses the union type check on rate limit names. An invalid name string silently produces no rate-limit enforcement rather than failing at compile time. | LOW | `convex/lib/rateLimit.ts`. Replace `v.string()` arg with `v.union(v.literal("start-extraction"), v.literal("api-key-save"), v.literal("checkout-session"))` matching the `defineRateLimits` keys. The `args.name as any` cast can then be removed — TypeScript infers the correct union. Tests needed for invalid-name rejection. |
| 4 | **Typed workflow cancel IDs** | `workflow.cancel(ctx, job.workflowId as any)` in `convex/extraction/mutations.ts` line 263 casts a stored string to bypass the expected `Id<"_scheduled_functions">` type. If the `@convex-dev/workflow` component upgrades its ID type, this silently breaks at runtime. | LOW | `convex/extraction/mutations.ts`, `convex/schema.ts`. Store `workflowId` as `v.id("_scheduled_functions")` instead of `v.string()` in the `extractionJobs` schema (or verify the workflow component stores it that way). The cast then becomes unnecessary. Covered partially by cascade-delete tests but not specifically the cancel path. |

### Differentiators (Engineering Quality — Materially Improves Robustness or Maintainability)

These fix real issues that are not actively causing incidents today but carry meaningful risk of silent failure, accumulating debt, or performance degradation at scale.

| # | Fix | Value Proposition | Complexity | Existing Code Dependency |
|---|-----|-------------------|------------|--------------------------|
| 5 | **Persistent audit table** | `[AUDIT:KEY_DECRYPT]` and `[AUDIT:DEBUG_ACCESS]` events are emitted via `console.log` in `convex/lib/crypto.ts`. Convex function logs are ephemeral — they rotate and are not queryable by date range or userId. A persistent Convex `auditLog` table provides tamper-evident, queryable history. | MEDIUM | `convex/lib/crypto.ts` lines 81–86. New `auditLog` table in `convex/schema.ts`. New `logAuditEvent` internal mutation. The `decryptApiKey` function becomes an action (needs `ctx` to call the mutation) or the audit write is separated from the decrypt call. Existing call sites of `decryptApiKey` (Zotero actions, API key actions) must be updated to pass `ctx`. |
| 6 | **Real server-side Convex pagination for library** | `convex/library/queries.ts` calls `.collect()` on all user library items (lines 204, 217), then filters in JavaScript. For a user with thousands of items, this hits Convex query time limits and returns all documents to the function regardless of the requested page. | HIGH | `convex/library/queries.ts`. Use `paginationOptsValidator` and `.paginate()`. Collection membership filter must be pushed into a pre-query lookup (fetch collection item IDs first, then use them as a filter set). Rating and date filters stay as JavaScript post-filters on the paginated slice — acceptable because a single page is small. The library UI must adopt `usePaginatedQuery` instead of `useQuery`. This is the highest-complexity fix in this milestone. |
| 7 | **Incremental extraction report aggregation** | `loadJobDataForReporting` in `convex/extraction/mutations.ts` loads all 500 papers and all their results into memory simultaneously (up to 5,000 result records for a 500-paper, 10-question job). This hits Convex mutation time limits on large jobs and is the root cause of the 500-paper hard cap. | HIGH | `convex/extraction/mutations.ts` lines 47–84. The fix requires pre-aggregating insight data incrementally as each paper completes extraction, writing partial aggregates to a new `extractionInsightCache` document (or incrementally patching the `extractionJobs` document with running totals). At report time, the mutation reads cached aggregates instead of re-loading all results. This enables lifting the 500-paper cap in a subsequent milestone. |
| 8 | **Dynamic XLSX import / exceljs migration** | `lib/extraction/export.ts` imports `xlsx` at module level (`import * as XLSX from 'xlsx'`), bundling ~500KB into the main page chunk. The `xlsx` package is also a legacy OSS fork with known prototype pollution vulnerabilities and no active ESM support. | MEDIUM | `lib/extraction/export.ts` line 2, `components/extraction/export-dialog.tsx` line 17. Two changes: (a) switch from static import to `await import('exceljs')` inside the XLSX export handler (eliminates bundle cost for users who never export), and (b) rewrite the XLSX generation code against the `exceljs` API (actively maintained, ESM-native). The `ExcelJS.Workbook` API differs from `xlsx`'s `XLSX.utils.book_new()` pattern — a targeted rewrite is needed, not a drop-in swap. |
| 9 | **Subscription cron batching with circuit-breaking** | `convex/subscriptions/internal.ts` line 203 takes up to 1,000 active subscription records per hourly cron. Each record triggers a Stripe API call in `convex/maintenance/internal.ts`. 1,000 Stripe API calls in a single cron action can exhaust Stripe rate limits and exceed Convex action time budgets. | MEDIUM | `convex/subscriptions/internal.ts`, `convex/maintenance/internal.ts`. Add cursor-based pagination so the cron processes subscriptions in batches of 50–100, scheduling the next batch via `ctx.scheduler.runAfter(0, ...)`. Add a circuit-breaker: if a batch exceeds a wall-clock budget (e.g., 45s), schedule the remainder and log a warning. This mirrors the GDPR `cleanupDeletedUsers` pattern already in the codebase. |
| 10 | **`as any` casts for export/filtering fields** | `lib/extraction/export.ts` and `lib/extraction/filtering.ts` cast `result as any` to access `correctedAnswer`, `citations`, `citationStatus`, and `reviewState`. These fields exist in the schema and in `extractionResultWithReviewValidator` but are not part of the inferred query return type for these functions. If the query shape changes, these casts silently access `undefined`. | LOW | `convex/extraction/validators.ts` has `extractionResultWithReviewValidator`. Derive `ExtractionResultWithReview` as a TypeScript type from the validator using Convex's `Infer<>` utility. Thread this type through `lib/extraction/export.ts` and `lib/extraction/filtering.ts` to replace all `result as any` casts. No runtime behavior changes — purely compile-time safety. |
| 11 | **Stripe customer type cast in maintenance cron** | `convex/maintenance/internal.ts` line 103 uses `(fresh.customer as any)?.id` to handle both string and expanded object customer forms. The `typeof x === 'string' ? x : x?.id` pattern already used in `convex/http.ts` is the correct approach, but was not applied here. Silently produces `undefined` if Stripe returns an expanded customer object, skipping the subscription correction. | LOW | `convex/maintenance/internal.ts` line 103. Replace with `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id`. Add a test specifically for the expanded-customer-object path. The pattern is already established in `convex/http.ts` so this is a direct application of existing codebase style. |
| 12 | **Credit deduction TOCTOU mitigation** | Two concurrent actions can both read a sufficient balance and both call `deductCredits`. Convex OCC prevents negative balances (the mutation re-reads), but the user may experience a surprising `INSUFFICIENT_CREDITS` rejection on an operation they expected to succeed. The TOCTOU contract is documented in `convex/credits/internal.ts` lines 1238–1280. | MEDIUM | The mitigation strategy is already documented: route all `deductCredits` callers through a per-user workpool with `maxParallelism: 1`. This serializes deduction requests at the action level, eliminating the read-check gap entirely. The existing workpool infrastructure (already used for extraction) can be extended. This is a precautionary improvement — no incident has been observed. Implement only if the concurrency stress test reveals actual double-deduction failures. |

### Anti-Features (Approaches That Seem Good But Create Problems)

| Approach | Why Tempting | Why Problematic | Better Alternative |
|----------|--------------|-----------------|-------------------|
| **DOMPurify for XSS highlighting** | Industry-standard HTML sanitization | DOMPurify adds ~45KB to the bundle and introduces a dependency that must be kept up to date. For this use case — highlighting plain text with a single `<mark>` tag — it is complete overkill. | React-native text splitting: split on regex match, return `[<span>before</span>, <mark>match</mark>, <span>after</span>]`. No HTML injection, no sanitization needed, no bundle cost. |
| **Remove `highlightText` entirely** | "Just skip highlighting" | The feature is actively used in three places in the table view. Users depend on visual search feedback when filtering results. | Keep highlighting, just implement it without raw HTML injection. |
| **Offset-based pagination for library** | Page numbers feel more natural | Convex does not support offset pagination natively. Offset pagination is inconsistent when items are added/removed (pages shift). | Cursor-based `.paginate()` is the Convex-native pattern. The existing `getJobResultsPaginated` in extraction already demonstrates it. |
| **Full in-memory aggregation with higher cap** | Simplest code path | Raising `MAX_PAPERS_PER_JOB` to 1,000 just defers the time-limit failure to larger jobs. The root issue is loading all results simultaneously. | Incremental aggregation as results arrive; report reads cached totals. |
| **Keep `xlsx` with dynamic import only** | Avoids rewrite | `xlsx` has documented prototype pollution vulnerabilities (CVEs). Dynamic import fixes the bundle size but leaves the vulnerability in place. | Migrate to `exceljs` (actively maintained, ESM-native) at the same time as adding dynamic import. Both changes are needed. |
| **Global error boundary for env var failures** | Catch all missing keys in one place | Module-level env var access in `convex/lib/constants.ts` means errors occur at import time, not at handler entry. A global wrapper cannot intercept import-time failures. | Call `assertPlanPriceConfig()` in a startup cron or at the top of each major handler. This catches misconfiguration on the first invocation. |
| **Move audit events to a third-party log sink** | External SIEM integration | Requires infrastructure setup, credentials management, and network calls in hot paths (every API key decrypt). | Persist to a Convex `auditLog` table first. It is queryable, transactional, and zero-infrastructure. External sink integration is a follow-on concern. |
| **Per-user workpool for ALL credit operations** | Maximum concurrency safety | Most credit operations (grants, purchases) are not concurrent by nature. Adding workpool overhead to all paths increases latency and complexity for zero benefit in practice. | Apply workpool serialization only to `deductCredits` callers. The documented TOCTOU contract already contains the mitigation path. |
| **Implement BILL-02 (upgrade metadata Stripe→Convex) in this milestone** | CONCERNS.md lists it | The concern is documented as a TODO pending full metadata migration verification. Attempting it mid-milestone risks breaking upgrade proration credit grants. | Verify migration completeness first (separate query), then implement in a dedicated phase. Listed in CONCERNS.md as a follow-up, not a blocking issue. |

---

## Feature Dependencies

```
[XSS-safe highlighting]
    └──independent──> (React JSX split; no upstream deps)
    └──enables──> [highlightText unit tests with HTML characters]

[Rate limiter exhaustiveness]
    └──independent──> (change v.string() to v.union in consume mutation)
    └──requires──> [rate limit names kept in sync with defineRateLimits config]

[Typed workflow cancel IDs]
    └──requires──> [verify @convex-dev/workflow ID type is Id<"_scheduled_functions">]
    └──may require──> [schema migration for workflowId field type]

[Startup env var validation]
    └──independent──> (call assertPlanPriceConfig() + add encryption key check)
    └──enhances──> [debug gate — both benefit from early failure on misconfiguration]

[Persistent audit table]
    └──requires──> [new auditLog table in schema]
    └──requires──> [logAuditEvent internalMutation]
    └──requires──> [decryptApiKey caller sites pass ctx]
    └──enables──> [queryable audit history by userId and date]

[Real server-side library pagination]
    └──requires──> [paginationOptsValidator on browseLibrary query]
    └──requires──> [UI adopts usePaginatedQuery]
    └──requires──> [collection membership pre-fetch before paginated query]
    └──conflicts──> [current exportItems approach (non-paginated export needs separate path)]

[Incremental extraction aggregation]
    └──requires──> [new aggregation cache field or table]
    └──requires──> [workpool worker writes partial aggregates on paper completion]
    └──enables──> [lifting 500-paper hard cap in future milestone]
    └──independent of──> [persistent audit table, XSS fix, library pagination]

[Dynamic XLSX import / exceljs migration]
    └──requires──> [exceljs added as dependency]
    └──requires──> [rewrite XLSX generation code against exceljs API]
    └──independent of──> [all Convex-side concerns]

[Subscription cron batching]
    └──requires──> [cursor-based pagination on subscription scan]
    └──requires──> [scheduler.runAfter(0) for batch continuation]
    └──follows pattern──> [cleanupDeletedUsers self-scheduling batch]

[as any casts in export/filtering]
    └──requires──> [ExtractionResultWithReview derived type from existing validator]
    └──independent of──> [all runtime behavior]

[Stripe customer type cast fix]
    └──independent──> (direct pattern replacement, no new types needed)
    └──requires──> [test for expanded customer object path]

[Credit TOCTOU mitigation]
    └──requires──> [concurrency stress test first to confirm OCC behavior]
    └──requires──> [per-user workpool setup if test reveals gap]
    └──independent of──> [all other concerns]
```

### Dependency Notes

- **Persistent audit table requires ctx plumbing:** `decryptApiKey` is a pure function today (takes strings, returns a string). Adding `ctx.runMutation(logAuditEvent)` requires it to become async and accept a Convex context. All call sites (Zotero key resolution, API key resolution) must be updated accordingly.
- **Library pagination conflicts with current export pattern:** The export query (`exportItems`) fetches all filtered items without pagination to get accurate count and content. This separate export path must be preserved alongside the paginated browse/search query. They can coexist with different query functions.
- **Incremental aggregation is the highest-risk item:** It changes the write path in workpool workers (on every paper completion) and the read path in report queries. The 500-paper cap must remain in place until the incremental path is tested end-to-end.
- **Typed workflow cancel IDs depend on component internals:** The `@convex-dev/workflow` component must be checked to confirm `workflowId` is actually `Id<"_scheduled_functions">` at the type level. If the component stores it differently, the cast may be unavoidable until the component exposes a typed cancel API.
- **BILL-02 (upgrade metadata migration) is out of scope for this milestone.** It appears in CONCERNS.md as tech debt but is conditional on migration verification. It is NOT in the 12 target features and should not be added.

---

## Fix Prioritization Matrix

| # | Fix | User/System Value | Implementation Cost | Risk if Deferred | Priority |
|---|-----|-------------------|---------------------|------------------|----------|
| 1 | XSS-safe highlighting | HIGH (security) | MEDIUM | HIGH (active XSS vector) | P1 |
| 2 | Startup env var validation | HIGH (ops safety) | LOW | HIGH (silent misconfiguration) | P1 |
| 3 | Rate limiter exhaustiveness | MEDIUM (correctness) | LOW | MEDIUM (invalid names silently pass) | P1 |
| 6 | Real library pagination | HIGH (correctness at scale) | HIGH | HIGH (breaks for large libraries) | P1 |
| 7 | Incremental extraction aggregation | HIGH (correctness at scale) | HIGH | HIGH (500-paper cap blocks growth) | P1 |
| 8 | Dynamic XLSX import / exceljs | MEDIUM (security + perf) | MEDIUM | MEDIUM (CVE exposure + bundle size) | P2 |
| 9 | Subscription cron batching | MEDIUM (reliability) | MEDIUM | MEDIUM (Stripe rate limit risk) | P2 |
| 5 | Persistent audit table | MEDIUM (security ops) | MEDIUM | LOW (console.log still works) | P2 |
| 10 | as any in export/filtering | LOW (DX) | LOW | LOW (works but untyped) | P2 |
| 11 | Stripe customer type cast | LOW (correctness) | LOW | LOW (works for string customers) | P2 |
| 4 | Typed workflow cancel IDs | LOW (DX) | LOW | LOW (works, fragile on upgrade) | P3 |
| 12 | Credit TOCTOU mitigation | LOW (precautionary) | MEDIUM | LOW (no incident observed) | P3 |

**Priority key:**
- P1: Must fix — active risk, broken at scale, or silent misconfiguration
- P2: Should fix — accumulating debt, reliability concern, or quality improvement with clear payoff
- P3: Precautionary — no observed incident, fix when cost is low or triggered by an incident

---

## Expected Behavior When Complete

### 1. XSS-Safe Highlighting
- `highlightText` signature changes: `(text: string, query: string) => ReactNode`
- Implementation splits `text` on regex match: `text.split(regex).map((part, i) => ...)`
- Matching parts wrapped in `<mark className="bg-yellow-200/50 ...">`, non-matching parts as plain strings
- All three `dangerouslySetInnerHTML` call sites replaced with `{highlightText(...)}` rendering the ReactNode
- New test: `highlightText` with text containing `<script>`, `<img onerror>`, `&amp;` — verifies no HTML injection, verifies match still highlighted
- No DOMPurify dependency added

### 2. Startup Env Var Validation
- A cron (or a dedicated `validateConfig` internalAction called from cron) invokes `assertPlanPriceConfig()` and equivalent checks for `ENCRYPTION_KEY` and `STRIPE_SECRET_KEY`
- If any required env var is missing, a structured error is thrown and logged — immediately visible in Convex dashboard logs on deployment
- No silent `""` fallback for critical vars reaches production undetected
- `OpenAlex User-Agent` fallback to `admin@example.com` replaced with explicit error or real env var (already tracked in CONCERNS.md as a bug)

### 3. Rate Limiter Exhaustiveness Enforcement
- `consume` mutation in `convex/lib/rateLimit.ts` changes `args.name: v.string()` to `args.name: v.union(v.literal("start-extraction"), v.literal("api-key-save"), v.literal("checkout-session"))`
- The `as any` cast on line 52 is removed — TypeScript infers the correct union type
- An invalid rate limit name (e.g., a typo) now produces a Convex argument validation error at the call site, not a silent no-op
- Test: calling `consume` with an invalid name throws a validation error

### 4. Typed Workflow Cancel IDs
- `workflowId` field in the `extractionJobs` schema uses `v.id("_scheduled_functions")` (or the correct ID table name from `@convex-dev/workflow`)
- `workflow.cancel(ctx, job.workflowId as any)` becomes `workflow.cancel(ctx, job.workflowId)` — no cast
- TypeScript catches ID type mismatches at compile time rather than at runtime
- If the component stores IDs differently, the fix is a narrow cast to the specific type rather than `as any`

### 5. Persistent Audit Table
- New `auditLog` table in `convex/schema.ts` with fields: `userId`, `action`, `purpose`, `metadata`, `timestamp`
- New `logAuditEvent` internalMutation that writes to this table
- `decryptApiKey` in `convex/lib/crypto.ts` becomes async and accepts `ctx`, calling `logAuditEvent` instead of `console.log`
- `[AUDIT:DEBUG_ACCESS]` events in `convex/lib/debug_gate.ts` similarly routed to the table
- All `decryptApiKey` call sites (Zotero, API key resolution) updated to pass `ctx`
- Audit records queryable: `ctx.db.query("auditLog").withIndex("by_userId", ...).collect()` for any user
- Console.log audit output removed — or kept as a secondary fallback for grep-ability

### 6. Real Server-Side Library Pagination
- `browseLibrary` and `searchLibrary` queries use `.paginate(paginationOpts)` instead of `.collect()`
- `paginationOptsValidator` in query args; `paginationOpts` passed to `.paginate()`
- Collection membership filter: pre-fetch `collectionItemIds` set before the paginated query; post-filter on the paginated slice (small per page)
- Rating, date, and year filters applied to the paginated slice in JavaScript — acceptable for small page sizes
- Library UI component switches from `useQuery` to `usePaginatedQuery` hook
- Export query remains separate non-paginated path for correct filtered totals
- Result: users with 10,000+ library items get correct, fast pagination without Convex time-limit failures

### 7. Incremental Extraction Report Aggregation
- New `extractionInsightCache` field on `extractionJobs` (or a separate `extractionInsightCaches` table) stores running totals per question: answer distribution counts, confidence sum, paper count
- Workpool worker (paper completion handler) increments the cache atomically after writing extraction results
- `loadJobDataForReporting` reads the cached aggregates instead of loading all result records
- For jobs in progress, the cache reflects completed papers; for completed jobs, the cache is final
- `MAX_PAPERS_PER_JOB` safety cap remains in place until the incremental path is fully validated
- No more in-memory fan-out of N papers × M questions at report time

### 8. Dynamic XLSX Import / exceljs Migration
- `import * as XLSX from 'xlsx'` removed from top of `lib/extraction/export.ts`
- XLSX export handler: `const ExcelJS = await import('exceljs')` inside the handler function
- XLSX generation rewritten against `ExcelJS.Workbook` API: `workbook.addWorksheet()`, `worksheet.addRow()`, `workbook.xlsx.writeBuffer()`
- `export-dialog.tsx` loads the export module lazily (the dynamic import cascades naturally)
- `xlsx` package removed from `package.json`; `exceljs` added
- Bundle analyzer confirms ~500KB removed from main chunk

### 9. Subscription Cron Batching with Circuit-Breaking
- Hourly subscription status cron processes subscriptions in batches of 100 (not all 1,000 at once)
- After each batch, schedules the next batch via `ctx.scheduler.runAfter(0, ...)` with a cursor
- Circuit-breaker: if elapsed time in current invocation exceeds 45 seconds, logs a warning and schedules the remainder without processing it
- Stripe API calls within each batch run in parallel (`Promise.all`) not sequentially
- Pattern matches existing `cleanupDeletedUsers` self-scheduling batch already in `convex/maintenance/mutations.ts`

### 10. Typed `as any` Casts in Export and Filtering
- `ExtractionResultWithReview` TypeScript type derived from `extractionResultWithReviewValidator` using `Infer<typeof extractionResultWithReviewValidator>`
- `lib/extraction/export.ts` lines 117, 171, 175–177, 219: `result as any` replaced with properly typed `result` access
- `lib/extraction/filtering.ts` lines 48, 51: `(r as any).correctedAnswer` and `(r as any).citations` replaced with typed field access
- Zero runtime behavior change — purely compile-time type safety
- TypeScript catches field name typos and schema changes from this point forward

### 11. Stripe Customer Type Cast Fix
- `convex/maintenance/internal.ts` line 103: `(fresh.customer as any)?.id` replaced with `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id`
- Pattern already used in `convex/http.ts` — direct transplant
- New test: `checkSubscriptionStatus` correction path exercised with a mock Stripe subscription object where `customer` is an expanded object (`{ id: "cus_xxx", ... }`) not a string — verifies `stripeCustomerId` is correctly extracted

### 12. Credit Deduction TOCTOU Mitigation
- Pre-condition: add a concurrency stress test that calls `deductCredits` from two simulated simultaneous actions on the same user
- If the test confirms Convex OCC prevents double-deduction: document test result, close the concern, no code change needed
- If the test reveals a gap: route all `deductCredits` callers through a per-user workpool with `maxParallelism: 1`; serialize deduction requests at the action level
- The documented TOCTOU contract in `convex/credits/internal.ts` lines 1238–1280 remains as-is regardless

---

## Recommended Phase Structure

Based on dependencies, risk level, and implementation complexity:

### Phase A: Type Safety and Correctness (Low-Cost, High-Value Fixes)
*Items that are targeted, low-risk, and independently verifiable*

1. Rate limiter exhaustiveness (`as any` cast removal + typed arg validator)
2. Typed workflow cancel IDs (schema verification + cast removal)
3. `as any` casts in export/filtering (derive `ExtractionResultWithReview` type)
4. Stripe customer type cast fix (direct pattern transplant)
5. Test: `checkSubscriptionStatus` correction path with expanded customer object

### Phase B: Security and Audit (Medium-Cost, Required for Production Hardening)
*Items that require new infrastructure or cross-cutting changes*

6. XSS-safe highlighting (React-native split, remove `dangerouslySetInnerHTML`)
7. Startup env var validation (cron-based check calling `assertPlanPriceConfig()`)
8. Persistent audit table (schema + mutation + call site updates)

### Phase C: Performance (High-Cost, Required for Scale)
*Items that require architectural changes to query patterns*

9. Real server-side library pagination (`.paginate()` + `usePaginatedQuery` + UI changes)
10. Incremental extraction report aggregation (cache field + workpool writer changes)

### Phase D: Infrastructure and Dependencies
*Items requiring external dependency changes or cron restructuring*

11. Dynamic XLSX import / exceljs migration (dependency swap + API rewrite)
12. Subscription cron batching with circuit-breaking (self-scheduling pattern)

### Phase E: Concurrency Validation
*Conditional on test results*

13. Credit TOCTOU mitigation (stress test first; implement workpool only if gap confirmed)

**Rationale for ordering:**
- Phase A items are all targeted type changes with no new infrastructure — fast, independently testable, zero risk to existing behavior
- Phase B items require new schema (audit table) or cross-cutting call site changes (XSS, env var) — medium effort, clear scope
- Phase C items are the highest-complexity changes and require careful testing to avoid regressions in production query behavior
- Phase D items have external dependency risk (exceljs API differences) and cron timing risk (batching logic) — isolated from core query changes
- Phase E is conditional and should not block other phases

---

## Sources

- Existing codebase: `convex/lib/rateLimit.ts`, `components/extraction/results-views/table-view.tsx`, `convex/library/queries.ts`, `convex/credits/internal.ts`, `convex/extraction/mutations.ts`, `convex/lib/crypto.ts`, `convex/lib/constants.ts`, `convex/maintenance/internal.ts`
- `convex/extraction/validators.ts` — existing `extractionResultWithReviewValidator` for `ExtractionResultWithReview` type derivation
- Prior research: `.planning/research/FEATURES_v2.3_HARDENING.md` — scheduler batching patterns and N+1 resolution
- Prior research: `.planning/research/FEATURES.md` (v2.4) — typed validator patterns, cascade delete, GDPR patterns
- [Convex: Paginated Queries](https://docs.convex.dev/database/pagination) — `.paginate()` and cursor-based pagination pattern (HIGH confidence)
- [Convex: Argument Validation](https://docs.convex.dev/functions/validation) — `v.union(v.literal(...))` exhaustiveness pattern (HIGH confidence)
- [ExcelJS npm](https://www.npmjs.com/package/exceljs) — actively maintained Excel library with ESM support (HIGH confidence)
- [React: Rendering Lists](https://react.dev/learn/rendering-lists) — ReactNode array pattern for safe text highlighting (HIGH confidence)

---
*Feature research for: v3.0 Zero-Any Overhaul*
*Researched: 2026-03-03*
