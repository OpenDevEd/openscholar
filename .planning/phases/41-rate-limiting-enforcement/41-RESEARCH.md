# Phase 41: Rate Limiting Enforcement - Research

**Researched:** 2026-03-02
**Domain:** Convex server-side rate limiting with `convex-helpers/server/rateLimit`
**Confidence:** HIGH

## Summary

Phase 41 adds rate limiting enforcement to exposed endpoints using the `convex-helpers` token-bucket rate limiter. Phase 37 already added `...rateLimitTables` to the schema, and the `convex-helpers` package (v0.1.112) is already installed. The existing `convex/lib/rateLimit.ts` file is a stub with config-only constants and no enforcement -- it needs to be replaced with `defineRateLimits` from `convex-helpers/server/rateLimit`.

There are two categories of endpoints to rate-limit: **mutations** (extraction job creation) and **actions** (API key save, checkout sessions). The `rateLimit()` function requires `{ db: GenericDatabaseWriter }`, which means it works directly in mutation handlers via `ctx`. For actions (which lack `ctx.db`), rate limiting must be delegated to an internal mutation called via `ctx.runMutation`. This is the standard Convex pattern: create a small `consumeRateLimit` internal mutation, then call it from actions before proceeding.

The `defineRateLimits` API provides centralized configuration with type-safe name auto-completion. Using `throws: true` causes a `ConvexError` with `{ kind: "RateLimited", name, retryAt }` data, giving clients clear error information. The `key` parameter supports per-user rate limiting using user IDs.

**Primary recommendation:** Replace the stub `convex/lib/rateLimit.ts` with `defineRateLimits` configuration, add a `consumeRateLimit` internal mutation for action endpoints, and add `rateLimit()` calls at the top of each target endpoint handler.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RATE-02 | Rate limits enforced on extraction job creation | `startExtraction`, `duplicateExtraction`, `startExtractionFromTemplate` are public mutations -- call `rateLimit(ctx, { name: "start-extraction", key: user._id, throws: true })` directly after `requireAuth`. All three are in `convex/extraction/mutations.ts`. |
| RATE-03 | Rate limits enforced on other exposed endpoints (API key saves, checkout sessions) | `encryptAndSave` (action in `convex/apiKeys/actions.ts`), `createCheckoutSession` (action in `convex/subscriptions/actions.ts`), `createTopupCheckoutSession` (action in `convex/credits/actions.ts`). Actions lack `ctx.db`, so rate limiting must go through an internal mutation called via `ctx.runMutation`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex-helpers | 0.1.112 | `defineRateLimits`, `rateLimit`, `rateLimitTables` from `server/rateLimit` | Already installed; provides token-bucket and fixed-window rate limiting backed by the `rateLimits` table added in Phase 37 |
| convex | 1.32.0 | `mutation`, `internalMutation`, `action`, `ConvexError` | Already installed; the runtime in which rate limits are checked |

### Supporting
None needed. This phase uses only existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `convex-helpers/server/rateLimit` (helper) | `@convex-dev/rate-limiter` (component) | Component is the newer recommended approach but requires `convex.config.ts` changes + component installation. `convex-helpers` is already installed and the project has committed to it (milestone decision). |
| `throws: true` (ConvexError) | Manual `{ ok, retryAt }` check + custom error | `throws: true` is simpler -- one line instead of if/else. The thrown `ConvexError` has structured data (`{ kind: "RateLimited", name, retryAt }`) that clients can parse. |
| Internal mutation for action rate limiting | Custom in-memory tracking | In-memory tracking doesn't survive restarts and doesn't work across Convex function isolates. The database-backed approach is the only correct one for Convex. |

**Installation:**
```bash
# No new packages needed. Zero npm install.
```

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── lib/
│   └── rateLimit.ts           # defineRateLimits config + consumeRateLimit internal mutation
├── extraction/
│   └── mutations.ts           # startExtraction, duplicateExtraction, startExtractionFromTemplate -- rateLimit(ctx, ...) calls
├── apiKeys/
│   └── actions.ts             # encryptAndSave -- ctx.runMutation(internal.lib.rateLimit.consume, ...)
├── subscriptions/
│   └── actions.ts             # createCheckoutSession -- ctx.runMutation(internal.lib.rateLimit.consume, ...)
└── credits/
    └── actions.ts             # createTopupCheckoutSession -- ctx.runMutation(internal.lib.rateLimit.consume, ...)
