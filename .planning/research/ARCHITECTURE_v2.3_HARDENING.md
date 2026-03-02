# Architecture Research: v2.3 Codebase Hardening

**Domain:** Codebase hardening for existing Next.js + Convex academic search platform
**Researched:** 2026-03-02
**Confidence:** HIGH

## System Overview — Current Architecture

```
+-------------------------------------------------------------------+
|                    Next.js Frontend (App Router)                   |
|  +-------------+  +----------------+  +------------------------+  |
|  | Search Page |  | Library Page   |  | Settings/Billing Page  |  |
|  | (SidebarL.) |  | (SidebarL.)    |  | (debug console.log)   |  |
|  +------+------+  +-------+--------+  +-----------+------------+  |
|         |                 |                        |              |
|  +------+------+  +------+--------+  +------------+-----------+  |
|  | Zustand     |  | nuqs URL      |  | Zustand AIConfigStore  |  |
|  | SidebarStore|  | state         |  | (localStorage persist) |  |
|  +------+------+  +------+--------+  +------------+-----------+  |
|         |                 |                        |              |
|  +------+-----------------+------------------------+-----------+  |
|  |              Server Actions (app/actions/)                  |  |
|  |              (debug console.logs in openalex.ts)            |  |
|  +-----+------------------------------------------------------+  |
+---------|---------------------------------------------------------+
          |
+---------v---------------------------------------------------------+
|                    Convex Backend                                  |
|  +-----------+  +------------+  +----------+  +----------------+  |
|  | http.ts   |  | crons.ts   |  | workflow |  | workpool       |  |
|  | (webhooks)|  | (scheduled)|  | (durable)|  | (PDF pipeline) |  |
|  +-----+-----+  +-----+------+  +----+-----+  +-------+------+  |
|        |               |              |                 |         |
|  +-----v-----+  +------v------+  +---v---------+  +---v------+  |
|  | subscrip. |  | maintenance |  | extraction/ |  | apiKeys/ |  |
|  | /actions  |  | /internal   |  | mutations   |  | actions  |  |
|  | (any cast)|  | (any cast)  |  | (any types) |  | (AES)    |  |
|  +-----------+  +-------------+  +-------------+  +----------+  |
|                                                                   |
|  +-------------------+  +-----------+  +------------------------+ |
|  | credits/actions   |  | zotero/   |  | lib/rateLimit.ts       | |
|  | (any cast, dummy) |  | actions   |  | (config only, no       | |
|  +-------------------+  | mutations |  |  enforcement)          | |
|                         | (plain    |  +------------------------+ |
|                         |  apiKey)  |                             |
|                         +-----------+                             |
|                                                                   |
|  +-----------------------------------------------------------+   |
|  | Schema: 20 tables, 50+ indexes, 1 search index            |   |
|  | extractionPapers | extractionResults | extractionEvidence  |   |
|  | Units | extractionResultReviews | extractionQuestions       |   |
|  +-----------------------------------------------------------+   |
+---------|---------------------------------------------------------+
          |
+---------v---------------------------------------------------------+
|  External Services                                                |
|  +--------+  +--------+  +----------+  +----------+  +--------+  |
|  | Stripe |  | Clerk  |  | OpenAlex |  | Zotero   |  | AI     |  |
|  | API    |  | Auth   |  | API      |  | OAuth1.0 |  | Models |  |
|  +--------+  +--------+  +----------+  +----------+  +--------+  |
+-------------------------------------------------------------------+
```

## Hardening Integration Map

Each concern from CONCERNS.md maps to specific integration points. This section catalogs every touch point, categorized by the type of change required.

### Component Classification

| Component | Change Type | Files Modified | New Files | Risk |
|-----------|-------------|---------------|-----------|------|
| Type safety sweep (ctx: any) | Modify existing | 3 extraction files | 0 | Low |
| Type safety (`internal as any`) | Modify existing | 7 billing files | 0 | Medium |
| `patchData: any` typing | Modify existing | 1 file | 0 | Low |
| Debug log removal | Modify existing | 2 files | 0 | Low |
| `@ts-ignore` / debug_papers fix | Modify existing | 1 file | 0 | Low |
| Zotero key encryption | Modify existing | 3 files, 1 schema | 1 migration | Medium |
| Env var validation | Modify existing | 4 files | 1 new util | Low |
| Stripe "dummy" key removal | Modify existing | 3 files | 0 | Low |
| Rate limiting enforcement | Modify existing + new | 2-3 mutation files | 1 schema table, 1 config | Medium |
| N+1 query resolution | Modify existing | 2 files | 0 | Medium |
| Deletion cascade fix | Modify existing | 1 file | 0 | High |
| Backfill full table scan | Modify existing | 1 file | 0 | Low |
| Orphaned PDF cleanup | Modify existing | 1 file | 0 | Low |
| Debug function isolation | Modify existing | 1 index file | 0 | Low |
| Test coverage additions | New | 0 | 3-4 test files | Low |

### Hardening Fixes — Detailed Integration Points

---

### Fix 1: Type Safety — `ctx: any` in Extraction Module

**What changes:** Replace `ctx: any` with proper `QueryCtx` or `MutationCtx` from `convex/_generated/server`.

**Integration points:**

The generated `convex/_generated/server.d.ts` already exports these types:
```typescript
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
```

The existing `convex/lib/auth.ts` already imports and uses them correctly:
```typescript
import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
export type AuthContext = QueryCtx | MutationCtx;
```

**Files to modify:**

