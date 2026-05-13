# Plan 02 — Introduce SSOT field-object pattern on `users` as exemplar

## Goal

Land the canonical SSOT pattern on exactly one table (`users`), establishing:

1. The `xFields` field-object convention co-located with the validator.
2. The `AssertExactDoc<TableName, Validator>` type helper that surfaces drift in `tsc --noEmit`.
3. The migration shape that every subsequent plan (03, 04, 05, 06) copies verbatim.

After this plan, `users` is the working reference. Every future contributor opening `convex/lib/validators.ts` sees the pattern in concrete code and propagates it.

## Scope

- Two files:
  - `convex/lib/validators.ts` — introduce `AssertExactDoc`, introduce `userFields`, rewrite `userValidator` to spread `userFields`, add the `const _check_userValidator: AssertExactDoc<"users", typeof userValidator> = true;` guard.
  - `convex/schema.ts` — change `users: defineTable({...inlined fields...})` to `users: defineTable(userFields)`, import `userFields` from `./lib/validators`.
- Out of scope: every other table. They migrate in plans 03–06.

## Design

### Step 1 — Add the type helper

Top of `convex/lib/validators.ts`, after the `import { v }` line:

```ts
import { v, type Infer } from "convex/values";
import type { Doc, TableNames } from "../_generated/dataModel";

/**
 * Compile-time invariant: the runtime row type for `T` is exactly the
 * `Infer<>` shape of the mirror validator `V`. Drift in either direction
 * collapses `_AssertExactDoc<T, V>` to a string literal that fails to
 * assign to `true`, surfacing the bug under `tsc --noEmit`.
 *
 * Used as:
 *   const _check_xValidator: AssertExactDoc<"x", typeof xValidator> = true;
 *
 * Place the `_check_` line directly under each mirror validator and
 * (re-)read it during code review: it is the structural contract.
 */
export type AssertExactDoc<
  T extends TableNames,
  V extends { _type: object },
> = [Doc<T>] extends [Infer<V>]
  ? [Infer<V>] extends [Doc<T>]
    ? true
    : "validator has fields the table does not (validator is wider)"
  : "table has fields the validator does not (validator is narrower)";
```

Notes:
- `Doc<T>` already includes `_id` and `_creationTime`; the validator does too, so the comparison is apples-to-apples.
- `[X] extends [Y]` (the bracket-wrapped form) prevents TypeScript from distributing over unions, which is what we want — full structural compare.
- The two failure-case string literals give the reviewer a direction. Either side can be tightened.

### Step 2 — Add `userFields`

Replace the current `userValidator` block:

```ts
export const userFields = {
  clerkId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  state: userStateValidator,
  lastLoginAt: v.optional(v.number()),
  libraryItemCount: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  ...userFields,
});

const _check_userValidator: AssertExactDoc<"users", typeof userValidator> = true;
```

### Step 3 — Update `convex/schema.ts`

```ts
// top of file
import {
  errorCodeValidator,
  searchFiltersValidator,
  structuredErrorValidator,
} from "./extraction/validators";
import { userFields } from "./lib/validators";

// inside defineSchema(...)
users: defineTable(userFields)
  .index("by_clerkId", ["clerkId"])
  .index("by_email", ["email"])
  .index("by_state", ["state"]),
```

The indexes attached to `users` are preserved verbatim — only the `defineTable` argument changes shape.

## TDD sequence

1. **R1 (red)**: in `convex/lib/validators.ts`, temporarily insert a deliberately-drifted check:

   ```ts
   const _check_userValidator: AssertExactDoc<"users", typeof userValidator> = true;
   ```

   Then comment out (or omit) the `state` field from `userFields` in the same edit. Run `npx tsc --noEmit` — the `_check_userValidator` line should error with the validator-wider message (because the row has `state` but the validator spreads a field-object that doesn't).

   This is the red proof that the type guard works. Once observed, restore `state`.

2. **G1 (green)**: with `state` restored, `npx tsc --noEmit` is clean. `userValidator` and `userFields` are aligned by construction.

3. **R2 (red)**: temporarily inject a phantom `lastSeenAt: v.optional(v.number())` into `userFields` only (not in the schema's `users` table — but you cannot test that here because `userFields` IS the table now). Skip this test for `users` since the field-object is shared. Instead, the test runs at the moment we migrate the SECOND table in plan 03 — a manual drift attempt there proves the guard fires.

4. **G2 (green)**: nothing else to do for `users`. The TS guard *is* the test.

## Files touched

- `convex/lib/validators.ts:1-65` — add `AssertExactDoc`, add `userFields`, rewrite `userValidator`, add `_check_userValidator` guard.
- `convex/schema.ts:1-110` — add `userFields` import, replace `users: defineTable({...})` with `users: defineTable(userFields)`.

## Migration stance

Pure refactor. The keys, types, and optionality of every `users` column are byte-identical before and after. No dev DB action. No schema validator complaint expected.

## Test plan

- `npx tsc --noEmit` — clean. The `_check_userValidator: AssertExactDoc<...> = true;` guard is the actual test.
- `npx vitest run convex/users` — every user-related test passes unchanged. The runtime shape is identical.
- Manually verify drift detection one-shot during TDD step R1 above; revert immediately.

## Deployability gate

After the commit:

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
- `npx pm2 logs next --lines 5 --nostream` shows recent `✓ Compiled` with no `Type error`.
- No `Schema validator complaint` line in the convex push log — if one appears, the field-object is not byte-identical to the prior `defineTable` argument and the plan is violated.

## Acceptance criteria

- `convex/lib/validators.ts` exports `AssertExactDoc` and `userFields` and contains the `_check_userValidator` guard line.
- `convex/schema.ts` imports `userFields` and uses `defineTable(userFields)`.
- `npx tsc --noEmit` clean.
- Convex push lands with `✔ Convex functions ready!`.
- Demonstrated (and reverted) drift detection: removing a field from `userFields` makes `tsc` fail with a `AssertExactDoc` mismatch.
- No behavioral change in any user-returning query.

## Known pitfalls

- **`AssertExactDoc` constraint `V extends { _type: object }`** — Convex validators carry a `_type` property that captures the inferred type. The constraint narrows `V` to validators specifically so `Infer<V>` resolves correctly. If TypeScript complains the constraint is wrong, use `V extends Validator<any, any, any>` from `convex/values` instead — the goal is to accept any `v.object(...)` result.
- **Spread order matters**: `_id` and `_creationTime` come FIRST in the validator's `v.object(...)`, then `...userFields`. Convex requires `_id`/`_creationTime` to be the first two keys for the row-shape recognizer. Do not flip the spread order.
- **`defineTable(userFields)` does NOT include `_id`/`_creationTime`** — those are added automatically by `defineTable`. Only the validator wraps them explicitly. The field-object must NOT contain `_id` or `_creationTime`.
- **Imports**: `convex/schema.ts` already imports from `./extraction/validators`; importing from `./lib/validators` is the same pattern. No circular import — `convex/lib/validators.ts` does not import from `./schema`.
- **`Doc<TableName>` is generated** by `npx convex codegen`. If `_generated/dataModel.d.ts` is stale, `tsc --noEmit` will report `Doc<"users">` as `unknown`. Run `npx convex dev --once` or wait for the pm2 dev push before relying on the type check.
- **Comment hygiene**: do not write a multi-line explanation above `userFields` repeating what the schema comment already says. The field-object IS the schema; comments belong on the field-object only, and the schema's `// USERS - …` banner stays where it is.
