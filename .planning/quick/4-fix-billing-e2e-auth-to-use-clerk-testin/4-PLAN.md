---
phase: quick-4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - e2e/billing/fixtures.ts
autonomous: true
requirements: [QUICK-4]

must_haves:
  truths:
    - "Billing E2E tests sign in via Clerk testing-token bypass, not password strategy"
    - "All billing specs land on /settings/billing instead of the login page"
  artifacts:
    - path: "e2e/billing/fixtures.ts"
      provides: "Updated clerkUser fixture using testing-token sign-in"
  key_links:
    - from: "e2e/billing/fixtures.ts clerkUser fixture"
      to: "clerk.signIn"
      via: "emailAddress-only call (no strategy/password)"
      pattern: "clerk\\.signIn.*emailAddress"
---

<objective>
Fix the billing E2E `clerkUser` fixture so sign-in uses Clerk's testing-token bypass instead of
`strategy: "password"`, which fails to establish a session.

Purpose: Billing tests are landing on the login page because `strategy: "password"` does not
activate the testing-token bypass set up by `clerkSetup()` in global.setup.ts. Switching to the
same pattern used by `e2e/auth.spec.ts` (emailAddress-only, no strategy) fixes this.

Output: Updated `e2e/billing/fixtures.ts` with working sign-in approach.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@e2e/billing/fixtures.ts
@e2e/auth.spec.ts
@e2e/global.setup.ts

<interfaces>
<!-- Working sign-in pattern from e2e/auth.spec.ts -->
```typescript
// Testing-token bypass — no strategy, no password param
await clerk.signIn({
  page,
  emailAddress,   // top-level param, NOT nested inside signInParams
});
```

<!-- Current broken pattern in fixtures.ts (lines 77-84) -->
```typescript
await clerk.signIn({
  page,
  signInParams: {
    strategy: "password",
    identifier: email,
    password,
  },
});
```

<!-- clerk.signIn signature from @clerk/testing/playwright -->
// When called without strategy it activates the testing-token bypass
// established by clerkSetup() in global.setup.ts.
// The emailAddress param is passed at the top level, not inside signInParams.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Switch clerkUser fixture to testing-token sign-in</name>
  <files>e2e/billing/fixtures.ts</files>
  <action>
In `e2e/billing/fixtures.ts`, make the following targeted changes:

1. **Remove `password` from `ClerkTestUser` type** (line 16) — callers never use it and it
   suggests the password strategy is relevant to test authors.
   ```typescript
   // Before
   type ClerkTestUser = {
     id: string;
     email: string;
     password: string;
   };
   // After
   type ClerkTestUser = {
     id: string;
     email: string;
   };
   ```

2. **Replace the `clerk.signIn` call** (lines 77-84) with the emailAddress-only pattern:
   ```typescript
   // Before
   await clerk.signIn({
     page,
     signInParams: {
       strategy: "password",
       identifier: email,
       password,
     },
   });
   // After
   await clerk.signIn({
     page,
     emailAddress: email,
   });
   ```

3. **Update `use(...)` call** (line 92) — remove `password` from the yielded object:
   ```typescript
   // Before
   await use({ id: user.id, email, password });
   // After
   await use({ id: user.id, email });
   ```

The user creation block (lines 60-72) stays unchanged — fresh users per test for isolation is
correct and desirable. Only the sign-in mechanism changes.

Do NOT change anything else in the file.
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx tsc --noEmit --project tsconfig.json 2>&1 | grep "e2e/billing/fixtures" || echo "No type errors in fixtures.ts"</automated>
  </verify>
  <done>
    - `fixtures.ts` uses `clerk.signIn({ page, emailAddress: email })` with no strategy/password params
    - `ClerkTestUser` type has no `password` field
    - TypeScript reports no errors in the billing fixture file
  </done>
</task>

</tasks>

<verification>
After the change, run the billing E2E tests against the dev server to confirm tests reach
`/settings/billing` instead of the login page:

```bash
cd /Users/mcharrad/Documents/Github/openalex-count
npx playwright test e2e/billing/ --reporter=list 2>&1 | head -60
```

If the full suite is too slow, smoke-check with a single spec:
```bash
npx playwright test e2e/billing/ --reporter=list -x 2>&1 | head -80
```
</verification>

<success_criteria>
- `e2e/billing/fixtures.ts` sign-in uses `emailAddress` param (testing-token bypass), not `strategy: "password"`
- TypeScript compiles without errors
- Billing specs navigate to `/settings/billing` after sign-in (not redirected to login page)
</success_criteria>

<output>
No SUMMARY file needed for quick tasks. Update `.planning/STATE.md` Quick Tasks Completed table
with entry: `| 4 | Fix billing e2e auth to use clerk testing token | 2026-03-05 | {commit} | [4-fix-billing-e2e-auth-to-use-clerk-testin](./quick/4-fix-billing-e2e-auth-to-use-clerk-testin/) |`
</output>
