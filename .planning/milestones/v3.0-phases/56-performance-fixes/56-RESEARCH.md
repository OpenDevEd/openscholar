# Phase 56: Performance Fixes - Research

**Researched:** 2026-03-04
**Domain:** Convex query optimization, dynamic JS imports, cron batching patterns, migration cleanup
**Confidence:** HIGH

## Summary

Phase 56 addresses four independent performance concerns plus one test requirement. Each fix targets a specific file and concern documented in CONCERNS.md. The fixes are: (1) bounding the `getLibraryCount` query to avoid a full table scan, (2) migrating from the unmaintained `xlsx` package to `exceljs` with a dynamic import to eliminate ~500KB from the initial bundle, (3) restructuring the subscription status cron to use cursor-based self-scheduling with a circuit-breaker to prevent Stripe rate limit exhaustion at scale, and (4) removing or gating the `listAllConnections` migration helper that performs an unbounded table scan on `zoteroConnections`.

All four fixes are independent of each other and can be implemented in any order. The codebase already contains the exact self-scheduling batch pattern needed for the cron fix (in `cleanupDeletedUsers` in `convex/maintenance/mutations.ts`). The ExcelJS migration is the highest-effort item because it involves a full API rewrite from `xlsx`'s array-of-arrays style to ExcelJS's builder pattern, plus a mandatory round-trip test (TEST-05). The library count fix and migration helper cleanup are both trivial one-line or few-line changes.

**Primary recommendation:** Start with the trivial fixes (PERF-01, PERF-05), then implement the cron batching (PERF-04), and save ExcelJS migration (PERF-03 + TEST-05) for last since it has the highest API surface change and requires the round-trip test.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | Fix `getLibraryCount` unbounded `.collect()` in `convex/library/queries.ts` with bounded `.take()` or proper count query | Direct code inspection: lines 243-254 use `.collect()` on `by_user` index. Replace with `.take(10_000).length` to bound the scan. Existing tests in `convex/library/queries.test.ts` lines 356-407 cover correctness -- the bounded version must pass the same three tests. |
| PERF-03 | Replace static `xlsx` import with dynamic `import('exceljs')` in export handler; migrate from `xlsx` to `exceljs` API | Current code: `import * as XLSX from 'xlsx'` at line 2 of `lib/extraction/export.ts`. ExcelJS 4.4.0 is the standard replacement. API mapping documented below. The `exportToExcel` function must become async. `export-dialog.tsx` already calls this -- signature change propagates there. |
| PERF-04 | Implement subscription cron batching with cursor-based self-scheduling and 45s circuit-breaker | Current `checkSubscriptionStatus` in `convex/maintenance/internal.ts` iterates all active subs (up to 1000 via `listActiveSubscriptions`) sequentially with Stripe API calls. Refactor to process in batches of 50-100 with `ctx.scheduler.runAfter(0, ...)` continuation. Pattern already exists in `cleanupDeletedUsers`. |
| PERF-05 | Remove or gate `listAllConnections` migration helper in `convex/zotero/internal.ts` | The function at lines 42-52 does an unbounded `.collect()` on `zoteroConnections`. It is called only by `migrateToEncryptedKeys` in `convex/zotero/actions.ts` line 1134. Migration is complete (all rows have `encryptedApiKey`). Either delete both the helper and its caller, or gate behind `requirePublicDebugEnabled()`. |
| TEST-05 | Add round-trip ExcelJS export test (generate XLSX, parse back, assert headers and row values) | The test must use ExcelJS itself (or a reader) to parse the generated buffer back and verify sheet names, headers, and cell values. vitest is the test runner. Test goes in `tests/` directory following existing naming convention. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | ^1.31.7 | Query bounding (`.take()`), cron self-scheduling (`ctx.scheduler.runAfter`) | Already installed; all four fixes use Convex APIs |
| ExcelJS | 4.4.0 | XLSX generation replacing `xlsx` | Actively maintained, ESM-compatible in Next.js server context, full XLSX read/write. Replaces stagnant `xlsx@0.18.5` with known CVEs |
| vitest | ^3.2.4 | Round-trip ExcelJS test | Already the project test runner |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex-test | ^0.0.41 | Convex function unit tests (if testing bounded query) | Already used for `getLibraryCount` tests in `convex/library/queries.test.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ExcelJS | `write-excel-file` | Write-only, no read capability for round-trip testing, less cell formatting control |
| ExcelJS | Keep `xlsx` with dynamic import only | Fixes bundle size but leaves known CVE exposure; `xlsx` 0.18.5 is stagnant |
| Deleting `listAllConnections` | Gating behind debug check | Deletion is simpler and more secure; migration is confirmed complete, no future use case |

**Installation:**
```bash
npm uninstall xlsx
npm install exceljs
```

## Architecture Patterns

### Recommended Project Structure
```
convex/library/
└── queries.ts                    # MODIFY: getLibraryCount .collect() -> .take(10_000)

