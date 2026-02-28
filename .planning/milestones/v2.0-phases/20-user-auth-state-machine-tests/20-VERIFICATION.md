---
phase: 20
status: passed
verified: 2026-02-28
---

# Phase 20: User Auth & State Machine Tests - Verification

## Phase Goal
Auth state machine enforces correct access control and user creation produces atomically correct initial state

## Requirement Coverage

| Req ID | Description | Plan | Test File | Status |
|--------|-------------|------|-----------|--------|
| AUTH-01 | assertActiveUser allows active, throws FORBIDDEN for suspended/deleted | 20-01 | tests/auth-state-machine.test.ts | PASSED |
| AUTH-02 | createUserWithDefaults atomically creates user + credits + subscription | 20-01 | tests/user-creation.test.ts | PASSED |
| AUTH-03 | ensureUser creates on first login, updates lastLoginAt on return | 20-02 | tests/ensure-user.test.ts | PASSED |
| AUTH-04 | syncProfileFromSession patches only blank fields, preserves existing | 20-02 | tests/sync-profile.test.ts | PASSED |

## must_haves Verification

### Plan 20-01 Truths
- [x] requireAuth allows active users through (assertActiveUser behavior)
- [x] requireAuth throws FORBIDDEN with 'Account suspended' for suspended users
- [x] requireAuth throws FORBIDDEN with 'Account deleted' for deleted users
- [x] requireAuth throws UNAUTHENTICATED when no identity
- [x] requireAuth throws UNAUTHENTICATED when user not found
- [x] createUserWithDefaults inserts into users table with state active
- [x] createUserWithDefaults inserts into credits table with correct freeBalance
- [x] createUserWithDefaults inserts into subscriptions table with plan free and status active
- [x] createUserWithDefaults makes exactly 3 db.insert calls (atomicity)
- [x] createUserWithDefaults returns the userId from the users insert

### Plan 20-02 Truths
- [x] ensureUser creates new user on first login via createUserWithDefaults
- [x] ensureUser updates lastLoginAt on return visit without overwriting existing profile fields
- [x] ensureUser throws FORBIDDEN for suspended existing user
- [x] ensureUser throws FORBIDDEN for deleted existing user
- [x] ensureUser patches blank profile fields from identity on return visit
- [x] ensureUser does not patch non-blank profile fields on return visit
- [x] syncProfileFromSession patches only blank profile fields
- [x] syncProfileFromSession preserves existing non-empty values
- [x] syncProfileFromSession does not call db.patch when no fields need updating
- [x] syncProfileFromSession sets updatedAt when patching fields

### Artifacts
- [x] tests/auth-state-machine.test.ts exists (6 tests, 110 lines)
- [x] tests/user-creation.test.ts exists (8 tests, 139 lines)
- [x] tests/ensure-user.test.ts exists (8 tests, 176 lines)
- [x] tests/sync-profile.test.ts exists (10 tests, 182 lines)

### Key Links
- [x] tests/auth-state-machine.test.ts imports from convex/lib/auth.ts
- [x] tests/user-creation.test.ts imports from convex/lib/userCreation.ts
- [x] tests/ensure-user.test.ts tests convex/users/mutations.ts handler
- [x] tests/sync-profile.test.ts tests convex/users/mutations.ts handler

## Test Results

```
Test Files  63 passed (63)
     Tests  575 passed (575)
```

All 32 new tests pass. Full suite of 575 tests pass with zero regressions.

## Success Criteria Verification

1. [x] `assertActiveUser` allows active users through, throws FORBIDDEN for suspended users, and throws FORBIDDEN for deleted users
2. [x] `createUserWithDefaults` atomically creates a user row, a credits row (freeBalance=2000), and a subscription row (plan=free, status=active)
3. [x] `ensureUser` creates a new user on first login and updates only `lastLoginAt` on return visits without overwriting existing profile fields
4. [x] `syncProfileFromSession` patches only blank profile fields and preserves existing non-empty values

## Result

**Status: PASSED**

All 4 requirements verified. All 20 must_have truths confirmed. Full test suite green.
