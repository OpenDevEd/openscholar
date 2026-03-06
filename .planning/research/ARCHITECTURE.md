# Architecture Patterns

**Domain:** Production readiness fixes for Convex-backed academic search platform
**Researched:** 2026-03-06

## Recommended Architecture

Three focused changes to the existing Convex backend. No new layers, no new frontend components. All changes are backend-only modifications to existing modules.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `convex/extraction/debug*.ts` (6 files) | Debug/diagnostic queries for extraction jobs | `convex/lib/debug_gate.ts`, extraction tables |
| `convex/extraction/test*.ts` (5 files) | Test job creation and automation | `convex/lib/debug_gate.ts`, extraction mutations |
| `convex/debug_papers.ts` (1 file) | Top-level debug query | extraction tables |
| `convex/library/queries.ts` | Library browsing, search, count | `libraryItems` table |
| `convex/library/mutations.ts` | Library item CRUD (save, delete, rate) | `libraryItems` table, sharded counter |
| `convex/library/collections.ts` | Collection CRUD and assignment | `collections`, `libraryItemCollections` tables |
| High-traffic `.collect()` query paths | Various extraction and library queries | Multiple extraction and library tables |

### Data Flow

**Current debug endpoint flow (INSECURE):**
```
Client SDK --> public query/mutation (diagnoseJob, getFailedPapersDebug, createTestJob, createTestJobForFix)
           --> requirePublicDebugEnabled() env var check
           --> requireAuth() user check
           --> database query
```

**Target debug endpoint flow (SECURE):**
```
Convex Dashboard / npx convex run --> internalQuery/internalMutation
                                  --> database query (no env gate needed)
```

**Current library count flow (WASTEFUL):**
```
useProtectedQuery(getLibraryCount) --> .withIndex("by_user").take(10_000) --> items.length
```

**Target library count flow (EFFICIENT):**
```
useProtectedQuery(getLibraryCount) --> counter.count(ctx, userId) --> O(1) number
```

## Change 1: Debug Endpoint Internalization

### Current State

12 debug/test files in the convex codebase are gated by `requirePublicDebugEnabled()`. Of these, the critical security concern is the **4 files using `query` or `mutation`** (public Convex functions callable from any client):

| File | Function Type | Security Risk |
|------|--------------|---------------|
| `convex/extraction/debug.ts` | `query` (PUBLIC) | **HIGH** - `diagnoseJob` exposes job internals |
| `convex/extraction/debug_errors.ts` | `query` (PUBLIC) | **HIGH** - `getFailedPapersDebug` exposes error details |
| `convex/extraction/testActions.ts` | `mutation` (PUBLIC) | **CRITICAL** - `createTestJob` can create jobs |
| `convex/extraction/create_test_job.ts` | `mutation` (PUBLIC) | **CRITICAL** - `createTestJobForFix` can create jobs |

The remaining 8 files already use `internalQuery`/`internalMutation`/`internalAction` and are not callable from clients. They still call `requirePublicDebugEnabled()` as a defense-in-depth measure, but the env gate is redundant for internal functions.

### Target Architecture

**Convert all 4 public functions to internal functions.** The `requirePublicDebugEnabled()` gate and `debug_gate.ts` module become unnecessary and should be removed entirely.

**Specific changes per file:**

1. `convex/extraction/debug.ts`: `query` -> `internalQuery`, remove `requirePublicDebugEnabled()` call, remove `requireAuth()` (internal functions are trusted)
2. `convex/extraction/debug_errors.ts`: `query` -> `internalQuery`, remove both gates
3. `convex/extraction/testActions.ts`: `mutation` -> `internalMutation`, remove both gates
4. `convex/extraction/create_test_job.ts`: `mutation` -> `internalMutation`, remove both gates

**For the 8 already-internal files:** Remove `requirePublicDebugEnabled()` calls since they serve no purpose on internal functions.

