---
phase: 90-free-first-parsing-waterfall
reviewed: 2026-04-15T12:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - convex.json
  - convex/extraction/mutations.ts
  - convex/extraction/parse.ts
  - convex/extraction/queries.ts
  - convex/extraction/validators.ts
  - convex/extraction/workpoolActions.ts
  - convex/schema.ts
  - package.json
  - tests/extraction/parse.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 90: Code Review Report

**Reviewed:** 2026-04-15T12:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The Phase 90 implementation delivers a well-structured multi-tier parsing waterfall (PMC JATS -> arXiv HTML -> unpdf -> Gemini -> abstract-only) with proper timeout controls, idempotency guards, and Convex best practices (index-backed queries, OCC-aware counter increments, batched workpool enqueue). The schema, validators, queries, and mutations are consistently designed and follow Convex guidelines closely.

One critical bug exists in the waterfall logic where oversized PDFs (>200 pages) rejected by the page cap are still sent to Gemini, defeating the cost/resource guard. Additionally, the workflow start failure in `createExtractionJob` is silently swallowed, which can orphan jobs in production. Several minor quality items round out the findings.

## Critical Issues

### CR-01: Oversized PDFs bypass page cap and reach Gemini tier

**File:** `convex/extraction/parse.ts:430-466`
**Issue:** When `parsePdfWithUnpdf` throws due to the >200 page cap (line 310), `unpdfText` remains `null`. The conditional on line 452 (`unpdfText === null || unpdfText.length < MIN_UNPDF_CHARS`) evaluates to true, causing the waterfall to attempt the Gemini tier with the same oversized PDF. This defeats the 200-page safety cap -- Gemini will receive and process an arbitrarily large document, incurring unnecessary cost and latency. The test at `tests/extraction/parse.test.ts:443-473` passes accidentally because no fetch mock is configured for Gemini's PDF re-download, causing Gemini to also fail. The test comment ("no Gemini for huge docs") documents the intended behavior, but the code does not enforce it.

**Fix:** Track whether the unpdf failure was due to the page cap vs. other errors, and skip Gemini when the page cap triggered. One approach:

```typescript
// 4. Tier 3: unpdf local PDF extraction (60s timeout)
if (pdfUrl) {
  let unpdfText: string | null = null;
  let pageLimitExceeded = false;

  try {
    const { text } = await withTimeout(
      (signal) => parsePdfWithUnpdf(pdfUrl, signal),
      60_000
    );
    unpdfText = text;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("pages (max 200)")) {
      pageLimitExceeded = true;
    }
    console.warn(
      `[ParseWaterfall] unpdf tier failed for ${paperId}: ${msg}`
    );
  }

  // Check if unpdf produced sufficient text
  if (unpdfText !== null && unpdfText.length >= MIN_UNPDF_CHARS) {
    return { bodyText: unpdfText, parsingSource: "unpdf" };
  }

  // 5. Tier 4: Gemini-as-PDF-parser (120s timeout)
  // Skip Gemini if the page cap was exceeded -- oversized PDFs should not
  // be sent to any parser (PARSE-10).
  if (!pageLimitExceeded && (unpdfText === null || unpdfText.length < MIN_UNPDF_CHARS)) {
    // ... existing Gemini logic
  }
}
```

Also update the test to explicitly mock and assert that Gemini is NOT called when the page cap fires (currently, `generateText` is not asserted as not-called).

## Warnings

### WR-01: Workflow start failure silently orphans extraction jobs

**File:** `convex/extraction/mutations.ts:122-134`
**Issue:** If `workflow.start` throws in production (not just test environments), the catch block logs the error but still returns `{ jobId }` to the caller. The job row is created with status "pending" and no `workflowId`, meaning nothing will ever process it. The user sees a successful job creation response for an orphaned job that will never complete. The comment says "Workflow component may not be available in test environments" but there is no guard to distinguish test from production.

**Fix:** Either re-throw in production so the mutation transaction rolls back, or update the job status to "failed" within the catch block so the UI can surface the failure:

```typescript
try {
  const workflowId = await workflow.start(
    ctx,
    internal.extraction.workflow.runExtractionWorkflow,
    { jobId }
  );
  await ctx.db.patch(jobId, { workflowId: String(workflowId) });
} catch (e) {
  console.error(`[createExtractionJob] Failed to start workflow: ${e}`);
  // Mark the job as failed so it does not appear stuck in "pending"
  await ctx.db.patch(jobId, {
    status: "failed",
    errorMessage: `Workflow start failed: ${e instanceof Error ? e.message : String(e)}`,
    updatedAt: Date.now(),
  });
}
```

Note: The schema for `extractionJobs` does not currently have an `errorMessage` field. If adding one is not desired, at minimum patch the status to "failed".

### WR-02: Test masks Gemini bypass for oversized PDFs

**File:** `tests/extraction/parse.test.ts:443-473`
**Issue:** The test "rejects PDFs with >200 pages" asserts that `extractText` was not called and the result is `abstract_only`, but it does not assert that `generateText` (Gemini) was also NOT called. The test passes because Gemini's fetch fails silently (no mock configured for the third fetch call), not because the code actually skips Gemini. This is a false-negative test -- it documents behavior it does not actually verify.

**Fix:** Add an explicit assertion that Gemini was not invoked:

```typescript
expect(vi.mocked(extractText)).not.toHaveBeenCalled();
expect(vi.mocked(generateText)).not.toHaveBeenCalled(); // <-- add this
expect(result.parsingSource).toBe("abstract_only");
```

This assertion will fail against the current code, confirming the CR-01 bug. Once CR-01 is fixed, it will pass.

### WR-03: Redundant double-patch per paper in enqueueAllPapers

**File:** `convex/extraction/mutations.ts:194-214`
**Issue:** Each paper receives two `ctx.db.patch` calls in the enqueue loop: lines 195-198 patch status to "pending" (which it already is, since the query on line 170 filters for `status: "pending"`) and set `updatedAt`, then lines 211-214 patch `workpoolId` and `updatedAt` again. With 200 papers (the maximum), this produces 400 document writes where 200 would suffice, doubling the write load in a single mutation transaction.

**Fix:** Combine into a single patch after the workpool enqueue:

```typescript
for (const paper of pendingPapers) {
  const workId = await extractionPool.enqueueAction(
    ctx,
    internal.extraction.workpoolActions.processExtractionPaper,
    { paperId: paper._id, jobId: args.jobId },
    {
      onComplete: internal.extraction.mutations.handleExtractionComplete,
      context: { paperId: paper._id, jobId: args.jobId },
    }
  );

  await ctx.db.patch(paper._id, {
    workpoolId: String(workId),
    updatedAt: Date.now(),
  });
}
```

## Info

### IN-01: extractTextFromJatsBody converts non-string/non-object primitives via String()

**File:** `convex/extraction/parse.ts:260`
**Issue:** The fallback `return String(node)` on line 260 handles cases where the JATS body contains numeric or boolean values from XML parsing. `fast-xml-parser` with `parseTagValue: false` should always return strings, making this branch unreachable. However, it is a safe defensive measure and not a bug.

**Fix:** No action needed. Consider adding a comment explaining this is a defensive fallback:

```typescript
// Defensive: fast-xml-parser with parseTagValue:false should only produce strings,
// but coerce any unexpected primitive types as a safety net.
return String(node);
```

### IN-02: TERMINAL_STATUSES duplicated across three locations

**File:** `convex/extraction/mutations.ts:18`, `convex/extraction/queries.ts:39`, `convex/extraction/workflow.ts:39`
**Issue:** The terminal status array `["completed", "cancelled", "failed"]` is defined independently in three files. If a new terminal status is added (e.g., "expired"), one or more locations could be missed, causing inconsistent terminal-state guards.

**Fix:** Export a single `TERMINAL_STATUSES` constant from the validators file and import it everywhere:

```typescript
// convex/extraction/validators.ts
export const EXTRACTION_TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;
export type ExtractionTerminalStatus = (typeof EXTRACTION_TERMINAL_STATUSES)[number];
```

---

_Reviewed: 2026-04-15T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
