# Phase 46: Cron Additions - Research

**Researched:** 2026-03-03
**Domain:** Convex cron jobs, scheduled cleanup of expired OAuth tokens
**Confidence:** HIGH

## Summary

Phase 46 is the simplest phase in v2.4: a single cron job that deletes expired `zoteroOAuthTokens` documents. The tokens are temporary OAuth 1.0a request tokens stored during the Zotero OAuth flow, each with a 10-minute TTL (`expiresAt: Date.now() + 10 * 60 * 1000`). The existing code already checks expiration on retrieval (`getRequestToken` deletes expired tokens it finds), but tokens from abandoned OAuth flows (user starts connect, never completes callback) accumulate indefinitely.

The implementation requires exactly two changes: (1) a new `internalMutation` in the zotero or maintenance module that queries all `zoteroOAuthTokens` and deletes those where `expiresAt < Date.now()`, and (2) a new entry in `convex/crons.ts` that calls this mutation on a regular interval. The project already has four cron jobs using `crons.interval()` with the `internal` API reference pattern. No new libraries, no schema changes, no new indexes required.

**Primary recommendation:** Create a single `cleanupExpiredOAuthTokens` internal mutation and register it in `convex/crons.ts` with an hourly interval. The mutation should query all tokens (the table will typically have 0-5 rows), filter expired ones in JS, and delete them with per-document try-catch for concurrency safety.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRON-01 | Add cron job to delete expired `zoteroOAuthTokens` where `expiresAt < Date.now()` | Existing cron pattern in `convex/crons.ts` using `crons.interval()` + `internal` references. Table schema confirmed with `expiresAt: v.number()` field. No index on `expiresAt` needed since table is always tiny (0-5 rows during active OAuth flows). Existing cleanup patterns in `convex/maintenance/mutations.ts` provide template. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | (existing) | Database, mutations, cron scheduling | Core platform -- cron registration via `cronJobs()`, mutation via `internalMutation` |

### Supporting
None -- no additional libraries needed.

### Alternatives Considered
None -- all functionality is built into the Convex platform.

**Installation:**
No installation needed -- all dependencies already present.

## Architecture Patterns

### Recommended Project Structure
No new files or directories needed. Changes touch exactly two files:

```
convex/
  crons.ts               # Add new cron.interval() entry
  zotero/mutations.ts    # Add cleanupExpiredOAuthTokens internal mutation
  OR
  maintenance/mutations.ts  # Alternative location for the cleanup mutation
```

### Pattern 1: Internal Mutation Registered as Cron
**What:** An `internalMutation` that performs cleanup logic, registered in `convex/crons.ts` with `crons.interval()`.
**When to use:** Any scheduled background cleanup task.
**Example:**

```typescript
// Source: convex/crons.ts (existing pattern)
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup expired zotero oauth tokens",
  { hours: 1 },
  internal.zotero.mutations.cleanupExpiredOAuthTokens
);

export default crons;
```

### Pattern 2: Query-All-Then-Filter Cleanup Mutation
**What:** For tiny tables (< 100 rows typically), query all documents and filter in JS rather than requiring a specialized index.
**When to use:** When the table is inherently small (temporary/ephemeral data).
**Example:**