1. `convex/extraction/mutations.ts` — Helper functions at top of file:
   - `assertJobOwnership(ctx: any, ...)` on line 29 -> `ctx: MutationCtx`
   - `loadJobDataForReporting(ctx: any, ...)` on line 41 -> `ctx: MutationCtx`
   - All `(q: any)` index callbacks -> remove type annotation (TypeScript infers from index name)

2. `convex/extraction/queries.ts` — Helper functions:
   - `resolveOwnedJob(ctx: any, ...)` on line 34 -> `ctx: QueryCtx`
   - `resolveOwnedPaper(ctx: any, ...)` on line 52 -> `ctx: QueryCtx`
   - `attachReviewMetadata(ctx: any, ...)` on line 105 -> `ctx: QueryCtx`
   - `loadJobPapersAndResults(ctx: any, ...)` on line 145 -> `ctx: QueryCtx`
   - All `(q: any)` index callbacks -> remove type annotation

3. `convex/extraction/workpoolActions.ts` — Uses `internalAction` (ActionCtx), not database ctx directly. The `ctx: any` here likely appears in helper functions that receive ctx forwarded from action handlers.

**Pattern — before/after:**
```typescript
// BEFORE
async function assertJobOwnership(
  ctx: any,
  userId: Id<"users">,
  jobId: Id<"extractionJobs">
) { ... }

// AFTER
import { MutationCtx } from "../_generated/server";

async function assertJobOwnership(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"extractionJobs">
) { ... }
```

**For index callbacks:**
```typescript
// BEFORE
.withIndex("by_job", (q: any) => q.eq("jobId", jobId))

// AFTER — TypeScript infers q's type from the index definition in schema
.withIndex("by_job", (q) => q.eq("jobId", jobId))
```

**Dependency:** None. This is a pure type annotation change. No runtime behavior changes.

**Confidence:** HIGH — `convex/_generated/server.d.ts` confirmed to export `QueryCtx`, `MutationCtx`, `ActionCtx`. The auth module already uses this exact pattern.

---

### Fix 2: Type Safety — `internal as any` Cast

**What changes:** Remove `const internalApi = internal as any` and use `internal` directly.

**Root cause investigation:** The generated `api.d.ts` already has fully typed `internal` and `components` exports. The `as any` cast exists because either (a) the types were incomplete at the time code was written, or (b) the developer wanted to avoid type errors from function signature mismatches.

**Integration points:**

The `components` object in `api.d.ts` is typed with the stripe component's function references. The `internal` object filters `fullApi` to only internal functions. Both are fully typed.

**Files to modify:**

1. `convex/http.ts:10` — `const internalApi = internal as any` -> use `internal` directly
2. `convex/crons.ts:5` — `const internalApi = internal as any` -> use `internal` directly
3. `convex/credits/internal.ts:26-27` — remove `as any` casts
4. `convex/credits/actions.ts:25` — `const internalApi = internal as any` -> use `internal` directly
5. `convex/subscriptions/actions.ts:36-37` — both `internal as any` and `components as any`
6. `convex/subscriptions/internal.ts` — if `internal as any` used
7. `convex/credits/queries.ts` — if `internal as any` used

**Critical caveat:** The `components as any` cast in `subscriptions/actions.ts` is for `@convex-dev/stripe` component access. The generated `components` type in `api.d.ts` does include the stripe component type (lines 217+). Removing this cast should work, but verify that the `stripeClient` (from `convex/stripe.ts`) provides all needed methods without requiring untyped access.

**Verification approach:** After removing `as any`, run `npx convex dev` to regenerate types and check for compile errors. Each call site that breaks reveals a genuine type mismatch that needs fixing (renamed function, wrong args, etc.).

**Dependency:** Should be done after ctx typing (Fix 1) because some files overlap. Run `npx convex dev` between fixes to keep types fresh.

**Confidence:** HIGH — The generated types are present and complete. The cast was likely a convenience shortcut, not a workaround for missing types.

---

### Fix 3: Type Safety — `patchData: any` in Mutation

**What changes:** Type the patch object using Convex's `Partial<Doc<"extractionPapers">>` equivalent.

**Integration point:** `convex/extraction/mutations.ts:1887`

**Pattern:**
```typescript
// BEFORE
const patchData: any = {
  status: "completed",
  completedAt: Date.now(),
  creditsUsed: args.creditsUsed,
};
if (args.storageId) patchData.storageId = args.storageId;
if (args.pdfContentUsed) patchData.pdfContentUsed = true;

// AFTER
import type { Doc } from "../_generated/dataModel";

type PaperCompletionPatch = Partial<Pick<Doc<"extractionPapers">,
  "status" | "completedAt" | "creditsUsed" | "storageId" | "pdfContentUsed"
>>;

const patchData: PaperCompletionPatch = {
  status: "completed",
  completedAt: Date.now(),
  creditsUsed: args.creditsUsed,
};
if (args.storageId) patchData.storageId = args.storageId;
if (args.pdfContentUsed) patchData.pdfContentUsed = true;
```

**Dependency:** None. Isolated change.

**Confidence:** HIGH — Standard Convex pattern. `Doc` type is generated from schema.

---

### Fix 4: Debug Log Removal

**What changes:** Remove `console.log` calls from production code paths.

**Integration points:**

1. `app/settings/billing/page.tsx` — Search for `console.log("[BILLING]` and remove any debug render logging.

2. `app/actions/openalex.ts:13,18,23,35` — Four `console.log` calls:
   - Line 13: `console.log("query", query)`
   - Line 18: `console.log('OpenAlex SDK call with params:', ...)`
   - Line 23: `console.log('OpenAlex SDK response:', ...)`
   - Line 35: `console.log("searchField", ...)`

