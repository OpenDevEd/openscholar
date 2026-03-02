# Stack Research: v2.3 Codebase Hardening

**Domain:** Convex backend hardening (type safety, rate limiting, pagination, encryption, deletion cascade, N+1 resolution)
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

The v2.3 hardening milestone requires **zero new dependencies**. Every fix uses existing packages (`convex@1.32.0`, `convex-helpers@0.1.112`) and built-in Node.js crypto. The codebase already has the correct packages installed -- the gap is purely in how they are used. The generated types in `convex/_generated/server.d.ts` and `convex/_generated/api.d.ts` already export `QueryCtx`, `MutationCtx`, `ActionCtx`, `Doc`, `Id`, and fully-typed `internal` and `components` objects. The `as any` casts scattered through billing and extraction modules are unnecessary with the current generated types.

## Recommended Stack

### Core Technologies (Already Installed -- No Changes)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| convex | 1.32.0 | Backend runtime, database, scheduling | Installed -- use more of its type system |
| convex-helpers | 0.1.112 | Rate limiting (`server/rateLimit`), migrations | Installed -- rate limiting module unused |
| Node.js crypto | Built-in | AES-256-GCM encryption for Zotero keys | Already used in `convex/apiKeys/actions.ts` |

### What to Activate from Existing Packages

| Capability | Source | Import Path | Currently Used? |
|------------|--------|-------------|-----------------|
| `QueryCtx` | convex (generated) | `../_generated/server` | YES in `convex/lib/auth.ts`, NO in extraction modules |
| `MutationCtx` | convex (generated) | `../_generated/server` | YES in `convex/lib/auth.ts`, NO in extraction modules |
| `Doc<T>` | convex (generated) | `../_generated/dataModel` | YES but alongside `ctx: any` |
| `internal` (typed) | convex (generated) | `../_generated/api` | Imported then cast to `any` in 5 files |
| `components` (typed) | convex (generated) | `../_generated/api` | Imported then cast to `any` in 4 files |
| `paginationOptsValidator` | convex/server | `convex/server` | Imported in `queries.ts` but not broadly used |
| `.paginate()` | convex/server | Built into query builder | Not used for backfills or large data |
| `rateLimitTables` | convex-helpers | `convex-helpers/server/rateLimit` | NOT used -- rate limit module is config-only stub |
| `defineRateLimits` | convex-helpers | `convex-helpers/server/rateLimit` | NOT used |
| `rateLimit()` | convex-helpers | `convex-helpers/server/rateLimit` | NOT used |
| AES-256-GCM encrypt/decrypt | Node.js crypto | `crypto` | YES for provider API keys, NOT for Zotero |

## Detailed Patterns for Each Hardening Area

---

### 1. Convex Proper Typing (MutationCtx, QueryCtx, Typed Internal API)

**Problem:** `ctx: any` used in 30+ helper functions across extraction modules. `internal as any` in 5 files. `components as any` in 4 files. All bypass compile-time safety.

**Evidence from codebase:** The generated `convex/_generated/server.d.ts` already exports:
```typescript
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
```

The generated `convex/_generated/api.d.ts` already exports:
- `internal` as `FilterApi<typeof fullApi, FunctionReference<any, "internal">>` -- fully typed, includes every internal function path
- `components` with full type declarations for `components.stripe.public.*`, `components.stripe.private.*`, `components.rag.*`, `components.workflow.*`, `components.workpool.*`

**Fix pattern for helper functions:**

```typescript
// BEFORE (current)
async function assertJobOwnership(ctx: any, userId: Id<"users">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get(jobId);
  // ...
}

async function loadJobDataForReporting(ctx: any, jobId: Id<"extractionJobs">) {
  const papers = await ctx.db.query("extractionPapers")
    .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
    .collect();
  // ...
}

// AFTER (fixed)
import { QueryCtx, MutationCtx } from "../_generated/server";

async function assertJobOwnership(ctx: MutationCtx, userId: Id<"users">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get(jobId);
  // Now: job is typed as Doc<"extractionJobs"> | null
}

async function loadJobDataForReporting(ctx: QueryCtx, jobId: Id<"extractionJobs">) {
  const papers = await ctx.db.query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    // No more (q: any) -- TypeScript infers the index fields
    .collect();
}
```

