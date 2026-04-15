# Phase 89: Core Schema & Workflow Skeleton - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 89-core-schema-workflow-skeleton
**Mode:** --auto (all decisions auto-selected)
**Areas discussed:** Schema Table Design, Workflow Stage Granularity, Workpool Registration, Batched Enqueue Pattern

---

## Schema Table Design

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal MVP tables | 4 tables (jobs, papers, questions, results) with only WORK-01 through WORK-07 fields | ✓ |
| Full-featured tables | Include all fields from Phase 90-97 upfront | |

**User's choice:** [auto] Minimal MVP tables — downstream phases add fields as needed.

| Option | Description | Selected |
|--------|-------------|----------|
| by_paper_question + by_job + by_paper | Standard composite indexes for idempotent save and querying | ✓ |
| Minimal indexes | Only by_paper_question | |

**User's choice:** [auto] Full index set for query patterns.

| Option | Description | Selected |
|--------|-------------|----------|
| Denormalized counters on job | totalPapers, processedPapers, failedPapers matching screening pattern | ✓ |
| Computed counters from paper rows | Count papers by status on read | |

**User's choice:** [auto] Denormalized counters — proven pattern from screening.

| Option | Description | Selected |
|--------|-------------|----------|
| Store workpoolId on paper row | Enables targeted cancel per WORK-03 | ✓ |
| No workpoolId tracking | Simpler but requires cancelAll | |

**User's choice:** [auto] Store workpoolId — WORK-03 explicitly requires it.

---

## Workflow Stage Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| 3 journaled steps (load, enqueue, finalize) | Mirrors screening workflow, workpool items handle per-paper pipeline | ✓ |
| Per-paper journaled steps | One step per paper per stage | |
| Per-stage journaled steps (4 total) | parse/extract/critic/persist as workflow steps | |

**User's choice:** [auto] 3 journaled steps — matches screening pattern and WORK-01/WORK-06.

| Option | Description | Selected |
|--------|-------------|----------|
| Workpool items run full pipeline | Each item does parse→extract→critic→persist autonomously | ✓ |
| Workflow orchestrates per-paper | Workflow tracks each paper through stages | |

**User's choice:** [auto] Workpool items run full pipeline autonomously.

---

## Workpool Registration

| Option | Description | Selected |
|--------|-------------|----------|
| maxParallelism: 5 | Upper bound of WORK-02 range, matches screeningPool | ✓ |
| maxParallelism: 3 | Conservative lower bound | |

**User's choice:** [auto] maxParallelism: 5 — matches existing screeningPool.

| Option | Description | Selected |
|--------|-------------|----------|
| Separate named component | extractionWorkpool alongside screeningWorkpool in convex.config.ts | ✓ |
| Reuse existing component | Share with screening | |

**User's choice:** [auto] Separate named component — isolated pools.

---

## Batched Enqueue Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Single mutation creates rows + enqueues | One transaction for paper rows and workpool enqueue | ✓ |
| Two-step: create rows then enqueue | Separate mutation for row creation and workpool enqueue | |

**User's choice:** [auto] Single mutation — matches WORK-06 requirement.

| Option | Description | Selected |
|--------|-------------|----------|
| Query-first idempotent save | Check by_paper_question index before insert, skip if exists | ✓ |
| Upsert pattern | Replace existing row on duplicate | |

**User's choice:** [auto] Query-first skip — prevents onComplete double-fire corruption per WORK-07.

---

## Claude's Discretion

- Exact field names and validator shapes for the four tables
- Whether extractionQuestions are nested on the job or separate rows
- Internal vs public function split
- Test file organization

## Deferred Ideas

None — all discussion stayed within phase scope.
