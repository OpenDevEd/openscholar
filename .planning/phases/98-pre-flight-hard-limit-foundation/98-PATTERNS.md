# Phase 98: Pre-flight & Hard-Limit Foundation - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 6 (2 new, 4 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/lib/queryBounds.ts` | config | N/A (constants) | self (existing file) | exact |
| `convex/lib/extractionLimit.ts` | utility | request-response | `convex/subscriptions/queries.ts:getTier` | exact |
| `convex/extraction/queries.ts` | controller (query) | CRUD | self (existing file) | exact |
| `convex/extraction/mutations.ts` | controller (mutation) | CRUD | self (existing file) | exact |
| `convex/extraction/benchmark.test.ts` | test | transform | `convex/extraction/mutations.test.ts` | exact |
| `convex/extraction/queries.ts` (new `getExtractionLimit` query) | controller (query) | request-response | `convex/subscriptions/queries.ts:getTier` | exact |

## Pattern Assignments

### `convex/lib/queryBounds.ts` (config, constants -- MODIFY)

**Analog:** self (existing file)

**Full file pattern** (`convex/lib/queryBounds.ts`, lines 1-26):
```typescript
/** Maximum library items returned in a single browse/list query.
 * Based on practical upper bound of a user's library size. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering.
 * Matches MAX_LIBRARY_BROWSE since a collection is a subset of library. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Maximum credit transactions loaded per user.
 * Users accumulate transactions over time; 1,000 is generous. */
export const MAX_CREDIT_TRANSACTIONS = 1_000;

/** Maximum papers in a single screening job.
 * Balances throughput with credit/cost predictability. */
export const MAX_SCREENING_PAPERS_PER_JOB = 200;

/** Maximum screening jobs listed per user. */
export const MAX_SCREENING_JOBS_PER_USER = 500;

/** Maximum papers in a single extraction job.
 * Matches screening limit -- balances throughput with cost predictability. */
export const MAX_EXTRACTION_PAPERS_PER_JOB = 200;

/** Maximum extraction jobs listed per user. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;
```

**Conventions to follow:**
- `SCREAMING_SNAKE_CASE` for all constants
- JSDoc comment above every constant explaining the purpose and rationale
- Numeric separators with underscores (`10_000`, `1_000`)
- No default exports; all named exports

**New code must add:**
- `import type { SubscriptionPlan } from "../../lib/billing/entitlements"` -- use `type` import to avoid runtime bundling into Convex runtime
- `EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number>` before the `MAX_EXTRACTION_PAPERS_PER_JOB` line
- Derive `MAX_EXTRACTION_PAPERS_PER_JOB` via `Math.max(...Object.values(EXTRACTION_LIMITS_BY_TIER))`
- Add `MAX_EXTRACTION_RESULTS_QUERY = 10_000` as a separate constant

---

### `convex/lib/extractionLimit.ts` (utility, request-response -- NEW)

**Analog:** `convex/subscriptions/queries.ts:getTier` (lines 27-45)

**Subscription lookup + plan resolution pattern** (`convex/subscriptions/queries.ts`, lines 27-45):
```typescript
export const getTier = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    // Cardinality: ~1-5 subscriptions per user
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const subscription = selectCanonicalSubscription(subscriptions);

    return getPlanTier(resolveEffectivePlan(subscription));
  },
});
```

**Imports pattern** (`convex/subscriptions/queries.ts`, lines 1-7):
```typescript
import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { getPlanTier } from "../lib/constants";
import { subscriptionValidator } from "../lib/validators";
import { selectCanonicalSubscription } from "./lib/selectCanonicalSubscription";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
```

**Key differences for `extractionLimit.ts`:**
- Export an async function (not a query handler) -- it receives `ctx` and `userId` as arguments
- Context type: `QueryCtx | MutationCtx` from `../_generated/server` (see `convex/lib/auth.ts` line 1 for pattern)
- Returns `Promise<number>` (the limit value)
- Reuses the exact subscription lookup + `selectCanonicalSubscription` + `resolveEffectivePlan` chain

**Context typing pattern** (`convex/lib/auth.ts`, lines 1-6):
```typescript
import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
```

---

### `convex/extraction/queries.ts` -- new `getExtractionLimit` query (controller, request-response -- ADD)

**Analog:** `convex/subscriptions/queries.ts:getTier` (lines 27-45)

