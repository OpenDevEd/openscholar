# Technology Stack: v3.2 Production Readiness

**Project:** OpenAlex Count
**Researched:** 2026-03-06
**Confidence:** HIGH
**Scope:** NEW capabilities only. Existing stack (Next.js, Convex ^1.31.7, Stripe SDK v20.3.0, convex-helpers, convex-test, Vitest, Playwright, 750+ tests, zero-any codebase) is validated -- NOT re-researched.

---

## Context

v3.2 addresses three production readiness concerns from CONCERNS.md. None require new npm packages.

| Concern | Capability Needed | Decision |
|---------|-------------------|---------|
| Debug endpoints publicly accessible | Convert `query()` to `internalQuery()` | Convex built-in `internalQuery` (no new dep) |
| Library count fetches 10,000 docs | Efficient document counting | Manual counter field with atomic increment/decrement (no new dep) |
| Unbounded `.collect()` on high-traffic paths | Bounded query guards | `.take(N)` bounds on identified paths (no new dep) |

**Result: zero new npm packages required.** Every capability uses existing Convex primitives.

---

## Recommended Stack

### No New Dependencies

| Capability | Package | Version | What Changes |
|------------|---------|---------|-------------|
| Internal functions | `convex` | ^1.31.7 (installed) | `internalQuery` from `convex/server` -- already used by 5 of 7 debug files |
| Counter field | `convex` | ^1.31.7 (installed) | `ctx.db.patch()` for atomic increment/decrement in mutations |
| Query bounding | `convex` | ^1.31.7 (installed) | `.take(N)` method on query builder -- already used extensively |
| Testing | `convex-test` | ^0.0.41 (installed) | Verify counter consistency and internal function access |

### What NOT to Add

| Candidate | Version | Why Skip |
|-----------|---------|----------|
| `@convex-dev/aggregate` | 0.2.1 | Provides O(log n) count/sum/max with B-tree component. Requires registering in `convex.config.ts`, maintaining insert/replace/delete hooks on every write path, and adds a 0.x dependency. Library count is a single per-user counter with low write frequency (user-initiated save/unsave). A manual counter field patched atomically in the same mutation is simpler and matches the project's existing `extractionJobStats` pattern. |
| `@convex-dev/sharded-counter` | 0.2.0 | Optimizes for high-throughput concurrent increments via sharding. Library save/unsave is user-initiated (not batch), so OCC contention is negligible. A single counter field is sufficient. |

---

## Approach Per Concern

### 1. Debug Endpoint Security

**Current state (verified in codebase):**

| File | Export | Type | Status |
|------|--------|------|--------|
| `debug.ts` | `diagnoseJob` | `query()` (PUBLIC) | Must convert |
| `debug_errors.ts` | `getFailedPapersDebug` | `query()` (PUBLIC) | Must convert |
| `debug_job_citations.ts` | `debugJobCitations` | `internalQuery` | Already internal |
| `debug_job_content.ts` | `debugJobContent` | `internalQuery` | Already internal |
| `debug_paper_results.ts` | `debugPaperResults` | `internalQuery` | Already internal |
| `debug_papers.ts` | `getPaperErrorsInternal` | `internalQuery` | Already internal |
| `debug_pdfjs_alignment.ts` | `debugPdfAlignment` | `internalAction` | Already internal |

**Fix:**
1. Convert `diagnoseJob` and `getFailedPapersDebug` from `query()` to `internalQuery` (import change only)
2. Remove `requirePublicDebugEnabled()` calls from all 7 debug files (internal functions are not client-callable)
3. Remove `requireAuth()` from debug files that have it (internal functions bypass auth by design -- they are only callable from other server functions)
4. Delete `convex/lib/debug_gate.ts` entirely
5. Remove `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var from all environments

**Stack needed:** `internalQuery` from `convex/server` (already available). Zero new packages.

**Why `internalQuery` over env var gate:** Internal functions are architecturally unreachable from clients. The env var gate is a runtime check that can be misconfigured. `internalQuery` eliminates the attack surface entirely -- there is no HTTP endpoint to call, no matter what env vars are set.

### 2. Library Count Optimization

**Current state:** `getLibraryCount` in `convex/library/queries.ts:330-341` does:
```typescript
const items = await ctx.db
  .query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .take(10_000);
