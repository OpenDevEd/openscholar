# Feature Research: Codebase Hardening (v2.3)

**Domain:** Codebase hardening for Convex + Next.js academic search platform
**Researched:** 2026-03-02
**Confidence:** HIGH (patterns verified against Convex official docs and existing codebase)

## Feature Landscape

This milestone has no user-facing features in the traditional sense. Every "feature" is an internal quality improvement that prevents data loss, security breaches, runtime errors, or performance degradation. The categories below map to the concerns identified in `.planning/codebase/CONCERNS.md`.

---

### Table Stakes (Must Fix -- Risk of Data Loss, Security Breach, or Runtime Failure)

Features where the current state represents an active bug, security vulnerability, or data integrity risk.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Remove production `console.log` statements | Debug logs leak query params and billing state to stdout; clutters server logs | LOW | 2 files: `app/settings/billing/page.tsx:282-290`, `app/actions/openalex.ts:13,18,23,35`. Delete or replace with conditional `NODE_ENV` guard. |
| Fix `@ts-ignore` in `debug_papers.ts` | Accessing non-existent schema field `p.pdfUsed` silently returns `undefined` | LOW | `convex/debug_papers.ts:20-21`. Remove the field access or update schema if field is needed. |
| Stripe `"dummy"` key fallback removal | Missing `STRIPE_SECRET_KEY` silently passes init, then every Stripe call fails at runtime with opaque auth errors | LOW | `convex/subscriptions/actions.ts:38`, `convex/credits/actions.ts:31`. Replace with throw-on-missing validation. |
| Env var validation for critical configs | `NEXT_PUBLIC_APP_URL` fallback to `localhost:3000` can redirect Stripe checkout and Zotero OAuth to localhost in production | LOW | `convex/http.ts:13-16`, `convex/subscriptions/actions.ts:42-45`. Validate at function entry, throw if missing in production. |
| Deletion cascade: add evidence units | `deleteExtractionInternal` orphans `extractionEvidenceUnits` rows permanently; database grows unboundedly | MEDIUM | `convex/extraction/mutations.ts:968-1009`. Add deletion step for evidence units by paper before deleting papers. Requires index `by_paper` on `extractionEvidenceUnits`. |
| Deletion cascade: add storage cleanup | Deleted jobs' PDF `storageId` files are never cleaned; storage costs accumulate | MEDIUM | Call `ctx.storage.delete(paper.storageId)` during paper deletion in cascade. |
| Zotero API key encryption | Plaintext API key in `zoteroConnections` table -- the only user secret stored unencrypted | MEDIUM | `convex/zotero/mutations.ts:97-103`. Apply same AES-256-GCM pattern from `convex/apiKeys/actions.ts`. Requires Zotero save/read to go through an action (Node.js runtime for `crypto`). |
| Orphaned PDF cleanup for failed papers | `cleanupOldPdfs` only handles `completed` papers; `download_failed` and `failed` papers with `storageId` are never cleaned | LOW | `convex/extraction/mutations.ts:1250-1281`. Add additional query for failed status papers with `storageId`. |

### Differentiators (Raises Quality Bar -- Prevents Future Incidents)