**Query structure pattern** (`convex/subscriptions/queries.ts`, lines 27-45):
```typescript
export const getTier = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    // Cardinality: ~1-5 subscriptions per user
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const subscription = selectCanonicalSubscription(subscriptions);

    return getPlanTier(resolveEffectivePlan(subscription));
  },
});
```

**Auth guard pattern for queries** (`convex/extraction/queries.ts`, lines 520-525):
```typescript
const user = await getCurrentUser(ctx);
if (!user) return null;
```

**Key differences for `getExtractionLimit`:**
- Returns `v.object({ limit: v.number(), plan: v.string() })` (not just a number)
- Unauthenticated returns `{ limit: 0, plan: "free" }` (matches `getTier` returning `0`)
- Calls `getExtractionLimitForUser(ctx, user._id)` from the new helper

---

### `convex/extraction/queries.ts` -- call-site rewiring (controller, CRUD -- MODIFY)

**Analog:** self (existing file)

**`.take()` pattern to preserve** (`convex/extraction/queries.ts`, lines 527-530):
```typescript
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);
```

**`.take()` site to change** (`convex/extraction/queries.ts`, lines 118-120):
```typescript
// BEFORE (site #7 -- fetches results, not papers):
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10);

// AFTER: replace with MAX_EXTRACTION_RESULTS_QUERY
```

**Sites that keep `MAX_EXTRACTION_PAPERS_PER_JOB`:** lines 103 (papers), 139 (papers), 333 (papers), 530 (papers), 624 (papers)
**Sites that switch to `MAX_EXTRACTION_RESULTS_QUERY`:** line 120 (results)

---

### `convex/extraction/mutations.ts` -- call-site rewiring (controller, CRUD -- MODIFY)

**Analog:** self (existing file)

**User-facing validation pattern to change** (`convex/extraction/mutations.ts`, lines 45-49):
```typescript
// BEFORE (sites #1 and #2 -- user-facing cap):
if (args.papers.length > MAX_EXTRACTION_PAPERS_PER_JOB) {
  throw createError(
    "VALIDATION_ERROR",
    `Maximum ${MAX_EXTRACTION_PAPERS_PER_JOB} papers per job`
  );
}

// AFTER: replace with getExtractionLimitForUser(ctx, user._id) result
```

**Error throwing pattern** (`convex/extraction/mutations.ts`, lines 42-44):
```typescript
throw createError("VALIDATION_ERROR", "At least one paper is required");
```

**`.take()` site to change** (`convex/extraction/mutations.ts`, lines 489-492):
```typescript
// BEFORE (site #5 -- fetches results, not papers):
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10);

// AFTER: replace with MAX_EXTRACTION_RESULTS_QUERY
```

**Sites that keep `MAX_EXTRACTION_PAPERS_PER_JOB`:** lines 204 (papers), 274 (papers)
**Sites that switch to `MAX_EXTRACTION_RESULTS_QUERY`:** line 492 (results)
**Sites that switch to per-user limit:** lines 45, 48 (user-facing cap in `createExtractionJob`)

**Import block to update** (`convex/extraction/mutations.ts`, line 16):
```typescript
// BEFORE:
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";

// AFTER: add MAX_EXTRACTION_RESULTS_QUERY and import getExtractionLimitForUser
import { MAX_EXTRACTION_PAPERS_PER_JOB, MAX_EXTRACTION_RESULTS_QUERY } from "../lib/queryBounds";
import { getExtractionLimitForUser } from "../lib/extractionLimit";
```

---

### `convex/extraction/benchmark.test.ts` (test, transform -- NEW)

**Analog:** `convex/extraction/mutations.test.ts`

**Test file structure pattern** (`convex/extraction/mutations.test.ts`, lines 1-9):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
```

**Seed user helper** (`convex/extraction/mutations.test.ts`, lines 10-24):
```typescript
async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_extraction_test",
      email: "extraction-test@example.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}
