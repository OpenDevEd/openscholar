# Phase 20: User Auth & State Machine Tests - Research

**Researched:** 2026-02-28
**Domain:** Convex auth state machine testing (unit tests with mocked context)
**Confidence:** HIGH

## Summary

Phase 20 tests four auth-related functions: `assertActiveUser` (pure synchronous guard), `createUserWithDefaults` (atomic user+credits+subscription creation), `ensureUser` (first-login vs return-visit mutation), and `syncProfileFromSession` (blank-field patching mutation). The functions live in `convex/lib/auth.ts`, `convex/lib/userCreation.ts`, and `convex/users/mutations.ts`.

The key constraint is convex-test issue #50 (`getUserIdentity` bug) which blocks full Convex mutation testing. The project's established mitigation (used in all prior phases) is to test extracted pure logic directly and mock `ctx.db`/`ctx.auth` at the module boundary. `assertActiveUser` is already a pure function accepting a `Doc<"users">` and returning or throwing -- no mocking needed. The other three functions require lightweight ctx mocking.

**Primary recommendation:** Test `assertActiveUser` as a pure function import. For `createUserWithDefaults`, `ensureUser`, and `syncProfileFromSession`, build minimal mock objects for `ctx.db` and `ctx.auth` using `vi.fn()`, then call the handler functions directly with those mocks. This follows the exact same pattern used in Phases 15-19.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation decisions are Claude's discretion.

### Claude's Discretion
- Test data construction for user states (active, suspended, deleted)
- How to mock/stub Convex mutation context for user creation atomicity tests
- How to verify atomicity of createUserWithDefaults (credits row + subscription row created together)
- How to test ensureUser first-login vs return-visit without a real database
- How to verify syncProfileFromSession preserves non-empty fields while patching blank ones
- Test organization (one file per function vs grouped by concern)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | `assertActiveUser` allows active users, throws FORBIDDEN for suspended/deleted | Pure function test -- import directly from `convex/lib/auth.ts`, pass user doc objects with different `state` values |
| AUTH-02 | `createUserWithDefaults` atomically creates user + credits + subscription rows | Mock `ctx.db.insert` with `vi.fn()`, verify three insert calls with correct table names and field values |
| AUTH-03 | `ensureUser` creates on first login, updates `lastLoginAt` on return without overwriting profile | Mock `ctx.auth.getUserIdentity`, `ctx.db.query().withIndex().unique()`, and `ctx.db.patch`; test two paths |
| AUTH-04 | `syncProfileFromSession` patches only blank fields, preserves existing values | Mock `requireAuth` to return user doc with mixed blank/filled fields, verify `ctx.db.patch` receives only blank field updates |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Test runner + assertions | Already configured in project with multi-env support |
| vi.fn() / vi.mock() | built-in | Function/module mocking | Standard vitest mocking, used throughout all prior test phases |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex/values (ConvexError) | project version | Error type checking | Verify FORBIDDEN errors thrown by assertActiveUser |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual ctx mocking | convex-test | Blocked by issue #50 (getUserIdentity bug) -- manual mocking is the established workaround |

## Architecture Patterns

### Source File Locations
```
convex/lib/auth.ts           # assertActiveUser (pure function), requireAuth, getOrCreateUserFromIdentity
convex/lib/userCreation.ts   # createUserWithDefaults (ctx.db.insert x3)
convex/lib/errors.ts         # createError -> ConvexError<{code, message}>
convex/lib/constants.ts      # FREE_SIGNUP_CREDIT_GRANT = 2000, PLAN_CONFIG
convex/lib/freeCredits.ts    # applyTierFreeCreditCap (used by createUserWithDefaults)
convex/users/mutations.ts    # ensureUser, syncProfileFromSession (Convex mutations)
```

### Test File Location
```
tests/
  auth-state-machine.test.ts   # AUTH-01: assertActiveUser state transitions
  user-creation.test.ts        # AUTH-02: createUserWithDefaults atomicity
  ensure-user.test.ts          # AUTH-03: ensureUser first-login vs return
  sync-profile.test.ts         # AUTH-04: syncProfileFromSession field preservation
```

### Pattern 1: Pure Function Testing (AUTH-01)
**What:** Import `assertActiveUser` directly and test with plain objects
**When to use:** Function has no ctx/db dependencies
**Example:**
```typescript
import { assertActiveUser } from "../convex/lib/auth";

const activeUser = { _id: "user1" as any, state: "active", /* ... */ } as any;
expect(assertActiveUser(activeUser)).toBe(activeUser);

const suspendedUser = { ...activeUser, state: "suspended" };
expect(() => assertActiveUser(suspendedUser)).toThrow();
```