Features that are not actively breaking things today but prevent future problems, improve maintainability, or reduce operational risk.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Type safety sweep: eliminate `ctx: any` | Catches schema mismatches and wrong index names at compile time instead of runtime | MEDIUM | ~15 occurrences across `convex/extraction/mutations.ts`, `queries.ts`, `workpoolActions.ts`. Replace with `MutationCtx` / `QueryCtx` from `convex/_generated/server`. Replace `(q: any)` callbacks with typed index parameters. |
| Type safety sweep: eliminate `internal as any` | Catches renamed/deleted internal functions at compile time | MEDIUM | ~7 files: `http.ts`, `crons.ts`, `credits/internal.ts`, `credits/actions.ts`, `subscriptions/actions.ts`, etc. Root cause is likely incomplete type generation for `@convex-dev/stripe` component references. Fix by regenerating types or properly typing the component API. |
| Type safety: `patchData: any` elimination | Prevents writing arbitrary fields to `extractionPapers` documents | LOW | `convex/extraction/mutations.ts:1887`. Replace with `Partial<Doc<"extractionPapers">>`. |
| Rate limiting enforcement | Prevents abuse of API key save, checkout creation, job creation, and user sync endpoints | HIGH | Currently `convex/lib/rateLimit.ts` is config-only with zero enforcement. Replace with `@convex-dev/rate-limiter` component (official Convex package). Requires adding to `convex.config.ts`, defining limits, and calling `rateLimiter.limit()` in relevant mutations/actions. |
| N+1 query resolution: `loadJobDataForReporting` | 200+ sequential DB reads for a 100-paper job; hits Convex transaction limits on large jobs | MEDIUM | `convex/extraction/mutations.ts:40-77`. Refactor inner loop to use `Promise.all` with `papers.map()` so all per-paper queries run in parallel. |
| N+1 query resolution: `loadJobPapersAndResults` | Sequential `for...of` loop with `await` inside; same transaction limit risk | MEDIUM | `convex/extraction/queries.ts:145-170`. Same pattern: replace sequential loop with `Promise.all(papers.map(...))`. |
| Unbounded `.collect()` audit | 90+ `.collect()` calls; worst case is full `extractionPapers` table scan in backfill | MEDIUM | Replace with `.take(N)` for bounded reads, `paginate()` for cursor-based traversal. Priority: `mutations.ts:1775` (full table scan), `maintenance/internal.ts:70` (full subscriptions scan). |
| Debug/test function isolation | 14 debug/test files in production Convex deployment; internal test functions bypass debug gate | MEDIUM | Wrap all test functions (`test_runner.ts`, `test_automation.ts`, `test_helpers.ts`) in `requirePublicDebugEnabled()` gate. Remove test workflow exports from `convex/extraction/index.ts`. |
| Deletion cascade: fix recursion to scheduler | Current recursive `ctx.runMutation` re-fetches ALL papers each iteration (O(n^2)); risks infinite recursion if batch size equals result count | MEDIUM | Replace `ctx.runMutation(internal...)` recursion with `ctx.scheduler.runAfter(0, internal...)` for proper Convex batched deletion pattern. Pass cursor state to avoid re-scanning. |
| Test coverage: extraction cascade delete | Zero test coverage on the most complex mutation in the codebase | MEDIUM | Write tests covering: evidence units deleted, storage cleaned, batch continuation works, job itself deleted last. |
| Test coverage: Zustand store migrations | 5-version migration chain untested; risk of silent data corruption on upgrade | MEDIUM | Write tests that create stores at each version and verify migration to latest produces correct shape. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like natural extensions of hardening work but create more problems than they solve.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full `.collect()` elimination (all 90+ calls) | "Every `.collect()` is dangerous" | Most `.collect()` calls are on indexed queries returning small result sets (per-job papers, per-paper results). Replacing all with pagination adds complexity without benefit for bounded data. | Audit and fix only the unbounded ones: full table scans and queries without indexes. Leave per-entity `.collect()` with proper indexes alone. |
| Move all debug functions to separate deployment | "Zero debug code in production" | Convex does not support importing functions across deployments. Separate deployment means separate database, making debug queries useless for production debugging. | Gate all debug/test functions behind `requirePublicDebugEnabled()`. Keep `ENABLE_PUBLIC_DEBUG_FUNCTIONS` unset in production. Remove exports from `index.ts` for test-only functions. |
| Custom rate limiting table instead of `@convex-dev/rate-limiter` | "We already have `convex/lib/rateLimit.ts` with the design" | Reimplementing token bucket with cleanup crons, sharding, and transactional guarantees is weeks of work. The existing file is config-only and has zero enforcement logic. | Use `@convex-dev/rate-limiter` (official Convex component). It handles token bucket, fixed window, sharding, transactional rollback, and cleanup automatically. Delete the custom `rateLimit.ts` file. |
| Encrypt all localStorage data (API keys in Zustand) | "Keys in localStorage are insecure" | Browser-side encryption with a key also stored browser-side provides zero security improvement. The threat is XSS, which can read the decryption key too. | Accept localStorage risk for BYOK keys (user's own keys). Document the security model. Server-side keys (Zotero, provider keys) are already encrypted in Convex via AES-256-GCM. |
| Schema version field migration for `V32_CUTOVER_AT` | "Replace timestamp gating with proper schema version" | Requires a data migration on all existing `extractionJobs` rows, schema change, and rewriting all version-checking logic. High risk for a mechanism that works and affects only pre-V3.2 jobs. | Keep `V32_CUTOVER_AT` for now. Add a `// TECH DEBT` comment documenting the eventual migration path. Revisit only if adding V4.0 extraction version. |
| Global error boundary for all Convex functions | "Catch every error in one place" | Convex functions already have built-in error handling and retry. A global wrapper adds indirection and can mask real errors by catching too broadly. | Use specific error handling at the function level with `createError()` pattern already established in the codebase. |
| Automated env var sync across deployments | "Prevent env var misconfiguration" | Requires CI/CD integration, secrets management service, and coordination across dev/staging/prod. Over-engineering for the current team size. | Validate env vars at function entry with clear error messages. Add a deployment checklist document. |

---

## Feature Dependencies

```
[Stripe dummy key removal]
    (no dependencies -- standalone fix)

[Env var validation]
    (no dependencies -- standalone fix)

[Production console.log removal]
    (no dependencies -- standalone fix)

[@ts-ignore fix in debug_papers.ts]
    (no dependencies -- standalone fix)

[Type safety: ctx typing]
    (no dependencies -- standalone refactor)

[Type safety: internal as any]
    (no dependencies -- may require `npx convex codegen` type regeneration)

[Rate limiting enforcement]
    └──requires──> [@convex-dev/rate-limiter added to convex.config.ts]
    └──requires──> [Rate limit definitions created]
    └──enhances──> [Stripe dummy key removal (validates key before rate-limited operations)]

[Zotero API key encryption]
    └──requires──> [ENCRYPTION_KEY env var (already exists for apiKeys)]
    └──requires──> [Zotero save mutation refactored to action (needs Node.js crypto)]

[Deletion cascade fixes]
    └──requires──> [Index on extractionEvidenceUnits.by_paper (if not already present)]
    └──enhances──> [Orphaned PDF cleanup]

[Orphaned PDF cleanup]
    └──requires──> [Index on extractionPapers by failed statuses with storageId]

[N+1 query resolution]
    (no dependencies -- refactor within existing functions)

[Unbounded .collect() audit]
    (no dependencies -- per-query refactoring)

[Debug function isolation]
    (no dependencies -- add guards, remove exports)

[Test: deletion cascade]
    └──requires──> [Deletion cascade fixes (test the corrected version)]

[Test: Zustand migrations]
    (no dependencies -- test existing code)
```

### Dependency Notes

- **Rate limiting requires `@convex-dev/rate-limiter` component:** This is a Convex component that needs `app.use(rateLimiter)` in `convex.config.ts` (alongside existing stripe, rag, workflow, workpool). Must be installed before any rate limit enforcement code is written.
- **Zotero encryption requires action refactor:** The current `saveConnection` is an internal mutation. AES-256-GCM requires Node.js `crypto` module, which is only available in Convex actions (not mutations). The save path must be refactored from `internalMutation` to `internalAction` that calls a mutation after encrypting.
- **Deletion cascade tests should test the fixed version:** Writing tests against the current broken cascade is wasted effort. Fix the cascade first, then write tests against the corrected behavior.
- **Type safety work is independent:** All `any` elimination can happen in parallel with other work since it does not change runtime behavior.

---

## Hardening Priority Tiers

### Tier 1: Fix Now (Active bugs, security holes, data loss)

Items that represent currently-broken behavior or active risk.

- [ ] Remove production `console.log` -- active log pollution in production
- [ ] Fix `@ts-ignore` in `debug_papers.ts` -- accessing non-existent field
- [ ] Remove Stripe `"dummy"` key fallback -- silent failure on misconfigured env
- [ ] Add env var validation for `NEXT_PUBLIC_APP_URL` -- could redirect to localhost
- [ ] Fix deletion cascade: add evidence units -- data orphaning on every delete
- [ ] Fix deletion cascade: add storage cleanup -- storage leak on every delete
- [ ] Encrypt Zotero API key -- only unencrypted user secret in database

### Tier 2: Harden Soon (Prevents incidents, improves reliability)

Items that prevent future problems but are not actively causing issues today.

- [ ] Enforce rate limiting via `@convex-dev/rate-limiter` -- abuse prevention
- [ ] Fix N+1 queries (2 functions) -- will break on large jobs
- [ ] Fix deletion cascade recursion pattern -- O(n^2) on large deletions
- [ ] Orphaned PDF cleanup for failed papers -- slow storage cost leak
- [ ] Debug/test function isolation -- unnecessary attack surface
- [ ] Audit unbounded `.collect()` calls -- top 3 worst offenders only

### Tier 3: Strengthen Foundation (Maintainability, compile-time safety)

Items that improve developer experience and catch bugs earlier but do not affect runtime behavior.

- [ ] Type safety sweep: `ctx: any` to `MutationCtx`/`QueryCtx` (~15 occurrences)
- [ ] Type safety sweep: `internal as any` elimination (~7 files)
- [ ] Type safety: `patchData: any` to typed partial
- [ ] Test coverage: extraction cascade delete
- [ ] Test coverage: Zustand store migrations

---

## Feature Prioritization Matrix

| Feature | Risk Reduction | Implementation Cost | Priority |
|---------|---------------|---------------------|----------|
| Remove production console.log | MEDIUM | LOW | P1 |
| Fix @ts-ignore debug_papers | LOW | LOW | P1 |
| Stripe dummy key removal | HIGH | LOW | P1 |
| Env var validation | HIGH | LOW | P1 |
| Deletion cascade: evidence units | HIGH | MEDIUM | P1 |
| Deletion cascade: storage cleanup | MEDIUM | LOW | P1 |
| Zotero API key encryption | HIGH | MEDIUM | P1 |
| Orphaned PDF cleanup (failed) | MEDIUM | LOW | P1 |
| Rate limiting enforcement | HIGH | HIGH | P2 |
| N+1 query fix: loadJobDataForReporting | MEDIUM | MEDIUM | P2 |
| N+1 query fix: loadJobPapersAndResults | MEDIUM | MEDIUM | P2 |
| Deletion cascade: recursion fix | MEDIUM | MEDIUM | P2 |
| Debug function isolation | MEDIUM | MEDIUM | P2 |
| Unbounded .collect() audit (top 3) | MEDIUM | MEDIUM | P2 |
| Type safety: ctx: any | MEDIUM | MEDIUM | P3 |
| Type safety: internal as any | MEDIUM | MEDIUM | P3 |
| Type safety: patchData: any | LOW | LOW | P3 |
| Test: deletion cascade | HIGH | MEDIUM | P3 |
| Test: Zustand migrations | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Fix now -- active risk or currently broken
- P2: Harden soon -- prevents future incidents
- P3: Strengthen foundation -- improves maintainability and catches future bugs

---

## Implementation Patterns by Category

### 1. Type Safety Sweep

**Pattern: Replace `ctx: any` with generated types**

Current (broken):
```typescript
async function assertJobOwnership(ctx: any, userId: Id<"users">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get(jobId); // no autocomplete, no type checking
}
```

Fixed:
```typescript
import { QueryCtx, MutationCtx } from "./_generated/server";

// Use QueryCtx for read-only helpers (callable from both queries and mutations)
async function assertJobOwnership(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get(jobId); // full autocomplete, schema-aware
}
```

**Key principle:** Use `QueryCtx` for helpers that only read. Use `MutationCtx` for helpers that write. A `MutationCtx` satisfies the `QueryCtx` interface, so `QueryCtx` helpers can be called from mutations.

**Pattern: Replace `(q: any)` index callbacks**

Current (broken):
```typescript
ctx.db.query("extractionPapers").withIndex("by_job", (q: any) => q.eq("jobId", jobId))
```

Fixed:
```typescript
// The type is inferred automatically when ctx is properly typed -- no annotation needed
ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId))
```

When `ctx` has the correct type, Convex infers the index callback parameter type automatically. The `(q: any)` annotations exist only because `ctx` was typed as `any`, cascading the loss of type information.

**Pattern: Replace `internal as any`**

Current:
```typescript
const internalApi = internal as any;
// Later: ctx.runMutation(internalApi.some.function, args)
```

Root cause: This pattern typically appears when `@convex-dev/stripe` or other components have incomplete type generation. Fix by running `npx convex codegen` and verifying the generated `_generated/api.d.ts` includes all internal function signatures. If the cast is needed for component APIs specifically, type it narrowly:

```typescript
// If component types are incomplete, cast narrowly rather than `as any`
import { components, internal } from "./_generated/api";
// Use internal directly -- if types are generated correctly, no cast needed
```

### 2. Rate Limiting Enforcement

**Pattern: `@convex-dev/rate-limiter` component integration**

Step 1 -- Install and configure:
```bash
npm install @convex-dev/rate-limiter
```

Step 2 -- Add to `convex/convex.config.ts`:
```typescript
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
app.use(rateLimiter);
```

Step 3 -- Define rate limits in a shared module:
```typescript
// convex/lib/rateLimiter.ts
import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  "api-key-save": { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },
  "checkout-session": { kind: "token bucket", rate: 3, period: MINUTE, capacity: 3 },
  "ensure-user": { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  "start-extraction": { kind: "token bucket", rate: 5, period: HOUR, capacity: 5 },
});
```

Step 4 -- Enforce in mutations/actions:
```typescript
await rateLimiter.limit(ctx, "start-extraction", { key: userId, throws: true });
```

The `throws: true` option automatically throws a `ConvexError` with retry timing. The old `convex/lib/rateLimit.ts` file should be deleted after migration.

### 3. Deletion Cascade (Batched, Scheduler-Based)

**Pattern: Replace recursive `ctx.runMutation` with `ctx.scheduler.runAfter`**

Current (problematic):
```typescript
// Re-calls itself via runMutation -- synchronous recursion within transaction
await ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId });
```

Fixed:
```typescript
// Schedule continuation -- runs as separate transaction
await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, {
  jobId,
  phase: "evidence_units", // Track deletion phase
});
```

**Pattern: Phase-based deletion with explicit ordering**

```typescript
export const deleteExtractionInternal = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    phase: v.union(
      v.literal("evidence_units"),
      v.literal("results"),
      v.literal("reviews"),
      v.literal("papers"),
      v.literal("questions"),
      v.literal("job"),
    ),
  },
  handler: async (ctx, { jobId, phase }) => {
    const BATCH_SIZE = 100;

    switch (phase) {
      case "evidence_units": {
        // Delete evidence units for first paper that has them
        const paper = await ctx.db.query("extractionPapers")
          .withIndex("by_job", q => q.eq("jobId", jobId)).first();
        if (!paper) {
          // No papers left, skip to questions
          await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal,
            { jobId, phase: "questions" });
          return;
        }
        const units = await ctx.db.query("extractionEvidenceUnits")
          .withIndex("by_paper", q => q.eq("paperId", paper._id)).take(BATCH_SIZE);
        await Promise.all(units.map(u => ctx.db.delete(u._id)));
        // Continue same phase if more exist
        if (units.length === BATCH_SIZE) {
          await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal,
            { jobId, phase: "evidence_units" });
        } else {
          // Move to results phase for this paper
          await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal,
            { jobId, phase: "results" });
        }
        return;
      }
      // ... similar for each phase
    }
  },
});
```

**Key principle:** Each scheduler invocation runs as a separate Convex transaction. This avoids hitting transaction limits on large datasets and prevents the O(n^2) re-scanning of the current implementation.

### 4. N+1 Query Resolution

**Pattern: Replace sequential loop with `Promise.all` + `map`**

Current (N+1):
```typescript
for (const paper of papers) {
  const results = await ctx.db.query("extractionResults")
    .withIndex("by_paper", (q: any) => q.eq("paperId", paper._id)).collect();
  // process results
}
```

Fixed:
```typescript
const allResults = await Promise.all(
  papers.map(paper =>
    ctx.db.query("extractionResults")
      .withIndex("by_paper", q => q.eq("paperId", paper._id)).collect()
  )
);
// allResults[i] corresponds to papers[i]
```

In Convex, `Promise.all` with `db.get()` or indexed queries runs all reads in parallel within the same transaction. There is no network round-trip between the function and the database -- they are co-located. The parallelism avoids sequential await chains that create waterfall reads.

For the `loadJobDataForReporting` function specifically, the fix is:
```typescript
// Fetch all papers' results and reviews in parallel
const paperData = await Promise.all(
  papers.map(async (paper) => {
    const [results, reviews] = await Promise.all([
      ctx.db.query("extractionResults").withIndex("by_paper", q => q.eq("paperId", paper._id)).collect(),
      ctx.db.query("extractionResultReviews").withIndex("by_paper", q => q.eq("paperId", paper._id)).collect(),
    ]);
    return { paper, results, reviews };
  })
);
```

### 5. Env Var Validation

**Pattern: Validate-and-throw at function entry, not module load**

Convex environment variables are accessed via `process.env` and cannot be used to conditionally define functions. The correct pattern is to validate at the top of the function handler:

```typescript
function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

// Usage in action handler:
handler: async (ctx, args) => {
  const stripeKey = requireEnvVar("STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-01-28.clover" });
  // ...
}
```

**Important constraint:** Convex re-evaluates environment variables on each function invocation, but the module-level code runs once at deploy time. Stripe is currently initialized at module level with the dummy fallback. Moving initialization inside the handler ensures the key is validated on every call.

For `NEXT_PUBLIC_APP_URL`, validate only in production-path functions (Stripe redirect URLs, OAuth callbacks):
```typescript
const domain = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL;
if (!domain) {
  throw new Error("NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_URL must be set for redirect URLs");
}
```

### 6. Zotero API Key Encryption

**Pattern: Apply existing AES-256-GCM pattern from `apiKeys/actions.ts`**

The codebase already has a proven encryption implementation. The Zotero integration needs the same treatment:

1. Create `convex/zotero/actions.ts` with `"use node"` directive
2. Copy the `encrypt`/`decrypt` functions (or extract to shared `convex/lib/crypto.ts`)
3. Refactor `saveConnection` to be an `internalAction` that encrypts, then calls a mutation to persist
4. Refactor `getConnection` queries to decrypt via an internal action when the key is needed

The existing pattern in `convex/apiKeys/actions.ts` uses AES-256-GCM with random IV, which provides confidentiality, integrity, and authenticity. The same `ENCRYPTION_KEY` env var can be reused.

### 7. Debug/Test Function Isolation

**Pattern: Gate all test functions, remove from public exports**

Step 1 -- Wrap ungated internal test functions:
```typescript
// Before: accessible without any gate
export const runTestSuite = internalMutation({
  handler: async (ctx) => { ... }
});

// After: gated
export const runTestSuite = internalMutation({
  handler: async (ctx) => {
    requirePublicDebugEnabled(); // throws if ENABLE_PUBLIC_DEBUG_FUNCTIONS !== "true"
    // ...
  }
});
```

Step 2 -- Remove test exports from `convex/extraction/index.ts`:
```typescript
// Remove these lines:
// export { testSimpleWorkflow } from "./testWorkflow";
// export { createTestJob } from "./testActions";
```

Step 3 -- Keep test files in the codebase but ensure they are only callable via internal functions with debug gates. Convex internal functions are not callable from clients, but they are callable from other server functions -- the gate ensures they only run when explicitly enabled.

### 8. Orphaned Storage Cleanup

**Pattern: Extend cleanup to cover all terminal paper statuses**

```typescript
// Current: only cleans completed papers
const oldPapers = await ctx.db.query("extractionPapers")
  .withIndex("by_status_completedAt", q => q.eq("status", "completed").lt("completedAt", cutoffTime))
  .collect();

// Extended: also clean failed papers
const failedPapers = await ctx.db.query("extractionPapers")
  .withIndex("by_status", q => q.eq("status", "failed"))
  .filter(q => q.neq(q.field("storageId"), undefined))
  .take(100); // Bounded batch

const downloadFailedPapers = await ctx.db.query("extractionPapers")
  .withIndex("by_status", q => q.eq("status", "download_failed"))
  .filter(q => q.neq(q.field("storageId"), undefined))
  .take(100);
```

Additionally, invoke storage cleanup within the deletion cascade so that deleted jobs' PDFs are removed before the paper records are deleted.

---

## Sources

- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) -- HIGH confidence (official docs)
- [Convex MutationCtx API](https://docs.convex.dev/api/interfaces/server.GenericMutationCtx) -- HIGH confidence (official docs)
- [Convex Rate Limiter Component](https://github.com/get-convex/rate-limiter) -- HIGH confidence (official Convex component)
- [@convex-dev/rate-limiter NPM](https://www.npmjs.com/package/@convex-dev/rate-limiter) -- HIGH confidence (official package)
- [Convex Queries That Scale](https://stack.convex.dev/queries-that-scale) -- HIGH confidence (official Convex blog)
- [Convex Functional Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) -- HIGH confidence (official Convex blog)
- [Convex Operational Maturity](https://stack.convex.dev/operational-maturity-for-production) -- HIGH confidence (official Convex blog)
- [Convex Environment Variables](https://docs.convex.dev/production/environment-variables) -- HIGH confidence (official docs)
- [Convex Paginated Queries](https://docs.convex.dev/database/pagination) -- HIGH confidence (official docs)
- [End-to-End Encryption with Convex](https://stack.convex.dev/end-to-end-encryption-with-convex) -- HIGH confidence (official Convex blog)
- [Convex Testing Patterns](https://stack.convex.dev/testing-patterns) -- HIGH confidence (official Convex blog)
- Existing codebase: `convex/apiKeys/actions.ts` (encryption pattern), `convex/extraction/mutations.ts` (deletion cascade, N+1 queries), `convex/lib/rateLimit.ts` (config-only rate limits)

---
*Feature research for: Codebase Hardening v2.3*
*Researched: 2026-03-02*
