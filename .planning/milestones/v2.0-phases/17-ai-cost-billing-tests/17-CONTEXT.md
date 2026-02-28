# Phase 17: AI Cost & Billing Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Test cost calculation, usage aggregation, and model registry functions. Verify correct pricing for all supported providers (OpenAI, Anthropic, Google, DeepSeek), usage summation edge cases, and model lookup/registry correctness. No production code changes — tests only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Test data construction for provider-specific pricing models
- How to verify cost calculation precision (floating point handling)
- How to test all known models without brittle coupling to the model list
- Test organization (one file per module vs grouped by concern)
- Edge case selection for aggregateUsage (empty array, single item, large numbers)
- How to handle unknown model/provider graceful degradation testing

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Success criteria are fully defined in ROADMAP.md (AICB-01 through AICB-04).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-ai-cost-billing-tests*
*Context gathered: 2026-02-28*