```

**Seed extraction job helper** (`convex/extraction/mutations.test.ts`, lines 26-49):
```typescript
async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
  }> = {}
): Promise<Doc<"extractionJobs">> {
  return await t.run(async (ctx): Promise<Doc<"extractionJobs">> => {
    const id = await ctx.db.insert("extractionJobs", {
      userId,
      status: overrides.status ?? "pending",
      totalPapers: overrides.totalPapers ?? 2,
      processedPapers: overrides.processedPapers ?? 0,
      failedPapers: overrides.failedPapers ?? 0,
      questions: [{ key: "q1", question: "What is the main finding?" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  });
}
```

**Seed extraction result pattern** (`convex/extraction/mutations.test.ts`, lines 112-119):
```typescript
await t.run(async (ctx) => {
  await ctx.db.insert("extractionResults", {
    jobId: job._id,
    paperId: paper._id,
    questionId: "q1",
    answer: "test answer",
    createdAt: Date.now(),
  });
});
```

**Test assertion pattern** (`convex/extraction/mutations.test.ts`, lines 92-101):
```typescript
const papers = await t.run(async (ctx) => {
  return await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
});

expect(papers).toHaveLength(3);
expect(papers.every((p) => p.status === "pending")).toBe(true);
```

**`getConvexSize` usage for benchmark** (from RESEARCH.md, verified):
```typescript
import { getConvexSize } from "convex/values";

const payloadBytes = getConvexSize(queryResult);
const payloadMB = payloadBytes / (1024 * 1024);
expect(payloadMB).toBeLessThan(5);
```

**Vitest config:** Tests in `convex/**/*.test.ts` run in `edge-runtime` environment (from `vitest.config.ts` `environmentMatchGlobs`). The `modules` glob is required: `const modules = import.meta.glob("./**/*.ts");`

---

## Shared Patterns

### Authentication (Query Context)
**Source:** `convex/lib/auth.ts`, lines 31-39
**Apply to:** `getExtractionLimit` query, `getExtractionLimitForUser` helper callers
```typescript
export async function getCurrentUser(
  ctx: AuthContext
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await getUserByClerkId(ctx, identity.subject);
  if (!user || user.state !== "active") return null;
  return user;
}
```

### Authentication (Mutation Context)
**Source:** `convex/lib/auth.ts`, lines 48-64
**Apply to:** `createExtractionJob` mutation (already uses `requireAuth`)
```typescript
export async function requireAuth(ctx: AuthContext, allowSyncing?: boolean): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  const user = await getUserByClerkId(ctx, identity.subject);
  if (!user) {
    if (allowSyncing) {
      throw createError("UNAUTHENTICATED", "User not synced yet");
    }
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  return assertActiveUser(user);
}
```

### Error Handling
**Source:** `convex/lib/errors.ts`, lines 73-81
**Apply to:** `createExtractionJob` validation errors
```typescript
export function createError(
  code: ErrorCode,
  message?: string
): ConvexError<ErrorData> {
  if (message) {
    return new ConvexError({ code, message });
  }
  return new ConvexError({ code });
}
```

### Subscription Plan Resolution Chain
**Source:** `convex/subscriptions/queries.ts` lines 17-23 + `convex/subscriptions/lib/selectCanonicalSubscription.ts` + `lib/billing/entitlements.ts`
**Apply to:** `getExtractionLimitForUser` helper
```typescript
// Step 1: Fetch all subscriptions for user (cardinality ~1-5)
const subscriptions = await ctx.db
  .query("subscriptions")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .order("desc")
  .collect();

// Step 2: Select canonical subscription (priority: active paid > active free > any free > fallback)
const subscription = selectCanonicalSubscription(subscriptions);

// Step 3: Resolve effective plan (returns "free" for null/canceled subscriptions)
const plan = resolveEffectivePlan(subscription);
```

### Constants Naming Convention
**Source:** `convex/lib/queryBounds.ts` (entire file) + `convex/lib/constants.ts`
**Apply to:** All new constants in `queryBounds.ts`
- `SCREAMING_SNAKE_CASE` naming
- JSDoc comment above each constant
- Numeric separators with underscores: `1_000`, `10_000`
- Pure value exports (no functions in `queryBounds.ts`)
- Cross-boundary type imports use `import type` keyword

### Convex Query Registration
**Source:** `convex/extraction/queries.ts`, lines 21-33 (representative)
**Apply to:** `getExtractionLimit` query
```typescript
export const getExtractionProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      // ...
    })
  ),
  handler: async (ctx, args) => {
    // auth guard
    // ownership check
    // business logic
  },
});
```

### Convex Test Scaffolding
**Source:** `convex/extraction/mutations.test.ts`, lines 1-9
**Apply to:** `benchmark.test.ts`
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("./**/*.ts");
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have exact or role-match analogs in the codebase |

---

## Metadata

**Analog search scope:** `convex/lib/`, `convex/extraction/`, `convex/subscriptions/`, `lib/billing/`
**Files scanned:** 14 source files read in full or partial
**Pattern extraction date:** 2026-04-15
