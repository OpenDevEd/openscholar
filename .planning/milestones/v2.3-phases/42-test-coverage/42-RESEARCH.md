# Phase 42: Test Coverage - Research

**Researched:** 2026-03-02
**Domain:** Automated test coverage for Convex backend cascade deletion, Zustand store migrations, and extraction insight aggregation edge cases
**Confidence:** HIGH

## Summary

Phase 42 adds automated test coverage for three previously untested subsystems: (1) the extraction job cascade delete implemented in Phase 38, (2) the Zustand `useSearchHistoryStore` migration chain (7 versions, 0-through-7), and (3) edge cases in the `aggregateQuestionInsights` pure function from `lib/extraction/insights.ts`. All three test areas build on well-established patterns already present in the codebase.

The project uses **Vitest 3.2.4** as its test runner with **convex-test 0.0.41** for Convex backend integration tests (running in `edge-runtime` environment) and standard Vitest for pure function unit tests (running in `node` environment). The existing test infrastructure is mature with 60+ test files, a setup file at `tests/setup.ts`, and `vitest.config.ts` properly configured with environment matching globs.

**Primary recommendation:** Write three test files -- one convex-test integration test for cascade delete (`convex/extraction/cascade-delete.test.ts`), one pure unit test for Zustand migration chain (`tests/store-migrations.test.ts`), and extend the existing `tests/extraction-insights.test.ts` with edge case test blocks.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Extraction cascade delete tested (including evidence units and storage) | convex-test with `finishAllScheduledFunctions` can execute the full scheduler-based cascade; `t.run()` provides direct DB access for seeding the full graph and verifying zero orphaned rows; existing `convex/library/queries.test.ts` demonstrates the established convex-test pattern |
| TEST-02 | Zustand store migration paths tested (5-version chain) | The `useSearchHistoryStore` has a `migrate` function (versions 0->7) that is a pure function accepting `(persistedState, version)` -- extractable and testable directly without DOM; each migration step adds specific fields with known defaults |
| TEST-03 | Extraction insight aggregation edge cases tested (null answers, missing fields, empty paper sets) | `aggregateQuestionInsights`, `buildDisagreementClusters`, and `buildRunDiff` are pure exported functions in `lib/extraction/insights.ts` -- directly importable and testable with crafted inputs; existing test file covers happy paths but not null/empty/missing edge cases |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 3.2.4 | Test runner and assertions | Already installed and configured in project |
| convex-test | 0.0.41 | Convex backend testing with mock DB | Already installed; provides `convexTest(schema)`, `t.run()`, `t.mutation()`, `finishAllScheduledFunctions()` |
| @edge-runtime/vm | 5.0.0 | Edge runtime environment for convex-test | Already installed; required by vitest config for `convex/**/*.test.ts` files |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/jest-dom | 6.9.1 | Extended matchers | Already in setup.ts; provides `toBeNull()` etc. but standard vitest matchers suffice for these tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| convex-test for cascade | Manual mock of ctx | convex-test provides real DB semantics including indexes and scheduler -- far more reliable |
| Testing migrations via store hydration | Testing migrate function directly | Direct function testing is simpler, faster, and doesn't require DOM/localStorage mocking |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Test File Structure
```
convex/
  extraction/
    cascade-delete.test.ts    # TEST-01: convex-test integration (edge-runtime)
tests/
  store-migrations.test.ts    # TEST-02: pure unit test (node environment)
  extraction-insights.test.ts # TEST-03: extend existing file with edge cases
```

