# Phase 74: Query Bounding Audit - Research

**Researched:** 2026-03-06
**Domain:** Convex query performance / unbounded `.collect()` safety
**Confidence:** HIGH

## Summary

This phase is a code audit and remediation task, not a feature build. The codebase has 124+ `.collect()` calls across 27 Convex files. Many are already properly bounded (extraction paper queries use `MAX_PAPERS_PER_JOB = 500`), but several high-traffic query paths lack explicit `.take(N)` guards, creating unbounded memory growth risk. The cascade delete system (`deleteExtractionInternal`) is already well-implemented with batched `.take(BATCH_SIZE)` and self-scheduling -- it must NOT be changed.

The work breaks into three categories: (1) high-traffic `.collect()` calls that need `.take(N)` guards with documented MAX constants, (2) cascade delete paths that need verification they are NOT over-bounded (they are correct as-is), and (3) naturally-bounded `.collect()` calls on small-cardinality tables that need inline cardinality comments.

**Primary recommendation:** Audit every `.collect()` call in production code (skip test files), categorize each as high-traffic/cascade/naturally-bounded, add `.take(N)` guards with named MAX constants to the high-traffic ones, and add cardinality comments to the rest.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-04 | All high-traffic `.collect()` calls bounded with `.take(N)` and documented MAX constants | Complete inventory of all 70+ production `.collect()` calls below; categorization into high-traffic vs naturally-bounded; MAX constant naming convention established |
| PERF-05 | Cascade delete paths verified to not be over-bounded (no orphaned data) | Cascade delete implementation reviewed -- uses `.take(BATCH_SIZE)` with self-rescheduling loop, which is correct and must not be changed |
</phase_requirements>

## Standard Stack

No new libraries needed. This is a code audit phase using existing Convex patterns.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | existing | Database queries | Already in use |

## Architecture Patterns

### Existing Pattern: Batched Cascade Delete (DO NOT MODIFY)

The `deleteExtractionInternal` mutation in `convex/extraction/mutations.ts` (lines 1057-1200) uses a correct batched self-scheduling pattern:

```typescript
const BATCH_SIZE = 100;
const items = await ctx.db.query("table")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(BATCH_SIZE);
if (items.length > 0) {
  for (const item of items) await ctx.db.delete(item._id);
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
  return null; // re-enter to process next batch
}
```

This is intentionally bounded at BATCH_SIZE=100 per transaction, but re-schedules itself until all items are deleted. This does NOT orphan data -- it processes everything in chunks. **PERF-05 is satisfied by this existing design.**

### Pattern: MAX Constant + .take() Guard

For high-traffic read queries, use a named constant:

```typescript
/** Maximum library items returned in a single browse query. */
const MAX_LIBRARY_ITEMS = 10_000;

const items = await ctx.db.query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", userId))
  .order(sortOrder)
  .take(MAX_LIBRARY_ITEMS);
```

### Pattern: Cardinality Comment for Naturally-Bounded Queries

For tables where the data is inherently small per-scope:

```typescript
// Cardinality: ~1-3 per user (one per Stripe customer)
const customers = await ctx.db.query("billingCustomers")
  .withIndex("by_user", (q) => q.eq("userId", args.userId))
  .collect();
```

### Anti-Patterns to Avoid
- **Adding .take(N) to cascade delete paths:** This would silently orphan data. The existing self-scheduling loop is correct.
- **Using magic numbers instead of named constants:** Always define a `const MAX_X = N` with a JSDoc comment explaining why that number was chosen.

## Complete Audit Inventory

### Category 1: High-Traffic `.collect()` Calls Needing `.take(N)` Guards

These are production query/mutation paths called during normal user interaction:

| File | Line | Table | Index | Needs Bound |
|------|------|-------|-------|-------------|
| `library/queries.ts` | 55 | `libraryItemCollections` | `by_collection` | YES -- can grow with library size |
| `library/queries.ts` | 187 | `libraryItems` | search index | YES -- unbounded search results |
| `library/queries.ts` | 194 | `libraryItems` | sort index by user | YES -- unbounded user library |
| `library/queries.ts` | 349 | `libraryItems` | `by_user` | YES -- lazy backfill count path |
| `library/mutations.ts` | 91 | `libraryItemCollections` | `by_item` | CASCADE -- see below |
| `library/mutations.ts` | 125 | `libraryItemCollections` | `by_item` | CASCADE -- see below |
| `library/collections.ts` | 68 | `libraryItemCollections` | `by_collection` | YES -- can grow large |
| `library/collections.ts` | 191 | `libraryItemCollections` | `by_collection` | CASCADE (delete collection) |
| `library/collections.ts` | 212 | `libraryItemCollections` | `by_item` | Low cardinality but annotate |
| `extraction/queries.ts` | 144 | `extractionResultReviews` | `by_paper` | Bounded by questions per job (~20 max) -- annotate |
| `extraction/queries.ts` | 172 | `extractionResultReviews` | `by_job` | YES -- up to 500 papers x ~20 questions |
| `extraction/queries.ts` | 219 | `extractionQuestions` | `by_job` | Low cardinality (~5-20) -- annotate |
| `extraction/queries.ts` | 234 | `extractionResults` | `by_paper` | Low cardinality (questions per paper, ~5-20) -- annotate |
| `extraction/queries.ts` | 353 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/queries.ts` | 407,421 | `extractionResults` | `by_paper` | Low cardinality -- annotate |
| `extraction/queries.ts` | 493 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/queries.ts` | 513 | `extractionResults` | `by_paper` | Low cardinality -- annotate |
| `extraction/queries.ts` | 580 | `extractionResults` | `by_paper` | Low cardinality -- annotate |
| `extraction/queries.ts` | 690 | `extractionJobStats` | `by_job` | Low cardinality (1 per question) -- annotate |
| `extraction/queries.ts` | 1288 | `extractionReportSnapshots` | `by_job` | Low cardinality (~1-5 per job) -- annotate |
| `extraction/queries.ts` | 1332 | `extractionJobs` | `by_user` | YES -- grows over time |
| `extraction/queries.ts` | 1352 | `extractionRunDiffs` | `by_job` | Low cardinality -- annotate |
| `extraction/queries.ts` | 1424 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/queries.ts` | 1457 | `extractionEvidenceUnits` | `by_paper` | YES -- can be many per paper |
| `extraction/mutations.ts` | 57 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 72 | `extractionResults` | `by_paper` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 76 | `extractionResultReviews` | `by_paper` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 307 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 597 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 787 | `extractionJobStats` | `by_job` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 1248 | `extractionQuestions` | `by_job` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 1274 | `extractionResults` | `by_paper` | Low cardinality -- annotate |
| `extraction/mutations.ts` | 2252 | `extractionEvidenceUnits` | `by_paper` | YES -- can be many |
| `extraction/guard.ts` | 34 | `extractionJobs` | `by_user` | YES -- grows over time |
| `users/queries.ts` | 41 | `apiKeys` (or similar) | `by_user` | Check cardinality |
| `credits/internal.ts` | 102 | `credits` | `by_user` | Low cardinality (~1-3) -- annotate |
| `credits/internal.ts` | 180 | `billingCustomers` | `by_stripe_customer` | Low cardinality (1) -- annotate |
| `credits/internal.ts` | 202 | `subscriptions` | `by_stripe_sub` | Low cardinality (~1-3) -- annotate |
| `credits/internal.ts` | 212 | `billingCustomers` | `by_stripe_customer` | Low cardinality (1) -- annotate |
| `credits/internal.ts` | 849 | `credits` | `by_user` | Low cardinality -- annotate |
| `credits/internal.ts` | 1054,1164 | `creditTransactions` | `by_stripe_payment_intent` | Low cardinality (1) -- annotate |
| `credits/internal.ts` | 1400 | `creditTransactions` | `by_user` | YES -- grows over time |
| `credits/queries.ts` | 202 | `billingCustomers` | `by_user` | Low cardinality (1) -- annotate |
| `subscriptions/internal.ts` | 105 | `billingCustomers` | `by_user` | Low cardinality (1) -- annotate |
| `subscriptions/internal.ts` | 109 | `billingCustomers` | `by_stripe_customer` | Low cardinality (1) -- annotate |
| `subscriptions/internal.ts` | 159,169,180 | `subscriptions` | various | Low cardinality (~1-5) -- annotate |
| `subscriptions/internal.ts` | 255,286 | `billingCustomers` | various | Low cardinality (1) -- annotate |
| `subscriptions/internal.ts` | 309,334 | `subscriptions` | various | Low cardinality -- annotate |
| `subscriptions/internal.ts` | 449 | `billingCustomers` | `by_stripe_customer` | Low cardinality (1) -- annotate |
| `subscriptions/internal.ts` | 545,593 | `subscriptions` | `by_stripe_sub` | Low cardinality -- annotate |
| `subscriptions/queries.ts` | 20,37 | `subscriptions` | `by_user` | Low cardinality (~1-5) -- annotate |
| `apiKeys/queries.ts` | 28 | `apiKeys` | `by_user` | Low cardinality (~1-3) -- annotate |
| `zotero/mutations.ts` | 23 | `zoteroOAuthTokens` | `by_user` | Low cardinality (1) -- annotate |

### Category 2: Cascade Delete Paths (DO NOT ADD .take() BOUNDS)

These `.collect()` calls are in delete paths where bounding would orphan data. They are OK because the parent scope is already bounded OR they use the self-scheduling pattern:

| File | Line | Context | Why Safe |
|------|------|---------|----------|
| `library/mutations.ts` | 91 | Delete library item -> cascade memberships | Items per collection are bounded by library size; single-item scope |
| `library/mutations.ts` | 125 | Remove from library -> cascade memberships | Same as above |
| `library/collections.ts` | 191 | Delete collection -> cascade memberships | Collection membership bounded by library size |
| `extraction/mutations.ts` | 1057-1200 | `deleteExtractionInternal` | Already uses `.take(BATCH_SIZE)` with self-scheduling -- correct |

**Note on library cascade deletes (PERF-05):** The library item delete at `library/mutations.ts:91` and `library/mutations.ts:125` use `.collect()` to fetch all `libraryItemCollections` for a single item. This is safe because a single library item belongs to at most ~50 collections (user-created collections). However, these could add a `.take(MAX_COLLECTIONS_PER_ITEM)` guard as defense-in-depth without orphan risk, since a user deleting an item also deletes all its memberships in a single transaction.

The collection delete at `library/collections.ts:191` fetches all memberships for a collection. A collection could theoretically contain many items. This path should be reviewed -- if a collection has thousands of items, this could hit transaction limits. However, since each collection is per-user and libraries are bounded, this is acceptable for now.

### Category 3: Test/Debug Files (SKIP)

Files in `testing/`, `test_*.ts`, `*.test.ts`, `debug_*.ts` are not high-traffic production paths and do not need bounding.

## Recommended MAX Constants

Define these in a new shared file or co-located with their usage:

```typescript
// convex/lib/queryBounds.ts