```

### Pattern 1: defineRateLimits Configuration Module
**What:** Centralized rate limit definitions with type-safe names.
**When to use:** Always -- this is the recommended pattern from `convex-helpers`.
**Example:**
```typescript
// convex/lib/rateLimit.ts
import { defineRateLimits } from "convex-helpers/server/rateLimit";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  // Extraction job creation: 5 per hour, burst of 3
  "start-extraction": {
    kind: "token bucket",
    rate: 5,
    period: HOUR,
    capacity: 3,
  },
  // API key saves: 5 per minute
  "api-key-save": {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },
  // Checkout session creation: 3 per minute
  "checkout-session": {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },
});
```
**Source:** Verified against `convex-helpers@0.1.112/server/rateLimit.ts` lines 10-24 (usage example in module comment).

### Pattern 2: Direct rateLimit in Mutations
**What:** Call `rateLimit(ctx, ...)` directly in mutation handlers where `ctx.db` is available.
**When to use:** For public mutation endpoints (`startExtraction`, `duplicateExtraction`, `startExtractionFromTemplate`).
**Example:**
```typescript
// In a mutation handler (convex/extraction/mutations.ts)
import { rateLimit } from "../lib/rateLimit";

export const startExtraction = mutation({
  // ... args ...
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Data extraction");

    // Rate limit AFTER auth (don't count unauthenticated requests)
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id, // per-user
      throws: true,   // throws ConvexError if exceeded
    });

    // ... rest of handler
  },
});
```
**Source:** `convex-helpers@0.1.112/server/rateLimit.ts` lines 93-99 (per-user rate limit example).

### Pattern 3: Internal Mutation for Action Rate Limiting
**What:** Actions (which run in Node.js and lack `ctx.db`) delegate rate limit checks to an internal mutation via `ctx.runMutation`.
**When to use:** For public action endpoints (`encryptAndSave`, `createCheckoutSession`, `createTopupCheckoutSession`).
**Example:**
```typescript
// convex/lib/rateLimit.ts (add internal mutation)
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const consume = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
    count: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: args.name,
      key: args.key,
      count: args.count,
      throws: true,
    });
    return null;
  },
});
```

```typescript
// In an action handler (convex/apiKeys/actions.ts)
export const encryptAndSave = action({
  handler: async (ctx, args) => {
    // Get identity first (for rate limit key)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

    // Rate limit via internal mutation
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "api-key-save",
      key: identity.subject, // Clerk user ID as key
    });

    // ... rest of handler (encryption, save)
  },
});
```
**Source:** This is the standard Convex pattern for actions needing database writes. Actions use `ctx.runMutation` to delegate DB operations.

### Pattern 4: isRateLimitError for Client-Side Handling
**What:** The `isRateLimitError` helper from `convex-helpers` lets clients detect rate limit errors.
**When to use:** Optional -- for client-side toast/retry logic.
**Example:**
```typescript
// Client-side React code
import { isRateLimitError } from "convex-helpers/server/rateLimit";