```typescript
// Source: convex/zotero/mutations.ts (new function)
export const cleanupExpiredOAuthTokens = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const allTokens = await ctx.db.query("zoteroOAuthTokens").collect();

    let deletedCount = 0;
    for (const token of allTokens) {
      if (token.expiresAt < now) {
        await ctx.db.delete(token._id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[cleanupExpiredOAuthTokens] Deleted ${deletedCount} expired token(s)`);
    }

    return null;
  },
});
```

### Pattern 3: Defensive Delete with Concurrency Safety
**What:** Wrap individual deletes in try-catch to handle the case where another process (the `getRequestToken` flow or a concurrent cron) has already deleted the token.
**When to use:** When multiple code paths can delete the same document.
**Example:**

```typescript
for (const token of expiredTokens) {
  try {
    await ctx.db.delete(token._id);
    deletedCount++;
  } catch {
    // Token may have been deleted by getRequestToken or concurrent cron
    // This is safe to ignore
  }
}
```

**Important note on Convex OCC:** In practice, Convex mutations use optimistic concurrency control. If two mutations try to delete the same document, one will succeed and the other will be retried. On retry, `ctx.db.delete()` on a non-existent document throws an error. The try-catch pattern handles this gracefully. However, because Convex crons guarantee at most one instance runs at a time (per the Convex docs), the primary concurrency concern is between the cron and the `getRequestToken` flow, not between two cron runs.

### Anti-Patterns to Avoid
- **Adding an index on `expiresAt` for a tiny table:** The `zoteroOAuthTokens` table will rarely have more than a handful of rows. Adding a `by_expiresAt` index adds schema complexity with zero performance benefit. `.collect()` on a small table is perfectly efficient.
- **Running the cron every minute:** OAuth tokens expire after 10 minutes. Hourly cleanup is more than sufficient. A 1-minute interval wastes function invocations.
- **Querying by `expiresAt` range without an index:** If the table were large, you would need an index. But since it is small, `.collect()` + JS filter is correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scheduled recurring task | Custom scheduler with `ctx.scheduler.runAfter` loop | `crons.interval()` in `convex/crons.ts` | Convex-managed, survives deploys, guaranteed at-most-once execution |
| Token expiry check | Complex index-based range query | `.collect()` + JS filter on `expiresAt` | Table is tiny (0-5 rows typically), full scan is negligible cost |

**Key insight:** This is a trivial cleanup task. The entire implementation is ~20 lines of code across two files. Do not over-engineer it.

## Common Pitfalls

### Pitfall 1: Concurrent Deletion Race with getRequestToken
**What goes wrong:** The cron reads a token, decides it is expired, and calls `ctx.db.delete()`. But between the read and the delete, `getRequestToken` already deleted the same token (it also checks expiration and deletes expired tokens). The cron's delete call fails because the document no longer exists.
**Why it happens:** Two code paths (cron cleanup and OAuth callback) both delete expired tokens.
**How to avoid:** Wrap individual deletes in try-catch. Alternatively, since Convex OCC retries the entire mutation on conflict, the retried run simply will not find the already-deleted token -- so `.collect()` returns fewer items and the mutation succeeds. The try-catch is belt-and-suspenders safety.
**Warning signs:** Convex function errors like "Could not find document" in the cron job logs.

### Pitfall 2: Forgetting to Use `internal` Reference
**What goes wrong:** Using `api.zotero.mutations.cleanupExpiredOAuthTokens` instead of `internal.zotero.mutations.cleanupExpiredOAuthTokens` in the cron registration. Since the mutation is an `internalMutation`, it cannot be referenced via the `api` object -- only via `internal`.
**Why it happens:** Copy-paste from examples that use `api`.
**How to avoid:** The mutation is declared with `internalMutation`, so the `internal` import is required. TypeScript will catch this at compile time.
**Warning signs:** TypeScript type error on the cron registration line.

### Pitfall 3: Mutation Placement in Wrong Module
**What goes wrong:** Placing the cleanup mutation in a module that uses `"use node"` (Node.js runtime), making it an action instead of a mutation. Crons can call both mutations and actions, but a mutation is simpler and uses OCC. The `maintenance/internal.ts` file has `"use node"` at the top (it is an action file), so adding a mutation there would silently make it run as an action.
**Why it happens:** Developer sees "maintenance" and puts cleanup code in the first maintenance file they find.
**How to avoid:** Place the mutation in either `convex/zotero/mutations.ts` (co-located with other zotero mutations) or `convex/maintenance/mutations.ts` (co-located with other cleanup mutations). Both files define `internalMutation` without `"use node"`.
**Warning signs:** Function registered as action instead of mutation in Convex dashboard.

## Code Examples

Verified patterns from the codebase:

### Existing Cron Registration Pattern
```typescript
// Source: convex/crons.ts (lines 7-11)
crons.interval(
  "cleanup deleted users",
  { hours: 24 },
  internal.maintenance.mutations.cleanupDeletedUsers
);
```

### Existing Token Expiry Check Pattern
```typescript
// Source: convex/zotero/mutations.ts (lines 53-62)
const stored = await ctx.db
  .query("zoteroOAuthTokens")
  .withIndex("by_token", (q) => q.eq("token", token))
  .first();