**Fix pattern for `internal as any`:**

```typescript
// BEFORE (current in convex/http.ts, convex/crons.ts, etc.)
import { components, internal } from "./_generated/api";
const internalApi = internal as any;
// ... later:
await ctx.runMutation(internalApi.subscriptions.internal.syncSubscription, { ... });

// AFTER (fixed)
import { components, internal } from "./_generated/api";
// No cast needed -- internal is already typed
await ctx.runMutation(internal.subscriptions.internal.syncSubscription, { ... });
```

**Fix pattern for `components as any`:**

```typescript
// BEFORE (current in convex/credits/internal.ts, etc.)
const componentApi = components as any;
await ctx.runQuery(componentApi.stripe.public.listInvoices, { ... });

// AFTER (fixed)
// components.stripe.public is fully typed in _generated/api.d.ts
await ctx.runQuery(components.stripe.public.listInvoices, { ... });
```

**Key principle:** `MutationCtx` satisfies `QueryCtx` (superset). Helper functions that only read should accept `QueryCtx` so they work in both mutation and query handlers. Helper functions that write must use `MutationCtx`.

**Files to change:** `convex/extraction/mutations.ts`, `convex/extraction/queries.ts`, `convex/extraction/workpoolActions.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/credits/queries.ts`, `convex/subscriptions/actions.ts`, `convex/subscriptions/internal.ts`

**Confidence:** HIGH -- verified against generated type declarations in `_generated/server.d.ts` (lines 107-123) and `_generated/api.d.ts` (lines 212-215, 217-568).

---

### 2. Convex Rate Limiting (convex-helpers Built-in)

**Problem:** `convex/lib/rateLimit.ts` is a config-only stub. No enforcement. Endpoints vulnerable to abuse.

**Solution:** Use `convex-helpers/server/rateLimit` which is already installed (v0.1.112). This is a standalone table-backed rate limiter -- no separate component install needed.

**Schema addition:**

```typescript
// convex/schema.ts
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  ...rateLimitTables,  // Adds "rateLimits" table with { name, key, value, ts } + index
  // ... existing tables unchanged
});
```

The `rateLimitTables` export adds a single table:
```typescript
rateLimits: defineTable({
  name: v.string(),
  key: v.optional(v.string()),
  value: v.number(),
  ts: v.number(),
}).index("name", ["name", "key", "_creationTime"])
```

**Rate limit definition:**

```typescript
// convex/lib/rateLimit.ts (replace current stub)
import { defineRateLimits } from "convex-helpers/server/rateLimit";
import { HOUR, MINUTE } from "convex-helpers";

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  "api-key-save": {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },
  "checkout-session": {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },
  "ensure-user": {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  "start-extraction": {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 5,
  },
});
```

**Enforcement in mutations:**

```typescript
// In a mutation handler
import { rateLimit } from "../lib/rateLimit";

// Inside handler:
await rateLimit(ctx, {
  name: "start-extraction",
  key: user._id,  // Per-user rate limit
  throws: true,   // Throws ConvexError if exceeded
});
```

**Key details:**
- `rateLimit()` accepts `{ db: GenericDatabaseWriter }` -- works in any mutation context
- Token bucket: tokens accumulate continuously, allows bursts after idle
- `throws: true` throws a `ConvexError` with `{ kind: "RateLimited", name, retryAt }` -- can be caught on client
- `checkRateLimit()` is read-only (works in queries) -- checks without consuming
- No cleanup cron needed -- old entries are naturally overwritten (token bucket uses one row per name+key)

**Why convex-helpers over @convex-dev/ratelimiter component:** Already installed. No component registration needed. Same algorithm (token bucket / fixed window). The `@convex-dev/ratelimiter` component is the newer approach but requires `app.config.ts` changes and component installation. Using convex-helpers avoids adding a new component dependency.

**Confidence:** HIGH -- verified against convex-helpers source on GitHub and type declarations at `convex-helpers@0.1.112/server/rateLimit.d.ts`.

---

### 3. Convex Pagination (Cursor-Based for Large Queries)

**Problem:** 90+ `.collect()` calls. `backfillIsIndexed` does a full table scan. Dashboard queries load all papers/results unbounded.