try {
  await startExtraction(args);
} catch (error) {
  if (isRateLimitError(error)) {
    const retryAt = error.data.retryAt;
    toast.error(`Rate limited. Try again in ${Math.ceil((retryAt - Date.now()) / 1000)}s`);
  }
}
```
**Source:** `convex-helpers@0.1.112/server/rateLimit.ts` lines 180-184 (`isRateLimitError` function).

### Anti-Patterns to Avoid
- **Rate limiting before auth check:** Always call `requireAuth` / `requireActionAuth` first. Unauthenticated requests should fail at auth, not consume rate limit tokens. Rate limiting goes AFTER auth.
- **Rate limiting in actions without `ctx.runMutation`:** Actions don't have `ctx.db`. Trying to call `rateLimit(ctx, ...)` directly in an action will cause a TypeScript error or runtime crash. Always delegate to an internal mutation.
- **Using global rate limits instead of per-user:** Without `key: user._id`, all users share one token bucket. One active user could exhaust the limit for everyone. Always use per-user keys for user-facing endpoints.
- **Adding rate limiting to internal mutations:** Internal mutations are called by the system (workflows, schedulers), not by users. Rate limiting them would break internal pipelines. Only rate-limit public endpoints.
- **Hand-rolling a ConvexError for rate limiting:** The `throws: true` option on `rateLimit()` already throws a properly structured `ConvexError` with `{ kind: "RateLimited", name, retryAt }`. Don't create a custom error.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token bucket algorithm | Custom counter + timestamp logic | `rateLimit()` from `defineRateLimits` | The convex-helpers implementation handles edge cases: token accumulation, capacity limits, atomic read-write, ConvexError with retryAt |
| Rate limit table schema | Custom `defineTable` | `rateLimitTables` spread (already done in Phase 37) | Table schema must match what `rateLimit()` expects internally (name + key index) |
| Rate limit error type | Custom error code in `createError` | `throws: true` on `rateLimit()` | Produces standard `ConvexError<RateLimitError>` with `{ kind: "RateLimited", name, retryAt }` that `isRateLimitError()` can detect |
| In-action rate limit check | Inline db.query in action | `consume` internal mutation via `ctx.runMutation` | Actions lack `ctx.db`; the internal mutation pattern is the Convex-standard approach for DB writes from actions |

**Key insight:** The `convex-helpers` rate limiter stores one row per (name, key) pair in the `rateLimits` table. It atomically reads the current token count, applies the token-bucket math, and writes back. This is naturally serialized by Convex's OCC (optimistic concurrency control). A hand-rolled version would need to replicate this exact behavior.

## Common Pitfalls

### Pitfall 1: TypeScript Error When Passing ctx to rateLimit
**What goes wrong:** TypeScript may complain that `MutationCtx` (which has `GenericDatabaseWriter<DataModel>`) is not assignable to `{ db: GenericDatabaseWriter<RateLimitDataModel> }`.
**Why it happens:** TypeScript's structural typing for generic types can be strict about `DataModel` vs `RateLimitDataModel`. Since `DataModel` includes the `rateLimits` table (from Phase 37), it IS compatible, but TS may not infer this.
**How to avoid:** Pass `ctx` directly -- in practice, the convex-helpers source internally casts via `as unknown as GenericDatabaseReader<RateLimitDataModel>` (line 455 of rateLimit.ts), so the external type constraint is lenient enough. If TypeScript does complain, a minimal cast like `ctx as any` or `{ db: ctx.db as any }` resolves it. This was flagged as an open question in Phase 37 research.
**Warning signs:** TypeScript error: "Type 'GenericDatabaseWriter<DataModel>' is not assignable to type 'GenericDatabaseWriter<RateLimitDataModel>'".

### Pitfall 2: Rate Limiting Before Authentication
**What goes wrong:** Placing `rateLimit()` before `requireAuth()` means unauthenticated requests consume rate limit tokens. An attacker could exhaust the global rate limit with unauthenticated requests, blocking legitimate users.
**Why it happens:** Natural instinct to put guards at the top of the handler.
**How to avoid:** Always follow this order: (1) feature flag check, (2) auth check, (3) rate limit check, (4) business logic. Rate limit uses `user._id` as key, which requires auth first.
**Warning signs:** Rate limit errors when no authenticated user is hitting the endpoint.

### Pitfall 3: Forgetting to Rate Limit duplicateExtraction and startExtractionFromTemplate
**What goes wrong:** Only `startExtraction` gets rate limited, but `duplicateExtraction` and `startExtractionFromTemplate` also create extraction jobs and start workflows.
**Why it happens:** The requirement says "extraction job creation endpoint" (singular), but there are three mutations that create jobs.
**How to avoid:** All three mutations should use the same `"start-extraction"` rate limit name with the user's ID as key. They all have the same cost profile (creating a job + starting a workflow).
**Warning signs:** Users bypass rate limiting by duplicating or using templates instead of creating new jobs.

### Pitfall 4: Action Rate Limit Key Mismatch
**What goes wrong:** Using `identity.subject` (Clerk ID) as the rate limit key in actions but `user._id` (Convex document ID) in mutations. Same user gets two separate rate limit buckets.
**Why it happens:** Actions get identity from `ctx.auth.getUserIdentity()` which returns `subject` (Clerk ID), while mutations use `requireAuth()` which returns the Convex `Doc<"users">`.
**How to avoid:** For consistency, all rate limit keys should use the same identifier. The `consume` internal mutation should accept a `key` string parameter. For actions, pass `identity.subject` (Clerk ID). For mutations, pass `user._id` (Convex ID). Since these are different rate limit names (e.g., `"api-key-save"` vs `"start-extraction"`), the key format doesn't need to match across different limit names. Within the same limit name, always use the same format.
**Warning signs:** Rate limit not triggering when expected, because tokens are split between two keys.

### Pitfall 5: Forgetting createTopupCheckoutSession
**What goes wrong:** Rate limiting `createCheckoutSession` (subscription) but not `createTopupCheckoutSession` (credit top-up). Both create Stripe checkout sessions.
**Why it happens:** The requirement mentions "checkout session creation" -- easy to read as only subscription checkout.
**How to avoid:** Both checkout session actions should use the same `"checkout-session"` rate limit name. They have the same abuse profile (creating Stripe sessions).
**Warning signs:** Users spam credit top-up purchases while subscription checkout is rate-limited.

## Code Examples

Verified patterns from official sources:

### Complete rateLimit.ts Replacement
```typescript
// convex/lib/rateLimit.ts
// Source: convex-helpers@0.1.112/server/rateLimit.ts (defineRateLimits pattern)
import { defineRateLimits } from "convex-helpers/server/rateLimit";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  "start-extraction": {
    kind: "token bucket",
    rate: 5,
    period: HOUR,
    capacity: 3,
  },
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
});

