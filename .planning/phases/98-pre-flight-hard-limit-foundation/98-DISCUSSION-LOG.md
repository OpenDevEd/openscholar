# Phase 98: Pre-flight & Hard-Limit Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 98-pre-flight-hard-limit-foundation
**Areas discussed:** Constant architecture, Benchmark methodology, Query split strategy, Pagination fallback scope
**Mode:** --auto (all decisions auto-selected)

---

## Constant Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Replace flat constant with derived value from tier map | `EXTRACTION_LIMITS_BY_TIER` as single source of truth, derive `MAX_EXTRACTION_PAPERS_PER_JOB` via `Math.max()` so existing imports work | ✓ |
| Keep flat constant, add tier map separately | Two independent constants — risk of drift | |
| Inline tier lookup everywhere | No shared constant — high maintenance burden | |

**User's choice:** [auto] Replace flat constant with derived value from tier map (recommended default)
**Notes:** Preserves backward compatibility at all 15 import sites while making the tier map authoritative.

---

## Benchmark Methodology

| Option | Description | Selected |
|--------|-------------|----------|
| Seed dev DB with synthetic data and measure response size | Direct measurement against Convex dev deployment with 1000 rows × 7 questions | ✓ |
| Estimate from schema field sizes | Mathematical estimate without real Convex serialization overhead | |
| Wait for real production data | Risky — can't test until users hit the limit | |

**User's choice:** [auto] Seed dev database with synthetic data and measure serialized query response size (recommended default)
**Notes:** Pass criterion: ≤ 5 MB total payload. Result must be committed as an auditable artifact.

---

## Query Split Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate exports with clear naming | `MAX_EXTRACTION_PAPERS_PER_JOB` (user cap) + `MAX_EXTRACTION_RESULTS_QUERY` (internal bound), audit all 15 sites | ✓ |
| Single constant with runtime multiplier | Keep one constant, multiply at query sites — fragile | |
| Feature flag for internal bounds | Overkill for a static query safety bound | |

**User's choice:** [auto] Two separate exports in queryBounds.ts with clear naming (recommended default)
**Notes:** The `MAX * 10` multiplier in `finalizeJobIfDone` must be revisited — prefer direct count query.

---

## Pagination Fallback Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal server-side pagination only | Cursor-based `.paginate()` on `getExtractionResults` if benchmark fails; UI pagination in Phase 103 | ✓ |
| Full pagination with UI | Over-scoped for Phase 98 — UI is Phase 103's job | |
| Skip pagination, just lower the cap | Defeats the purpose of bumping to 1000 | |

**User's choice:** [auto] Minimal pagination — cursor-based paginate only getExtractionResults, defer UI pagination to Phase 103 (recommended default)
**Notes:** Only triggered if benchmark exceeds 5 MB. API shape should match Convex's built-in `.paginate()`.

---

## Claude's Discretion

- Internal naming conventions for new constants and helpers
- Exact synthetic data generation approach for benchmark
- Whether benchmark uses Convex internal action or test harness
- Test file organization for `getExtractionLimitForUser`

## Deferred Ideas

None — all discussion stayed within phase scope.