**Solution:** Use Convex's built-in `.paginate()` API for queries that could grow large, and `.take(N)` for bounded results.

**Client-facing paginated queries (already partially used in library):**

```typescript
import { query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

export const listJobPapers = query({
  args: {
    jobId: v.id("extractionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .paginate(args.paginationOpts);
    // Returns: { page: Doc[], continueCursor: string, isDone: boolean }
  },
});
```

**Server-side paginated processing (for backfills/cascades):**

```typescript
// Pattern: scheduled mutation with cursor
export const deleteJobBatch = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { jobId, cursor }) => {
    const BATCH_SIZE = 100;
    const result = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .paginate({ numItems: BATCH_SIZE, cursor });

    for (const paper of result.page) {
      await ctx.db.delete(paper._id);
    }

    if (!result.isDone) {
      // Schedule next batch
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteJobBatch, {
        jobId,
        cursor: result.continueCursor,
      });
    }
  },
});
```

**When to use which:**
- `.paginate()` with `paginationOptsValidator` -- for client-facing queries the user pages through
- `.paginate()` with manual cursor -- for server-side batch processing (backfills, cascades)
- `.take(N)` -- when you need a bounded result and don't need pagination state (e.g., "first 10 results")
- `.collect()` -- ONLY when the result set is guaranteed bounded (e.g., user's collections -- max ~50)

**Confidence:** HIGH -- verified against official Convex pagination docs and `paginationOptsValidator` already imported in `convex/extraction/queries.ts`.

---

### 4. AES Encryption for Zotero API Keys

**Problem:** Zotero API keys stored as plaintext `v.string()` in `zoteroConnections` table. Provider API keys in `apiKeys` table use AES-256-GCM encryption.

**Solution:** Reuse the existing `encrypt()`/`decrypt()` functions from `convex/apiKeys/actions.ts`. No new dependencies.

**Existing encryption pattern (from `convex/apiKeys/actions.ts`):**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}
```

**Implementation approach:**

1. **Extract shared crypto utility:** Move `encrypt()`/`decrypt()` to `convex/lib/crypto.ts` (Node.js action file with `"use node"`)
2. **Schema change:** Replace `apiKey: v.string()` with `encryptedApiKey: v.string()` and `keyPrefix: v.string()` in `zoteroConnections` table
3. **Mutation change:** `saveConnection` becomes an action (needs Node.js crypto), encrypts before storing
4. **Query change:** Reads that need the key decrypt via internal action (same pattern as `apiKeys/actions.ts:getDecrypted`)
5. **Migration:** Backfill existing plaintext keys to encrypted format

**Schema update:**

```typescript
zoteroConnections: defineTable({
  userId: v.id("users"),
  zoteroUserId: v.string(),
  encryptedApiKey: v.string(),  // Was: apiKey: v.string()
  keyPrefix: v.string(),        // New: for display (e.g., "zot_abc...")
  username: v.optional(v.string()),
  connectedAt: v.number(),
})
```

**Key constraint:** Encryption/decryption requires Node.js `crypto` module, which only runs in Convex actions (not mutations/queries). The existing `apiKeys` pattern uses actions for encrypt/save and internal actions for decrypt. Zotero should follow the same pattern.

**Confidence:** HIGH -- directly reuses proven pattern from `convex/apiKeys/actions.ts` with zero new dependencies.

---

### 5. Deletion Cascade Best Practices

**Problem:** `deleteExtractionInternal` misses `extractionEvidenceUnits`, uses recursive self-scheduling with O(papers^2) complexity, and has no test coverage.

**Solution:** Cursor-based batch deletion with scheduled continuations.

**Pattern: Cascading delete with cursor progression**

```typescript
export const deleteExtractionCascade = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    phase: v.union(
      v.literal("evidence"),
      v.literal("results"),
      v.literal("reviews"),
      v.literal("papers"),
      v.literal("questions"),
      v.literal("job")
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { jobId, phase, cursor }) => {
    const BATCH = 100;

    if (phase === "evidence") {
      // Delete evidence units for all papers in this job
      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .paginate({ numItems: BATCH, cursor });

      for (const paper of papers.page) {
        const units = await ctx.db
          .query("extractionEvidenceUnits")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        for (const unit of units) {
          await ctx.db.delete(unit._id);
        }
      }

      if (!papers.isDone) {
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionCascade, {
          jobId, phase: "evidence", cursor: papers.continueCursor,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionCascade, {
          jobId, phase: "results", cursor: null,
        });
      }
    }
    // ... similar for each phase, then final job deletion
  },
});
```

**Key principles:**
- **Phase-based:** Delete child entities before parents (evidence -> results -> reviews -> papers -> questions -> job)
- **Cursor-based:** Each phase paginates through records, scheduling continuation if not done
- **Scheduler, not recursion:** Use `ctx.scheduler.runAfter(0, ...)` instead of `ctx.runMutation(internal....)` to avoid deep call stacks
- **Bounded batches:** Each mutation processes at most BATCH_SIZE documents to stay within Convex limits
- **Include storage cleanup:** Delete `storageId` files when deleting papers

**Why not Convex Ents:** The project doesn't use Convex Ents and adding it for cascade support alone is overkill. The scheduled-continuation pattern is the standard Convex approach for large batched deletes.

**Confidence:** HIGH -- pattern verified against Convex best practices docs and stack.convex.dev migration articles.

---

### 6. N+1 Query Resolution

**Problem:** `loadJobDataForReporting` and `loadJobPapersAndResults` iterate papers and query results/reviews per paper sequentially. For 100 papers = 200+ DB reads.

**Solution:** Batch-fetch related documents by jobId, then join in memory.

**Pattern:**

```typescript
// BEFORE: N+1 (sequential per-paper queries)
for (const paper of papers) {
  const results = await ctx.db.query("extractionResults")
    .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
    .collect();
  // ...
}

