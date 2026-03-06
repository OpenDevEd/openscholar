# Feature Landscape

**Domain:** Production readiness fixes for academic search/extraction platform
**Researched:** 2026-03-06
**Milestone:** v3.2 Production Readiness

## Table Stakes

Features that must ship before production. Missing any = security or reliability risk.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Debug endpoints converted to `internalQuery`/`internalAction` | Security blocker: 2 debug functions (`debug.ts:diagnoseJob`, `debug_errors.ts:getFailedPapersDebug`) are public `query` exports callable by any client. Env-var gate is defense-in-depth, not a security boundary. | Low | None -- 4 of 6 debug files already use `internalQuery`/`internalAction`, only 2 need conversion | Convex docs: "Public functions can be called by anyone, including potentially malicious attackers." The env-var gate (`requirePublicDebugEnabled`) should be removed entirely once all functions are internal -- internal functions cannot be called from clients by design. |
| Efficient library count (replace `.take(10_000).length`) | Performance blocker: `getLibraryCount` fetches up to 10,000 full documents just to return a number. Wastes bandwidth, memory, and Convex read units. Returns incorrect count for users with >10,000 items. | Medium | Requires `@convex-dev/sharded-counter` component installation | Current code at `convex/library/queries.ts:330-341`. Convex deliberately has no native COUNT -- the sharded counter component exists specifically for this use case. |
| High-traffic `.collect()` calls bounded | Reliability blocker: Several production query paths use unbounded `.collect()` on user-scoped indexes. The library browse path (`queries.ts:194`) collects ALL user library items for client-side sort/filter -- this is the highest-risk path. | Medium | Depends on understanding query access patterns and expected cardinality per path | 124 total `.collect()` calls across 26 files. Most are in test code or naturally-bounded contexts. Focus on the handful in high-traffic production queries. |

## Differentiators

Features that improve production quality beyond baseline. Not blockers but high value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| Persistent audit log for debug function access | Current debug audit uses `console.log` which is ephemeral. Persistent `auditLogs` table already exists (`writeAuditLog` internalMutation from v3.0). Wire debug access through it for queryable audit trail. | Low | Depends on: debug endpoint conversion to internal | Existing infrastructure -- just needs wiring. |
| Counter-based collection membership counts | `loadCollectionItemIds` (`queries.ts:40-58`) collects ALL memberships for a collection to build a filter Set. A counter per collection would enable showing collection item counts without loading all memberships. | Medium | Depends on: sharded counter component (same one used for library count) | Could share the same component instance. Deferred unless collection sizes grow large. |
| `debug_gate.ts` module removal | Once all debug functions are internal, the entire `convex/lib/debug_gate.ts` module becomes dead code. Removing it eliminates a confusing artifact that implies env-var gating is the security model. | Low | Depends on: debug endpoint conversion complete | Clean codebase signal -- no misleading security patterns left behind. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full aggregate component for all tables | Over-engineering. Only `libraryItems` count is a known bottleneck. The aggregate component maintains a B-tree for O(log n) counting, SUM, MAX, and offset pagination -- far more than needed for a simple per-user item counter. | Use `@convex-dev/sharded-counter` for library count (simpler API, lower overhead). Evaluate aggregate component only if SUM/MAX/offset-pagination needs emerge. |
| Custom admin dashboard for debug queries | Debug endpoints exist for developer troubleshooting, not for user-facing admin. Building UI around them is scope creep. | Keep debug functions as internal queries callable via `npx convex run` from CLI. |
| Replacing ALL `.collect()` with `.take()` blindly | Many `.collect()` calls are correct -- they operate on naturally small result sets (collections per user typically <50, memberships per item typically <10, subscriptions per user 1-3). Blindly adding `.take()` hides bugs where data grows unexpectedly and adds false safety. | Audit each call individually. Add `.take()` only where the result set could reasonably grow large. Document expected cardinality for naturally-bounded queries with inline comments. |
| Server-side pagination refactor for library | Moving all filtering to Convex indexes would require many composite indexes and significant refactoring of the library query layer. The current client-side filtering works for reasonable library sizes once `.collect()` is bounded. | Defer until library sizes exceed practical limits (5,000+ items). Bound `.collect()` with `.take()` for now. |
| Sharded counter for every table | Adding increment/decrement hooks to every mutation across all tables adds complexity and maintenance burden with no measured need. | Only add the counter for `libraryItems` where the count query is a documented bottleneck. |

## Feature Dependencies