**Note:** `assertActiveUser` is NOT exported from `convex/lib/auth.ts`. It's a module-private function. Two approaches:
1. Extract the logic to test (call `requireAuth` or `getOrCreateUserFromIdentity` which call `assertActiveUser` internally)
2. Test via the exported functions that delegate to it

Looking at the code more carefully: `assertActiveUser` is a **non-exported** function. However, `requireAuth` calls it and IS exported. The success criteria says "assertActiveUser allows active users through, throws FORBIDDEN for suspended/deleted" -- we can test this behavior through `requireAuth` which delegates to `assertActiveUser`, OR we can refactor to export it. Since this is tests-only phase (no production code changes), we test the behavior through the exported surface.

**Revised approach:** Mock `ctx.auth.getUserIdentity` and `ctx.db.query` to return users in different states, then call `requireAuth` and verify the assertActiveUser behavior.

### Pattern 2: Ctx Mocking for DB Operations (AUTH-02)
**What:** Build minimal mock ctx with `db.insert` as `vi.fn()`
**When to use:** Function calls `ctx.db.insert`/`ctx.db.patch`/`ctx.db.query`
**Example:**
```typescript
const insertResults = new Map();
const mockCtx = {
  db: {
    insert: vi.fn(async (table: string, doc: any) => {
      const id = `mock_${table}_id`;
      insertResults.set(table, { id, doc });
      return id;
    }),
  },
};

await createUserWithDefaults(mockCtx as any, {
  clerkId: "clerk_123",
  email: "test@example.com",
});

expect(mockCtx.db.insert).toHaveBeenCalledTimes(3);
expect(mockCtx.db.insert).toHaveBeenCalledWith("users", expect.objectContaining({ state: "active" }));
expect(mockCtx.db.insert).toHaveBeenCalledWith("credits", expect.objectContaining({ freeBalance: 2000 }));
expect(mockCtx.db.insert).toHaveBeenCalledWith("subscriptions", expect.objectContaining({ plan: "free", status: "active" }));
```

### Pattern 3: Query Chain Mocking (AUTH-03, AUTH-04)
**What:** Mock the Convex query builder chain (`query().withIndex().unique()`)
**When to use:** Functions that query for existing users before patching
**Example:**
```typescript
const mockCtx = {
  auth: {
    getUserIdentity: vi.fn().mockResolvedValue({
      subject: "clerk_123",
      email: "test@example.com",
      givenName: "Test",
      familyName: "User",
      pictureUrl: "https://example.com/avatar.jpg",
    }),
  },
  db: {
    query: vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        unique: vi.fn().mockResolvedValue(existingUser),
      }),
    }),
    patch: vi.fn(),
    insert: vi.fn(),
    get: vi.fn(),
  },
};
```

### Anti-Patterns to Avoid
- **Testing Convex mutations via convex-test with auth:** Blocked by issue #50 -- use direct handler calls with mocked ctx
- **Modifying production source files:** Phase scope is tests-only -- no changes to convex/lib/auth.ts or convex/users/mutations.ts
- **Testing internal function exports:** `assertActiveUser` is not exported -- test its behavior through `requireAuth`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Convex error matching | Custom error matchers | `expect(() => fn()).toThrow()` + check `ConvexError` data | Standard vitest assertions handle ConvexError |
| User document factories | Inline object literals everywhere | Shared `createMockUser(overrides)` helper | DRY, consistent test data |

## Common Pitfalls

### Pitfall 1: assertActiveUser is Not Exported
**What goes wrong:** Trying to import `assertActiveUser` directly from `convex/lib/auth.ts` fails
**Why it happens:** It's a module-private function
**How to avoid:** Test the behavior through `requireAuth` (which calls assertActiveUser internally) or through `getOrCreateUserFromIdentity`
**Warning signs:** TypeScript import error on `assertActiveUser`

### Pitfall 2: Convex Error Assertion
**What goes wrong:** `expect(() => fn()).toThrow("FORBIDDEN")` may not match because ConvexError wraps data
**Why it happens:** `createError` returns `new ConvexError({ code: "FORBIDDEN", message })` -- the thrown value is a ConvexError with data property
**How to avoid:** Use `expect(() => fn()).toThrow(ConvexError)` then check error.data.code, or use try/catch
**Warning signs:** Test expects string but gets object

### Pitfall 3: FREE_SIGNUP_CREDIT_GRANT Value
**What goes wrong:** Hardcoding 2000 in tests when the constant changes
**Why it happens:** The requirement says "freeBalance=2000" but the actual value comes from `applyTierFreeCreditCap` which applies a cap
**How to avoid:** Import `FREE_SIGNUP_CREDIT_GRANT` from constants and use it in assertions, or verify the result of `applyTierFreeCreditCap({ plan: "free", currentFreeBalance: 0, amountToAdd: 2000 })`
**Warning signs:** Magic number 2000 scattered in test assertions