// AFTER: 2 queries total (batch fetch + in-memory join)
const [papers, allResults, allReviews] = await Promise.all([
  ctx.db.query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect(),
  ctx.db.query("extractionResults")
    .withIndex("by_paper")  // Need new index: by_job on extractionResults
    // OR: collect all results for papers via a broader approach
    .collect(),
  ctx.db.query("extractionResultReviews")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect(),
]);

// In-memory grouping
const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
for (const result of allResults) {
  const existing = resultsByPaper.get(result.paperId) ?? [];
  existing.push(result);
  resultsByPaper.set(result.paperId, existing);
}
```

**Index requirement:** `extractionResults` currently has `by_paper` and `by_paper_question` indexes. To batch-fetch all results for a job without iterating papers, add a `by_job` index that requires a `jobId` field on `extractionResults`, OR use the fact that `extractionResultReviews` already has `by_job` and `extractionResults` can be fetched via paper IDs.

**Practical approach (no schema change):** Since `extractionResults` doesn't have `jobId`, use `Promise.all` to parallelize the per-paper fetches instead of making them sequential:

```typescript
const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
await Promise.all(
  papers.map(async (paper) => {
    const results = await ctx.db.query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect();
    resultsByPaper.set(paper._id, results);
  })
);
```

This changes O(n) sequential reads to O(n) parallel reads, which Convex handles efficiently within a single transaction. For very large jobs (500+ papers), the paginated dashboard approach (section 3) is the real fix.

**Confidence:** HIGH -- `Promise.all` for parallel reads in Convex is documented best practice. No new dependencies.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@convex-dev/ratelimiter` (component) | `convex-helpers` rate limiting already installed, same algorithm, no component registration | `convex-helpers/server/rateLimit` |
| `convex-ents` | Only needed for auto-cascading deletes; project has manual cascade pattern | Manual cursor-based cascade with scheduler |
| New encryption library (e.g., `tweetnacl`) | Node.js built-in `crypto` with AES-256-GCM already proven in codebase | `crypto` module (Node.js built-in) |
| `zod` for runtime validation in Convex | Convex validators (`v.string()`, etc.) handle server-side validation natively | Convex `v` validators |
| Any ORM or query builder | Convex's typed query builder is the correct layer; `any` casts were the issue, not missing abstraction | Direct `ctx.db.query()` with proper typing |

## What NOT to Change

