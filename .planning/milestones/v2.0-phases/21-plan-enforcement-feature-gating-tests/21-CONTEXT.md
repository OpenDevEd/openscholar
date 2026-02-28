# Phase 21: Plan Enforcement & Feature Gating Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Test plan configuration contracts (PLAN_CONFIG for free/go/pro/enterprise), tier enforcement (getPlanTier, getFreeCreditCapForPlan, getPlanFromPriceId, requirePlanTier), server-side feature flag guards (requireCreditsEnabled, requireCreditTopupsEnabled, requireSubscriptionsEnabled with env var isolation), and canonical subscription selection priority. No production code changes — tests only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- How to test PLAN_CONFIG correctness (snapshot vs explicit assertions per plan)
- How to isolate env vars for feature flag guard tests (vi.resetModules pattern)
- How to test requirePlanTier throw/pass behavior across tier combinations
- How to construct test data for selectCanonicalSubscription priority ordering
- Test organization (one file per function group vs grouped by concern)
- Edge case selection for unknown plan/priceId inputs

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Success criteria are fully defined in ROADMAP.md (PLAN-01 through PLAN-05).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-plan-enforcement-feature-gating-tests*
*Context gathered: 2026-02-28*