### Pattern 1: Convex-Test Integration Test for Cascade Delete
**What:** Use `convex-test` to seed a full extraction job graph (job + questions + papers + results + reviews + evidence units + storage IDs), call `deleteExtractionInternal` via `t.mutation()`, run all scheduled functions to completion, then verify zero orphaned rows in all child tables.
**When to use:** Testing Convex mutations that use `ctx.scheduler.runAfter(0, ...)` for batched self-scheduling
**Example:**
```typescript
// Source: existing pattern from convex/library/queries.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("deleteExtractionInternal cascade", () => {
  it("deletes full job graph leaving zero orphaned rows", async () => {
    const t = convexTest(schema);

    // Seed full graph using t.run()
    const { jobId, paperId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { /* ... */ });
      const jobId = await ctx.db.insert("extractionJobs", { userId, /* ... */ });
      const paperId = await ctx.db.insert("extractionPapers", { jobId, /* ... */ });
      await ctx.db.insert("extractionQuestions", { jobId, /* ... */ });
      await ctx.db.insert("extractionResults", { paperId, /* ... */ });
      await ctx.db.insert("extractionResultReviews", { paperId, jobId, /* ... */ });
      await ctx.db.insert("extractionEvidenceUnits", { paperId, /* ... */ });
      return { jobId, paperId };
    });

    // Call the internal mutation (no auth required)
    await t.mutation(internal.extraction.mutations.deleteExtractionInternal, { jobId });

    // Run all scheduled functions (the cascade uses scheduler.runAfter(0, ...))
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    // Verify zero orphaned rows
    await t.run(async (ctx) => {
      const papers = await ctx.db.query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
      expect(papers).toHaveLength(0);
      // ... repeat for all child tables
    });
  });
});
```

### Pattern 2: Zustand Migration Chain Testing
**What:** Extract and directly invoke the `migrate` function from the persist config, passing synthetic previous-version state and asserting the output shape matches expectations.
**When to use:** Testing Zustand persist migrations without requiring a browser/DOM environment
**Example:**
```typescript
// The migrate function is defined inline in the persist config.
// Strategy: replicate the migration logic or import and test the store's migrate behavior.
// Since the migrate function is not separately exported, we test it by:
// 1. Creating the store with a mock storage adapter pre-loaded with old-version state
// 2. Verifying the hydrated state has correct shape

import { describe, it, expect } from "vitest";

// Approach: Test the migrate function directly by extracting its logic
// The search-history-store migrate function is at lib/store.ts lines 461-564
// It takes (persistedState: any, version: number) and returns the migrated state

describe("useSearchHistoryStore migrations", () => {
  it("version 0 -> 7: adds all fields to search history items", () => {
    const v0State = {
      searchHistory: [{
        query: "test",
        yearRange: [1990, 2024],
        // no isYearRangeEnabled, no queryHistory, no questionHistory, etc.
      }],
    };
    // Run through migration chain...
  });
});
```

### Pattern 3: Pure Function Edge Case Testing
**What:** Import exported functions and call with edge-case inputs (null answers, empty arrays, missing fields, undefined confidence)
**When to use:** Testing pure functions with boundary conditions
**Example:**
```typescript
import { aggregateQuestionInsights } from "../lib/extraction/insights";

it("handles empty entries array gracefully", () => {
  const result = aggregateQuestionInsights([], "string");
  expect(result.total).toBe(0);
  expect(result.answered).toBe(0);
  expect(result.avgConfidence).toBe(0);
});

it("handles all-null answers without crashing", () => {
  const result = aggregateQuestionInsights([
    { paperId: "p1", title: "T1", openalexId: "oa:1", questionKey: "q1", answer: null },
    { paperId: "p2", title: "T2", openalexId: "oa:2", questionKey: "q1", answer: undefined },
  ], "string");
  expect(result.total).toBe(2);
  expect(result.answered).toBe(0);
});
```