| Keep As-Is | Why |
|------------|-----|
| `@convex-dev/stripe` integration | Works correctly; `components` type is fully generated |
| `@convex-dev/workflow` and `@convex-dev/workpool` | Core to extraction pipeline; not part of hardening scope |
| `convex-test@0.0.41` | Existing test infrastructure unchanged |
| Vitest / Playwright configs | Test runners are stable; hardening adds tests, doesn't change runner setup |
| `ENCRYPTION_KEY` env var pattern | Already used for provider API keys; extend to Zotero |

## Installation

```bash
# No new packages needed. Zero npm install.
# All capabilities come from existing dependencies.
```

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| convex | 1.32.0 | convex-helpers@0.1.112 | Verified compatible |
| convex-helpers | 0.1.112 | convex@^1.0.0 | `rateLimitTables` uses standard `defineTable` |
| Node.js crypto | Built-in | Convex actions (`"use node"`) | Only available in action handlers |

## Schema Additions Summary

```typescript
// convex/schema.ts additions:
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  ...rateLimitTables,  // NEW: adds "rateLimits" table

  // MODIFIED: zoteroConnections
  zoteroConnections: defineTable({
    userId: v.id("users"),
    zoteroUserId: v.string(),
    encryptedApiKey: v.string(),  // Changed from apiKey
    keyPrefix: v.string(),        // New field
    username: v.optional(v.string()),
    connectedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_zotero_user", ["zoteroUserId"]),

  // All other tables unchanged
});
```

## File Changes Summary

| Area | Files Affected | Change Type |
|------|---------------|-------------|
| Type safety (ctx) | `convex/extraction/mutations.ts`, `convex/extraction/queries.ts`, `convex/extraction/workpoolActions.ts` | Replace `ctx: any` with `QueryCtx`/`MutationCtx`; remove `(q: any)` casts |
| Type safety (internal) | `convex/http.ts`, `convex/crons.ts`, `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/subscriptions/actions.ts` | Remove `internal as any` cast, use `internal` directly |
| Type safety (components) | `convex/credits/internal.ts`, `convex/credits/queries.ts`, `convex/subscriptions/internal.ts`, `convex/subscriptions/actions.ts` | Remove `components as any` cast, use `components` directly |
| Rate limiting | `convex/lib/rateLimit.ts` (rewrite), `convex/schema.ts` (add table) | Replace stub with `defineRateLimits` from convex-helpers |
| Rate enforcement | `convex/extraction/mutations.ts`, `convex/apiKeys/actions.ts`, `convex/subscriptions/actions.ts` | Add `rateLimit()` calls in handlers |
| Encryption | `convex/lib/crypto.ts` (new), `convex/zotero/mutations.ts`, `convex/zotero/actions.ts` | Extract shared crypto, encrypt Zotero keys |
| Schema | `convex/schema.ts` | Add `rateLimitTables`, modify `zoteroConnections` |
| Pagination | `convex/extraction/mutations.ts` (backfill, cascade) | Replace `.collect()` with `.paginate()` for unbounded queries |
| N+1 fix | `convex/extraction/mutations.ts`, `convex/extraction/queries.ts` | Parallelize per-paper queries with `Promise.all` |

## Sources

- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) -- QueryCtx/MutationCtx typing patterns (HIGH confidence)
- [Convex Paginated Queries](https://docs.convex.dev/database/pagination) -- .paginate() API, PaginationResult shape (HIGH confidence)
- [Convex Rate Limiting at Application Layer](https://stack.convex.dev/rate-limiting) -- token bucket implementation in convex-helpers (HIGH confidence)
- [convex-helpers rateLimit source](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/rateLimit.ts) -- defineRateLimits API, rateLimitTables schema (HIGH confidence)
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- query scaling, deletion patterns (HIGH confidence)
- [Stateful Online Migrations](https://stack.convex.dev/migrating-data-with-mutations) -- cursor-based batch processing pattern (HIGH confidence)
- [Convex Queries That Scale](https://stack.convex.dev/queries-that-scale) -- index optimization, data segmentation (HIGH confidence)
- Generated type declarations verified at: `convex/_generated/server.d.ts` (lines 107-143), `convex/_generated/api.d.ts` (lines 212-568)
- Installed package versions verified: `convex@1.32.0`, `convex-helpers@0.1.112`

---
*Stack research for: v2.3 Codebase Hardening*
*Researched: 2026-03-02*