**Pattern:** Remove the lines entirely. These are not conditional debug logs; they fire on every request.

**Dependency:** None. Pure deletion.

**Confidence:** HIGH — Lines confirmed present in code review.

---

### Fix 5: `@ts-ignore` and `debug_papers.ts`

**What changes:** Fix or remove the `@ts-ignore` accessing non-existent `p.pdfUsed` field.

**Integration point:** `convex/debug_papers.ts:20-21`

The schema for `extractionPapers` has `pdfContentUsed` (boolean), not `pdfUsed`. The field was likely renamed.

**Fix:**
```typescript
// BEFORE
// @ts-ignore
pdfUsed: p.pdfUsed

// AFTER
pdfContentUsed: p.pdfContentUsed
```

**Dependency:** None. Isolated fix.

**Confidence:** HIGH — Schema confirms `pdfContentUsed` exists on `extractionPapers`.

---

### Fix 6: Zotero API Key Encryption

**What changes:** Encrypt the Zotero API key at rest using the same AES-256-GCM pattern used for provider API keys.

**Integration points:**

The existing encryption system in `convex/apiKeys/actions.ts` provides:
- `encrypt(plaintext, keyHex)` -> `"iv:authTag:ciphertext"` format
- `decrypt(encrypted, keyHex)` -> plaintext
- Uses `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes)
- Runs in `"use node"` runtime (required for `crypto` module)

**Current Zotero flow (plaintext):**
1. OAuth completes in `convex/zotero/actions.ts:completeOAuth` (action, "use node")
2. Calls `internal.zotero.mutations.saveConnection` with plaintext `apiKey`
3. `saveConnection` (mutation) stores directly to `zoteroConnections` table
4. Read path: `convex/zotero/internal.ts:getConnection` (query) returns plaintext `apiKey`
5. Actions use `connection.apiKey` directly in fetch headers

**Proposed encrypted flow:**

The core challenge: Encryption/decryption needs `crypto` module (Node.js runtime), but `saveConnection` is a mutation (deterministic runtime, no Node.js). Reading is via a query (also deterministic runtime).

**Architecture decision: Encrypt in action, decrypt in action.**

```
completeOAuth (action, "use node")
  -> encrypt(accessToken, ENCRYPTION_KEY)
  -> call saveConnection mutation with encrypted key
  -> mutation stores encrypted key as-is

fetchCollections/fetchItems/etc (action, "use node")
  -> call getConnection query (returns encrypted key)
  -> decrypt(connection.apiKey, ENCRYPTION_KEY) in action
  -> use decrypted key for Zotero API calls
```

**Files to modify:**

1. **Create `convex/lib/crypto.ts`** — Extract `encrypt`/`decrypt` from `convex/apiKeys/actions.ts` into a shared module so both `apiKeys/actions.ts` and `zotero/actions.ts` can use them. The crypto module must be `"use node"`.

2. `convex/apiKeys/actions.ts` — Import from shared crypto module instead of local functions.

3. `convex/zotero/actions.ts:completeOAuth` (line 588) — Encrypt before saving:
   ```typescript
   import { encrypt, decrypt } from "../lib/crypto";

   // In completeOAuth handler:
   const encryptionKey = process.env.ENCRYPTION_KEY;
   if (!encryptionKey) {
     throw createError("ENCRYPTION_KEY_MISSING", "Encryption key not configured");
   }
   const encryptedApiKey = encrypt(accessToken, encryptionKey);

   await ctx.runMutation(internal.zotero.mutations.saveConnection, {
     userId,
     zoteroUserId,
     apiKey: encryptedApiKey,  // Now encrypted
     username: username || undefined,
   });
   ```

4. `convex/zotero/actions.ts` — Add a decrypt helper and use it in every action that reads the connection:
   - `fetchCollections` (line 618)
   - `fetchGroups` (line 669)
   - `fetchItems` (line 742)
   - `getAttachments` (line 954)
   - `downloadFile` (line 1019)

   Each of these already runs in `"use node"` runtime. Add:
   ```typescript
   function getDecryptedZoteroApiKey(encryptedKey: string): string {
     const encryptionKey = process.env.ENCRYPTION_KEY;
     if (!encryptionKey) {
       throw createError("ENCRYPTION_KEY_MISSING", "Encryption key not configured");
     }
     return decrypt(encryptedKey, encryptionKey);
   }
   ```

5. **Schema:** No schema change needed. The `apiKey: v.string()` field stores the encrypted string (which is also a string: `"iv:authTag:ciphertext"`).

6. **Migration:** Existing plaintext keys need a one-time migration. Write an `internalAction` that:
   - Reads all `zoteroConnections` via a query
   - For each, encrypts the plaintext `apiKey`
   - Patches the document with the encrypted value via a mutation
   This must be an action (not mutation) because it needs `crypto`.

**Dependency:** The shared crypto module extraction should happen first, then Zotero encryption, then migration.

**Confidence:** HIGH — The `apiKeys/actions.ts` pattern is proven. Same algorithm, same env var, same runtime.

---

### Fix 7: Environment Variable Validation

**What changes:** Add fail-fast validation for critical env vars instead of silent fallbacks.

**Integration points:**

Three categories of env var issues:

**Category A: Stripe "dummy" fallback (3 files)**

Files: `convex/subscriptions/actions.ts:39`, `convex/credits/actions.ts:31`, `convex/maintenance/internal.ts:11`

Each has: `new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", ...)`