### Anti-Patterns to Avoid
- **Testing cascade with manual mock ctx:** The cascade uses `ctx.scheduler.runAfter(0, ...)` which requires actual scheduler simulation. convex-test's `finishAllScheduledFunctions` handles this correctly -- do not attempt to mock the scheduler manually.
- **Testing Zustand migrations through rendered components:** The migration function is a pure data transform. Testing through component rendering adds unnecessary complexity (DOM, React hooks, localStorage mocking). Test the migration logic directly.
- **Shallow edge case coverage:** Don't just test one null answer. Cover: all-null, mixed null/valid, undefined confidence, undefined citationStatus, empty string answers, NaN confidence values.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Convex DB mocking | Custom mock of ctx.db, ctx.scheduler | `convex-test` library | Provides real DB semantics, index support, and scheduler simulation |
| Fake timer management | Manual setTimeout tracking | `vi.useFakeTimers()` + `finishAllScheduledFunctions` | convex-test integrates with Vitest's fake timers for scheduled function execution |
| Storage mock | Custom storage mock | convex-test's built-in storage support | `t.run()` ctx includes `storage` via `Pick<GenericActionCtx, "storage">` |

**Key insight:** convex-test provides a complete in-memory Convex backend with real DB indexes, scheduler simulation, and storage support. Testing against it gives much higher confidence than hand-rolled mocks.

## Common Pitfalls

### Pitfall 1: Forgetting `vi.useFakeTimers()` Before `finishAllScheduledFunctions`
**What goes wrong:** `finishAllScheduledFunctions` requires a timer-advancing function. Without fake timers, `vi.runAllTimers` has nothing to advance and scheduled functions never execute.
**Why it happens:** The convex-test API requires explicit timer control for scheduled function execution.
**How to avoid:** Always wrap cascade tests in `vi.useFakeTimers()` / `vi.useRealTimers()` and pass `vi.runAllTimers.bind(vi)` to `finishAllScheduledFunctions`.
**Warning signs:** Tests pass but the cascade delete only executes the first step (evidence units only).

### Pitfall 2: Not Seeding All Child Tables in Cascade Test
**What goes wrong:** Test "passes" but doesn't actually verify the cascade deletes evidence units, reviews, saved views, report snapshots, or run diffs because those tables were never seeded.
**Why it happens:** The cascade has 9 steps across 8+ tables. It's easy to only seed the obvious ones (job, papers, results).
**How to avoid:** Seed at least one row in EVERY child table: extractionJobs, extractionQuestions, extractionPapers (with storageId), extractionResults, extractionResultReviews, extractionEvidenceUnits, extractionSavedViews, extractionReportSnapshots, extractionRunDiffs. Then verify all are empty after deletion.
**Warning signs:** Test only checks 2-3 tables after deletion.

### Pitfall 3: Testing Zustand Migrations With Stale Version Numbers
**What goes wrong:** Test uses wrong version number, causing migration to skip steps.
**Why it happens:** The search-history-store is at version 7. The `migrate` function is called with the OLD version number. If you pass `version: 7`, no migration runs.
**How to avoid:** Test chain from version 0 upward. The requirement says "5-version migration chain" -- cover at least versions 0, 1, 2, 3, 4 as starting points and verify each produces version-7-compatible output.
**Warning signs:** Migration test always returns the input unchanged.

### Pitfall 4: `deleteExtractionInternal` Is Internal -- Cannot Use `asUser.mutation()`
**What goes wrong:** Test tries to call `deleteExtractionInternal` through a user identity, but it's an `internalMutation` that doesn't require auth.
**Why it happens:** Confusion between public `deleteExtraction` (requires auth + ownership) and internal `deleteExtractionInternal` (no auth).
**How to avoid:** Call `t.mutation(internal.extraction.mutations.deleteExtractionInternal, { jobId })` directly without `withIdentity`. Use `internal` import from `../_generated/api`.
**Warning signs:** "Unauthorized" errors in test output.

### Pitfall 5: Edge Case Tests Missing `confidence: undefined` and `citationStatus: undefined`
**What goes wrong:** Test covers `answer: null` but misses other optional fields being undefined, which can cause different code paths (division by zero in avgConfidence, missing citation status bucketing).
**Why it happens:** The `InsightEntry` type has `confidence?: number` and `citationStatus?: CitationStatus` as optional -- easy to forget they can be undefined.
**How to avoid:** Explicitly test entries with no confidence and no citationStatus fields.
**Warning signs:** Production crashes on entries from papers where extraction failed early (no confidence assigned).

