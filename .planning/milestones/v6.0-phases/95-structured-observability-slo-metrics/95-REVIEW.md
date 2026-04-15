---
phase: 95-structured-observability-slo-metrics
reviewed: 2026-04-15T12:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - components/extraction/job-metrics-panel.tsx
  - convex/extraction/extract.ts
  - convex/extraction/logging.test.ts
  - convex/extraction/logging.ts
  - convex/extraction/mutations.ts
  - convex/extraction/queries.ts
  - convex/extraction/workflow.ts
  - convex/extraction/workpoolActions.ts
  - convex/schema.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 95: Code Review Report

**Reviewed:** 2026-04-15T12:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The Phase 95 structured observability and SLO metrics implementation is well-structured overall. The logging module is clean, the cost computation is correct, the schema extensions for `citationValidityRate` and `recallOnInclude` are sound, and the UI component handles loading/null states properly with good accessibility attributes.

No security vulnerabilities or critical bugs were found. No hardcoded secrets, no injection vectors, no `eval` usage, no `dangerouslySetInnerHTML`, and no `as any` casts.

Four warnings and three informational items were identified, primarily around a logic bug in the UI `remaining` calculation that omits cancelled papers, a redundant display of error count in the metrics panel, a swallowed error in the critic catch block, and potential negative value in the tooltip.

## Warnings

### WR-01: `remaining` calculation ignores cancelled papers

**File:** `components/extraction/job-metrics-panel.tsx:103`
**Issue:** The `remaining` calculation subtracts `papersProcessed` and `errorCount` from `totalPapers`, but does not account for cancelled papers. If papers are cancelled (via `cancelExtractionJob`), the `remaining` value will be inflated. The `getExtractionJobMetrics` query does not return `cancelledPapers`, but the progress query does. Since the metrics panel is a companion to progress display, a cancelled paper showing as "remaining" is misleading.
**Fix:**
The `getExtractionJobMetrics` query should include `cancelledPapers` in its return value, and the UI should subtract it:
```tsx
// In queries.ts getExtractionJobMetrics, add to return:
cancelledPapers: job.cancelledPapers ?? 0,

// In job-metrics-panel.tsx:
const remaining = totalPapers - papersProcessed - errorCount - (metrics.cancelledPapers ?? 0);
```

### WR-02: Critic catch block swallows error details without logging the actual error

**File:** `convex/extraction/extract.ts:345`
**Issue:** The `catch` block at line 345 handles critic timeout/failure but does not capture the actual error object. The `errorMessage` field is hardcoded to `"Critic timeout or failure"` regardless of the actual exception. This makes incident triage harder because the structured log entry provides no signal about whether the failure was a timeout, a schema validation error, a rate limit, or something else entirely. The error variable is not even bound in the catch clause.
**Fix:**
```typescript
} catch (criticError) {
  const errorMsg = criticError instanceof Error
    ? criticError.message.slice(0, 200)
    : String(criticError).slice(0, 200);
  if (traceId && jobId && paperId) {
    emitStageError({
      traceId,
      jobId,
      paperId,
      stage: "critic",
      model: tier.name,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - criticStartMs,
      status: "failure",
      errorMessage: errorMsg,
      errorCategory: criticError instanceof DOMException ? "timeout" : "network",
      retryable: false,
    });
  }
```

### WR-03: `anySucceeded` check treats `"insufficient_evidence"` as success

**File:** `convex/extraction/workpoolActions.ts:261`
**Issue:** The success check `extractionResults.some((r) => r.answer !== null)` considers a paper successful if any question has `answer !== null`. However, `makeInsufficientEvidence` in `extract.ts` sets `answer: "insufficient_evidence"` (a non-null string), which means a paper where ALL questions returned `"insufficient_evidence"` would still be counted as `success: true`. This inflates `processedPapers` instead of `failedPapers`, skewing the SLO metrics.
**Fix:**
```typescript
const anySucceeded = extractionResults.some(
  (r) => r.answer !== null && r.answer !== "insufficient_evidence"
);
```

### WR-04: Duplicate error count display in metrics panel

**File:** `components/extraction/job-metrics-panel.tsx:206-213`
**Issue:** The error count is displayed twice in the same card cell -- once as a `<p>` element and again as a destructive `<Badge>`. Both show the exact same `errorCount` value. This creates visual redundancy and could confuse users (especially screen reader users who will hear the number announced twice).
**Fix:**
Show either the plain number or the badge, not both. For example, always use the badge when `errorCount > 0`, and fall back to the plain number when zero:
```tsx
<div className="flex items-center gap-2">
  {errorCount > 0 ? (
    <Badge variant="destructive" className="text-xs">
      {errorCount}
    </Badge>
  ) : (
    <p className="text-xl font-semibold leading-tight">0</p>
  )}
</div>
```

## Info

### IN-01: `remaining` can go negative without guard in calculation

**File:** `components/extraction/job-metrics-panel.tsx:103`
**Issue:** Although `Math.max(0, remaining)` is used in the tooltip at line 139, the raw `remaining` variable itself can be negative if `papersProcessed + errorCount > totalPapers` due to race conditions or counter drift. The variable is not used elsewhere currently, but if future code references `remaining` directly, it could show negative values.
**Fix:**
Clamp at declaration:
```tsx
const remaining = Math.max(0, totalPapers - papersProcessed - errorCount);
```

### IN-02: `console.warn` calls in extract.ts bypass structured logging

**File:** `convex/extraction/extract.ts:395-404`
**Issue:** Two `console.warn` calls in the cascade retry path use ad-hoc string formatting (`[ExtractionCascade] Tier ...`) instead of the structured JSON logging pattern established by `emitStageLog`/`emitStageError` in `logging.ts`. The module's own docstring at line 6 of `logging.ts` states "No ad-hoc console.log strings in the extraction pipeline." These are `console.warn` calls rather than `console.log`, but they still break the structured logging contract.
**Fix:**
Replace with `emitStageError` calls when `traceId`/`jobId`/`paperId` are available, or emit structured JSON via `console.warn(JSON.stringify({...}))` to maintain grep-friendly incident triage.

### IN-03: Error label uses `sr-only` making it invisible to sighted users

**File:** `components/extraction/job-metrics-panel.tsx:215-217`
**Issue:** The "Errors" label `<p>` element has `sr-only` class, making it invisible to sighted users. All other metric cells (Papers Processed, Avg Latency, Estimated Cost) have their label visible below the value. The Errors cell is the only one where the label is hidden, creating visual inconsistency. The `aria-label` on the parent `div` covers accessibility, so the hidden `<p>` is redundant for screen readers as well.
**Fix:**
Remove the `sr-only` class and restructure to match the pattern of other cells:
```tsx
<p className="text-xs text-muted-foreground">
  {t("errors")}
</p>
```

---

_Reviewed: 2026-04-15T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