/** Maximum library items returned per browse/list query. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Maximum extraction jobs listed per user. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;

/** Maximum evidence units loaded per paper. */
export const MAX_EVIDENCE_UNITS_PER_PAPER = 200;

/** Maximum reviews loaded in a single batch by job. */
export const MAX_REVIEWS_PER_JOB = 10_000;  // 500 papers x 20 questions

/** Maximum credit transactions loaded per user. */
export const MAX_CREDIT_TRANSACTIONS = 1_000;
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query pagination | Custom cursor logic | Convex `.paginate()` | For future use; this phase adds guards, not pagination |
| Aggregate counts | `.collect().length` | Denormalized counters | Already done in Phase 73 for library count |

## Common Pitfalls

### Pitfall 1: Over-Bounding Cascade Deletes
**What goes wrong:** Adding `.take(N)` to a cascade delete path without a re-scheduling loop silently leaves orphaned rows.
**Why it happens:** Developer sees `.collect()` and reflexively adds `.take()`.
**How to avoid:** The existing `deleteExtractionInternal` pattern is correct -- it uses `.take(BATCH_SIZE)` but re-schedules itself until all rows are processed. Library cascade deletes use `.collect()` which is safe because scope is bounded (memberships per single item).
**Warning signs:** Any cascade delete that uses `.take()` without a re-enter loop.

