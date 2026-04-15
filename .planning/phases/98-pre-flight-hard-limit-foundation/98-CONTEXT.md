# Phase 98: Pre-flight & Hard-Limit Foundation - Context

**Gathered:** 2026-04-15
**Updated:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the per-tier-ready paper-limit constants and prove that a 1000-paper extraction job's reactive query stays under Convex's 8 MB result-size cap before the bump lands in production. This is pure backend/infrastructure — no UI changes, no new routes, no user-facing components.

Requirements: LIM-01 (bump + split constants), LIM-02 (per-tier-ready shape), LIM-03 (helper + reactive query), GAP-04 (benchmark proof).

</domain>

<decisions>
## Implementation Decisions

### Constant Architecture
- **D-01:** Replace the flat `MAX_EXTRACTION_PAPERS_PER_JOB = 200` with a per-tier record `EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number>` where all tiers resolve to 1000 in this milestone. Derive `MAX_EXTRACTION_PAPERS_PER_JOB = Math.max(...Object.values(EXTRACTION_LIMITS_BY_TIER))` so all 15 existing import sites keep working without modification. The tier map is the single source of truth — v7.1 per-tier differentiation requires editing only this one object.
- **D-02:** Add a separate `MAX_EXTRACTION_RESULTS_QUERY` constant for internal `.take()` bounds (set to a value that keeps serialized responses under Convex's 8 MB cap). This decouples the user-facing per-job limit from the internal query-safety bound.

### Benchmark Methodology
- **D-03:** Benchmark by seeding the dev Convex deployment with synthetic data (1000 `extractionResults` rows x 7 questions each, with realistic answer/evidence field sizes) and measuring the serialized byte size of the `getExtractionResults` query response. Pass criterion: total payload <= 5 MB. If it exceeds 5 MB, Phase 98 must ship a minimal server-side pagination migration of `getExtractionResults` before the 200->1000 bump is committed.
- **D-04:** Record the benchmark result (pass/fail, exact byte size, row count, question count) in a test file or benchmark log committed to the repo so the outcome is auditable and gates subsequent phases.

### Query Split Strategy
- **D-05:** Audit all 15 call sites of `MAX_EXTRACTION_PAPERS_PER_JOB` and assign each to the correct constant: user-facing cap sites keep `MAX_EXTRACTION_PAPERS_PER_JOB`, internal `.take()` sites switch to `MAX_EXTRACTION_RESULTS_QUERY`. The `MAX * 10` multiplier in `finalizeJobIfDone` must be revisited — prefer a direct count query or aggregate index over fetching all results.

### Pagination Fallback Scope
- **D-06:** If the benchmark exceeds 5 MB, implement minimal cursor-based pagination on `getExtractionResults` (server-side only). UI pagination is Phase 103's responsibility — Phase 98 just ensures the query doesn't blow the 8 MB cap. The pagination API shape should match Convex's built-in `.paginate()` pattern so Phase 103 can consume it directly.

### Claude's Discretion
- Internal naming conventions for the new constants and helper functions
- Exact synthetic data generation approach for the benchmark
- Whether to use a Convex internal action or a test harness for the benchmark measurement
- Test file organization for the new `getExtractionLimitForUser` helper

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Extraction System
- `convex/lib/queryBounds.ts` — Current `MAX_EXTRACTION_PAPERS_PER_JOB = 200` constant and all other query bounds
- `convex/extraction/queries.ts` — `getExtractionResults` (line 479) and `getExtractionResultsForExport` (line 582), both use `.take(MAX_EXTRACTION_PAPERS_PER_JOB)`
- `convex/extraction/mutations.ts` — `createExtractionJob` mutation that validates paper count

### Subscription & Entitlements
- `lib/billing/entitlements.ts` — `resolveEffectivePlan` function used to determine user's current plan; `SubscriptionPlan` = `"free" | "go" | "pro" | "enterprise"`
- `convex/subscriptions/queries.ts` — Existing `getPlanTier` usage pattern with `resolveEffectivePlan`

### Error Handling
- `convex/lib/errors.ts` — `createError(code, message)` factory for typed `ConvexError` throwing; existing codes: `EXTRACTION_JOB_ALREADY_ACTIVE`, `EXTRACTION_JOB_NOT_FOUND`, `EXTRACTION_JOB_NOT_CANCELLABLE`, `EXTRACTION_PLAN_REQUIRED`
- `lib/toast/error-resolver.ts` — Client-side error-to-toast routing (for `EXTRACTION_LIMIT_EXCEEDED` in Phase 100)

### Research
- `.planning/research/PITFALLS.md` S4.1 — Critical analysis of 15 call sites affected by the 200->1000 bump
- `.planning/research/ARCHITECTURE.md` — Proposed constant architecture with `EXTRACTION_LIMITS_BY_TIER`
- `.planning/research/FEATURES.md` — Per-tier limit shape specification
- `.planning/research/SUMMARY.md` — Phase-by-phase delivery order and pitfall summary

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions (MUST read before writing any Convex code)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/lib/queryBounds.ts` — Central location for all query bounds; Phase 98 modifies this file directly
- `resolveEffectivePlan` in `lib/billing/entitlements.ts` — Already resolves user plan from subscription state; `getExtractionLimitForUser` wraps this
- `convex/lib/errors.ts` — `createError` factory for typed errors; use for `EXTRACTION_LIMIT_EXCEEDED` error code
- `convex/subscriptions/queries.ts` — Pattern for calling `resolveEffectivePlan` inside a Convex query handler

### Established Patterns
- Constants in `queryBounds.ts` use `SCREAMING_SNAKE_CASE` with JSDoc comments
- Convex queries follow the `query({ args, returns, handler })` pattern with explicit return validators
- Error codes are members of the `ErrorCode` discriminated union in `convex/lib/errors.ts`
- Tests live in `convex/extraction/*.test.ts` using Vitest with Convex test helpers (`createMockQueryCtx`, `createMockMutationCtx`)
- No per-tier/per-plan branching exists in extraction domain today — this phase introduces the first

### Integration Points
- `getExtractionResults` query — consumed by `app/extraction/[jobId]/extraction-results-client.tsx`
- `getExtractionResultsForExport` query — consumed by `lib/extraction/export.ts`
- `getExtractionJobMetrics` — uses `MAX_EXTRACTION_PAPERS_PER_JOB * 10` (2000) for results `.take()` — must switch to `MAX_EXTRACTION_RESULTS_QUERY`
- `getPendingPapers` — internal query, uses `.take(MAX_EXTRACTION_PAPERS_PER_JOB)` — must switch to `MAX_EXTRACTION_RESULTS_QUERY`
- All 15 call sites importing `MAX_EXTRACTION_PAPERS_PER_JOB` must be audited during the split

</code_context>

<specifics>
## Specific Ideas

- The `MAX * 10` multiplier in `finalizeJobIfDone` is a known hazard — research confirmed it's load-bearing but should be replaced with a direct count query or aggregate index rather than scaled with the new 1000 limit.
- The benchmark MUST run before the constant bump is committed — this is a gate, not a nice-to-have.
- `SubscriptionPlan` type must match the existing plan enum used by `resolveEffectivePlan` (currently `free/go/pro/enterprise`).
- `createExtractionJob` currently throws `VALIDATION_ERROR` for over-limit; Phase 100 will introduce the dedicated `EXTRACTION_LIMIT_EXCEEDED` code with per-tier messaging.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 98-pre-flight-hard-limit-foundation*
*Context gathered: 2026-04-15*
*Context updated: 2026-04-15 (auto-mode refresh with codebase verification)*