return items.length;
```

This fetches up to 10,000 full documents just to count them. Users with >10,000 items get incorrect counts. Users with large libraries pay unnecessary read bandwidth.

**Recommended approach:** Maintain a `libraryItemCount` counter on a dedicated document, incremented/decremented atomically in the same mutations that insert/delete library items.

**Integration points (all existing files, no new files needed):**

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `libraryItemCount: v.number()` field to user-associated record, or create a `libraryCounters` table with `by_user` index |
| `convex/library/mutations.ts` | `saveToLibrary`: increment counter after insert. `removeFromLibrary`: decrement after delete. `removeMultipleFromLibrary`: decrement by batch count after deletes. |
| `convex/library/queries.ts` | `getLibraryCount`: read counter document instead of `.take(10_000)` |
| Backfill | One-time internal mutation to count existing items per user and set initial counter values |

**Why a counter field over @convex-dev/aggregate (0.2.1):**
- Library writes are user-initiated, not batch -- OCC contention is near zero
- Only 2 mutation entry points modify libraryItems (save and remove/removeMultiple)
- The project already uses this exact pattern for `extractionJobStats` incremental counters (v3.0)
- No new component registration in `convex.config.ts` (currently has 4 components: stripe, rag, workflow, workpool)
- No new 0.x dependency to pin and monitor
- Counter is always consistent because increment/decrement runs in the same mutation as the insert/delete (Convex OCC guarantees atomicity)

**Why a counter field over @convex-dev/sharded-counter (0.2.0):**
- Sharded counters solve high-contention concurrent writes (e.g., thousands of simultaneous increments)
- Library save/unsave is a single-user action -- only one mutation runs at a time per user
- Adding a component for a problem that does not exist adds complexity with no benefit

### 3. Unbounded .collect() Audit

**Current state:** 125 `.collect()` calls across 27 files in `convex/`. Most are properly scoped by narrow index filters returning small result sets. The audit classifies each call.

**Classification framework:**

| Category | Criteria | Action |
|----------|----------|--------|
| Safe | Returns 1-5 rows by unique/narrow index (billing, subscriptions, per-user lookups) | No change |
| Bounded by design | Scoped to per-job data capped at MAX_PAPERS_PER_JOB=500 or per-question data (5-15 questions) | No change |
| Needs .take() guard | Could grow with usage (credit transactions, saved views, templates, report snapshots) | Add `.take(N)` |
| Test-only | In test files (`.test.ts`, `test_*.ts`) | No change |

**High-priority .collect() calls to bound:**

| File | Query | Risk | Recommended Bound |
|------|-------|------|-------------------|
| `credits/internal.ts:99-102` | `creditTransactions` by user | Grows with every purchase/grant | `.take(1000)` |
| `credits/internal.ts:846-849` | `creditTransactions` by user (all history) | Same | `.take(1000)` |
| `extraction/queries.ts:1285-1288` | `extractionSavedViews` by job | Could grow per job | `.take(100)` |
| `extraction/queries.ts:1329-1332` | `extractionWorkflowTemplates` by user | Could grow over time | `.take(100)` |
| `extraction/queries.ts:1349-1352` | `extractionReportSnapshots` by job | Could grow per job | `.take(50)` |
| `extraction/queries.ts:1454-1457` | `extractionEvidenceUnits` by paper | Bounded by paper content but no explicit guard | `.take(500)` |
| `subscriptions/internal.ts:177-180` | `subscriptions` by user | Should be 1-3 but no guard | `.take(10)` |

**Safe .collect() calls (no change needed):**
- `billingCustomers` by user/stripe_customer: 1 row per user (unique index)
- `subscriptions` by stripe_sub: 1 row per subscription (unique index)
- `extractionQuestions` by job: 5-15 questions per job (bounded by design)
- `extractionResults` by paper: bounded by question count (5-15 per paper)
- `extractionResultReviews` by paper/job: bounded by question count
- `extractionJobStats` by job: bounded by question count
- All test file `.collect()` calls: test-only, controlled data

**Stack needed:** `.take(N)` is a built-in Convex query method. Zero new packages.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Library counting | Manual counter field | `@convex-dev/aggregate` v0.2.1 | Adds component dependency and insert/replace/delete hooks for a single low-frequency counter |
| Library counting | Manual counter field | `@convex-dev/sharded-counter` v0.2.0 | Solves high-contention writes that do not exist here |
| Debug security | `internalQuery` | Keep env var gate with stronger checks | Runtime check can be misconfigured; `internalQuery` eliminates the attack surface architecturally |
| Debug security | `internalQuery` | Delete debug files entirely | Debug functions are useful in development/staging; internal functions preserve utility while removing public access |
| .collect() bounding | `.take(N)` guards | Server-side pagination everywhere | Over-engineering; most queries return small result sets; `.take(N)` is the right guard for bounded-but-not-paginated queries |
| .collect() bounding | `.take(N)` guards | Convex query limits (automatic) | Convex has a 16MB response limit but no automatic row cap; explicit `.take(N)` is defense-in-depth |

---

## Installation

```bash
# No new packages to install.
# All changes are code-level refactoring using existing Convex primitives:
#   - internalQuery (convex/server) -- debug endpoint conversion
#   - ctx.db.patch() (convex/server) -- counter increment/decrement
#   - .take(N) (convex query builder) -- .collect() bounding
```

---

## Version Compatibility

| Package | Current Version | Relevance to v3.2 |
|---------|----------------|-------------------|
| `convex` | ^1.31.7 | `internalQuery`, `ctx.db.patch()`, `.take()` -- all stable APIs since v1.0 |
| `convex-test` | ^0.0.41 | Testing internal function access patterns and counter consistency |

No version bumps required. All APIs used are stable Convex primitives available since well before v1.31.7.

---

## Sources

- [Convex aggregate component](https://github.com/get-convex/aggregate) -- evaluated and rejected; O(log n) count/sum/max is overkill for single per-user counter (HIGH confidence)
- [Convex sharded-counter component](https://github.com/get-convex/sharded-counter) -- evaluated and rejected; high-throughput sharding not needed for user-initiated operations (HIGH confidence)
- [Convex aggregate npm](https://www.npmjs.com/package/@convex-dev/aggregate) -- v0.2.1, peer dep convex ^1.24.8 (HIGH confidence, verified via npm registry)
- [Convex sharded-counter npm](https://www.npmjs.com/package/@convex-dev/sharded-counter) -- v0.2.0, peer dep convex ^1.24.8 (HIGH confidence, verified via npm registry)
- [Efficient COUNT, SUM, MAX with the Aggregate Component](https://stack.convex.dev/efficient-count-sum-max-with-the-aggregate-component) -- Convex blog on aggregate component use cases (MEDIUM confidence)
- Codebase: `convex/extraction/debug*.ts` -- 2 public, 5 internal debug functions verified (HIGH confidence)
- Codebase: `convex/lib/debug_gate.ts` -- env var gate implementation verified (HIGH confidence)
- Codebase: `convex/library/queries.ts:330-341` -- getLibraryCount .take(10_000) pattern verified (HIGH confidence)
- Codebase: `convex/library/mutations.ts` -- 2 mutation paths for libraryItem insert/delete verified (HIGH confidence)
- Codebase: 125 .collect() calls across 27 convex files verified via grep (HIGH confidence)
- Prior research: `.planning/milestones/v3.0-phases/57-incremental-aggregation/57-RESEARCH.md` -- validates manual counter pattern over @convex-dev/aggregate for this project (HIGH confidence)
- Codebase: `convex/convex.config.ts` -- 4 components registered (stripe, rag, workflow, workpool) (HIGH confidence)

---

*Stack research for: v3.2 Production Readiness*
*Researched: 2026-03-06*