**Remove entirely:**
- `convex/lib/debug_gate.ts` - no longer needed
- `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var from all environments

**Update:**
- `convex/extraction/index.ts` - keep exports but note they are now internal
- `tests/debug-gate.test.ts` - either delete or convert to verify functions are `internalQuery`/`internalMutation` (the inventory test is still valuable as a structural check)
- Any frontend code referencing `getFailedPapersDebug` or `diagnoseJob` via the Convex client SDK must be removed (grep confirms no frontend imports exist beyond generated types)

### Impact Assessment

- **Frontend:** Zero impact. No React components call debug queries.
- **Dashboard access:** Debug functions remain callable via `npx convex run` for staging diagnostics.
- **Test suite:** `tests/debug-gate.test.ts` needs rewrite. The debug gate behavior tests become irrelevant. The inventory test should verify internal function registration instead.
- **Convex generated types:** `convex/_generated/api.d.ts` will update automatically on next `npx convex dev`.

## Change 2: Efficient Library Counting

### Current State

`getLibraryCount` in `convex/library/queries.ts` (lines 330-341) fetches up to 10,000 documents just to return `.length`. This is a reactive query subscribed by the library page via `useProtectedQuery` -- it re-runs on every library mutation.

### Decision: Sharded Counter over Aggregate Component

**Use `@convex-dev/sharded-counter` because:**

1. **Exact match for the use case.** We need one thing: a per-user count of library items. Sharded counter is a key-value store (string -> number) with `inc`/`dec`/`count`. That is literally the entire requirement.

2. **Simpler API.** `counter.inc(ctx, userId)` on save, `counter.dec(ctx, userId)` on delete, `counter.count(ctx, userId)` on query. No `namespace`/`sortKey`/`TableAggregate` ceremony.

3. **Already proven pattern.** The project uses 4 `@convex-dev/*` components (rag, stripe, workflow, workpool). Adding a 5th is a known pattern.

4. **Previous decision rationale holds.** In v3.0 (milestone 57), `@convex-dev/aggregate` was explicitly rejected for `extractionJobStats` as "adds a dependency and complexity; simple upsert table is sufficient." The aggregate component is overkill for a single counter per user.

5. **No schema changes needed.** Sharded counter manages its own internal tables via the component system.

**Why NOT `@convex-dev/aggregate`:**
- Requires `TableAggregate` class with generic params (Namespace, Key, DataModel, TableName)
- Designed for COUNT + SUM + MAX + offset-pagination -- we only need COUNT
- More complex trigger setup (must hook into all mutations that modify the table)
- Aggregate is the right choice when you need sorted aggregates or offset pagination; we need neither

**Why NOT a manual counter field on `credits` or `users` table:**
- OCC contention: counter update conflicts with other mutations on the same user/credits row
- Sharded counter solves this by distributing writes across shards (default 16)

### Target Architecture

**New file: `convex/library/counter.ts`**
```typescript
import { components } from "../_generated/api";
import { ShardedCounter } from "@convex-dev/sharded-counter";

export const libraryCounter = new ShardedCounter(components.shardedCounter, {
  defaultShards: 4, // Low contention (single user saves at a time)
});
```

**Modified files:**

1. `convex/convex.config.ts` - add `app.use(shardedCounter)`
2. `convex/library/mutations.ts` - on `rateOrSaveItem` (line ~76): `libraryCounter.inc(ctx, user._id)` on INSERT path only; on delete: `libraryCounter.dec(ctx, user._id)`
3. `convex/library/queries.ts` - rewrite `getLibraryCount` to use `libraryCounter.count(ctx, user._id)`

**Migration for existing data:**
Existing users have library items but no counter value. Two approaches:

- **Lazy backfill (recommended):** On `getLibraryCount`, check if counter returns 0 for a user who has items. If so, count via `.take(10_000)` once and set the counter. This matches the project's established pattern (see `extractionJobStats` lazy backfill in v3.0).
- **One-time migration:** Write an `internalMutation` that iterates all users, counts their items, and sets the counter. Run via `npx convex run`.

Lazy backfill is preferred because it requires zero downtime and no migration coordination.

**Concurrency note:** The `rateOrSaveItem` mutation already does a "check if exists, if not insert" pattern. The counter increment must only happen on the INSERT path (new item), not the UPDATE path (re-rating existing item). Similarly, delete must only decrement when actually deleting. This is already structurally safe in the existing code.

### Impact Assessment

- **New dependency:** `@convex-dev/sharded-counter` (npm install)
- **Schema:** No changes to `convex/schema.ts`. Component manages its own tables.
- **Frontend:** Zero changes. `getLibraryCount` return type (`v.number()`) is unchanged.
- **Test suite:** `convex/library/queries.test.ts` `getLibraryCount` tests need updating to account for counter initialization.
- **Performance:** O(1) count query instead of O(n) document scan. Eliminates reactive query re-reads of up to 10,000 documents.

## Change 3: Unbounded `.collect()` Bounding

### Current State

124 `.collect()` calls across 26 Convex files. Most are safe due to index scoping (e.g., `.withIndex("by_user").collect()` where a user has few records). The concern is **high-traffic query paths** where the number of matching documents could grow large.

### Audit Classification

**Category A: Already bounded or inherently safe (NO ACTION)**

These `.collect()` calls are safe because the result set is inherently small:

| Pattern | Why Safe | Examples |
|---------|----------|----------|
| `by_user` on small tables (collections, apiKeys, zoteroConnections, subscriptions) | Users have few collections (<50), few API keys (<5), 1 Zotero connection, few subscriptions (<3) | `collections.ts:84`, `apiKeys/queries.ts:28`, `subscriptions/queries.ts:20` |
| `by_job` on questions table | Jobs have 5-15 questions max | `queries.ts:219`, `mutations.ts:57` |
| `by_stripe_*` lookups | 1:1 mappings | `credits/internal.ts:102` |
| Test files | Not production code | All `*.test.ts` files |
| `zoteroOAuthTokens` cleanup | 0-5 rows total | `maintenance/mutations.ts:32` |

**Category B: Bounded by MAX_PAPERS_PER_JOB but using `.collect()` (LOW RISK)**

These query per-paper data within extraction jobs. Papers per job are capped at 500 (`MAX_PAPERS_PER_JOB`). The `.collect()` on per-paper results/reviews/evidence returns at most ~15 rows per paper (one per question).

| File | Line | Query | Max Docs |
|------|------|-------|----------|
| `extraction/queries.ts` | 144 | reviews `by_paper` | ~15 per paper |
| `extraction/queries.ts` | 234 | results `by_paper` | ~15 per paper |
| `extraction/mutations.ts` | 72 | results `by_paper` | ~15 per paper |
| `extraction/mutations.ts` | 76 | reviews `by_paper` | ~15 per paper |

These are safe for the current 500-paper cap but should get `.take()` guards as defense-in-depth.

**Category C: High-traffic paths needing bounds (ACTION REQUIRED)**

| File | Line | Query | Risk | Recommended Bound |
|------|------|-------|------|-------------------|
| `library/queries.ts` | 55 | `libraryItemCollections` `by_collection` | Collection membership unbounded | `.take(10_000)` |
| `library/queries.ts` | 187 | `collectLibraryItems` search path | Search results unbounded | `.take(10_000)` |
| `library/queries.ts` | 194 | `collectLibraryItems` browse path | All user items unbounded | `.take(10_000)` |
| `library/collections.ts` | 68 | `libraryItemCollections` `by_collection` (delete cascade) | Unbounded cascade | `.take(1_000)` with continuation |
| `library/collections.ts` | 181 | `libraryItemCollections` `by_item` (delete item cascade) | Small per-item, but unbounded | `.take(100)` |
| `library/mutations.ts` | 76 | `libraryItemCollections` `by_item` | Check for existing memberships | `.take(100)` |
| `extraction/queries.ts` | 172 | `loadReviewsByJob` all reviews | 500 papers x 15 questions = 7,500 max | `.take(10_000)` |
| `extraction/mutations.ts` | 307 | papers `by_job` for cancel | Already bounded by MAX_PAPERS_PER_JOB | Add explicit `.take(MAX_PAPERS_PER_JOB)` |
| `extraction/mutations.ts` | 597 | papers `by_job` for duplicate | Same | Add explicit `.take(MAX_PAPERS_PER_JOB)` |
| `extraction/mutations.ts` | 787 | papers `by_job` for insight | Same | Add explicit `.take(MAX_PAPERS_PER_JOB)` |
| `subscriptions/internal.ts` | multiple | `by_user` subscriptions | Users should have 1-3 | `.take(10)` (already safe, add as documentation) |

### Bounding Strategy

Use `.take(N)` where N is the known upper bound plus a safety margin. Do NOT change to `.paginate()` -- that would change return types and require frontend changes.

For the `collectLibraryItems` paths in `library/queries.ts` (lines 187, 194): These feed `listLibrary` which is used for export. The `.collect()` is intentional -- it loads all items for CSV/JSON export. The `10_000` bound matches the existing `getLibraryCount` bound and represents a reasonable library size limit. Add `.take(10_000)` as an explicit cap.

For `loadReviewsByJob` (line 172): This loads all reviews for a job to avoid N+1. With 500 papers and ~15 questions, the theoretical max is 7,500. Use `.take(10_000)` as a safety bound.

### Impact Assessment

- **Frontend:** Zero changes.
- **Behavior:** No functional change for users within bounds. Users exceeding bounds get truncated results (acceptable -- these are safety caps, not expected limits).
- **Test suite:** Existing tests continue to pass since test data is well within bounds.

## Patterns to Follow

### Pattern 1: Internal Function for Admin/Debug Operations
**What:** Use `internalQuery`/`internalMutation` for any function that should not be client-callable.
**When:** Diagnostic queries, test job creation, data migration, admin operations.
**Example:**
```typescript
import { internalQuery } from "../_generated/server";

export const diagnoseJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // No auth check needed -- internal functions are trusted
    const job = await ctx.db.get(args.jobId);
    // ...
  },
});
```

### Pattern 2: Sharded Counter for Document Counting
**What:** Use `@convex-dev/sharded-counter` instead of `.collect().length` for counting documents.
**When:** A reactive query needs to return a count that changes on mutations.
**Example:**
```typescript
// In mutations: increment on create, decrement on delete
await libraryCounter.inc(ctx, userId);
await libraryCounter.dec(ctx, userId);

// In queries: O(1) count
const count = await libraryCounter.count(ctx, userId);
```

### Pattern 3: Defensive `.take()` Bounds
**What:** Always add `.take(N)` to `.collect()` calls with a comment explaining the bound.
**When:** Any query that could theoretically return an unbounded number of documents.
**Example:**
```typescript
// MAX_PAPERS_PER_JOB (500) is the hard cap for papers per extraction job
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", jobId))
  .take(MAX_PAPERS_PER_JOB); // Safety: bounded by job creation validation
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Public Functions with Runtime Gates
**What:** Using `query`/`mutation` with env var checks to restrict access.
**Why bad:** Any client can call public Convex functions. Env var gates rely on operational discipline ("never set this in prod"). A misconfiguration exposes all gated functions. The Convex platform already provides the `internalQuery`/`internalMutation` mechanism for exactly this purpose.
**Instead:** Use `internalQuery`/`internalMutation`. They are not callable from the client SDK at all -- enforced by the Convex runtime, not by application code.

### Anti-Pattern 2: Counting via Document Fetch
**What:** Fetching documents with `.take(N)` and returning `.length`.
**Why bad:** Reads N documents from the database, transfers them over the wire, and discards the data. Wasteful of database bandwidth and Convex function execution time. Gets worse as the collection grows.
**Instead:** Use a counter (sharded counter or manual counter field) that is updated on mutations.

### Anti-Pattern 3: Unbounded `.collect()` Without Size Analysis
**What:** Using `.collect()` without considering the maximum result set size.
**Why bad:** A user with 50,000 library items or a future feature that removes the 500-paper cap will cause queries to load unbounded data, potentially exceeding Convex function memory limits or timeout constraints.
**Instead:** Always add `.take(N)` with a comment explaining why N is the correct bound.

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Library count | `.take(10_000)` is fine | Sharded counter eliminates scan | Sharded counter scales linearly |
| Debug endpoints | Internal functions: zero attack surface | Same | Same |
| `.collect()` bounds | All within limits | All within limits | May need to revisit extraction paper limits |
| Counter migration | Lazy backfill handles all users | Lazy backfill amortizes over time | Consider batch migration at this scale |

## Build Order

**Phase 1: Debug endpoint internalization (no dependencies)**
1. Convert 4 public debug functions to internal
2. Remove `requirePublicDebugEnabled()` from all 12 files
3. Delete `convex/lib/debug_gate.ts`
4. Update/delete `tests/debug-gate.test.ts`
5. Remove `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var documentation
6. Deploy and verify via `npx convex run`

**Phase 2: Sharded counter for library count (independent of Phase 1)**
1. Install `@convex-dev/sharded-counter`
2. Add to `convex/convex.config.ts`
3. Create `convex/library/counter.ts` with `ShardedCounter` instance
4. Add `inc`/`dec` calls to `library/mutations.ts` save and delete paths
5. Rewrite `getLibraryCount` to use counter with lazy backfill
6. Update `convex/library/queries.test.ts`
7. Deploy and verify counts match

**Phase 3: `.collect()` bounding (independent of Phase 1 and 2)**
1. Add `.take()` bounds to Category C paths
2. Add `.take()` bounds to Category B paths (defense-in-depth)
3. Add comments explaining each bound
4. Run full test suite to verify no behavioral changes

**Ordering rationale:** All three phases are independent and could be done in parallel. However, Phase 1 (debug internalization) is the highest-priority security fix and should ship first. Phase 2 (sharded counter) requires an npm install and component registration. Phase 3 (`.collect()` bounding) is the lowest risk and can be done last as a sweep.

## Sources

- Convex Aggregate Component: [Official page](https://www.convex.dev/components/aggregate), [GitHub](https://github.com/get-convex/aggregate), [Stack article](https://stack.convex.dev/efficient-count-sum-max-with-the-aggregate-component)
- Convex Sharded Counter: [Official page](https://www.convex.dev/components/sharded-counter), [GitHub](https://github.com/get-convex/sharded-counter), [npm](https://www.npmjs.com/package/@convex-dev/sharded-counter)
- Prior decision: `.planning/milestones/v3.0-phases/57-incremental-aggregation/57-RESEARCH.md` rejected `@convex-dev/aggregate` for simple counting
- Codebase analysis: direct inspection of all 12 debug files, 124 `.collect()` call sites, library count query, and frontend usage
- Confidence: HIGH for debug internalization (straightforward Convex pattern), HIGH for sharded counter (official component, exact use case match), HIGH for `.collect()` bounding (mechanical change with known bounds)

---

*Architecture analysis: 2026-03-06*