```
Debug endpoint conversion (2 files: debug.ts, debug_errors.ts)
  --> Remove requirePublicDebugEnabled() from ALL debug files (including already-internal ones)
  --> Delete convex/lib/debug_gate.ts module
  --> Wire audit logging through existing writeAuditLog internalMutation

Sharded counter component installation (@convex-dev/sharded-counter)
  --> Add app.use(shardedCounter) in convex.config.ts
  --> Replace getLibraryCount with counter.count()
  --> Add counter.inc() to library save mutations
  --> Add counter.dec() to library delete mutations
  --> Lazy backfill for existing users (established pattern from extractionJobStats)

.collect() audit (independent of above)
  --> Identify high-traffic unbounded paths in production code
  --> Add .take() bounds with documented MAX constants
  --> Skip test files, debug functions, and naturally-bounded queries
```

## Detailed Analysis

### 1. Debug Endpoint Security Hardening

**Current state:** 6 debug files + 1 debug gate module in `convex/extraction/`:

| File | Export | Current Type | Action Needed |
|------|--------|-------------|---------------|
| `debug.ts` | `diagnoseJob` | **PUBLIC `query`** | Convert to `internalQuery` |
| `debug_errors.ts` | `getFailedPapersDebug` | **PUBLIC `query`** | Convert to `internalQuery` |
| `debug_papers.ts` | `getPaperErrorsInternal` | `internalQuery` | Remove debug gate only |
| `debug_paper_results.ts` | `debugPaperResults` | `internalQuery` | Remove debug gate only |
| `debug_job_citations.ts` | `debugJobCitations` | `internalQuery` | Remove debug gate only |
| `debug_job_content.ts` | `debugJobContent` | `internalQuery` | Remove debug gate only |
| `debug_pdfjs_alignment.ts` | `debugPdfAlignment` | `internalAction` | Remove debug gate only |

**What "internal" means in Convex:** Internal functions (`internalQuery`, `internalMutation`, `internalAction`) can only be called from other Convex functions or via `npx convex run` on the CLI. They are never exposed to the client SDK. This is a platform-enforced boundary -- not an application-level check like an env-var gate.

**The fix is mechanical:**
1. Change `import { query } from "../_generated/server"` to `import { internalQuery } from "../_generated/server"` in 2 files
2. Remove `requirePublicDebugEnabled()` calls from all 7 debug files (redundant for internal functions)
3. Remove `requireAuth()` calls from debug functions (internal functions are not user-facing; auth is meaningless)
4. Add `writeAuditLog` calls for persistent audit trail (optional but recommended)
5. Delete `convex/lib/debug_gate.ts` (dead code after conversion)

**Risk:** Very low. 5 of 7 debug exports are already internal. The pattern is established in the codebase.

### 2. Efficient Document Counting in Convex

**Current state:** `getLibraryCount` at `convex/library/queries.ts:330-341`:
```typescript
const items = await ctx.db
  .query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .take(10_000);
return items.length;
```

**Why this is problematic:** Fetches up to 10,000 complete documents (each ~1-2KB with slim fields) just to count them. At scale: ~10-20MB of read bandwidth per count query. Convex charges for document bandwidth. The count is also silently incorrect for users with >10,000 items.

**Recommended solution: `@convex-dev/sharded-counter`**

Use the sharded counter rather than the full aggregate component because:
- Only need counting, not SUM/MAX/offset-pagination
- Simpler API: `counter.inc(ctx, key)`, `counter.dec(ctx, key)`, `counter.count(ctx, key)`
- Lower overhead than maintaining a full B-tree (aggregate component)
- O(number-of-shards) reads vs O(log n) for aggregate -- for simple counting, shards are faster

**How it works:**
1. Install: `npm install @convex-dev/sharded-counter`
2. Configure: `app.use(shardedCounter)` in `convex/convex.config.ts`
3. Instantiate: `const counter = new ShardedCounter(components.shardedCounter)`
4. On library item save: `counter.inc(ctx, userId)` in save mutation
5. On library item delete: `counter.dec(ctx, userId)` in delete mutation
6. In `getLibraryCount`: `return counter.count(ctx, userId)` -- no document fetching

**Backfill strategy:** Use the lazy backfill pattern already established by `extractionJobStats` (v3.0): on first `count()` read for a user where no counter exists, compute the count via the old `.take(10_000).length` method, initialize the counter, and return the result. Subsequent reads use the counter directly.

**Caveats:**
- Sharded counter values are floats. Floating-point arithmetic can accumulate drift. Call `counter.rebalance()` periodically (daily cron) to consolidate shards.
- The counter must be updated in EVERY mutation that creates or deletes library items. Missing a mutation path silently drifts the count.
- `estimateCount()` is faster but approximate. Use `count()` for display accuracy.

### 3. Bounding `.collect()` Calls

**Current state:** 124 `.collect()` calls across 26 files in `convex/`.

