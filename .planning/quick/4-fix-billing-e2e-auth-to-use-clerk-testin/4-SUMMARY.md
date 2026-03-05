---
phase: quick-4
plan: 01
subsystem: e2e
tags: [e2e, clerk, auth, billing]
key-files:
  modified:
    - e2e/billing/fixtures.ts
decisions:
  - "Use emailAddress-only clerk.signIn (testing-token bypass) instead of strategy:password in billing fixtures"
metrics:
  duration: "~2 minutes"
  completed: "2026-03-05"
  tasks: 1
  files: 1
---

# Quick Task 4: Fix Billing E2E Auth to Use Clerk Testing Token Summary

**One-liner:** Switched billing E2E `clerkUser` fixture from `strategy:"password"` to emailAddress-only `clerk.signIn` call, activating Clerk's testing-token bypass.

## What Was Done

The billing E2E fixture `e2e/billing/fixtures.ts` was using `signInParams: { strategy: "password", identifier, password }` which bypasses the testing-token mechanism set up by `clerkSetup()` in `global.setup.ts`. This caused billing tests to land on the login page instead of `/settings/billing`.

The fix adopts the same pattern used in `e2e/auth.spec.ts`: calling `clerk.signIn({ page, emailAddress: email })` with no strategy or password params, which activates the testing-token bypass.

## Changes

- `ClerkTestUser` type: removed `password` field (irrelevant to testing-token flow)
- `clerk.signIn` call: replaced `signInParams` block with `emailAddress: email` at top level
- `use(...)` yield: removed `password` from yielded object to match updated type

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- Commit `6792c9d` exists
- `e2e/billing/fixtures.ts` uses `emailAddress: email` pattern (no strategy/password)
- TypeScript reports no errors in fixtures.ts