**Fix pattern — lazy initialization with validation:**
```typescript
// BEFORE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

// AFTER
function createStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Billing functions will not work."
    );
  }
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

// Lazy initialization - validates on first use, not module load
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = createStripeClient();
  return _stripe;
}
```

Why lazy initialization: Convex loads all modules at deploy time. If `STRIPE_SECRET_KEY` is set in the Convex environment but not available during the module import phase of a dev build, eager validation would crash. Lazy init validates on first actual use.

Alternative: Use the existing `stripeClient` from `convex/stripe.ts` which already wraps `@convex-dev/stripe`. But the raw Stripe SDK usage in actions is separate from the component client, so both need validation.

**Category B: FRONTEND_URL localhost fallback (2 files)**

Files: `convex/http.ts:11-14`, `convex/subscriptions/actions.ts:43-46`

Fix: Create `convex/lib/env.ts`:
```typescript
export function getFrontendUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL;
  if (!url) {
    console.warn("NEXT_PUBLIC_APP_URL not set, falling back to localhost:3000");
    return "http://localhost:3000";
  }
  return url;
}
```

Keep the fallback for development but log a warning. In production, this warning in Convex logs signals misconfiguration.

**Category C: ENCRYPTION_KEY (already validated)**

`convex/apiKeys/actions.ts` already validates `process.env.ENCRYPTION_KEY` at function call time and throws. This pattern is correct; extend it to Zotero actions (covered in Fix 6).

**Dependency:** Can be done independently. The lazy Stripe init should be tested to ensure it does not break the existing billing flows.

**Confidence:** HIGH — Standard patterns. Lazy init is a well-known approach for Convex actions.

---

### Fix 8: Rate Limiting Enforcement

**What changes:** Move from config-only rate limiting to server-side enforcement using `@convex-dev/rate-limiter`.

**Integration points:**

The existing `convex/lib/rateLimit.ts` defines three rate limit configs but explicitly states "rate limiting is handled at the application layer" (no server enforcement).

**Recommended approach: Use `@convex-dev/rate-limiter` component.**

This is the official Convex rate limiting component. It provides:
- Token bucket and fixed window algorithms
- Per-user keying
- Transactional safety (no race conditions)
- Configurable sharding for throughput

**Setup steps:**

1. Install: `npm install @convex-dev/rate-limiter`

2. Register component in `convex/convex.config.ts`:
   ```typescript
   import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
   app.use(rateLimiter);
   ```

3. Create `convex/lib/rateLimiter.ts` (replace existing `rateLimit.ts`):
   ```typescript
   import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
   import { components } from "../_generated/api";
   import { internalMutation } from "../_generated/server";
   import { v } from "convex/values";
   import { createError } from "./errors";

   export const rateLimiter = new RateLimiter(components.rateLimiter, {
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
     "start-extraction": {
       kind: "fixed window",
       rate: 10,
       period: HOUR,
     },
   });
   ```

4. Enforce in mutations:
   ```typescript
   import { rateLimiter } from "../lib/rateLimiter";

   // In startExtraction mutation handler:
   await rateLimiter.limit(ctx, "start-extraction", {
     key: user._id,
     throws: true,
   });
   ```

**Files to modify:**

- `convex/convex.config.ts` — Add rate limiter component
- `convex/lib/rateLimit.ts` -> rename/replace with `convex/lib/rateLimiter.ts`
- `convex/extraction/mutations.ts:startExtraction` — Add rate limit check
- `convex/subscriptions/actions.ts` or relevant checkout function — Add rate limit check

**Important caveat for actions:** `rateLimiter.limit()` requires a `MutationCtx` because it writes to the database. In actions, you must call it via a helper mutation:
```typescript
// convex/lib/rateLimiter.ts - add a mutation wrapper
export const checkRateLimit = internalMutation({
  args: { name: v.string(), key: v.string() },
  handler: async (ctx, { name, key }) => {
    const result = await rateLimiter.limit(ctx, name as any, { key });
    if (!result.ok) {
      throw createError("RATE_LIMITED",
        `Rate limited. Retry after ${result.retryAfter}ms`);
    }
  },
});

// In action:
await ctx.runMutation(internal.lib.rateLimiter.checkRateLimit, {
  name: "checkout-session",
  key: userId,
});
```

**Dependency:** Requires `npm install` and component registration. Should be done before other fixes that touch the same mutation files.

**Confidence:** MEDIUM — The `@convex-dev/rate-limiter` component API is well-documented, but integrating with actions (vs mutations) adds a layer of indirection. Verify the action-to-mutation bridge pattern works cleanly.

---

### Fix 9: N+1 Query Resolution

**What changes:** Batch database reads instead of per-paper sequential loops.

**Integration points:**

**Location 1: `loadJobDataForReporting` in `convex/extraction/mutations.ts:40-77`**

Current pattern (N+1):
```typescript
for (const paper of papers) {
  const [results, reviews] = await Promise.all([
    ctx.db.query("extractionResults")
      .withIndex("by_paper", q => q.eq("paperId", paper._id)).collect(),
    ctx.db.query("extractionResultReviews")
      .withIndex("by_paper", q => q.eq("paperId", paper._id)).collect(),
  ]);
}
```

For 100 papers: 200 sequential DB reads (2 per paper, parallelized per paper but sequential across papers).