lib/extraction/
└── export.ts                     # MODIFY: remove static xlsx import, async exportToExcel with dynamic import('exceljs')

components/extraction/
└── export-dialog.tsx             # MODIFY: await the now-async exportToExcel call

convex/maintenance/
└── internal.ts                   # MODIFY: checkSubscriptionStatus with cursor-based batching

convex/zotero/
├── internal.ts                   # MODIFY: remove listAllConnections
└── actions.ts                    # MODIFY: remove migrateToEncryptedKeys (or gate both)

tests/
└── export-exceljs-roundtrip.test.ts  # NEW: round-trip ExcelJS test
```

### Pattern 1: Bounded Count Query
**What:** Replace `.collect().length` with `.take(N).length` to cap the documents loaded into memory.
**When to use:** Any query that only needs a count, not the actual documents.
**Example:**
```typescript
// convex/library/queries.ts -- getLibraryCount
export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(10_000); // Bounded -- no full table scan
    return items.length;
  },
});
```
**Why 10,000:** Large enough to never truncate a real user's library (current product supports ~1024 items with `.collect()` default, but `.take()` has no such ceiling and is explicit about its bound). Small enough to prevent runaway memory use.

### Pattern 2: Dynamic Import for Heavy Libraries
**What:** Move large library imports inside the function body using `await import(...)` so they are only loaded when actually needed.
**When to use:** Any dependency > 100KB that is not needed on initial page load.
**Example:**
```typescript
// lib/extraction/export.ts
export async function exportToExcel(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const resultsSheet = workbook.addWorksheet('Results');

  // Add header row
  const headers = ['Title', 'DOI', 'Year', /* ... */];
  resultsSheet.addRow(headers);

  // Add data rows
  for (const paper of papers) {
    resultsSheet.addRow([paper.title, paper.doi || '', /* ... */]);
  }

  // Generate and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `extraction-results-${Date.now()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

### Pattern 3: Cursor-Based Self-Scheduling Cron
**What:** Process a batch of items, then schedule the next batch via `ctx.scheduler.runAfter(0, ...)` with a cursor. Include a time-budget circuit-breaker.
**When to use:** Any cron job that processes an unbounded number of items, especially when each item triggers an external API call (Stripe).
**Example:**
```typescript
// convex/maintenance/internal.ts
export const checkSubscriptionStatus = internalAction({
  args: {
    cursor: v.optional(v.string()), // Convex cursor for pagination
    startedAt: v.optional(v.number()), // Epoch ms when the top-level run began
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertPlanPriceConfig();
    const startedAt = args.startedAt ?? Date.now();
    const CIRCUIT_BREAKER_MS = 45_000;
    const BATCH_SIZE = 50;

    // Step 1: Expire past-due (mutation, runs once per top-level invocation)
    if (!args.cursor) {
      await ctx.runMutation(internal.maintenance.mutations.expirePastDueSubscriptions);
    }

    // Step 2: Fetch a batch of active subs
    // (listActiveSubscriptions needs to accept cursor + limit args)
    const batch = await ctx.runQuery(
      internal.subscriptions.internal.listActiveSubscriptionsBatch,
      { cursor: args.cursor, limit: BATCH_SIZE }
    );

    // Step 3: Process each sub in the batch
    for (const sub of batch.subs) {
      // Circuit-breaker: stop if approaching time limit
      if (Date.now() - startedAt > CIRCUIT_BREAKER_MS) {
        console.warn('[checkSubscriptionStatus] Circuit-breaker hit, scheduling remainder');
        await ctx.scheduler.runAfter(0, internal.maintenance.internal.checkSubscriptionStatus, {
          cursor: batch.nextCursor,
          startedAt: Date.now(), // Reset timer for next batch
        });
        return null;
      }

      // ... Stripe API call and divergence correction (same as current logic)
    }

    // Step 4: If more batches exist, schedule continuation
    if (!batch.isDone && batch.nextCursor) {
      await ctx.scheduler.runAfter(0, internal.maintenance.internal.checkSubscriptionStatus, {
        cursor: batch.nextCursor,
        startedAt,
      });
    }

    return null;
  },
});
```

### Pattern 4: Migration Helper Cleanup
**What:** Remove migration helpers after confirming the migration is complete.
**When to use:** When a one-time migration has been fully executed and verified.
**Example:**
```typescript
// convex/zotero/internal.ts -- DELETE listAllConnections entirely
// convex/zotero/actions.ts -- DELETE migrateToEncryptedKeys entirely (or gate behind debug check)
```

### Anti-Patterns to Avoid
- **Using `.collect()` for count-only queries:** Always use `.take(N)` when you only need the length. `.collect()` has no explicit bound and loads all documents.
- **Static imports for large optional libraries:** ExcelJS (~1.5MB uncompressed) should never be imported at module level. Use `await import('exceljs')` inside the handler.
- **Processing unbounded items in a single cron run:** Always implement cursor-based batching with a time-budget circuit-breaker for crons that make external API calls.
- **Leaving migration helpers deployed permanently:** Migration functions that perform full table scans should be removed once the migration is verified complete.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XLSX generation | Custom binary XLSX builder | ExcelJS `Workbook` + `writeBuffer()` | XLSX is a complex ZIP-based format; hand-rolling guarantees corrupt files |
| Cron batching/continuation | Custom scheduler with setTimeout | `ctx.scheduler.runAfter(0, ...)` Convex pattern | Convex guarantees scheduled function execution; setTimeout does not survive action termination |
| Count query optimization | Denormalized counter field + increment/decrement | `.take(N).length` on indexed query | Counter fields require careful consistency management on every insert/delete; `.take()` is correct and simple for libraries under 10k items |

**Key insight:** Every fix in this phase has an existing codebase pattern or direct API support. No new architectural patterns are needed.

## Common Pitfalls

### Pitfall 1: ExcelJS Default Export vs Named Export
**What goes wrong:** `const ExcelJS = await import('exceljs')` may return a module object where the `Workbook` class is at `.default` or at the top level depending on the bundler configuration.
**Why it happens:** ExcelJS is CJS internally; dynamic import in ESM context wraps CJS exports in a `default` property.
**How to avoid:** Test both paths. The safe pattern is:
```typescript
const mod = await import('exceljs');
const ExcelJS = 'default' in mod ? mod.default : mod;
const workbook = new ExcelJS.Workbook();
```
Or more directly: `const { Workbook } = await import('exceljs');`
**Warning signs:** `TypeError: ExcelJS.Workbook is not a constructor` at runtime.

### Pitfall 2: exportToExcel Becoming Async Breaks Call Sites
**What goes wrong:** `exportToExcel` is currently synchronous (returns `void`). Making it async (returns `Promise<void>`) requires all call sites to `await` it or handle the promise.
**Why it happens:** The dynamic import forces the function to be async.
**How to avoid:** Check `export-dialog.tsx` line 17 where `exportToExcel` is imported and called. The call site must become `await exportToExcel(...)`. Since the export dialog handler is likely already async (click handlers), this is straightforward but must not be missed.
**Warning signs:** Export silently fails with no download and no error (unhandled promise rejection).

### Pitfall 3: Circuit-Breaker Time Budget Miscalculation
**What goes wrong:** The 45s circuit-breaker fires before processing any subscriptions because `startedAt` is not properly passed through self-scheduling continuations.
**Why it happens:** Forgetting to pass `startedAt` in the scheduler args, causing each continuation to re-read `Date.now()` and think it has a fresh 45s budget (the opposite problem: circuit-breaker never fires).
**How to avoid:** Always pass `startedAt` from the original invocation. Reset it only when the circuit-breaker fires (to give the next scheduled run a fresh budget).
**Warning signs:** Cron logs show either "circuit-breaker hit" on every run (budget too aggressive) or processes all 1000+ subs in one run (budget never fires).

### Pitfall 4: Removing listAllConnections While migrateToEncryptedKeys Still References It
**What goes wrong:** Deleting `listAllConnections` from `convex/zotero/internal.ts` without also removing the `migrateToEncryptedKeys` action in `convex/zotero/actions.ts` causes a compilation error: the import `internal.zotero.internal.listAllConnections` no longer exists.
**Why it happens:** Incomplete cleanup -- removing the dependency without removing the dependent.
**How to avoid:** Delete both `listAllConnections` (internal.ts line 42-52) and `migrateToEncryptedKeys` (actions.ts lines 1113-1150) together. Run `npx convex typecheck` after to verify no broken references.
**Warning signs:** TypeScript compilation error on `internal.zotero.internal.listAllConnections`.

### Pitfall 5: ExcelJS writeBuffer() Returns ArrayBuffer, Not Buffer
**What goes wrong:** Code treats the return value of `workbook.xlsx.writeBuffer()` as a Node.js `Buffer` instead of an `ArrayBuffer`.
**Why it happens:** API confusion between Node.js Buffer and browser ArrayBuffer.
**How to avoid:** In the browser context (which `export.ts` runs in), `writeBuffer()` returns an `ArrayBuffer` suitable for `new Blob([buffer])`. In the test (Node.js context), it returns a `Buffer`. Both are valid for `new Blob()`, but be explicit about the type.
**Warning signs:** Empty or truncated XLSX downloads.

## Code Examples

### Current getLibraryCount (BEFORE)
```typescript
// convex/library/queries.ts lines 243-254
export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();  // UNBOUNDED -- loads all docs
    return items.length;
  },
});
```

### Fixed getLibraryCount (AFTER)
```typescript
export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(10_000);  // BOUNDED -- caps memory usage
    return items.length;
  },
});
```

### ExcelJS API Mapping (xlsx -> exceljs)
```typescript
// BEFORE (xlsx):
import * as XLSX from 'xlsx';
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(data);
XLSX.utils.book_append_sheet(workbook, sheet, 'Results');
XLSX.writeFile(workbook, 'output.xlsx');

// AFTER (exceljs):
const { Workbook } = await import('exceljs');
const workbook = new Workbook();
const sheet = workbook.addWorksheet('Results');

// Add headers
const headers = Object.keys(data[0]);
sheet.addRow(headers);

// Add data rows
for (const row of data) {
  sheet.addRow(headers.map(h => row[h]));
}

// Generate and download (browser context)
const buffer = await workbook.xlsx.writeBuffer();
const blob = new Blob([buffer], {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
});
// ... downloadFile logic
```

### ExcelJS Column-Based API (Preferred for Typed Data)
```typescript
// ExcelJS supports defining columns explicitly -- better for typed exports
const sheet = workbook.addWorksheet('Results');
sheet.columns = [
  { header: 'Title', key: 'title', width: 40 },
  { header: 'DOI', key: 'doi', width: 30 },
  { header: 'Year', key: 'year', width: 10 },
];

// Then add rows as objects matching column keys
for (const paper of papers) {
  sheet.addRow({
    title: paper.title,
    doi: paper.doi || '',
    year: paper.publicationYear || '',
  });
}
```

### Round-Trip ExcelJS Test Pattern
```typescript
// tests/export-exceljs-roundtrip.test.ts
import { describe, it, expect } from 'vitest';

describe('ExcelJS round-trip export', () => {
  it('generates valid XLSX with correct headers and data', async () => {
    const { Workbook } = await import('exceljs');

    // 1. Generate workbook using the same logic as exportToExcel
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Results');
    sheet.addRow(['Title', 'DOI', 'Year']);
    sheet.addRow(['Test Paper', '10.1234/test', '2024']);
    sheet.addRow(['Second Paper', '', '2023']);

    // 2. Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // 3. Parse back
    const parsed = new Workbook();
    await parsed.xlsx.load(buffer as Buffer);

    // 4. Assert structure
    const parsedSheet = parsed.getWorksheet('Results');
    expect(parsedSheet).toBeDefined();
    expect(parsedSheet!.rowCount).toBe(3); // header + 2 data rows

    // 5. Assert headers
    const headerRow = parsedSheet!.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Title');
    expect(headerRow.getCell(2).value).toBe('DOI');
    expect(headerRow.getCell(3).value).toBe('Year');

    // 6. Assert data
    const dataRow = parsedSheet!.getRow(2);
    expect(dataRow.getCell(1).value).toBe('Test Paper');
    expect(dataRow.getCell(2).value).toBe('10.1234/test');
  });
});
```

### Self-Scheduling Batch Pattern (Already in Codebase)
```typescript
// From convex/maintenance/mutations.ts -- cleanupDeletedUsers
// This is the exact pattern to follow for subscription cron batching:
const deletedUsers = await ctx.db
  .query("users")
  .withIndex("by_state", (q) => q.eq("state", "deleted"))
  .take(BATCH_SIZE);

// ... process batch ...

// If we fetched a full batch, there might be more to process
if (deletedUsers.length === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.maintenance.mutations.cleanupDeletedUsers, {});
}
```

### listAllConnections Current State (TO DELETE)
```typescript
// convex/zotero/internal.ts lines 42-52
export const listAllConnections = internalQuery({
  args: {},
  returns: v.array(v.object({
    _id: v.id("zoteroConnections"),
    encryptedApiKey: v.string(),
  })),
  handler: async (ctx) => {
    const all = await ctx.db.query("zoteroConnections").collect();
    return all.map((c) => ({ _id: c._id, encryptedApiKey: c.encryptedApiKey }));
  },
});
```

### migrateToEncryptedKeys Current State (TO DELETE)
```typescript
// convex/zotero/actions.ts lines 1113-1150
// The migration is a no-op (all rows have encryptedApiKey; the loop skips everything).
// Safe to remove entirely.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `xlsx` 0.18.5 (SheetJS CE) | ExcelJS 4.4.0 | October 2024 (ExcelJS v4.4.0 release) | Active maintenance, no known CVEs, ESM-aware |
| Static top-level imports for optional features | Dynamic `await import()` inside handlers | Next.js 13+ (2023) | Zero-cost until feature is used; tree-shaking compatible |
| `.collect()` for count queries | `.take(N)` bounded reads | Convex best practice | Prevents unbounded memory usage and query timeouts |
| Unbounded cron processing | Cursor-based self-scheduling + circuit-breaker | Established Convex pattern | Survives action time limits and external API rate limits |

**Deprecated/outdated:**
- `xlsx` 0.18.5: Stagnant, known prototype pollution CVEs, no ESM support. Being replaced by ExcelJS in this phase.
- `listAllConnections` + `migrateToEncryptedKeys`: One-time migration artifacts from Phase 39. Migration completed; all rows encrypted. No future use case.

## Open Questions

1. **ExcelJS CJS/ESM interop in Next.js 16 dynamic import**
   - What we know: ExcelJS 4.4.0 uses CJS internally. Next.js 14+ handles CJS-in-ESM automatically for node_modules. This project uses Next.js 16.1.6.
   - What's unclear: Whether the default export requires `.default` unwrapping in the dynamic import context of Next.js 16.
   - Recommendation: Test `const { Workbook } = await import('exceljs')` first. If it fails, fall back to `const mod = await import('exceljs'); const { Workbook } = mod.default ?? mod`. Verify with `npm run build` after migration.

2. **Subscription cron: internalAction vs internalMutation for batched version**
   - What we know: The current `checkSubscriptionStatus` is an `internalAction` (needs `process.env` for Stripe key and makes HTTP calls). Self-scheduling in an action uses `ctx.scheduler.runAfter`.
   - What's unclear: Whether to keep it as a single action that self-schedules, or split into a mutation-based batch fetcher + action-based Stripe caller.
   - Recommendation: Keep as `internalAction` with self-scheduling. The mutation split is unnecessary complexity -- the action already calls `expirePastDueSubscriptions` as a mutation for the DB writes. The Stripe calls must remain in the action context.

3. **listActiveSubscriptions pagination: new query vs modifying existing**
   - What we know: `listActiveSubscriptions` in `convex/subscriptions/internal.ts` currently uses `.take(1000)` with no cursor.
   - What's unclear: Whether to modify it to accept cursor/limit args or create a new `listActiveSubscriptionsBatch` query.
   - Recommendation: Modify the existing `listActiveSubscriptions` to accept optional `cursor` and `limit` args. Since it is only called from `checkSubscriptionStatus`, no other call sites are affected. Alternatively, keep the query as-is and implement batching purely in the action by calling with offset logic. Simplest approach: have the action fetch all subs once (the current `.take(1000)` is already bounded) and process them in batches of 50 with time-budget checks between batches, scheduling continuation with a cursor index into the array. This avoids query schema changes entirely.

## Sources

### Primary (HIGH confidence)
- `convex/library/queries.ts` lines 243-254 -- current `getLibraryCount` implementation with `.collect()`
- `lib/extraction/export.ts` lines 1-269 -- current `xlsx` import and `exportToExcel` implementation
- `convex/maintenance/internal.ts` lines 1-141 -- current `checkSubscriptionStatus` cron
- `convex/maintenance/mutations.ts` lines 11-86 -- `cleanupDeletedUsers` self-scheduling pattern
- `convex/zotero/internal.ts` lines 42-52 -- `listAllConnections` migration helper
- `convex/zotero/actions.ts` lines 1113-1150 -- `migrateToEncryptedKeys` caller of listAllConnections
- `convex/subscriptions/internal.ts` lines 187-218 -- `listActiveSubscriptions` query
- `convex/library/queries.test.ts` lines 356-407 -- existing `getLibraryCount` test suite
- `.planning/codebase/CONCERNS.md` -- performance bottleneck descriptions and improvement paths
- `.planning/REQUIREMENTS.md` -- requirement definitions for PERF-01, PERF-03, PERF-04, PERF-05, TEST-05
- `package.json` -- `xlsx@^0.18.5` listed as dependency

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` lines 390-456 -- ExcelJS dynamic import architecture research
- `.planning/research/STACK.md` lines 46-101 -- ExcelJS 4.4.0 evaluation and ESM compatibility analysis
- `.planning/research/PITFALLS.md` lines 61-77 -- ExcelJS migration pitfalls
- `.planning/research/FEATURES.md` lines 213-226 -- subscription cron batching feature spec

### Tertiary (LOW confidence)
- ExcelJS CJS/ESM dynamic import behavior in Next.js 16 specifically -- verified for Next.js 14 but not explicitly tested with 16. Risk is low (Next.js 16 maintains backward compatibility) but should be confirmed by running `npm run build` after migration.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - ExcelJS 4.4.0 is well-documented, Convex `.take()` and self-scheduling are native APIs
- Architecture: HIGH - All patterns already exist in the codebase; ExcelJS API mapping is straightforward
- Pitfalls: HIGH - Prior research (PITFALLS.md, ARCHITECTURE.md) already catalogued ExcelJS migration risks; cron batching pattern is proven in cleanupDeletedUsers

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain; ExcelJS 4.4.0 has no breaking changes planned)
