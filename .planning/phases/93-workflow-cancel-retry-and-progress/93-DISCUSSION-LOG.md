# Phase 93: Workflow Cancel, Retry, and Progress - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 93-workflow-cancel-retry-and-progress
**Areas discussed:** Cancel mutation design, Error classification taxonomy, Progress granularity, Cancel UX flow
**Mode:** --auto (all decisions auto-selected with recommended defaults)

---

## Cancel Mutation Design

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted per-paper cancel via stored workpoolId | Iterate paper rows, cancel each workpool item individually using persisted workpoolId — no cross-user blast radius | ✓ |
| Bulk cancelAll on extraction pool | Simpler but cancels ALL items in the pool, potentially hitting other users' jobs | |

**User's choice:** [auto] Targeted per-paper cancel via stored workpoolId (recommended default)
**Notes:** WORK-03 explicitly requires per-paper workpoolId for targeted cancel. The screening reference uses `cancelAll` which is the blast-radius pattern this phase must avoid.

| Option | Description | Selected |
|--------|-------------|----------|
| Cancel both workflow and individual workpool items | Workflow cancel stops future steps; per-paper cancel stops in-flight work | ✓ |
| Cancel workflow only | Simpler but in-flight workpool items continue running and consuming tokens | |
| Cancel workpool items only | Stops in-flight work but workflow could re-enqueue | |

**User's choice:** [auto] Cancel both workflow and individual workpool items (recommended default)
**Notes:** Follows screening pattern. Both levels are needed for complete cancellation.

---

## Error Classification Taxonomy

| Option | Description | Selected |
|--------|-------------|----------|
| Classify at throw/return boundary in workpool action | Retryable errors throw (auto-retry), permanent errors return {success: false} (no retry) | ✓ |
| Classify via middleware/wrapper around LLM calls | Central classification before errors propagate | |
| No classification — retry all errors uniformly | Current behavior, wastes credits on permanent failures | |

**User's choice:** [auto] Classify at throw/return boundary in workpool action (recommended default)
**Notes:** WORK-05 specifies the exact taxonomy: retryable (network, 5xx, 429, timeout) vs permanent (404, 400, validation).

| Option | Description | Selected |
|--------|-------------|----------|
| Shared helper in convex/extraction/errors.ts | Reusable classification module imported by workpoolActions | ✓ |
| Inline classification in workpoolActions.ts | Simpler but not reusable | |
| Extend convex/lib/errors.ts with extraction codes | Centralizes but mixes concerns | |

**User's choice:** [auto] Shared helper in convex/extraction/errors.ts (recommended default)
**Notes:** Keeps extraction error logic isolated while remaining reusable across workpool actions and future extraction error handling.

---

## Progress Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Existing getExtractionProgress is sufficient | Already returns status, totalPapers, processedPapers, failedPapers, percentComplete | ✓ |
| Add per-paper status streaming | More granular but higher subscription cost | |
| Add stage-level progress (parsing/extracting per paper) | Finest grain but complex counter management | |

**User's choice:** [auto] Existing getExtractionProgress is sufficient (recommended default)
**Notes:** The existing query satisfies WORK-09's processed/failed/remaining counters. Only addition: `cancelledPapers` counter for cancel-specific tracking.

---

## Cancel UX Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Optimistic status update with cancel button | Backend mutation handles cancel; UI reactively updates via progress query | ✓ |
| Two-phase cancel with confirmation dialog | Extra step before destructive action | |
| Soft cancel — stop enqueuing new papers but let in-flight finish | Less disruptive but slower to stop | |

**User's choice:** [auto] Optimistic status update with cancel button (recommended default)
**Notes:** UI implementation is Phase 97 scope. Phase 93 provides the backend `cancelExtractionJob` mutation. The progress query reactively shows cancel status.

---

## Claude's Discretion

- Exact error classification edge cases (non-standard OpenRouter status codes)
- Whether critic-pass errors need separate classification from extraction errors
- Test fixture design (real vs synthetic error objects)
- Whether `cancelledPapers` is a schema field or derived count

## Deferred Ideas

None — discussion stayed within phase scope.