**Fix — `Promise.all` across all papers:**
```typescript
const papers = await ctx.db.query("extractionPapers")
  .withIndex("by_job", q => q.eq("jobId", jobId)).collect();

// Batch: one Promise.all for ALL papers
const [allResultsByPaper, allReviewsByPaper] = await Promise.all([
  Promise.all(papers.map(paper =>
    ctx.db.query("extractionResults")
      .withIndex("by_paper", q => q.eq("paperId", paper._id))
      .collect()
      .then(results => [paper._id, results] as const)
  )),
  Promise.all(papers.map(paper =>
    ctx.db.query("extractionResultReviews")
      .withIndex("by_paper", q => q.eq("paperId", paper._id))
      .collect()
      .then(reviews => [paper._id, reviews] as const)
  )),
]);

const resultsByPaper = new Map(allResultsByPaper);
const reviewsByResult = new Map<string, Doc<"extractionResultReviews">>();
for (const [, reviews] of allReviewsByPaper) {
  for (const review of reviews) {
    reviewsByResult.set(review.resultId, review);
  }
}
```

In Convex mutations, `Promise.all` parallelizes DB reads within the same transaction. There are no actual network round-trips between the function and the database within a Convex mutation (they run co-located), but `Promise.all` still enables the Convex runtime to batch/optimize concurrent reads.

**Location 2: `loadJobPapersAndResults` in `convex/extraction/queries.ts:145-170`**

Same pattern, same fix. Replace:
```typescript
for (const paper of papers) {
  const results = await ctx.db.query("extractionResults")...
  resultsByPaper.set(paper._id, await attachReviewMetadata(ctx, paper._id, results));
}
```

With:
```typescript
const allResults = await Promise.all(
  papers.map(paper =>
    ctx.db.query("extractionResults")
      .withIndex("by_paper", q => q.eq("paperId", paper._id))
      .collect()
  )
);

const allEnriched = await Promise.all(
  papers.map((paper, i) =>
    attachReviewMetadata(ctx, paper._id, allResults[i])
  )
);

const resultsByPaper = new Map(
  papers.map((paper, i) => [paper._id, allEnriched[i]])
);
```

**API contract preservation:** Both functions return the same `{ questions, papers, resultsByPaper }` shape. No callers need to change.

**Dependency:** Should be combined with Fix 1 (ctx typing) since both touch the same functions.

**Confidence:** HIGH — `Promise.all` in Convex mutations/queries is the documented pattern for parallelizing reads. No schema changes needed.

---

### Fix 10: Deletion Cascade Restructure

**What changes:** Fix the recursive deletion cascade to include evidence units, eliminate O(papers^2) re-fetching, and use scheduled mutations instead of recursive `runMutation`.

**Integration point:** `convex/extraction/mutations.ts:968-1009` (`deleteExtractionInternal`)

**Current problems:**
1. Missing `extractionEvidenceUnits` deletion
2. Missing `extractionResultReviews` deletion
3. Missing PDF storage cleanup (`ctx.storage.delete`)
4. O(papers^2): re-queries all papers on every batch iteration
5. Recursive `ctx.runMutation(internal...deleteExtractionInternal)` — each recursive call is a new mutation transaction

**Proposed restructured cascade using `ctx.scheduler.runAfter`:**

```
deleteExtractionInternal(jobId, phase: "evidence")
  |
  v
Phase 1: Delete evidence units (batch by paper, one paper at a time)
  -> if more papers with evidence: schedule self with same phase
  |
  v (when evidence done)
Phase 2: Delete results + reviews (batch by paper)
  -> if more papers with results/reviews: schedule self
  |
  v (when results/reviews done)
Phase 3: Delete papers + cleanup storage (batch)
  -> if more papers: schedule self
  |
  v (when papers done)
Phase 4: Delete questions (batch)
  -> if more questions: schedule self
  |
  v (when questions done)
Phase 5: Delete job document
```

**Implementation pattern:**

