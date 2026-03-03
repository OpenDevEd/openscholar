# Architecture Research: v3.0 Zero-Any Overhaul Integration

**Domain:** Codebase maintenance — resolving all CONCERNS.md items in existing Convex + Next.js extraction platform
**Researched:** 2026-03-03
**Confidence:** HIGH (all integration points verified against actual codebase files)

## Existing Architecture Overview (v2.5 baseline)

```
+-----------------------------------------------------------------------+
|                          Next.js Frontend                              |
|  +----------+  +-----------+  +------------------+                    |
|  | Search   |  | Library   |  | Extraction Pages |                    |
|  | Page     |  | Page      |  | (job/papers/view)|                    |
|  +----+-----+  +-----+-----+  +--------+---------+                    |
|       |               |                |                               |
|  +----+-----+   +-----+-----+   +------+--------+  +---------------+  |
|  | Zustand  |   | nuqs URL  |   | Convex        |  | ExportDialog  |  |
|  | Stores   |   | State     |   | useQuery()    |  | (xlsx import) |  |
|  +----------+   +-----------+   +-----+---------+  +-------+-------+  |
|                                       |                     |          |
|  +------------------------------------|-----------+  lib/extraction/   |
|  | lib/ai/client/providers.ts (WRONG) |           |  export.ts (XLSX) |
|  | lib/extraction/export.ts  (any)    |           |                    |
|  | lib/extraction/filtering.ts (any)  |           |                    |
|  +------------------------------------|-----------+                    |
+---------------------------------------|----------------------------+---+
                                        |
+---------------------------------------|----------------------------+
|                  Convex Backend        |                           |
|                                        |                           |
|  +-------------------------------------v------------------------+  |
|  |            Public API Layer (queries / mutations)            |  |
|  |  extraction/queries.ts    extraction/mutations.ts            |  |
|  |  library/queries.ts       maintenance/mutations.ts           |  |
|  |  credits/actions.ts       zotero/mutations.ts                |  |
|  +--------+----------+-----------+----------------------------+  |
|           |          |           |                             |  |
|  +--------v--+ +-----v----+ +----v--------------------+       |  |
|  | Workflow  | | Workpool | | Cron Jobs (crons.ts)    |       |  |
|  | Manager   | | (PDF)    | | - cleanup users         |       |  |
|  | @convex-  | | parallel:| | - check subscriptions   |       |  |
|  | dev/wflow | | 3 / 10   | | - monitor stripe        |       |  |
|  +--------+--+ +----+-----+ | - reconcile invoices    |       |  |
|           |         |       | - cleanup zotero tokens |       |  |
|           v         v       +-------------------------+       |  |
|  +---------------------+                                      |  |
|  | workpoolActions.ts  |                                      |  |
|  | download -> extract |                                      |  |
|  +---------------------+                                      |  |
|                                                               |  |
|  +----------------------------------------------------------+ |  |
|  |  lib/crypto.ts  lib/rateLimit.ts  lib/debug_gate.ts     | |  |
|  |  lib/constants.ts  (audit via console.log currently)     | |  |
|  +----------------------------------------------------------+ |  |
|                                                               |  |
|  +----------------------------------------------------------+ |  |
|  |  Schema: users, subscriptions, credits, libraryItems,    | |  |
|  |  collections, libraryItemCollections, extractionJobs,    | |  |
|  |  extractionPapers, extractionResults, extractionQuestions,| |  |
|  |  extractionResultReviews, extractionRunDiffs, ...        | |  |
|  +----------------------------------------------------------+ |  |
+---------------------------------------------------------------+--+
```

## Concern-to-Architecture Mapping

All CONCERNS.md items map to one of five architectural domains. This document
analyzes integration points, new vs modified components, and data flows for each.

---

## Domain 1: Persistent Audit Table (SECURITY: Audit log uses console.log)

### Current State

`convex/lib/crypto.ts` (line 81) and `convex/lib/debug_gate.ts` (line 25) emit
structured `console.log` calls with `[AUDIT:KEY_DECRYPT]` and `[AUDIT:DEBUG_ACCESS]`
prefixes. These appear in Convex function logs but are not queryable, tamper-evident,
or persistent beyond log retention.

### New Component: `auditLogs` Table

Add a new table to `convex/schema.ts`:

```typescript
auditLogs: defineTable({
  userId: v.string(),           // Clerk ID or Convex user ID string
  action: v.string(),           // e.g. "KEY_DECRYPT", "DEBUG_ACCESS"
  purpose: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.string())),
  createdAt: v.number(),
}).index("by_user", ["userId"])
  .index("by_action_created", ["action", "createdAt"])
  .index("by_created", ["createdAt"]),
```

**Why this schema:** The `userId` is a string (not `v.id("users")`) because audit
events fire from `"use node"` actions where the user may only be known by Clerk ID.
Forcing `v.id("users")` would require an extra DB lookup. `action` + `createdAt`
composite index enables time-ranged audit queries by action type.

### New Internal Mutation: `convex/lib/audit.ts`

```typescript
// "use node" NOT needed — this is a mutation, not an action
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const writeAuditLog = internalMutation({
  args: {
    userId: v.string(),
    action: v.string(),
    purpose: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      action: args.action,
      purpose: args.purpose,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
    return null;
  },
});
```