**Triage by category:**

| Category | Count | Action |
|----------|-------|--------|
| Test files (*.test.ts) | ~40 | Skip -- test assertions, not production |
| Test helpers/automation | ~10 | Skip -- staging/test only |
| Debug functions | ~8 | Skip -- becoming internal, not user-facing |
| Naturally bounded (<100 docs expected) | ~50 | Document expected cardinality, no `.take()` needed |
| High-traffic, potentially unbounded | ~16 | Add `.take()` bounds |

**High-traffic paths needing bounds:**

| File | Line | Query Description | Risk | Recommended Bound |
|------|------|-------------------|------|-------------------|
| `library/queries.ts:194` | All library items by user (browse path) | HIGH -- grows with library size, called on every page load | `.take(10_000)` with documented constant |
| `library/queries.ts:187` | Library search index results | MEDIUM -- search index returns relevance-ranked results but no inherent cap | `.take(1_000)` |
| `library/queries.ts:55` | Collection memberships for filter set | MEDIUM -- grows with collection size | `.take(5_000)` |
| `extraction/queries.ts:144,172,219` | Per-job paper queries | LOW -- bounded by MAX_PAPERS_PER_JOB=500 | Already effectively bounded by job creation logic |
| `credits/internal.ts` (6 calls) | Credit transaction and dedup queries | MEDIUM -- transaction history grows over time | `.take(10_000)` on history queries |
| `subscriptions/internal.ts` (10 calls) | Subscription queries per user | LOW -- users have 1-3 subscriptions | No action needed |
| `library/collections.ts` (5 calls) | Collection memberships and user collections | LOW -- typically <50 collections, <200 memberships per collection | Document cardinality expectation |

**Pattern for bounding:**
```typescript
/** Maximum library items returned in a single browse query.
 *  Users with more items see truncated results -- pagination is the long-term fix. */
const MAX_LIBRARY_BROWSE = 10_000;

const items = await ctx.db
  .query("libraryItems")
  .withIndex(SORT_INDEX_MAP[sortBy], (q) => q.eq("userId", userId))
  .order(sortOrder)
  .take(MAX_LIBRARY_BROWSE);
```

**Convex-specific context:** Convex `.collect()` loads all matching documents into the function's memory. The framework warns: "If there's a chance the number of results is large (say 1000+ documents), you should use an index to filter the results further before calling `.collect()`." All high-traffic paths already use indexes -- the issue is lack of explicit `.take()` caps.

## MVP Recommendation

Prioritize in this order:

1. **Debug endpoint conversion** (table stakes, Low complexity, no dependencies)
   - Convert 2 public debug functions to `internalQuery`
   - Remove `requirePublicDebugEnabled()` from all 7 debug files
   - Delete `convex/lib/debug_gate.ts`
   - Add `writeAuditLog` calls for persistent audit trail

2. **`.collect()` bounding** (table stakes, Medium complexity, no dependencies)
   - Add `.take()` bounds to ~6 high-traffic production query paths
   - Define documented `MAX_*` constants for each bound
   - Skip test files, debug functions, and naturally-bounded queries

3. **Library count efficiency** (table stakes, Medium complexity, new component)
   - Install `@convex-dev/sharded-counter`
   - Replace `getLibraryCount` with counter read
   - Add counter.inc/dec to library save/delete mutations
   - Implement lazy backfill for existing users

**Defer:** Server-side pagination (High complexity, not blocking), collection counters (nice-to-have), full aggregate component (over-engineering for current needs).

## Sources

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- internal vs public functions, query safety
- [Convex Aggregate Component](https://stack.convex.dev/efficient-count-sum-max-with-the-aggregate-component) -- O(log n) counting via B-tree
- [Convex Sharded Counter](https://www.convex.dev/components/sharded-counter) -- simpler high-throughput counting
- [@convex-dev/sharded-counter GitHub](https://github.com/get-convex/sharded-counter) -- API reference (inc, dec, count, estimateCount, rebalance)
- [Queries That Scale](https://stack.convex.dev/queries-that-scale) -- .collect() bounds, pagination patterns
- [Convex Reading Data](https://docs.convex.dev/database/reading-data) -- .take(), .paginate(), .first(), .unique()
- [Convex Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf) -- index-based filtering best practices
- Existing codebase: `convex/lib/debug_gate.ts`, `convex/library/queries.ts`, `convex/extraction/debug_*.ts`

---
*Feature research for: v3.2 Production Readiness*
*Researched: 2026-03-06*
*Confidence: HIGH for debug conversion (pattern established), MEDIUM for sharded counter (well-documented but not yet used in project), HIGH for .collect() bounding (standard Convex practice)*