```typescript
export const deleteExtractionInternal = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    phase: v.optional(v.union(
      v.literal("evidence"),
      v.literal("results"),
      v.literal("papers"),
      v.literal("questions"),
      v.literal("job")
    )),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const BATCH_SIZE = 100;
    const phase = args.phase ?? "evidence";

    if (phase === "evidence") {
      const papers = await ctx.db.query("extractionPapers")
        .withIndex("by_job", q => q.eq("jobId", args.jobId))
        .take(1);

      if (papers.length > 0) {
        const units = await ctx.db.query("extractionEvidenceUnits")
          .withIndex("by_paper", q => q.eq("paperId", papers[0]._id))
          .take(BATCH_SIZE);

        if (units.length > 0) {
          for (const unit of units) await ctx.db.delete(unit._id);

          // More evidence may exist for this paper or others
          await ctx.scheduler.runAfter(0,
            internal.extraction.mutations.deleteExtractionInternal,
            { jobId: args.jobId, phase: "evidence" }
          );
          return null;
        }
      }
      // No more evidence units; advance to results phase
      await ctx.scheduler.runAfter(0,
        internal.extraction.mutations.deleteExtractionInternal,
        { jobId: args.jobId, phase: "results" }
      );
      return null;
    }

    if (phase === "results") {
      const papers = await ctx.db.query("extractionPapers")
        .withIndex("by_job", q => q.eq("jobId", args.jobId))
        .take(1);

      if (papers.length > 0) {
        // Delete results for this paper
        const results = await ctx.db.query("extractionResults")
          .withIndex("by_paper", q => q.eq("paperId", papers[0]._id))
          .take(BATCH_SIZE);

        // Delete reviews for this paper
        const reviews = await ctx.db.query("extractionResultReviews")
          .withIndex("by_paper", q => q.eq("paperId", papers[0]._id))
          .take(BATCH_SIZE);

        if (results.length > 0 || reviews.length > 0) {
          for (const res of results) await ctx.db.delete(res._id);
          for (const rev of reviews) await ctx.db.delete(rev._id);

          await ctx.scheduler.runAfter(0,
            internal.extraction.mutations.deleteExtractionInternal,
            { jobId: args.jobId, phase: "results" }
          );
          return null;
        }
      }
      // No more results/reviews; advance to papers
      await ctx.scheduler.runAfter(0,
        internal.extraction.mutations.deleteExtractionInternal,
        { jobId: args.jobId, phase: "papers" }
      );
      return null;
    }

    if (phase === "papers") {
      const papers = await ctx.db.query("extractionPapers")
        .withIndex("by_job", q => q.eq("jobId", args.jobId))
        .take(BATCH_SIZE);

      if (papers.length > 0) {
        for (const paper of papers) {
          // Cleanup PDF storage
          if (paper.storageId) {
            try { await ctx.storage.delete(paper.storageId); }
            catch (e) { console.error(`Storage cleanup failed: ${paper._id}`, e); }
          }
          await ctx.db.delete(paper._id);
        }

        await ctx.scheduler.runAfter(0,
          internal.extraction.mutations.deleteExtractionInternal,
          { jobId: args.jobId, phase: "papers" }
        );
        return null;
      }
      // Advance to questions
      await ctx.scheduler.runAfter(0,
        internal.extraction.mutations.deleteExtractionInternal,
        { jobId: args.jobId, phase: "questions" }
      );
      return null;
    }

    if (phase === "questions") {
      const questions = await ctx.db.query("extractionQuestions")
        .withIndex("by_job", q => q.eq("jobId", args.jobId))
        .take(BATCH_SIZE);

      if (questions.length > 0) {
        for (const q of questions) await ctx.db.delete(q._id);
        await ctx.scheduler.runAfter(0,
          internal.extraction.mutations.deleteExtractionInternal,
          { jobId: args.jobId, phase: "questions" }
        );
        return null;
      }
      // Advance to job deletion
      await ctx.scheduler.runAfter(0,
        internal.extraction.mutations.deleteExtractionInternal,
        { jobId: args.jobId, phase: "job" }
      );
      return null;
    }

    if (phase === "job") {
      const job = await ctx.db.get(args.jobId);
      if (job) await ctx.db.delete(args.jobId);
      return null;
    }

    return null;
  },
});
```

**Why `ctx.scheduler.runAfter(0, ...)` instead of `ctx.runMutation(...)`:**
- `runMutation` creates a nested transaction that counts toward the parent's limits
- `scheduler.runAfter(0, ...)` schedules an independent mutation that runs immediately after the current one commits
- This avoids transaction limit accumulation and allows each batch to have its own full budget

**Dependency:** This is the most complex fix. Should be done when type safety fixes (Fix 1, 2) are already applied to the same file. Test coverage (new tests) should be written before or alongside this fix.

**Confidence:** HIGH for the approach, MEDIUM for first-try correctness. The phase-based state machine is more maintainable than the recursive approach, but thorough testing is essential.

---

### Fix 11: Backfill Full Table Scan

**What changes:** Replace `ctx.db.query("extractionPapers").collect()` with cursor-based pagination.

**Integration point:** `convex/extraction/mutations.ts:1775` (`backfillIsIndexed`)

**Fix:** The table has `index("by_ragEntryId_isIndexed", ["ragEntryId", "isIndexed"])`. However, this index cannot be used to query "ragEntryId is NOT null AND isIndexed IS null" because Convex indexes require equality/range on prefix fields.

Better approach: Use cursor-based pagination with `paginate()`:

```typescript
export const backfillIsIndexed = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    const result = await ctx.db.query("extractionPapers")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let updated = 0;
    for (const paper of result.page) {
      if (paper.ragEntryId != null && paper.isIndexed == null) {
        await ctx.db.patch(paper._id, { isIndexed: true });
        updated++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0,
        internal.extraction.mutations.backfillIsIndexed,
        { cursor: result.continueCursor, batchSize }
      );
    }

    return { updated, hasMore: !result.isDone };
  },
});
```

**Dependency:** None. Isolated fix.

**Confidence:** HIGH — Standard Convex pagination pattern.

---

### Fix 12: Orphaned PDF Cleanup

**What changes:** Extend `cleanupOldPdfs` to handle failed papers, and invoke cleanup during deletion cascade.

**Integration point:** `convex/extraction/mutations.ts:1250-1281` (`cleanupOldPdfs`)

**Fix 1 — Extend cleanup for failed papers:**

The `by_status_completedAt` index only works for papers with a `completedAt` value. Failed papers may not have `completedAt`. Two approaches:

Option A: Add queries for failed statuses using `by_job_status` index (requires iterating jobs first).
Option B: Add a new index: `.index("by_status", ["status"])` on `extractionPapers`.

Recommended: Option B (add index), then:
```typescript
// After cleaning completed papers (existing logic)...
const failedStatuses = ["failed", "download_failed"] as const;
for (const failedStatus of failedStatuses) {
  const failedPapers = await ctx.db.query("extractionPapers")
    .withIndex("by_status", q => q.eq("status", failedStatus))
    .take(100);

  for (const paper of failedPapers) {
    if (paper.storageId) {
      try {
        await ctx.storage.delete(paper.storageId);
        await ctx.db.patch(paper._id, { storageId: undefined });
      } catch (error) {
        console.error(`Failed to delete PDF for failed paper ${paper._id}:`, error);
      }
    }
  }
}
```

