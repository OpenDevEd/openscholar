# Phase 20: User Auth & State Machine Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Test auth state machine access control (assertActiveUser for active/suspended/deleted states), user creation atomicity (createUserWithDefaults with credits and subscription), first-login vs return-visit behavior (ensureUser), and profile sync field preservation (syncProfileFromSession). No production code changes — tests only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Test data construction for user states (active, suspended, deleted)
- How to mock/stub Convex mutation context for user creation atomicity tests
- How to verify atomicity of createUserWithDefaults (credits row + subscription row created together)
- How to test ensureUser first-login vs return-visit without a real database
- How to verify syncProfileFromSession preserves non-empty fields while patching blank ones
- Test organization (one file per function vs grouped by concern)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Success criteria are fully defined in ROADMAP.md (AUTH-01 through AUTH-04).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-user-auth-state-machine-tests*
*Context gathered: 2026-02-28*
