# Phase 95: Structured Observability & SLO Metrics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 95-structured-observability-slo-metrics
**Areas discussed:** TraceId propagation, Structured log format, Per-job UI metrics query, SLO metric persistence
**Mode:** --auto (all decisions auto-selected with recommended defaults)

---

## TraceId Generation & Propagation

| Option | Description | Selected |
|--------|-------------|----------|
| In createExtractionJob, persisted on job row | Generate ULID in the mutation that creates the job, store as a field | ✓ |
| In workflow start step | Generate in the durable workflow's first step | |
| In workpool action per-paper | Generate per-paper, not per-job | |

**User's choice:** [auto] In createExtractionJob mutation, persisted on the job row (recommended default)
**Notes:** ULID chosen over UUIDv7 for monotonic sortability and grep-friendliness.

| Option | Description | Selected |
|--------|-------------|----------|
| Flat workpool arg | Pass traceId as a flat arg alongside jobId/paperId | ✓ |
| Context object | Wrap in a tracing context object | |

**User's choice:** [auto] Pass via workpool enqueue args alongside jobId/paperId (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Parameter to extractAnswers() | Thread traceId into the cascade module for per-call logging | ✓ |
| Environment/global context | Use AsyncLocalStorage or similar | |

**User's choice:** [auto] Yes, as a parameter to extractAnswers() (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| ulid package | Lightweight, no deps, monotonically sortable | ✓ |
| uuid v7 | Standard but not sortable by default in string form | |
| crypto.randomUUID() | Built-in but not time-sortable | |

**User's choice:** [auto] ulid package (recommended default)

---

## Structured Log Format

| Option | Description | Selected |
|--------|-------------|----------|
| Static cost-per-token map | Hardcoded per-model pricing, approximate but grep-friendly | ✓ |
| OpenRouter usage API | Query OpenRouter for actual cost post-hoc | |
| No cost tracking | Defer cost to Phase 96 or later | |

**User's choice:** [auto] Static cost-per-token map (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Replace all ad-hoc logs | Swap every console.log/error in workpoolActions.ts with structured JSON | ✓ |
| Keep existing + add structured | Add structured alongside existing | |

**User's choice:** [auto] Replace all ad-hoc console.* calls (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| parse, extract, critic, save | Four stages matching pipeline steps | ✓ |
| parse, extract, save | Three stages (critic is part of extract) | |

**User's choice:** [auto] Four stages: parse, extract, critic, save (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Shared helper module | emitStageLog/emitStageError in convex/extraction/logging.ts | ✓ |
| Inline JSON formatting | Format JSON inline at each call site | |

**User's choice:** [auto] Shared logging helper module (recommended default)

---

## Per-Job UI Metrics Query

| Option | Description | Selected |
|--------|-------------|----------|
| Computed from results at query time | Aggregate from extractionResults/extractionPapers rows | ✓ |
| Denormalized on job row | Pre-compute and store on job row at completion | |

**User's choice:** [auto] Computed from results at query time (recommended default)
**Notes:** Avoids schema migration and keeps source of truth in result rows. Acceptable for MVP scale.

| Option | Description | Selected |
|--------|-------------|----------|
| papersProcessed, avgLatencyMs, estimatedCostUsd, errorCount | Matching OBS-04 exactly | ✓ |
| Extended with per-model breakdown | Add per-tier cost/count breakdown | |

**User's choice:** [auto] Four metrics matching OBS-04 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Paper-level duration (completedAt - createdAt) | Uses existing schema fields | ✓ |
| Per-question latency from structured logs | Would need to persist latency per result | |

**User's choice:** [auto] Paper-level duration from existing fields (recommended default)

---

## SLO Metric Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Optional fields on extractionJobs row | citationValidityRate and recallOnInclude as optional floats | ✓ |
| Separate sloMetrics table | Dedicated table per run | |

**User's choice:** [auto] Optional fields on extractionJobs row (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Compute at job finalization | In finalizeJobIfDone after all papers complete | ✓ |
| Compute lazily in query | Calculate on read | |

**User's choice:** [auto] Compute at job finalization (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Computable now from criticVerdict data | supported / total with non-null verdict | ✓ |
| Defer to Phase 96 | Wait for golden set infrastructure | |

**User's choice:** [auto] Computable now — data exists from Phase 92 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Store field as null, populate in Phase 96 | Forward-compatible schema field | ✓ |
| Don't add field until Phase 96 | Avoid unused schema fields | |

**User's choice:** [auto] Store null, Phase 96 populates (recommended default)

---

## Claude's Discretion

- Exact cost-per-token values in the static map
- Whether metrics and SLO are one query or two
- Test fixture design for structured log assertions
- Whether latencyMs for extract stage is per-question or per-paper aggregate
- Whether emitStageLog uses typed params object or overloaded signatures

## Deferred Ideas

None — discussion stayed within phase scope.
