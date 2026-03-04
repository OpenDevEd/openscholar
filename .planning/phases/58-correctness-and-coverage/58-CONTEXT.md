# Phase 58: Correctness and Coverage - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate credit deduction concurrency safety via Convex OCC, fix the silent OpenAlex email fallback to fail loudly, and close 3 test coverage gaps (subscription cron correction path, GROBID URL discovery fallback chain). No new features — this phase hardens existing behavior and proves correctness through tests.

</domain>

<decisions>
## Implementation Decisions

### OpenAlex failure mode
- Throw and halt extraction when `OPENALEX_CONTACT_EMAIL` is absent — no silent `admin@example.com` fallback
- Validate at point of use (right before the OpenAlex API call), not at startup — only fails when OpenAlex is actually needed
- Backend error only — user sees generic extraction failure; admin sees the real cause (`OPENALEX_CONTACT_EMAIL not configured`) in Convex logs
- Test uses env var reset pattern: `vi.resetModules()` + `process.env` manipulation + re-import, matching existing codebase convention

### Credit concurrency
- Fire 5-10 concurrent `deductCredits` mutations on the same user via `convex-test` — assert final balance is never negative
- If Convex OCC proves sufficient (no negative balances), skip per-user workpool — document OCC proof in test comment
- Cover both scenarios: (1) sufficient balance with concurrent drains (all succeed, balance=0), (2) insufficient balance race (some fail with INSUFFICIENT_CREDITS, balance>=0)
- Add concurrency tests to existing `convex/credits/deduct-credits.test.ts` in a new `describe('concurrency')` block

### GROBID fallback
- When all GROBID endpoints fail, throw a descriptive error listing all attempted URLs and their failures
- Test uses mocked HTTP/fetch calls to simulate all endpoints failing — no real GROBID server needed
- Cover both failure path (all fail -> throws) and happy path (first fails, second succeeds -> returns working URL)
- Test file: `convex/extraction/grobid.test.ts` — co-located with source, matching existing pattern

### Subscription cron test
- Use `convex-test` with real Convex DB operations + mocked Stripe API response
- Cover both expanded customer object (`{id: "cus_xxx", ...}`) and string customer ID (`"cus_xxx"`) shapes per success criteria

### Claude's Discretion
- Exact number of concurrent mutations in credit stress test (5-10 range)
- Specific error message wording for OpenAlex and GROBID failures
- Whether to extract subscription correction logic into a testable helper or test the full mutation

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/credits/deduct-credits.test.ts`: Existing deduction tests with `convex-test` setup and `seedUserWithCredits` helper — extend for concurrency
- `convex/extraction/grobid.ts`: Discovery function with `DOCKER_GROBID_URL`, `LOCAL_GROBID_URL`, `HOST_GROBID_URL` constants — test targets lines 107-120
- `convex/extraction/actions.ts:141`: OpenAlex User-Agent line to modify — replace `?? "admin@example.com"` with validation throw
- `convex/maintenance/internal.ts`: `checkSubscriptionStatus` with `(fresh.customer as any)?.id` pattern — test target

### Established Patterns
- `vi.resetModules()` + `process.env` manipulation for env-var-dependent tests (documented in TESTING.md)
- `convex-test` with `convexTest(schema)` for Convex integration tests (edge-runtime environment)
- `expect(...).rejects.toThrow("SUBSTRING")` for error message assertions
- Inline `createMockCtx()` factories for mock contexts

### Integration Points
- OpenAlex validation connects to the extraction action pipeline in `convex/extraction/actions.ts`
- Credit concurrency connects to `convex/credits/internal.ts` deductCredits mutation
- GROBID test connects to `convex/extraction/grobid.ts` discovery function
- Subscription cron test connects to `convex/maintenance/internal.ts` correction logic

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 58-correctness-and-coverage*
*Context gathered: 2026-03-04*