### Pitfall 2: Inconsistent MAX Constants
**What goes wrong:** Different files define different bounds for the same table (e.g., `MAX_PAPERS = 500` in one file, `MAX_PAPERS = 1000` in another).
**Why it happens:** Constants defined locally instead of shared.
**How to avoid:** Define MAX constants in a single shared module (`convex/lib/queryBounds.ts`) and import everywhere.

### Pitfall 3: Forgetting Search Index Queries
**What goes wrong:** Search index queries (`withSearchIndex`) always `.collect()` -- you cannot use `.take()` with search indexes in Convex, but you can limit results client-side or slice the array.
**How to avoid:** For `library/queries.ts:187` (search query), Convex search results are already limited by the search engine (default 256). Add a comment documenting this behavior rather than trying to add `.take()`.

### Pitfall 4: Breaking Reactivity by Changing Query Structure
**What goes wrong:** Modifying a Convex query's structure (adding `.take()`) changes its reactive subscription behavior, which can cause UI re-renders.
**How to avoid:** Adding `.take(N)` where N is larger than any realistic result set has no behavioral impact. Choose N generously.

## Code Examples

### Adding a .take() Guard to a High-Traffic Query

```typescript
// Before (unbounded):
const items = await ctx.db.query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", userId))
  .order(sortOrder)
  .collect();

// After (bounded with MAX constant):
import { MAX_LIBRARY_BROWSE } from "../lib/queryBounds";

const items = await ctx.db.query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", userId))
  .order(sortOrder)
  .take(MAX_LIBRARY_BROWSE);
```

### Adding a Cardinality Comment

```typescript
// Cardinality: ~5-20 questions per extraction job (enforced by UI limit)
const questions = await ctx.db
  .query("extractionQuestions")
  .withIndex("by_job", (q) => q.eq("jobId", jobId))
  .order("asc")
  .collect();
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (via convex-test) |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run convex/extraction/cascade-delete.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-04 | `.collect()` calls bounded with `.take(N)` | manual inspection | Code review / grep audit | N/A (code audit) |
| PERF-05 | Cascade deletes not over-bounded | unit | `npx vitest run convex/extraction/cascade-delete.test.ts -x` | Exists |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/cascade-delete.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers cascade delete verification. The PERF-04 requirement is verified by code inspection, not automated tests.

## Open Questions

1. **Search index `.collect()` limitation**
   - What we know: Convex search indexes do not support `.take()` -- results are inherently limited by the search engine (typically 256 results max).
   - What's unclear: Exact default limit for Convex search results.
   - Recommendation: Add a comment documenting this is search-engine bounded. Optionally slice results array as defense-in-depth.

2. **Library collection delete with large collections**
   - What we know: `collections.ts:191` fetches all memberships for a collection via `.collect()` before deleting them.
   - What's unclear: Whether a user could realistically have thousands of items in a single collection.
   - Recommendation: Acceptable for now since library size is bounded. Add cardinality comment.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all 27 files containing `.collect()` calls
- Existing `cascade-delete.test.ts` test coverage for extraction delete path
- Existing `MAX_PAPERS_PER_JOB = 500` constant pattern in `extraction/queries.ts` and `extraction/mutations.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, pure code audit
- Architecture: HIGH - patterns directly observed in codebase
- Pitfalls: HIGH - cascade delete concern verified by reading implementation

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- code patterns don't change quickly)