**Fix 2 — Cleanup during deletion cascade:**
Already covered in Fix 10 (deletion cascade restructure) — the "papers" phase includes `ctx.storage.delete(paper.storageId)`.

**Dependency:** Fix 10 for cascade integration. Schema migration for new index if needed.

**Confidence:** HIGH — Standard Convex storage API.

---

### Fix 13: Debug Function Isolation

**What changes:** Verify all public debug functions are gated by `requirePublicDebugEnabled()`, and audit that no internal test function can be indirectly triggered from a client-facing surface.

**Integration point:** `convex/extraction/index.ts` (lines 94-121)

The index currently exports debug/test functions. In Convex:

- **Public functions** (exported from `query`/`mutation`/`action`): Callable from clients
- **Internal functions** (exported from `internalQuery`/`internalMutation`/`internalAction`): Only callable from other Convex functions

For internal functions (`createAndRunTestJob`, `getTestJobStatus`, `runPdfTestNow`, etc.), they are already protected by `"internal"` visibility. Clients cannot call them.

For public debug functions, verify each has `requirePublicDebugEnabled()` at the start of its handler:
- `diagnoseJob` from `./debug`
- `getFailedPapersDebug` from `./debug_errors`
- `debugPaperResults` from `./debug_paper_results`
- `debugJobContent` from `./debug_job_content`
- `debugJobCitations` from `./debug_job_citations`
- `debugPdfAlignment` from `./debug_pdfjs_alignment`
- `createTestJobForFix` from `./create_test_job`

**Action:** Audit each file, add `requirePublicDebugEnabled()` to any that is missing it.

**Dependency:** None.

**Confidence:** HIGH — Convex's internal/public visibility is enforced at the platform level.

---

## Data Flow Changes

### Current vs Proposed Deletion Flow
```
CURRENT:
deleteExtraction (public, auth)
  -> deleteExtractionInternal (recursive runMutation)
       -> delete results (100/batch, re-queries ALL papers each time)
       -> delete papers (100/batch)
       -> delete questions
       -> delete job
  MISSING: evidence units, reviews, storage cleanup

PROPOSED:
deleteExtraction (public, auth)
  -> deleteExtractionInternal (phase: "evidence", scheduler.runAfter)
  -> deleteExtractionInternal (phase: "results" + reviews)
  -> deleteExtractionInternal (phase: "papers" + storage cleanup)
  -> deleteExtractionInternal (phase: "questions")
  -> deleteExtractionInternal (phase: "job")
```

### Current vs Proposed Zotero Key Flow
```
CURRENT:
completeOAuth (action)
  -> saveConnection [plaintext apiKey]
  -> DB: apiKey = "PLAINTEXT_KEY"
fetchCollections (action)
  -> getConnection [returns plaintext]
  -> fetch(url, headers: plaintext)

PROPOSED:
completeOAuth (action, "use node")
  -> encrypt(accessToken, ENCRYPTION_KEY)
  -> saveConnection [encrypted apiKey]
  -> DB: apiKey = "iv:authTag:ciphertext"
fetchCollections (action, "use node")
  -> getConnection [returns encrypted]
  -> decrypt(apiKey, ENCRYPTION_KEY)
  -> fetch(url, headers: decrypted)
```

### Current vs Proposed Rate Limiting
```
CURRENT:
startExtraction (mutation)
  -> requireAuth -> requireProPlan -> create job (no rate check)

PROPOSED:
startExtraction (mutation)
  -> requireAuth
  -> requireProPlan
  -> rateLimiter.limit(ctx, "start-extraction", { key: user._id, throws: true })
  -> create job
```

## Suggested Build Order

The ordering is driven by three principles:
1. **Foundation first** — type safety fixes enable IDE support for all subsequent work
2. **Independent fixes in parallel** — no-dependency fixes can be batched
3. **High-risk fixes last** — complex changes benefit from the safety net of earlier fixes and tests

### Phase 1: Foundation (Type Safety + Quick Wins)

| Order | Fix | Rationale |
|-------|-----|-----------|
| 1.1 | Fix 1: ctx typing | Enables autocompletion and type checking for all subsequent extraction work |
| 1.2 | Fix 2: `internal as any` removal | Run `npx convex dev` after to regenerate types; validates all function references |
| 1.3 | Fix 3: `patchData: any` | Trivial, same file as Fix 1 |
| 1.4 | Fix 4: Debug log removal | Two files, zero risk |
| 1.5 | Fix 5: `@ts-ignore` fix | One line change |

**Phase 1 rationale:** All changes are low-risk type annotations and deletions. They do not change runtime behavior. After this phase, the entire codebase has proper types, enabling IDE support for the harder fixes that follow.

### Phase 2: Security Hardening

| Order | Fix | Rationale |
|-------|-----|-----------|
| 2.1 | Fix 7: Env var validation (Stripe + URL) | Quick, reduces silent failure surface |
| 2.2 | Fix 6: Shared crypto module extraction | Extract encrypt/decrypt from apiKeys to shared lib |
| 2.3 | Fix 6: Zotero key encryption | Apply encryption to Zotero flow |
| 2.4 | Fix 6: Zotero key migration | One-time migration of existing plaintext keys |
| 2.5 | Fix 13: Debug function audit | Verify all public debug functions are gated |

