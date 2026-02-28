---
phase: 20-user-auth-state-machine-tests
plan: 02
subsystem: testing
tags: [vitest, convex, auth, ensureUser, syncProfile, mutation-handler-testing]

requires:
  - phase: 14
    provides: "Multi-environment Vitest config and test infrastructure"
  - phase: 20-01
    provides: "Mock ctx patterns and ConvexError assertion pattern"
provides:
  - "ensureUser first-login vs return-visit behavior tests"
  - "syncProfileFromSession blank-field patching and existing-value preservation tests"
affects: [21-plan-enforcement-feature-gating-tests]

tech-stack:
  added: []
  patterns: [vi-mock-mutation-handler-extraction, vi-hoisted-mock-values]

key-files:
  created:
    - tests/ensure-user.test.ts
    - tests/sync-profile.test.ts
  modified: []

key-decisions:
  - "Mocked convex/_generated/server mutation() to return definition, exposing .handler for direct testing"
  - "Used vi.hoisted() for mock values referenced in vi.mock factories (avoids hoisting initialization error)"
  - "Mocked createUserWithDefaults to verify first-login delegation without testing creation atomicity again"
  - "Used Object.assign for mockUser state reset in beforeEach to avoid test pollution"

patterns-established:
  - "Mutation handler extraction: vi.mock('../convex/_generated/server', () => ({ mutation: (def) => def })) exposes .handler"
  - "vi.hoisted pattern for mock values: vi.hoisted(() => { const mock = vi.fn(); return { mock }; })"
  - "Mixed blank/filled field testing: systematic coverage of all field combination states"

requirements-completed: [AUTH-03, AUTH-04]

duration: 2min
completed: 2026-02-28
---

# Phase 20-02: ensureUser & syncProfileFromSession Tests Summary

**First-login/return-visit behavior tests and profile sync field preservation tests with mutation handler extraction**

## Performance

- **Duration:** 2 min
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- ensureUser tested for first-login (delegates to createUserWithDefaults) and return-visit (patches lastLoginAt only)
- ensureUser blank-field patching from identity verified (only patches undefined/empty fields)
- syncProfileFromSession tested for 10 scenarios covering all blank/filled field combinations
- Mutation handler extraction pattern established: mock `mutation()` to return definition, access `.handler`

## Task Commits

1. **Task 1 + Task 2: ensureUser and syncProfileFromSession tests** - `b250640` (test)

## Files Created/Modified
- `tests/ensure-user.test.ts` - 8 tests for ensureUser first-login, return-visit, state guards
- `tests/sync-profile.test.ts` - 10 tests for syncProfileFromSession field preservation

## Decisions Made
- Used vi.hoisted() to define mock values before vi.mock factory hoisting (required by Vitest)
- Mocked createUserWithDefaults instead of re-testing its internals (already covered by 20-01)
- Reset mockUser state in beforeEach using Object.assign to prevent test pollution

## Deviations from Plan
- Used `vi.hoisted()` instead of direct top-level variable in vi.mock factory (required by Vitest hoisting rules)

## Issues Encountered
- Initial sync-profile test failed due to `vi.mock` factory hoisting -- `mockUser` variable not accessible before initialization. Fixed with `vi.hoisted()` pattern.

## Next Phase Readiness
- Mutation handler extraction pattern ready for Phase 21 (plan enforcement tests may need similar approach)
- vi.hoisted pattern documented for future reference

---
*Phase: 20-user-auth-state-machine-tests*
*Completed: 2026-02-28*