## Code Examples

Verified patterns from the existing codebase:

### Seeding a User in convex-test
```typescript
// Source: convex/library/queries.test.ts
async function seedUser(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return await ctx.db.get(userId);
  });
}
```

### Calling Internal Mutations in convex-test
```typescript
// Source: convex-test API (index.d.ts)
// Internal mutations are called the same way as public ones via t.mutation()
await t.mutation(internal.extraction.mutations.deleteExtractionInternal, { jobId });
```

### Running Scheduled Functions to Completion
```typescript
// Source: convex-test API (index.d.ts)
// finishAllScheduledFunctions takes an advanceTimers callback
vi.useFakeTimers();
await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
vi.useRealTimers();
```

### Search History Store Migration Chain Shape
```typescript
// Source: lib/store.ts lines 460-564
// Version 0->1: adds isYearRangeEnabled (boolean, derived from yearRange)
// Version 1->2: adds queryHistory (array of {query, timestamp})
// Version 2->3: adds questionHistory (empty array)
// Version 3->4: adds screeningQuestions (empty array)
// Version 4->5: adds screeningResponses (empty object)
// Version 5->6: adds language (undefined)
// Version 6->7: normalizes screeningQuestions shape to {question: string}

// The migrate function signature:
// migrate: (persistedState: any, version: number) => persistedState
```

### Extraction Job Schema (Required Fields for Seeding)
```typescript
// Source: convex/schema.ts -- minimum required fields for extractionJobs
{
  userId: v.id("users"),
  sourceType: "history" | "zotero" | "manual" | "mixed",
  status: "pending" | "downloading_pdfs" | "indexing" | "extracting" | "completed" | "failed" | "cancelled",
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}
```

## Detailed Schema Requirements for Cascade Test Seeding

All tables that must be seeded (with required fields from `convex/schema.ts`):

| Table | Required Fields | Index Used by Cascade |
|-------|----------------|----------------------|
| `extractionJobs` | userId, sourceType, status, totalPapers, processedPapers, failedPapers, name, createdAt, updatedAt | (primary key) |
| `extractionQuestions` | jobId, key, question, type, order, createdAt | by_job |
| `extractionPapers` | jobId, openalexId, title, status, createdAt (storageId optional but MUST test) | by_job |
| `extractionResults` | paperId, questionKey, answer, citations (array), citationStatus, processedAt | by_paper |
| `extractionResultReviews` | jobId, paperId, resultId, questionKey, state, createdAt, updatedAt | by_paper |
| `extractionEvidenceUnits` | paperId, evidenceId, page, charRange (array), text, tokens (array), anchorConfidence, source, createdAt | by_paper |
| `extractionSavedViews` | jobId, userId, name, filters (object), createdAt, updatedAt | by_job |
| `extractionReportSnapshots` | jobId, userId, name, scope (object), sections (array), metrics (object), generatedAt, createdAt | by_job |
| `extractionRunDiffs` | jobId, baselineJobId, userId, summary (object), changes (array), generatedAt, createdAt | by_job |

## Zustand Migration Chain Detail

The search-history-store has **7 migration steps** (version 0 through 7). The success criteria says "5-version migration chain" -- this means testing at least 5 different starting versions to verify the chain works end-to-end.

| From Version | To Version | What Changes |
|-------------|-----------|--------------|
| 0 | 1 | Adds `isYearRangeEnabled` boolean per search history item (true if yearRange differs from default) |
| 1 | 2 | Adds `queryHistory` array (seeded from existing query + createdAt) |
| 2 | 3 | Adds `questionHistory` array (empty default) |
| 3 | 4 | Adds `screeningQuestions` array (empty default) |
| 4 | 5 | Adds `screeningResponses` object (empty default) |
| 5 | 6 | Adds `language` field (undefined default) |
| 6 | 7 | Normalizes `screeningQuestions` to `{question: string}` shape |