**Phase 2 rationale:** Security fixes are high-value and mostly independent. The crypto extraction enables Zotero encryption. Env var validation is standalone. Debug audit is a verification pass.

### Phase 3: Infrastructure (Rate Limiting)

| Order | Fix | Rationale |
|-------|-----|-----------|
| 3.1 | Fix 8: Install + register rate limiter component | npm install, config.ts change |
| 3.2 | Fix 8: Define rate limits + enforce in mutations | Wire up enforcement |

**Phase 3 rationale:** Rate limiting requires a new dependency and component registration. Doing this after security hardening means the endpoints being protected are already properly validated.

### Phase 4: Performance + Data Integrity

| Order | Fix | Rationale |
|-------|-----|-----------|
| 4.1 | Fix 9: N+1 query resolution | Promise.all batching, preserves API contracts |
| 4.2 | Fix 11: Backfill table scan fix | Pagination, isolated |
| 4.3 | Fix 12: Orphaned PDF cleanup extension | Extends cleanup scope |
| 4.4 | Fix 10: Deletion cascade restructure | Most complex fix; benefits from all prior type safety |

**Phase 4 rationale:** N+1 fixes are medium-risk with high reward. The deletion cascade is the most complex change and benefits from having typed helpers, IDE support, and rate limiting already in place. It should be the last functional change before testing.

### Phase 5: Test Coverage

| Order | Fix | Rationale |
|-------|-----|-----------|
| 5.1 | Deletion cascade unit tests | Validates Phase 4's most complex change |
| 5.2 | Zustand store migration tests | Validates the 5-version migration chain |
| 5.3 | Extraction insight edge case tests | Validates null/sparse data handling |

**Phase 5 rationale:** Tests validate the fixes from earlier phases. The deletion cascade tests are highest priority because that fix has the highest complexity.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (small) | All fixes above work within current Convex limits |
| 500+ paper jobs | N+1 fix (Fix 9) prevents transaction read limit hits; paginated deletion cascade (Fix 10) handles large job cleanup |
| 10K+ library items | Existing pagination in library queries handles this; no hardening changes needed |
| Concurrent users creating extraction jobs | Rate limiting (Fix 8) prevents abuse; per-user quotas scale linearly |

### Scaling Priorities

1. **First bottleneck:** Extraction job queries hitting Convex's 16MB/8192 doc read limits on large jobs. Fix 9 (Promise.all) helps but does not eliminate the limit; future work needs cursor-based pagination of job results.
2. **Second bottleneck:** Deletion of large jobs (500+ papers, 2500+ results, thousands of evidence units). Fix 10 handles this with batched scheduled mutations.

## Anti-Patterns to Avoid During Hardening

### Anti-Pattern 1: Eager Module-Level Validation

**What people do:** Add `if (!process.env.X) throw new Error()` at the top level of a Convex module.
**Why it's wrong:** Convex imports all modules at deploy time. If the env var is legitimately absent during a deploy check, the entire deployment fails.
**Do this instead:** Lazy validation on first function call, or validation inside the function handler.

### Anti-Pattern 2: Recursive runMutation for Large Batches

**What people do:** `ctx.runMutation(internal.same.function, { ...updatedArgs })` inside a mutation handler.
**Why it's wrong:** Each recursive call is a nested transaction that counts toward the parent's limits. Deep recursion hits Convex's transaction limits.
**Do this instead:** `ctx.scheduler.runAfter(0, internal.same.function, { ...args })` — schedules an independent mutation that runs immediately after the current one commits.

### Anti-Pattern 3: Typing Convex Index Callbacks

**What people do:** `(q: any) => q.eq("field", value)` on index callbacks.
**Why it's wrong:** TypeScript can infer the callback parameter type from the index name. Adding `any` disables all type checking on the query builder.
**Do this instead:** `(q) => q.eq("field", value)` — let TypeScript infer from the schema.

### Anti-Pattern 4: Encrypt/Decrypt in Mutations

**What people do:** Try to use Node.js `crypto` module in a Convex mutation.
**Why it's wrong:** Mutations run in deterministic runtime (not Node.js). The `crypto` module is only available in actions marked with `"use node"`.
**Do this instead:** Encrypt/decrypt in actions, pass encrypted values to mutations for storage.

### Anti-Pattern 5: Full Table Scan for Backfills

**What people do:** `ctx.db.query("table").collect()` to find documents needing migration.
**Why it's wrong:** Loads entire table into memory. Hits Convex read limits on tables with thousands of documents.
**Do this instead:** Use `paginate()` with `scheduler.runAfter(0, ...)` to process in batches across independent transactions.

## Sources

- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) — QueryCtx/MutationCtx typing
- [Convex Mutation Functions](https://docs.convex.dev/functions/mutation-functions) — ctx types, scheduler API
- [@convex-dev/rate-limiter on npm](https://www.npmjs.com/package/@convex-dev/rate-limiter) — Rate limiting component
- [Convex Rate Limiter README](https://github.com/get-convex/rate-limiter/blob/main/README.md) — Setup, API, usage patterns
- [Rate Limiting at the Application Layer (Convex Stack)](https://stack.convex.dev/rate-limiting) — Patterns and rationale
- [Convex Rate Limiting Docs](https://docs.convex.dev/agents/rate-limiting) — Official documentation
- Codebase inspection: `convex/_generated/server.d.ts`, `convex/_generated/api.d.ts`, `convex/lib/auth.ts`, `convex/apiKeys/actions.ts`, `convex/schema.ts`

---
*Architecture research for: v2.3 Codebase Hardening*
*Researched: 2026-03-02*