if (!stored) return null;
if (stored.expiresAt < Date.now()) {
  await ctx.db.delete(stored._id);
  return null;
}
```

### Existing Cleanup Mutation Signature Pattern
```typescript
// Source: convex/maintenance/mutations.ts (lines 11-13)
export const cleanupDeletedUsers = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // ...
  },
});
```

### Token Creation with TTL
```typescript
// Source: convex/zotero/mutations.ts (lines 27-33)
await ctx.db.insert("zoteroOAuthTokens", {
  token,
  tokenSecret,
  userId,
  expiresAt: Date.now() + 10 * 60 * 1000, // 10-minute TTL
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Expired tokens cleaned only on retrieval (lazy deletion) | Scheduled cron cleans expired tokens proactively | Phase 46 | Prevents unbounded accumulation of abandoned OAuth tokens |

**Deprecated/outdated:**
- None -- the Convex `cronJobs()` API has been stable since its introduction.

## Open Questions

None. This phase is straightforward:
- The table schema is known and stable.
- The cron API is well-documented and already used in the project.
- The cleanup logic mirrors existing patterns exactly.
- The concurrency concern (Pitfall 8 from PITFALLS research) is addressed by try-catch + Convex OCC.

## Design Decisions for Planner

### Mutation Location
**Recommendation:** Place in `convex/zotero/mutations.ts` alongside `storeRequestToken` and `getRequestToken`. This co-locates all token lifecycle operations (create, read, cleanup) in one module. The alternative (`convex/maintenance/mutations.ts`) is also valid but separates the cleanup from the data it operates on.

### Cron Interval
**Recommendation:** Hourly (`{ hours: 1 }`). Tokens expire after 10 minutes. Hourly cleanup means at worst a token lingers for ~70 minutes past expiry. This is consistent with the other hourly crons in the project (subscription check, Stripe monitoring, invoice reconciliation).

### Concurrency Handling
**Recommendation:** Use try-catch around individual deletes per the roadmap's success criteria: "handles already-deleted tokens gracefully (try-catch per individual delete) and does not crash if another process deletes a token concurrently." The Convex OCC retry would also handle this, but explicit try-catch makes the intent clear and satisfies the stated requirement.

### Logging
**Recommendation:** Log deletion count only when > 0, matching the pattern in `cleanupDeletedUsers` ("Cleaned up N deleted users"). Silent when no tokens found (the common case).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `convex/crons.ts` -- 4 existing cron registrations using `crons.interval()` + `internal` references
- Codebase inspection: `convex/schema.ts` lines 184-191 -- `zoteroOAuthTokens` table with `expiresAt: v.number()`, indexes `by_token` and `by_user` (no `expiresAt` index)
- Codebase inspection: `convex/zotero/mutations.ts` -- `storeRequestToken` (10-min TTL), `getRequestToken` (lazy expiry check + delete)
- Codebase inspection: `convex/maintenance/mutations.ts` -- `cleanupDeletedUsers` pattern (internalMutation, batch query, conditional delete, count logging)
- Convex `cron.ts` type definitions (node_modules/convex/src/server/cron.ts) -- `cronJobs()`, `interval()`, `hourly()`, `daily()` API confirmed
- `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md` Pitfall 8 -- concurrent cron + manual deletion safety analysis

### Secondary (MEDIUM confidence)
- Convex Cron Jobs Documentation (https://docs.convex.dev/scheduling/cron-jobs) -- at most one cron instance runs at a time, skips if previous is still executing (referenced in PITFALLS research)

### Tertiary (LOW confidence)
- None -- all findings verified against installed package type definitions and codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Convex cron API already used in project, no new libraries
- Architecture: HIGH -- exact pattern replicated from 4 existing cron registrations
- Pitfalls: HIGH -- concurrency concern already analyzed in PITFALLS research, simple mitigation

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain -- Convex cron API is mature and unchanged)