/**
 * Internal mutation for consuming rate limits from actions.
 * Actions lack ctx.db, so they delegate rate limit checks here.
 */
export const consume = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
    count: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: args.name,
      key: args.key,
      count: args.count,
      throws: true,
    });
    return null;
  },
});
```

### Extraction Mutation Rate Limiting (RATE-02)
```typescript
// In convex/extraction/mutations.ts -- startExtraction handler
// After requireAuth, before business logic:
import { rateLimit } from "../lib/rateLimit";

// Inside handler:
const user = await requireAuth(ctx);
await requireProPlan(ctx, user._id, "Data extraction");

await rateLimit(ctx, {
  name: "start-extraction",
  key: user._id,
  throws: true,
});
// ... create job, start workflow
```

### Action Rate Limiting via Internal Mutation (RATE-03)
```typescript
// In convex/apiKeys/actions.ts -- encryptAndSave handler
// At the top of handler, after getting identity:
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

await ctx.runMutation(internal.lib.rateLimit.consume, {
  name: "api-key-save",
  key: identity.subject,
});
// ... validate, encrypt, save
```

### ConvexError Thrown by rateLimit (throws: true)
```typescript
// Source: convex-helpers@0.1.112/server/rateLimit.ts lines 416-421
// When throws: true and rate limit exceeded:
throw new ConvexError({
  kind: "RateLimited",
  name: "start-extraction",
  retryAt: 1709400000000, // ms timestamp when retry could succeed
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Config-only stub in `convex/lib/rateLimit.ts` | `defineRateLimits` from `convex-helpers/server/rateLimit` backed by `rateLimits` table | convex-helpers 0.1.x (table-based) | Actual enforcement instead of informational-only config |
| `convex-helpers` rate limiting (table helper) | `@convex-dev/rate-limiter` (component) | Recommended for new projects | Component approach is newer but project decided on `convex-helpers` (milestone decision) |

**Deprecated/outdated:**
- The existing `convex/lib/rateLimit.ts` stub with `RATE_LIMITS` record and `getRateLimitConfig()` function provides zero enforcement. It should be completely replaced.

## Open Questions

1. **TypeScript compatibility of `ctx` with `rateLimit()`**
   - What we know: `MutationCtx` has `db: GenericDatabaseWriter<DataModel>`. The `rateLimit()` function from `defineRateLimits` expects `{ db: GenericDatabaseWriter<RateLimitDataModel> }`. Since `DataModel` includes the `rateLimits` table, it should be structurally compatible.
   - What's unclear: Whether TypeScript resolves this compatibility automatically or requires a cast. The convex-helpers source internally does `as unknown as GenericDatabaseReader<RateLimitDataModel>` (line 455), suggesting the external constraint is loose enough.
   - Recommendation: Try passing `ctx` directly. If TypeScript complains, use `ctx as any` -- this is safe because the internal cast handles the actual type narrowing. Test during implementation.

2. **Rate limit parameters tuning**
   - What we know: The stub file had `maxRequests: 5/min` for API key saves, `maxRequests: 3/min` for checkout sessions, `maxRequests: 10/min` for ensure-user. These are reasonable starting points.
   - What's unclear: Optimal extraction job creation limits. 5/hour with burst of 3 is conservative. Real-world usage patterns may require adjustment.
   - Recommendation: Start with the proposed values. They can be tuned later by editing the `defineRateLimits` configuration -- no schema changes needed.

## Endpoints to Rate Limit (Complete Inventory)

### Extraction Job Creation (RATE-02) -- Mutations
| Function | File | Type | Current Auth | Rate Limit Key |
|----------|------|------|-------------|----------------|
| `startExtraction` | `convex/extraction/mutations.ts:100` | `mutation` | `requireAuth` + `requireProPlan` | `user._id` |
| `duplicateExtraction` | `convex/extraction/mutations.ts:252` | `mutation` | `requireAuth` + `requireProPlan` | `user._id` |
| `startExtractionFromTemplate` | `convex/extraction/mutations.ts:409` | `mutation` | `requireAuth` + `requireProPlan` | `user._id` |

### Other Exposed Endpoints (RATE-03) -- Actions
| Function | File | Type | Current Auth | Rate Limit Key |
|----------|------|------|-------------|----------------|
| `encryptAndSave` | `convex/apiKeys/actions.ts:33` | `action` | Auth in internal mutation `save` | `identity.subject` |
| `createCheckoutSession` | `convex/subscriptions/actions.ts:207` | `action` | `requireActionAuth` | `identity.subject` |
| `createTopupCheckoutSession` | `convex/credits/actions.ts:41` | `action` | `requireActionAuth` | `identity.subject` |

## Sources

### Primary (HIGH confidence)
- `node_modules/convex-helpers/server/rateLimit.ts` -- Full source code of `defineRateLimits`, `rateLimit`, `checkRateLimit`, `resetRateLimit`, `isRateLimitError`, `rateLimitTables`. Verified token-bucket algorithm, `throws: true` behavior, `ConvexError` structure, and `getExisting` internal cast.
- `node_modules/convex-helpers/server/rateLimit.d.ts` -- Type declarations confirming `rateLimit` requires `{ db: GenericDatabaseWriter<RateLimitDataModel> }`, `defineRateLimits` returns typed `{ checkRateLimit, rateLimit, resetRateLimit }`.
- `convex/schema.ts` -- Verified `...rateLimitTables` already spread at top of schema (Phase 37 complete).
- `convex/extraction/mutations.ts` -- Verified `startExtraction` (line 100), `duplicateExtraction` (line 252), `startExtractionFromTemplate` (line 409) are public mutations with `requireAuth` + `requireProPlan`.
- `convex/apiKeys/actions.ts` -- Verified `encryptAndSave` (line 33) is a public action, auth delegated to internal mutation.
- `convex/subscriptions/actions.ts` -- Verified `createCheckoutSession` (line 207) is a public action with `requireActionAuth`.
- `convex/credits/actions.ts` -- Verified `createTopupCheckoutSession` (line 41) is a public action with `requireActionAuth`.
- `convex/lib/rateLimit.ts` -- Verified current stub has zero enforcement (config-only, `getRateLimitConfig` returns config object).
- `convex/lib/errors.ts` -- Verified `createError` pattern and `ErrorCode` union type (includes `"BILLING_RATE_LIMITED"` already).
- `.planning/phases/37-schema-additions/37-RESEARCH.md` -- Phase 37 research confirming `rateLimitTables` schema addition and open question about type compatibility.

### Secondary (MEDIUM confidence)
- `.planning/research/STACK_v2.3_HARDENING.md` -- Milestone-level decision to use `convex-helpers` over `@convex-dev/rate-limiter`, rate limit patterns and parameter recommendations.
- [Rate Limiting at the Application Layer (stack.convex.dev)](https://stack.convex.dev/rate-limiting) -- Official Convex stack post on rate limiting patterns.
- [convex-helpers rateLimit source on GitHub](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/server/rateLimit.ts) -- Canonical source confirming usage patterns.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `convex-helpers@0.1.112` already installed, `rateLimitTables` already in schema, API verified against source code
- Architecture: HIGH -- mutation vs action distinction clear, internal mutation pattern for actions is standard Convex, all target endpoints identified with line numbers
- Pitfalls: HIGH -- Type compatibility concern verified in source (internal cast handles it), auth ordering researched, all three extraction mutations identified

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- `convex-helpers` rate limiting API is mature and unlikely to change)