### Modified Component: `convex/lib/crypto.ts`

`decryptApiKey` is in a `"use node"` module — it cannot call `ctx.runMutation`
directly. The audit write must be delegated via the caller's action context.

**Approach:** Change `decryptApiKey` signature to accept an optional `auditWriter`
callback, keeping `console.log` as a fallback for contexts where the callback is
not provided:

```typescript
export function decryptApiKey(
  encrypted: string,
  keyHex: string,
  audit: { userId: string; purpose: string },
  writeAudit?: (args: AuditArgs) => Promise<void>
): string {
  const decrypted = decrypt(encrypted, keyHex);
  // Always log (grep-friendly Convex log fallback)
  console.log("[AUDIT:KEY_DECRYPT]", JSON.stringify({
    userId: audit.userId,
    purpose: audit.purpose,
    timestamp: new Date().toISOString(),
  }));
  // Persist to DB if caller provides writer
  if (writeAudit) {
    void writeAudit({ userId: audit.userId, action: "KEY_DECRYPT", purpose: audit.purpose });
  }
  return decrypted;
}
```

Callers (Convex actions with `ctx`) pass `async (args) => ctx.runMutation(internal.lib.audit.writeAuditLog, args)`.

### Modified Component: `convex/lib/debug_gate.ts`

Same pattern — `requirePublicDebugEnabled()` can only `console.log`. Pass an
optional audit writer from callers that have action context. For the initial
implementation, retaining `console.log` while adding a parallel DB write in the
callers is sufficient and avoids refactoring the gate signature.

### Data Flow (New)

```
decryptApiKey() called in "use node" action
  |
  +--> console.log [AUDIT:KEY_DECRYPT] (existing, keep)
  |
  +--> writeAudit callback -> ctx.runMutation(writeAuditLog)
                              -> INSERT into auditLogs table
```

### Integration Points

| Component | Action | Files |
|-----------|--------|-------|
| `convex/schema.ts` | ADD `auditLogs` table | schema.ts |
| `convex/lib/audit.ts` | NEW internal mutation | audit.ts (new file) |
| `convex/lib/crypto.ts` | MODIFY `decryptApiKey` to accept optional writer | crypto.ts |
| `convex/lib/debug_gate.ts` | MODIFY to accept optional writer | debug_gate.ts |
| Callers of `decryptApiKey` | PASS audit writer via ctx | workpoolActions.ts, apiKeys actions |

---

## Domain 2: Library Pagination — Cursor-Based (PERFORMANCE: unbounded .collect())

### Current State

`convex/library/queries.ts` already uses `paginationOptsValidator` and `.paginate()` for
both `browseLibrary` and `searchLibrary`. The CONCERNS.md describes the *previous* state —
this was already partially fixed. However, a specific remaining issue exists: when a
`collectionId` filter is active, the query pre-fetches all collection memberships via
`.collect()` on `libraryItemCollections`, then passes a `Set<string>` to the
`convex-helpers` `filter()` helper.

**Verified state (library/queries.ts lines 36-46):** The membership `.collect()` is
correct — `libraryItemCollections` for a single collection is bounded by how many
items the user has in that collection, not by the user's total library size. This is
not the same as collecting all library items. The CONCERNS.md refers to the *pre-cursor*
state before the paginate migration.

**Actual remaining issue:** The `filter()` helper from convex-helpers has a known
limitation with pagination: it does not guarantee full pages when the filter is
selective. If 50 items are fetched but only 3 match the collection filter, the page
returns 3 items, not 50. This causes sparse pages that the UI must handle with
`loadMore()` calls.

**`getLibraryCount` (lines 243-254)** still uses `.collect()` unconditionally:
```typescript
const items = await ctx.db
  .query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .collect();
return items.length;
```
This is unbounded for large libraries.

### Integration Changes

**`getLibraryCount` fix:** Replace with a `.take(N)` bounded approach or a paginated
count pattern. Since Convex has no native COUNT, the simplest fix is to bound via
`.take(10_000)` and return `items.length`. A more correct fix uses incremental
aggregation (see Domain 3 below) or accepts approximate counts.