### Pitfall 4: ensureUser Mutation Handler Access
**What goes wrong:** Trying to call `ensureUser` as a function -- it's a Convex mutation definition, not a plain function
**Why it happens:** `ensureUser` is defined as `mutation({ handler: async (ctx) => { ... } })` -- the handler is nested
**How to avoid:** Access the handler directly: since the function under test is embedded in a mutation definition, we need to either (a) mock the mutation wrapper, or (b) import the mutation and call its handler. The cleanest approach given the vi.mock pattern is to test the logic by constructing mock ctx and calling the handler function extracted from the mutation.
**Warning signs:** TypeScript errors about missing mutation context

### Pitfall 5: Date.now() Non-determinism
**What goes wrong:** Assertions on `lastLoginAt`, `createdAt`, `updatedAt` fail due to timing
**Why it happens:** `Date.now()` is called inside the handlers
**How to avoid:** Use `vi.useFakeTimers()` and `vi.setSystemTime()` to control time, or use `expect.any(Number)` for timestamp fields
**Warning signs:** Flaky tests that fail intermittently

## Code Examples

### Testing assertActiveUser Behavior via requireAuth
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConvexError } from "convex/values";

// We need to test assertActiveUser behavior through requireAuth
// since assertActiveUser is not exported
import { requireAuth } from "../convex/lib/auth";

function createMockCtx(user: any) {
  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue({ subject: "clerk_123" }),
    },
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(user),
        }),
      }),
    },
  };
}

describe("assertActiveUser (via requireAuth)", () => {
  it("allows active user through", async () => {
    const user = { _id: "user1", state: "active", clerkId: "clerk_123" };
    const ctx = createMockCtx(user);
    const result = await requireAuth(ctx as any);
    expect(result).toEqual(user);
  });

  it("throws FORBIDDEN for suspended user", async () => {
    const user = { _id: "user1", state: "suspended", clerkId: "clerk_123" };
    const ctx = createMockCtx(user);
    await expect(requireAuth(ctx as any)).rejects.toThrow(ConvexError);
  });
});
```

### Testing createUserWithDefaults Atomicity
```typescript
import { createUserWithDefaults } from "../convex/lib/userCreation";
import { FREE_SIGNUP_CREDIT_GRANT } from "../convex/lib/constants";

it("creates user, credits, and subscription atomically", async () => {
  const mockCtx = {
    db: {
      insert: vi.fn().mockResolvedValue("mock_user_id"),
    },
  };

  await createUserWithDefaults(mockCtx as any, {
    clerkId: "clerk_123",
    email: "test@example.com",
  });

  // Verify all three tables were inserted
  expect(mockCtx.db.insert).toHaveBeenCalledTimes(3);

  // Users table
  expect(mockCtx.db.insert).toHaveBeenNthCalledWith(1, "users",
    expect.objectContaining({ clerkId: "clerk_123", state: "active" }));

  // Credits table with correct freeBalance
  expect(mockCtx.db.insert).toHaveBeenNthCalledWith(2, "credits",
    expect.objectContaining({ freeBalance: expect.any(Number), paidBalance: 0 }));

  // Subscriptions table
  expect(mockCtx.db.insert).toHaveBeenNthCalledWith(3, "subscriptions",
    expect.objectContaining({ plan: "free", status: "active" }));
});
```

## Open Questions

1. **ensureUser handler access pattern**
   - What we know: ensureUser is a Convex `mutation()` definition with an embedded handler
   - What's unclear: Best way to access the handler for direct testing
   - Recommendation: Import the mutation object and test the handler's logic by constructing appropriate mock ctx. The Convex `mutation()` call returns an object whose handler can be invoked directly in tests (this is the established pattern for testing Convex functions without convex-test).

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of `convex/lib/auth.ts`, `convex/lib/userCreation.ts`, `convex/users/mutations.ts`
- `convex/lib/errors.ts` -- ConvexError wrapper pattern
- `convex/lib/constants.ts` -- FREE_SIGNUP_CREDIT_GRANT = 2000, PLAN_CONFIG
- `convex/lib/freeCredits.ts` -- applyTierFreeCreditCap used in createUserWithDefaults
- `convex/schema.ts` -- users, credits, subscriptions table schemas

### Secondary (MEDIUM confidence)
- Prior phase test patterns (tests/ai-batch.test.ts, tests/ai-cost.test.ts) -- vi.mock and vi.fn() patterns
- STATE.md blocker note on convex-test issue #50

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vitest already configured, patterns well-established across 7 completed phases
- Architecture: HIGH - source files inspected, function signatures and logic fully understood
- Pitfalls: HIGH - identified from direct code inspection (non-exported function, ConvexError wrapping, Date.now non-determinism)

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- testing pure functions against stable codebase)