**Testing approach:** The `migrate` function is defined inline in the `persist` config and is not separately exported. Options:
1. **Extract the migrate function** into a separate exported function (refactor) -- cleanest but requires code change
2. **Replicate the migration logic** in tests -- tests mirror the code, less ideal
3. **Test via store hydration** with mock localStorage -- tests actual integration but requires jsdom

Recommended: **Option 1** -- extract the `migrate` function as a named export. This is a minimal refactor (move function out of object literal) that enables clean testing. The planner should include this as a preparatory task.

**Alternative if no refactor desired:** Import the entire store module and use Zustand's `persist` API with a custom storage adapter pre-loaded with old-version state. This works in jsdom environment.

## Insight Edge Cases to Cover (TEST-03)

The existing test (`tests/extraction-insights.test.ts`) covers happy paths. Missing edge cases:

### `aggregateQuestionInsights`
1. **Empty entries array** -- should return zeroed aggregate, no crash
2. **All-null answers** -- answered should be 0, topAnswers should be empty
3. **All-undefined answers** -- same as null
4. **Missing confidence** (undefined) -- avgConfidence denominator should only count defined values
5. **Missing citationStatus** (undefined) -- should not increment any bucket
6. **Empty string answers** -- normalizeAnswer("") returns null, should count as unanswered
7. **NaN/Infinity confidence** -- `Number.isFinite` guard should skip these
8. **Mixed null and valid for array type** -- entityDistribution should still compute correctly for valid entries

### `buildDisagreementClusters`
1. **Empty entries** -- should return empty array
2. **All same answer** -- should return empty (only 1 group, `groups.size <= 1`)
3. **All null answers** -- should return empty (normalized is null, skipped)

### `buildRunDiff`
1. **Empty baseline and next** -- should return zero summary
2. **Baseline only (all removed)** -- removedAnswers should match
3. **Next only (all new)** -- newAnswers should match

## Open Questions

1. **Zustand migrate function extraction**
   - What we know: The migrate function is inline in the persist config object
   - What's unclear: Whether the project maintainer prefers extracting it as a named export vs testing through store hydration
   - Recommendation: Extract as named export -- minimal change, maximum testability. Include as first task in the plan.

2. **Storage mock in convex-test for storageId verification**
   - What we know: convex-test `t.run()` ctx includes storage access. The cascade delete calls `ctx.storage.delete(paper.storageId)` which is wrapped in try/catch.
   - What's unclear: Whether convex-test's in-memory storage supports `storage.store()` to create real storage IDs for seeding, or if we need to use a fake ID.
   - Recommendation: Use `t.run(async (ctx) => { const storageId = await ctx.storage.store(new Blob(["test"])); ... })` to create real storage entries. If that fails, seed with a fake ID and verify the cascade doesn't crash (the try/catch should handle it).

## Sources

### Primary (HIGH confidence)
- `convex/extraction/mutations.ts` lines 965-1103 -- deleteExtraction and deleteExtractionInternal implementation
- `convex/schema.ts` -- full schema with all extraction tables and indexes
- `lib/store.ts` lines 457-568 -- useSearchHistoryStore with 7-version migrate function
- `lib/extraction/insights.ts` -- full aggregateQuestionInsights, buildDisagreementClusters, buildRunDiff implementations
- `tests/extraction-insights.test.ts` -- existing happy-path tests
- `convex/library/queries.test.ts` -- established convex-test pattern with seedUser, t.run(), t.query()
- `vitest.config.ts` -- test environment configuration
- `package.json` -- dependency versions
- `node_modules/convex-test/dist/index.d.ts` -- convex-test API types

### Secondary (MEDIUM confidence)
- `.planning/phases/38-deletion-cascade-storage-cleanup/38-01-PLAN.md` -- Phase 38 plan documenting the cascade design

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and used in project
- Architecture: HIGH - patterns directly observed in existing test files
- Pitfalls: HIGH - derived from actual code analysis of cascade, migrations, and edge cases

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no library upgrades expected)