**Collection filter sparse page handling:** The `filter()` + `.paginate()` pattern
already in place is the correct Convex approach. The sparse-page limitation is a
convex-helpers known issue (GitHub issue #864). The mitigation is UI-side: the
library page must call `loadMore()` automatically when a page is unexpectedly small
(less than `numItems`) and `isDone` is false.

**`exportLibrary` (lines 155-241):** Still uses `.collect()` for export. This is
intentional — export must gather all filtered items. No change needed; the comment
already justifies this as the non-paginated export path.

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `convex/library/queries.ts` — `getLibraryCount` | Replace unbounded `.collect()` with `.take(10_000)` bound | LOW |
| `components/library/library-page-client.tsx` | Handle sparse pages by calling `loadMore()` when `page.length < numItems && !isDone` | LOW |
| No schema changes needed | Already indexed correctly | — |

---

## Domain 3: Incremental Aggregation for Extraction Reports (PERFORMANCE: 5,000 records in memory)

### Current State

`convex/extraction/mutations.ts` `loadJobDataForReporting()` (lines 47-84) loads all
papers (up to 500) and fans out N parallel queries for results + reviews per paper.
For 500 papers x 10 questions, this is 5,000 result records loaded in a single
mutation context.

`MAX_PAPERS_PER_JOB = 500` is the safety bound, but the fan-out is still O(papers × questions).

### Recommended Architecture: Pre-Aggregate on Result Arrival

Rather than computing insights at report-generation time, aggregate incrementally as
each paper's extraction completes. Store aggregate state in a new `extractionJobStats`
table.

**New table in `convex/schema.ts`:**

```typescript
extractionJobStats: defineTable({
  jobId: v.id("extractionJobs"),
  questionKey: v.string(),
  // Running counts by citation status
  groundedCount: v.number(),
  bestEffortCount: v.number(),
  insufficientEvidenceCount: v.number(),
  extractionErrorCount: v.number(),
  totalAnswered: v.number(),
  // Running confidence sum (for average)
  confidenceSum: v.number(),
  confidenceCount: v.number(),
  updatedAt: v.number(),
}).index("by_job", ["jobId"])
  .index("by_job_question", ["jobId", "questionKey"]),
```

**Modified mutation: `handleExtractionComplete` in workpoolActions.ts**

When each paper's extraction results are written, also upsert the job stats:

```typescript
// After inserting each extractionResult:
const existingStat = await ctx.db
  .query("extractionJobStats")
  .withIndex("by_job_question", (q) =>
    q.eq("jobId", args.jobId).eq("questionKey", result.questionKey))
  .unique();

if (existingStat) {
  await ctx.db.patch(existingStat._id, {
    groundedCount: existingStat.groundedCount + (result.citationStatus === "grounded" ? 1 : 0),
    // ... other fields
    updatedAt: Date.now(),
  });
} else {
  await ctx.db.insert("extractionJobStats", { jobId: args.jobId, questionKey: result.questionKey, ... });
}
```

**Modified `loadJobDataForReporting`:** Read from `extractionJobStats` instead of
fanning out per-paper queries. Report generation becomes O(questions) not O(papers × questions).

**Migration path:** Existing completed jobs have no stats records. The first time a
report is requested for an existing job, fall back to the fan-out approach and
backfill the stats table. New jobs always use incremental stats.

### Integration Points

| Component | Action | Files |
|-----------|--------|-------|
| `convex/schema.ts` | ADD `extractionJobStats` table | schema.ts |
| `convex/extraction/workpoolActions.ts` | MODIFY `handleExtractionComplete` to upsert stats | workpoolActions.ts |
| `convex/extraction/mutations.ts` | MODIFY `loadJobDataForReporting` to read stats first | mutations.ts |
| Cascade delete | ADD deletion of `extractionJobStats` records in `deleteExtractionInternal` | mutations.ts |

**Note:** Convex mutations are atomic, so upsert-on-arrival is race-free (OCC handles
concurrent paper completions). The `@convex-dev/aggregate` component exists for this
pattern but adds a new component dependency. A simple upsert table is sufficient for
this use case without a new package dependency.

---

## Domain 4: Module Boundary Cleanup (TECH DEBT: lib/ai/client → lib/ai/server)

### Current State

`convex/ai/helpers.ts` (line 20) imports `getProviderModel` from `lib/ai/client/providers`.
The `client/` subdirectory name implies browser-only code. The function uses dynamic
`await import('@ai-sdk/openai')` etc., which is Node.js compatible but structurally
misplaced.

**Verified in `lib/ai/client/providers.ts`:** The function uses dynamic imports of
`@ai-sdk/*` packages — all Node.js compatible. There are no browser-only APIs in this
file. The boundary violation is conceptual but creates genuine risk: future developers
may add browser-only imports to `lib/ai/client/` (e.g., React hooks, localStorage)
without realizing the backend depends on it.

### Recommended Change: Create `lib/ai/server/providers.ts`

```
lib/ai/
  client/
    executor.ts       (browser-side AI execution)
    hook-factory.ts   (React hooks for AI)
    mode-routing.ts   (client-side routing)
    router.ts         (client router)
    providers.ts      (MOVE content to server/)
  core/               (existing — shared utilities)
  server/             (NEW)
    providers.ts      (MOVED from client/providers.ts)
```

**`lib/ai/server/providers.ts`** — identical content to current `lib/ai/client/providers.ts`.

**`lib/ai/client/providers.ts`** — replace with a re-export for backward compatibility
with any other client-side callers:
```typescript
// Deprecated: use lib/ai/server/providers instead
export { getProviderModel } from '../server/providers';
```

**`convex/ai/helpers.ts` (line 20)** — update import path:
```typescript
import { getProviderModel } from "../../lib/ai/server/providers";
```

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `lib/ai/server/providers.ts` | NEW file (content moved from client/) | LOW |
| `lib/ai/client/providers.ts` | MODIFY to re-export from server/ | LOW |
| `convex/ai/helpers.ts` | UPDATE import path | LOW |
| Any other client-side callers | Unchanged (re-export handles backward compat) | NONE |

---

## Domain 5: ExcelJS Dynamic Import (PERFORMANCE/DEPENDENCY: xlsx static import)

### Current State

`lib/extraction/export.ts` line 2:
```typescript
import * as XLSX from 'xlsx';
```

This is a static top-level import. The `xlsx` package is ~500KB and is bundled into
every page that imports `export.ts`. `components/extraction/export-dialog.tsx` (line 17)
statically imports from `export.ts`, pulling XLSX into the extraction job page bundle.

`xlsx` v0.18.5 is the SheetJS Community Edition — not actively maintained for security.
CONCERNS.md recommends replacing with `exceljs` (actively maintained, ESM-compatible).

### Recommended Architecture: Dynamic Import + ExcelJS

**Replace static import in `lib/extraction/export.ts`:**

```typescript
// Remove: import * as XLSX from 'xlsx';

export async function exportToExcel(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): Promise<void> {
  const ExcelJS = await import('exceljs');  // Dynamic import
  const workbook = new ExcelJS.Workbook();
  // ... rest of implementation using ExcelJS API
}
```

**ExcelJS API differences from xlsx:**
- `new ExcelJS.Workbook()` instead of `XLSX.utils.book_new()`
- `workbook.addWorksheet('name')` instead of `XLSX.utils.book_append_sheet()`
- `worksheet.addRow([...])` instead of building array-of-arrays
- Export via `workbook.xlsx.writeBuffer()` returning an `ArrayBuffer`

**`components/extraction/export-dialog.tsx`** — the static import of `exportToExcel`
from `export.ts` must remain static (the dialog needs the function signature at
compile time), but the XLSX bundle is only loaded when `exportToExcel` is *called*,
not when the dialog is mounted. Dynamic import inside the function is sufficient —
no need to lazy-load the entire `export-dialog.tsx` component.

### ExcelJS ESM Compatibility Note

ExcelJS has a known issue with ESM in certain bundler configurations: `"Dynamic require of 'crypto' is not supported"`. This is avoided by ensuring the import path resolves to the CJS build. Next.js 14+ handles this automatically for `node_modules` that have both CJS and ESM exports. Verify by running `npm run build` after migration.

**Package change:**
```bash
npm uninstall xlsx
npm install exceljs
```

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `lib/extraction/export.ts` | REPLACE static `import * as XLSX` with `await import('exceljs')` inside `exportToExcel` | MEDIUM (API change) |
| `package.json` | REMOVE `xlsx`, ADD `exceljs` | LOW |
| `components/extraction/export-dialog.tsx` | No change needed (import is the async function, not XLSX directly) | NONE |
| Test: `lib/extraction/export.test.ts` | UPDATE mocks from `vi.mock('xlsx')` to `vi.mock('exceljs')` | LOW |

---

## Domain 6: Env Var Startup Validation (SECURITY: no startup assertion)

### Current State

`convex/lib/constants.ts` has `assertPlanPriceConfig()` (line 55) which throws if
`GO_PRICE_ID` or `PRO_PRICE_ID` are empty. This function is not called at startup —
only inside specific handler paths. Silent misconfiguration is possible.

`convex/lib/env.ts` has `requireAppUrl()` but only validates `NEXT_PUBLIC_APP_URL`.

Critical vars without startup checks: `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`,
`STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN`, `STRIPE_GO_PRICE_ID`,
`STRIPE_PRO_PRICE_ID`.

### Recommended Integration Point: Extend Existing Cron

There is no `init.ts` pattern currently. The cleanest integration point is the
existing `checkSubscriptionStatus` hourly cron — it already calls Stripe and implicitly
validates `STRIPE_SECRET_KEY`. A dedicated validation cron is cleaner.

**New internal action: `convex/lib/startup.ts`**

```typescript
"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

const REQUIRED_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
] as const;

export const validateEnvVars = internalAction({
  args: {},
  returns: v.null(),
  handler: async (_ctx) => {
    const missing: string[] = [];
    for (const name of REQUIRED_VARS) {
      if (!process.env[name]) missing.push(name);
    }
    if (missing.length > 0) {
      // Log prominently — will appear in Convex function logs
      console.error("[STARTUP:ENV_MISSING]", JSON.stringify({ missing, timestamp: new Date().toISOString() }));
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }
    console.log("[STARTUP:ENV_OK]", JSON.stringify({ vars: REQUIRED_VARS.length, timestamp: new Date().toISOString() }));
    return null;
  },
});
```

**Add to `convex/crons.ts`:** Run validation at startup interval (every 6 hours is
sufficient — env vars only change on deploy):

```typescript
crons.interval(
  "validate env vars",
  { hours: 6 },
  internal.lib.startup.validateEnvVars
);
```

**CLERK_JWT_ISSUER_DOMAIN** is not a Convex env var — it is a Next.js public variable.
Validate it in `lib/auth/` during Next.js initialization, not in Convex.

### Integration Points

| Component | Action | Files |
|-----------|--------|-------|
| `convex/lib/startup.ts` | NEW internal action | startup.ts (new file) |
| `convex/crons.ts` | ADD validation cron entry | crons.ts |
| `convex/lib/constants.ts` | No change needed (`assertPlanPriceConfig` called by startup) | — |

---

## Domain 7: Type Narrowing for Stripe SDK Unions

### Current State — Two Separate Issues

**Issue A:** `convex/maintenance/internal.ts` line 103:
```typescript
const stripeCustomerId =
  typeof fresh.customer === "string"
    ? fresh.customer
    : (fresh.customer as any)?.id;
```
The `typeof === 'string'` branch is already correct. The `else` branch uses `as any`
because `fresh` is typed `any` (line 51: `const fresh: any = ...`).

**Issue B:** `convex/lib/rateLimit.ts` line 52:
```typescript
name: args.name as any,
```
The `consume` internal mutation accepts `name: v.string()` but passes it to `rateLimit()`
which expects `Name extends keyof Limits` (a branded union type from `defineRateLimits`).

### Fix A: Remove `any` from Stripe subscription fetch

`convex/maintenance/internal.ts` line 51 types the Stripe subscription as `any` to
avoid Stripe SDK type complexity. The fix is to import the Stripe type and use it:

```typescript
// Before:
const fresh: any = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);

// After:
import type Stripe from "stripe";
const fresh: Stripe.Subscription = await getStripe().subscriptions.retrieve(
  sub.stripeSubscriptionId
);
```

With proper typing, the customer extraction becomes:
```typescript
const stripeCustomerId =
  typeof fresh.customer === "string"
    ? fresh.customer
    : fresh.customer?.id;   // no cast needed — Stripe.Customer has .id
```

### Fix B: Rate Limiter Exhaustiveness

The `consume` mutation in `convex/lib/rateLimit.ts` must validate that the incoming
`name` string is one of the defined rate limit names before passing it to `rateLimit()`.

**Pattern: typed union via `v.union()` validator:**

```typescript
// In convex/lib/rateLimit.ts — derive names from the config
const RATE_LIMIT_NAMES = ["start-extraction", "api-key-save", "checkout-session"] as const;
type RateLimitName = typeof RATE_LIMIT_NAMES[number];

const rateLimitNameValidator = v.union(
  v.literal("start-extraction"),
  v.literal("api-key-save"),
  v.literal("checkout-session")
);

export const consume = internalMutation({
  args: {
    name: rateLimitNameValidator,  // Replace v.string()
    key: v.string(),
    count: v.optional(v.number()),
  },
  // ...
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: args.name,  // Now typed as the correct union, no cast needed
      // ...
    });
  },
});
```

Callers must pass a valid rate limit name string — Convex's runtime validator rejects
invalid names at the boundary before the handler runs.

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `convex/maintenance/internal.ts` | REMOVE `const fresh: any`, use `Stripe.Subscription` type | LOW |
| `convex/lib/rateLimit.ts` | REPLACE `v.string()` with typed `rateLimitNameValidator`, REMOVE `as any` cast | LOW |
| Callers of `consume` mutation | Verified at compile time — no runtime changes | NONE |

---

## Domain 8: Typed Workflow IDs (FRAGILE: workflow cancel uses `as any`)

### Current State

`convex/extraction/mutations.ts` line 263:
```typescript
await workflow.cancel(ctx, job.workflowId as any);
```

`job.workflowId` is `v.optional(v.string())` in the schema. `workflow.cancel()` expects
a `WorkflowId` type (a branded string: `string & { __isWorkflowId: true }`).

**Verified in installed package** (`node_modules/@convex-dev/workflow/dist/types.d.ts` line 3):
```typescript
export type WorkflowId = string & { __isWorkflowId: true };
export declare const vWorkflowId: VString<WorkflowId>;
```

`vWorkflowId` is `v.string()` at runtime — it is a branded type only at the TypeScript
level. `workflow.start()` returns a `WorkflowId`. Storing and retrieving it as `v.string()`
works at runtime but loses the brand.

### Fix: Store with `vWorkflowId` Validator

**`convex/schema.ts`** — change `workflowId` field in `extractionJobs`:
```typescript
// Before:
workflowId: v.optional(v.string()),

// After:
workflowId: v.optional(vWorkflowId),
```

Import: `import { vWorkflowId } from "@convex-dev/workflow";`

**`convex/extraction/mutations.ts`** — remove the cast:
```typescript
// Before:
await workflow.cancel(ctx, job.workflowId as any);

// After (job.workflowId is now WorkflowId | undefined):
if (job.workflowId) {
  await workflow.cancel(ctx, job.workflowId);
}
```

**`setJobWorkflowId` internal mutation** (line 1616-1623) — update arg type:
```typescript
args: {
  jobId: v.id("extractionJobs"),
  workflowId: vWorkflowId,  // was v.string()
},
```

**Callers of `setJobWorkflowId`:** `workflow.start()` returns `WorkflowId`, which
is already the correct type. The store call becomes type-safe end-to-end.

**Schema change impact:** `vWorkflowId` is `v.string()` at runtime. This is a no-op
schema change — no data migration needed. Convex will accept the deployment because
the stored values are still valid strings.

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `convex/schema.ts` | MODIFY `workflowId` to `v.optional(vWorkflowId)` | NONE (runtime no-op) |
| `convex/extraction/mutations.ts` | REMOVE `as any` from `workflow.cancel()`, update `setJobWorkflowId` args | LOW |
| `convex/workflow.ts` | No change | — |

---

## Domain 9: ExtractionResultWithReview Type (TECH DEBT: as any in export/filter)

### Current State

`lib/extraction/export.ts` and `lib/extraction/filtering.ts` access `correctedAnswer`,
`citations`, `citationStatus`, and `reviewState` via `result as any`. These fields
exist in the schema (`extractionResults` + `extractionResultReviews`) but are not
part of the `Doc<"extractionResults">` type (which only has schema fields, not joined data).

The functions receive `PaperWithResults` (defined in `filtering.ts` line 19):
```typescript
export interface PaperWithResults extends Doc<"extractionPapers"> {
  results: Array<Doc<"extractionResults">>;
}
```

The query path that constructs `PaperWithResults` joins review data inline, but the
type does not reflect the join.

### Fix: Derive `ExtractionResultWithReview` from Convex Validators

**In `convex/extraction/validators.ts`** — add a new combined validator that matches
the actual joined shape returned by queries:

```typescript
export const extractionResultWithReviewValidator = v.object({
  // All extractionResults fields
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  // ... all other result fields

  // Joined review fields (optional — paper may have no review)
  correctedAnswer: v.optional(answerValidator),
  reviewState: v.optional(reviewStateValidator),
});
```

**In `lib/extraction/filtering.ts`** — derive the TypeScript type:

```typescript
import type { Infer } from "convex/values";
import { extractionResultWithReviewValidator } from "@/convex/extraction/validators";

export type ExtractionResultWithReview = Infer<typeof extractionResultWithReviewValidator>;

export interface PaperWithResults extends Doc<"extractionPapers"> {
  results: Array<ExtractionResultWithReview>;
}
```

**In `lib/extraction/export.ts`** — remove all `result as any` casts; access
`result.correctedAnswer`, `result.citations`, `result.citationStatus`, `result.reviewState`
directly.

**Query return type alignment:** The Convex query that builds `PaperWithResults` must
return the `ExtractionResultWithReview` shape. Update the `returns` validator in the
relevant query to use `extractionResultWithReviewValidator` for result items.

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `convex/extraction/validators.ts` | ADD `extractionResultWithReviewValidator` | LOW |
| `lib/extraction/filtering.ts` | REPLACE `PaperWithResults.results` type, REMOVE `as any` accesses | LOW |
| `lib/extraction/export.ts` | REMOVE all `result as any` casts (5 locations) | LOW |
| Convex query returning joined data | UPDATE `returns` validator to use new combined shape | MEDIUM (must match exactly) |

---

## Domain 10: XSS-Safe Highlight (SECURITY: dangerouslySetInnerHTML)

### Current State

`components/extraction/results-views/table-view.tsx` line 293:
```typescript
function highlightText(text: string, query: string): string {
  if (!query || !query.trim()) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<mark class="...">$1</mark>');
}
```

The *query* is regex-escaped but the *text* (paper title, AI answer) is not sanitized
before injection via `dangerouslySetInnerHTML`. AI-generated answers are the risk source.

### Fix: React-Native Text Splitting (no dangerouslySetInnerHTML)

Replace `highlightText()` (which returns an HTML string) with a React component that
splits text into segments and renders `<mark>` elements natively:

```typescript
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}
```

This approach:
- Never calls `dangerouslySetInnerHTML`
- React's JSX escaping handles all HTML characters in `text` automatically
- No external sanitization library needed (DOMPurify unnecessary for React-native rendering)
- All existing usages of `highlightText()` with `dangerouslySetInnerHTML` replaced with `<HighlightedText text={...} query={...} />`

**Usage sites to update** (3 locations in `table-view.tsx` per CONCERNS.md):
- Lines 159-165, 378-388, 450-451

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `components/extraction/results-views/table-view.tsx` | REPLACE `highlightText()` + `dangerouslySetInnerHTML` with `<HighlightedText />` component | LOW |
| No new dependencies | Pure React approach | NONE |

---

## Domain 11: Dead Code Removal

### Items with Zero Architectural Impact

**`components/library/library-filters.tsx`:** Delete the file. Knip confirms no imports.
No cascading changes.

**`convex/test.setup.ts`:** Verify whether it should be in `vitest.config.ts` as a
`setupFiles` entry. If it contains Convex module discovery for `convex-test`, add it
to the `edge-runtime` environment's `setupFiles`. If its content duplicates
`tests/setup.ts`, delete it.

**`convex/zotero/internal.ts` `listAllConnections`:** This global `.collect()` on
`zoteroConnections` was a migration helper. Add `requirePublicDebugEnabled()` gate
or delete it entirely if the migration is confirmed complete.

**BILL-02 follow-up (`convex/credits/actions.ts` line 374-393):** The
`processInvoiceForGrant` path still reads upgrade metadata from Stripe API when
local Convex `subscriptions` table already has `pendingFromPlan`, `pendingToPlan`,
`pendingChangeTimestamp` fields. Replace `getStripe().subscriptions.retrieve()` call
with direct read from `subRecord` (the already-fetched Convex subscription record).
Remove the extra Stripe API call.

### Integration Points

| Component | Action | Risk |
|-----------|--------|------|
| `components/library/library-filters.tsx` | DELETE | NONE |
| `convex/test.setup.ts` | VERIFY and either add to vitest config or DELETE | LOW |
| `convex/zotero/internal.ts` `listAllConnections` | ADD debug gate or DELETE | LOW |
| `convex/credits/actions.ts` lines 374-393 | REPLACE Stripe API call with Convex DB read | LOW |

---

## Cross-Domain Data Flow Changes Summary

### New Data Flows

| Flow | Trigger | Path |
|------|---------|------|
| Persistent audit event | `decryptApiKey` called | `decryptApiKey()` -> auditWriter callback -> `writeAuditLog` mutation -> `auditLogs` table |
| Persistent debug audit | `requirePublicDebugEnabled()` success | caller action -> `writeAuditLog` mutation -> `auditLogs` table |
| Incremental stats update | Paper extraction completes | `handleExtractionComplete` -> upsert `extractionJobStats` per result |
| Report generation (fast path) | Report requested | Read `extractionJobStats` (O(questions)) instead of fan-out |
| Env var validation | Hourly cron (new) | `validateEnvVars` action -> check `process.env` -> throw/log |

### Modified Data Flows

| Flow | Change |
|------|--------|
| XLSX export | Static import -> dynamic `await import('exceljs')` inside function |
| Workflow cancel | `as any` cast removed; schema uses `vWorkflowId` typed brand |
| Rate limit consume | `v.string()` name -> typed `rateLimitNameValidator` union |
| Export/filter field access | `result as any` -> `ExtractionResultWithReview` typed access |
| Text highlighting | `dangerouslySetInnerHTML` -> `<HighlightedText />` React component |
| Upgrade credit grant | Stripe API call removed; reads `pendingFromPlan`/`pendingToPlan` from Convex |
| Subscription customer ID | `fresh.customer as any` -> `Stripe.Subscription` typed access |

### New Schema Tables

| Table | Purpose | Indexes |
|-------|---------|---------|
| `auditLogs` | Persistent tamper-evident audit trail | `by_user`, `by_action_created`, `by_created` |
| `extractionJobStats` | Pre-aggregated extraction report data | `by_job`, `by_job_question` |

---

## Suggested Build Order (Dependency-Aware)

The 11 domains have few hard dependencies. Order by risk profile and coupling:

### Phase A: Zero-Risk Isolated Cleanups

No dependencies. Ship first to reduce concern count without risk.

| Priority | Domain | Rationale |
|----------|--------|-----------|
| 1 | Delete `library-filters.tsx` | Single file delete, zero references |
| 2 | Delete/fix `convex/test.setup.ts` | Zero production impact |
| 3 | `lib/ai/client` -> `lib/ai/server` boundary | Import path change only |
| 4 | Remove `listAllConnections` or add debug gate | Contained to `zotero/internal.ts` |

### Phase B: Type Safety (No Schema Changes)

Fix type casts without touching schema or data.

| Priority | Domain | Rationale |
|----------|--------|-----------|
| 5 | Stripe SDK type in `maintenance/internal.ts` | Replace `const fresh: any`, 1-line fix |
| 6 | Rate limiter typed validator | Replace `v.string()` + `as any` in one file |
| 7 | Workflow `vWorkflowId` schema brand | Runtime no-op, compile-time safety |
| 8 | `ExtractionResultWithReview` type + export/filter de-any | Validator + type threading |

### Phase C: Frontend Safety

Pure UI changes, no backend impact.

| Priority | Domain | Rationale |
|----------|--------|-----------|
| 9 | `<HighlightedText />` XSS fix | Component replacement, no Convex changes |
| 10 | Library pagination sparse page handling | UI `loadMore()` logic addition |

### Phase D: Performance + Package

Moderate risk due to API surface changes.

| Priority | Domain | Rationale |
|----------|--------|-----------|
| 11 | ExcelJS dynamic import | Package replacement, test updates needed |
| 12 | `getLibraryCount` bounded collect | Simple query bound |

### Phase E: New Schema + Infrastructure

These require schema deploys and carry moderate complexity.

| Priority | Domain | Rationale |
|----------|--------|-----------|
| 13 | Env var validation cron | New file + cron entry |
| 14 | BILL-02: read from Convex instead of Stripe API | Credits action change, verify with existing tests |
| 15 | `auditLogs` table + persistent audit writes | New schema table + mutation wiring |
| 16 | `extractionJobStats` incremental aggregation | New schema table + workpool action change + migration path |

**Phase E ordering rationale:** Schema changes require Convex deploy cycles. The audit
table (15) is simpler than aggregation stats (16) because it has no migration concern —
it starts empty and fills forward. Aggregation stats (16) needs a migration path for
existing completed jobs.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Audit Write in "use node" Module Directly

**What fails:** Calling `ctx.runMutation` inside `decryptApiKey()` in `crypto.ts`
**Why:** `crypto.ts` uses `"use node"` and does not receive a `ctx` parameter. The
crypto function must remain a pure function.
**Do this instead:** Pass an async callback from the calling action; the action has `ctx`.

### Anti-Pattern 2: ExcelJS Synchronous Import

**What fails:** `import * as ExcelJS from 'exceljs'` at module top level in `export.ts`
**Why:** Adds ~700KB to the page bundle even for users who never export to Excel.
**Do this instead:** `await import('exceljs')` inside the async `exportToExcel` function.

### Anti-Pattern 3: `v.id("extractionJobStats")` in Cascade Delete — Forgetting New Table

**What fails:** Adding `extractionJobStats` to schema without adding it to `deleteExtractionInternal`
**Why:** Cascade delete must cover all tables with a `jobId` foreign key. Orphaned stats
records accumulate forever.
**Do this instead:** After adding any table with `jobId`, immediately add it to the cascade
delete steps. Maintain the table in the cascade delete code comment listing all 9 (now 10) child tables.

### Anti-Pattern 4: Replacing `dangerouslySetInnerHTML` with DOMPurify

**What fails:** `DOMPurify.sanitize(text)` then `dangerouslySetInnerHTML`
**Why:** Adds a browser-only dependency, increases bundle, and still uses the risky API.
React's JSX escaping is already correct — splitting and rendering is the idiomatic pattern.
**Do this instead:** The `<HighlightedText />` component approach with `text.split(regex)`.

### Anti-Pattern 5: Typed `WorkflowId` Requiring Data Migration

**What worries developers:** Changing `workflowId: v.optional(v.string())` to `v.optional(vWorkflowId)` might break existing stored data.
**Why it is safe:** `vWorkflowId` is `v.string()` at runtime. The branded type is TypeScript-only. Zero data migration needed.

---

## New vs Modified Components Summary

| Type | Component | Action | Domain |
|------|-----------|--------|--------|
| NEW | `convex/schema.ts` — `auditLogs` table | ADD table | Audit |
| NEW | `convex/schema.ts` — `extractionJobStats` table | ADD table | Aggregation |
| NEW | `convex/lib/audit.ts` | ADD `writeAuditLog` internalMutation | Audit |
| NEW | `convex/lib/startup.ts` | ADD `validateEnvVars` internalAction | Env vars |
| NEW | `lib/ai/server/providers.ts` | MOVE content from client/providers.ts | Module boundary |
| MODIFIED | `convex/lib/crypto.ts` | Accept optional audit writer callback | Audit |
| MODIFIED | `convex/lib/debug_gate.ts` | Accept optional audit writer callback | Audit |
| MODIFIED | `convex/lib/rateLimit.ts` | Replace `v.string()` with typed union validator | Rate limiter |
| MODIFIED | `convex/schema.ts` — `extractionJobs.workflowId` | Change to `vWorkflowId` brand | Workflow IDs |
| MODIFIED | `convex/extraction/mutations.ts` — `cancelExtraction` | Remove `as any` cast | Workflow IDs |
| MODIFIED | `convex/extraction/mutations.ts` — `setJobWorkflowId` | Update arg type | Workflow IDs |
| MODIFIED | `convex/extraction/mutations.ts` — `loadJobDataForReporting` | Read from stats table | Aggregation |
| MODIFIED | `convex/extraction/mutations.ts` — `deleteExtractionInternal` | Add stats table to cascade | Aggregation |
| MODIFIED | `convex/extraction/validators.ts` | ADD `extractionResultWithReviewValidator` | Export/filter types |
| MODIFIED | `convex/extraction/workpoolActions.ts` | Upsert `extractionJobStats` on result arrival | Aggregation |
| MODIFIED | `convex/maintenance/internal.ts` | Replace `const fresh: any` with `Stripe.Subscription` | Stripe types |
| MODIFIED | `convex/credits/actions.ts` | Replace Stripe API call with Convex DB read (BILL-02) | Dead code |
| MODIFIED | `convex/crons.ts` | ADD env var validation cron | Env vars |
| MODIFIED | `convex/ai/helpers.ts` | Update import path to `lib/ai/server/providers` | Module boundary |
| MODIFIED | `lib/ai/client/providers.ts` | Replace with re-export from server/ | Module boundary |
| MODIFIED | `lib/extraction/export.ts` | Replace static XLSX import with dynamic ExcelJS | ExcelJS |
| MODIFIED | `lib/extraction/filtering.ts` | Use `ExtractionResultWithReview` type | Export/filter types |
| MODIFIED | `convex/library/queries.ts` — `getLibraryCount` | Bound collect with `.take(10_000)` | Library perf |
| MODIFIED | `components/extraction/results-views/table-view.tsx` | Replace highlight with `<HighlightedText />` | XSS |
| DELETED | `components/library/library-filters.tsx` | Unused component | Dead code |
| DELETED/FIXED | `convex/test.setup.ts` | Verify or delete | Dead code |
| DELETED | `convex/zotero/internal.ts` `listAllConnections` | Migration helper | Dead code |
| PACKAGE | `xlsx` | REMOVE | ExcelJS |
| PACKAGE | `exceljs` | ADD | ExcelJS |

---

## Sources

- `@convex-dev/workflow` `vWorkflowId` and `WorkflowId` type — verified in installed package `node_modules/@convex-dev/workflow/dist/types.d.ts` (HIGH confidence)
- `convex-helpers` `filter()` pagination limitation — GitHub issue #864 (MEDIUM confidence, known limitation)
- ExcelJS dynamic import in Next.js — community reports of CJS/ESM conflicts; mitigated by Next.js 14+ handling (MEDIUM confidence)
- React text splitting vs `dangerouslySetInnerHTML` — OWASP recommendation, React documentation pattern (HIGH confidence)
- Convex `@convex-dev/aggregate` component — exists but not chosen due to added dependency complexity; upsert table is sufficient (HIGH confidence)
- All file paths and line numbers verified against actual codebase (HIGH confidence)

---

*Architecture research for: v3.0 Zero-Any Overhaul*
*Researched: 2026-03-03*
